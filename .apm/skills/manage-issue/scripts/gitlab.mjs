#!/usr/bin/env node
// Camino de GitLab de las skills del flujo. Cada skill lleva su copia de este fichero y todas son iguales.
// Elige el forge, lee GITLAB_TOKEN del .env del proyecto y llama a la API de GitLab con curl.
// curl respeta el proxy del sandbox. El token entra por stdin: no aparece en los argumentos ni en ficheros.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const FORGES = ["github", "gitlab"];
const MAX_PAGES = 1000;

export class GitLabError extends Error {
  constructor(message, { code = 1, status } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function git(cwd, ...args) {
  try {
    return (await exec("git", args, { cwd })).stdout.trim();
  } catch {
    return null;
  }
}

async function projectRoot(cwd) {
  const root = await git(cwd, "rev-parse", "--show-toplevel");
  if (!root) throw new GitLabError("No es un repositorio git.");
  return root;
}

// En un worktree sin .env en su raíz, vale el de la copia principal del repositorio.
async function envRoot(root) {
  if (existsSync(join(root, ".env"))) return root;
  const common = await git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
  if (common && basename(common) === ".git" && existsSync(join(dirname(common), ".env"))) return dirname(common);
  return null;
}

// El .env se lee línea a línea y no se ejecuta, con las mismas reglas que gh.sh. Gana la última línea.
export function envValue(text, name) {
  const pattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=(.*)$`);
  let raw = null;
  for (const line of text.split("\n")) {
    const match = line.replace(/\r$/, "").match(pattern);
    if (match) raw = match[1];
  }
  if (raw === null) return null;
  const value = raw.trim();
  // Entre comillas, el valor es lo de dentro. Sin comillas, un « # » empieza un comentario.
  const quoted = value.match(/^(?:"([^"]*)"|'([^']*)')(?:\s+#.*)?$/);
  if (quoted) return quoted[1] ?? quoted[2];
  return value.replace(/\s+#.*$/, "");
}

async function readEnvFile(root) {
  const base = await envRoot(root);
  return base ? { base, text: readFileSync(join(base, ".env"), "utf8") } : null;
}

// Un ajuste que no es secreto: primero el entorno y, si no está, el .env.
async function setting(name, { root, env }) {
  if (env[name]?.trim()) return env[name].trim();
  const file = await readEnvFile(root);
  return (file && envValue(file.text, name)) || null;
}

export async function readToken(root) {
  const file = await readEnvFile(root);
  if (!file) throw new GitLabError("Falta el fichero .env en la raíz del proyecto con GITLAB_TOKEN=tu_token.");
  if ((await git(file.base, "check-ignore", "-q", ".env")) === null) {
    throw new GitLabError("El .env no está en .gitignore. Añádelo antes de seguir: el token no puede subirse.");
  }
  const token = envValue(file.text, "GITLAB_TOKEN");
  // Las comillas, las barras invertidas y los caracteres de control romperían la configuración que lee curl.
  if (!token || !/^[\x21-\x7e]+$/.test(token) || /["\\]/.test(token)) {
    throw new GitLabError("El .env no tiene un GITLAB_TOKEN válido.");
  }
  return token;
}

// Admite git@host:grupo/proyecto.git, ssh://, https:// y http://. Una ruta local no tiene host.
export function parseRemote(remote) {
  const text = (remote ?? "").trim();
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(text)) {
    let url;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    if (!["ssh:", "git+ssh:", "https:", "http:"].includes(url.protocol) || !url.hostname) return null;
    // El puerto de un remoto web es el de la web; el de SSH no.
    return { host: url.hostname.toLowerCase(), webHost: url.protocol.startsWith("http") ? url.host.toLowerCase() : url.hostname.toLowerCase(), path: url.pathname };
  }
  const scp = text.match(/^(?:[^@/\\]+@)?([^/\\:]{2,}):(?!\/\/)(.+)$/);
  if (!scp) return null;
  const host = scp[1].toLowerCase();
  return { host, webHost: host, path: scp[2] };
}

function forgeUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }
  if (!url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new GitLabError("GIT_WORKFLOW_FORGE_URL tiene que ser una dirección https://, sin usuario ni parámetros.");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function projectPath(remotePath, url) {
  let path = decodeURIComponent(remotePath).replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  const prefix = decodeURIComponent(new URL(url).pathname).replace(/^\/+|\/+$/g, "");
  if (prefix && path.startsWith(`${prefix}/`)) path = path.slice(prefix.length + 1);
  if (!path.includes("/")) throw new GitLabError("El remoto origin no nombra un proyecto de GitLab (grupo/proyecto).");
  return path;
}

// GIT_WORKFLOW_FORGE manda. Sin ella, un origin en gitlab.com es GitLab y cualquier otro es GitHub.
export async function resolveForge({ cwd = process.cwd(), env = process.env } = {}) {
  const root = await projectRoot(cwd);
  const declared = (await setting("GIT_WORKFLOW_FORGE", { root, env }))?.toLowerCase() ?? null;
  if (declared && !FORGES.includes(declared)) throw new GitLabError("GIT_WORKFLOW_FORGE tiene que ser github o gitlab.");
  const override = await setting("GIT_WORKFLOW_FORGE_URL", { root, env });
  const url = override ? forgeUrl(override) : null;
  const remote = parseRemote(await git(root, "remote", "get-url", "origin"));
  const forge = declared ?? (remote?.host === "gitlab.com" ? "gitlab" : "github");
  if (forge === "github") return { forge, root, host: remote?.host ?? null, declared: Boolean(declared) };
  if (!remote) throw new GitLabError("Falta el remoto origin con la dirección del proyecto de GitLab.");
  const base = url ?? `https://${remote.webHost}`;
  return { forge, root, host: new URL(base).host, url: base, project: projectPath(remote.path, base), declared: Boolean(declared) };
}

// En un host que no es github.com ni gitlab.com, sin forge declarado y sin token, el aviso nombra cómo declararlo.
export async function checkForge(options = {}) {
  const found = await resolveForge(options);
  if (found.forge === "github" && !found.declared && found.host && found.host !== "github.com") {
    const file = await readEnvFile(found.root);
    if (!file || !envValue(file.text, "GITHUB_TOKEN")) {
      throw new GitLabError(
        `Falta GITHUB_TOKEN en el .env y ${found.host} se trata como GitHub. Si tu forge es GitLab, declara GIT_WORKFLOW_FORGE=gitlab.`,
      );
    }
  }
  return found;
}

// curl puede escribir varios bloques de cabeceras (proxy, 100 Continue): vale el último.
export function parseHeaders(text) {
  const blocks = text.replace(/\r\n/g, "\n").split("\n\n").filter((block) => block.trim().startsWith("HTTP/"));
  const headers = {};
  for (const line of (blocks.at(-1) ?? "").split("\n").slice(1)) {
    const colon = line.indexOf(":");
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return headers;
}

async function runCurl(args, input) {
  const child = exec("curl", args, { maxBuffer: 1024 * 1024 });
  // Si curl no arranca, escribir en su stdin falla: el error que importa es el de la ejecución.
  child.child.stdin.on("error", () => {});
  child.child.stdin.end(input);
  return (await child).stdout;
}

function detail(data) {
  const value = data?.message ?? data?.error_description ?? data?.error;
  if (!value) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function failure(status, data) {
  if (status >= 300 && status < 400) {
    return `GitLab redirige la petición (HTTP ${status}) y no se sigue. Revisa origin o declara GIT_WORKFLOW_FORGE_URL.`;
  }
  if (status === 401) return "GitLab rechaza el token del .env. Crea otro y cámbialo.";
  if (status === 403 && data?.error === "insufficient_scope") return "Al GITLAB_TOKEN le falta el permiso api.";
  if (status === 403) return `GitLab no permite esta acción a la cuenta del token (HTTP 403). ${detail(data)}`.trim();
  if (status === 404) return "GitLab no lo encuentra o la cuenta del token no lo ve (HTTP 404).";
  return `GitLab respondió HTTP ${status}. ${detail(data)}`.trim();
}

export function createClient({ url, project, token }, { run = runCurl } = {}) {
  // Lo que venga de fuera pasa por aquí antes de mostrarse.
  const redact = (text) => String(text).split(token).join("[token]");

  async function send(method, address, { body, headers = {} } = {}) {
    const folder = await mkdtemp(join(tmpdir(), "gitlab-"));
    try {
      const output = join(folder, "body");
      const dump = join(folder, "headers");
      // -q va el primero: ignora ~/.curlrc. Sin --location, el token no sigue ninguna redirección.
      const args = ["-q", "--silent", "--show-error", "--globoff", "--proto", "=https", "--max-time", "30",
        "--request", method, "--config", "-", "--dump-header", dump, "--output", output, "--write-out", "%{http_code}"];
      for (const [name, value] of Object.entries(headers)) args.push("--header", `${name}: ${value}`);
      if (body !== undefined) {
        const input = join(folder, "request.json");
        await writeFile(input, JSON.stringify(body), { mode: 0o600 });
        args.push("--header", "Content-Type: application/json", "--data-binary", `@${input}`);
      }
      args.push("--url", address);

      let status;
      try {
        status = Number(await run(args, `header = "PRIVATE-TOKEN: ${token}"\n`));
      } catch (error) {
        if (error.code === "ENOENT") throw new GitLabError("curl no está instalado. Hace falta para GitLab.");
        throw new GitLabError(redact(`No se pudo conectar con GitLab. ${error.stderr?.trim() ?? ""}`.trim()));
      }

      const text = await readFile(output, "utf8").catch(() => "");
      let data = null;
      try {
        data = text.trim() ? JSON.parse(text) : null;
      } catch {
        if (status >= 200 && status < 300) throw new GitLabError("GitLab no respondió JSON. Revisa GIT_WORKFLOW_FORGE_URL.");
      }
      const ok = (status >= 200 && status < 300) || status === 304;
      if (!ok) throw new GitLabError(redact(failure(status, data)), { status });
      return { status, headers: parseHeaders(await readFile(dump, "utf8").catch(() => "")), data };
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  function address(path, query = {}) {
    const search = new URLSearchParams();
    for (const [name, value] of Object.entries(query)) if (value !== undefined) search.append(name, value);
    const suffix = search.toString();
    return `${url}/api/v4/${path}${suffix ? `?${suffix}` : ""}`;
  }

  const request = (method, path, { query, body, headers } = {}) => send(method, address(path, query), { body, headers });

  // Recorre todas las páginas siguiendo x-next-page.
  async function paginate(path, query = {}) {
    const items = [];
    let page = "1";
    for (let count = 0; page; count++) {
      if (count >= MAX_PAGES) throw new GitLabError("GitLab devuelve demasiadas páginas.");
      const response = await request("GET", path, { query: { ...query, per_page: 100, page } });
      if (!Array.isArray(response.data)) throw new GitLabError("GitLab no devolvió una lista.");
      items.push(...response.data);
      page = response.headers["x-next-page"] || null;
    }
    return items;
  }

  async function graphql(query, variables = {}) {
    const { data } = await send("POST", `${url}/api/graphql`, { body: { query, variables } });
    if (data?.errors?.length) {
      throw new GitLabError(redact(`GitLab rechazó la consulta. ${data.errors.map((error) => error.message).join(" ")}`));
    }
    return data?.data;
  }

  // La ruta de un recurso del proyecto: los subgrupos van codificados.
  const scoped = (path = "") => `projects/${encodeURIComponent(project)}${path ? `/${path}` : ""}`;

  return { request, paginate, graphql, scoped };
}

// El cliente de la API para el proyecto de origin. El token solo se lee cuando el forge es GitLab.
export async function connect({ cwd, env, run } = {}) {
  const found = await resolveForge({ cwd, env });
  if (found.forge !== "gitlab") {
    throw new GitLabError("El forge de este repositorio es GitHub. Si es GitLab, declara GIT_WORKFLOW_FORGE=gitlab.");
  }
  const token = await readToken(found.root);
  return { ...found, ...createClient({ ...found, token }, { run }) };
}

export async function whoami(client) {
  const { data } = await client.request("GET", "user");
  if (!data?.username) throw new GitLabError("No se pudo confirmar la cuenta de GitLab.");
  return { id: data.id, username: data.username };
}

export async function run(args, options = {}) {
  const [command, ...rest] = args;
  if (command === "forge" && !rest.length) return (await checkForge(options)).forge;
  if (command === "whoami" && !rest.length) return (await whoami(await connect(options))).username;
  throw new GitLabError("Uso: gitlab.mjs forge | whoami");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  run(process.argv.slice(2))
    .then((output) => console.log(output))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = typeof error.code === "number" ? error.code : 1;
    });
}
