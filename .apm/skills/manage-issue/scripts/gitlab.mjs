#!/usr/bin/env node
// Camino de GitLab de las skills del flujo. Cada skill lleva su copia de este fichero y todas son iguales.
// Elige el forge, lee GITLAB_TOKEN del .env del proyecto y llama a la API de GitLab con curl.
// curl respeta el proxy del sandbox. El token entra por stdin: no aparece en los argumentos ni en ficheros.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const FORGES = ["github", "gitlab"];
const MAX_PAGES = 1000;
const PLANNER = 15;
export const LIMITS = { issue: 1048576, comment: 1000000 };
// Los mismos colores y descripciones que ensure-label.sh usa en GitHub.
const LABELS = {
  feat: ["#a2eeef", "Nueva funcionalidad"],
  fix: ["#d73a4a", "Corrige un fallo"],
  docs: ["#0075ca", "Documentación"],
  refactor: ["#fbca04", "Cambia el código sin cambiar el comportamiento"],
  test: ["#0e8a16", "Tests"],
  chore: ["#cfd3d7", "Mantenimiento"],
  knowledge: ["#7057ff", "Conocimiento del equipo"],
};
const USAGE = [
  "Uso: gitlab.mjs forge | status | whoami | member check USUARIO | label ensure TIPO",
  "  issue create TITULO CUERPO TIPO | issue state N | issue close N [completed|not planned] | issue reopen N | issue assign-me N",
  "  mr find RAMA BASE | mr create RAMA TITULO CUERPO TIPO BASE | mr status RAMA | mr view N | mr edit N [--title T] [--body-file F]",
  "  mr draft N | mr ready N | mr assign-me N | mr request-review N USUARIO...",
].join("\n");
// Los prefijos con los que GitLab marca un merge request como draft.
const DRAFT = /^(?:\s*(?:\[draft\]|\(draft\)|draft:))+\s*/i;

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
  if (!file) throw new GitLabError("Falta el fichero .env en la raíz del proyecto con GITLAB_TOKEN=tu_token.", { code: 3 });
  if ((await git(file.base, "check-ignore", "-q", ".env")) === null) {
    throw new GitLabError("El .env no está en .gitignore. Añádelo antes de seguir: el token no puede subirse.", { code: 3 });
  }
  const token = envValue(file.text, "GITLAB_TOKEN");
  // Las comillas, las barras invertidas y los caracteres de control romperían la configuración que lee curl.
  if (!token || !/^[\x21-\x7e]+$/.test(token) || /["\\]/.test(token)) {
    throw new GitLabError("El .env no tiene un GITLAB_TOKEN válido.", { code: 3 });
  }
  return token;
}

// Admite git@host:grupo/proyecto.git, ssh://, https:// y http://. Una ruta local no tiene host.
export function parseRemote(remote) {
  const found = splitRemote(remote);
  // altssh.gitlab.com es el SSH de gitlab.com por el puerto 443.
  return found?.host === "altssh.gitlab.com" ? { ...found, host: "gitlab.com", webHost: "gitlab.com" } : found;
}

function splitRemote(remote) {
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
        { code: 3 },
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
      const error = new GitLabError(redact(`GitLab rechazó la consulta. ${data.errors.map((item) => item.message).join(" ")}`));
      error.graphql = true;
      throw error;
    }
    return data?.data;
  }

  // La ruta de un recurso del proyecto: los subgrupos van codificados.
  const scoped = (path = "") => `projects/${encodeURIComponent(project)}${path ? `/${path}` : ""}`;

  return { request, paginate, graphql, scoped };
}

// El cliente de la API para el proyecto de origin. El token solo se lee cuando el forge es GitLab.
export async function connect({ cwd, env, run, project } = {}) {
  const found = await resolveForge({ cwd, env });
  if (found.forge !== "gitlab") {
    throw new GitLabError("El forge de este repositorio es GitHub. Si es GitLab, declara GIT_WORKFLOW_FORGE=gitlab.");
  }
  const token = await readToken(found.root);
  const target = { ...found, project: project ?? found.project };
  return { ...target, ...createClient({ ...target, token }, { run }) };
}

export async function whoami(client) {
  const { data } = await client.request("GET", "user");
  if (!data?.username) throw new GitLabError("No se pudo confirmar la cuenta de GitLab.");
  return { id: data.id, username: data.username };
}

// Los comandos y sustituciones que declara GitLab en lib/gitlab/quick_actions y su carpeta ee, a 2026-11-26.
const QUICK_ACTIONS = new Set((
  "add_child add_contacts add_email approve assign assign_reviewer award blocked_by blocks board_move " +
  "checkin_reminder child_epic clear_health_status clear_weight clone close confidential convert_to_ticket " +
  "copy_metadata create_merge_request done draft due duplicate epic estimate estimate_time health_status " +
  "internal_note iteration label labels link lock merge milestone move page parent_epic promote promote_to " +
  "promote_to_incident publish q react ready reassign reassign_reviewer rebase relabel relate remove_child " +
  "remove_child_epic remove_contacts remove_due_date remove_email remove_epic remove_estimate remove_iteration " +
  "remove_label remove_milestone remove_parent remove_parent_epic remove_reviewer remove_time_estimate " +
  "remove_time_spent remove_zoom reopen request_changes request_review reviewer run_pipeline set_parent severity " +
  "shrug spend spend_time spent status submit_review subscribe tableflip tag target_branch timeline title todo " +
  "type unapprove unassign unassign_reviewer unlabel unlink unlock unsubscribe weight zoom"
).split(" "));

// Las líneas del texto, sin las vacías del principio.
function textLines(text) {
  return String(text ?? "").replace(/\r/g, "").replace(/^(?:[ \t]*\n)+/, "").split("\n");
}

// La primera línea que empieza por un comando de GitLab, o null. No se interpreta el Markdown: tampoco se
// libran los bloques de código ni los comentarios, y así ningún formato puede esconder un comando.
// Solo se libra una línea que ya estaba guardada en previous sin cambios desde el principio hasta la línea
// siguiente: nada de lo que decide si es código ha cambiado, y GitLab ya la guardó sin ejecutarla.
export function findQuickAction(text, previous) {
  const lines = textLines(text);
  const saved = previous ? textLines(previous) : [];
  let same = 0;
  while (same < saved.length && lines[same] === saved[same]) same++;
  const untouched = (i) => i < same && lines[i + 1] === saved[i + 1];
  for (let i = 0; i < lines.length; i++) {
    const command = lines[i].match(/^\/([a-z_]+)(?=\s|$)/i);
    if (command && QUICK_ACTIONS.has(command[1].toLowerCase()) && !untouched(i)) return command[0];
  }
  return null;
}

function checkText(text, previous) {
  const command = findQuickAction(text, previous);
  if (command) {
    throw new GitLabError(`GitLab ejecutaría «${command}» como un comando. Pon un espacio delante de la barra, también dentro de un bloque de código. No se escribe nada.`);
  }
}

const issuePath = (client, number, suffix = "") => client.scoped(`issues/${number}${suffix}`);

export async function getIssue(client, number) {
  return (await client.request("GET", issuePath(client, number))).data;
}

export async function updateIssue(client, number, changes) {
  if (changes.description !== undefined) {
    checkText(changes.description, (await getIssue(client, number)).description);
  }
  return (await client.request("PUT", issuePath(client, number), { body: changes })).data;
}

// Los comentarios de la issue, del más antiguo al más nuevo y sin los de sistema.
export async function listNotes(client, number) {
  const notes = await client.paginate(issuePath(client, number, "/notes"), { sort: "asc", order_by: "created_at" });
  return notes.filter((note) => !note.system);
}

export async function createNote(client, number, body) {
  checkText(body);
  return (await client.request("POST", issuePath(client, number, "/notes"), { body: { body } })).data;
}

export async function updateNote(client, number, id, body) {
  const saved = (await client.request("GET", issuePath(client, number, `/notes/${id}`))).data;
  checkText(body, saved?.body);
  return (await client.request("PUT", issuePath(client, number, `/notes/${id}`), { body: { body } })).data;
}

// Edita la issue quien la creó, quien la tiene asignada y el rol Planner o superior.
export async function canEditIssue(client, number) {
  const me = await whoami(client);
  const issue = await getIssue(client, number);
  if (issue.author?.id === me.id || issue.assignees?.some((person) => person.id === me.id)) return true;
  try {
    const { data } = await client.request("GET", client.scoped(`members/all/${me.id}`));
    return (data?.access_level ?? 0) >= PLANNER;
  } catch (error) {
    if (error.status === 404) return false;
    throw error;
  }
}

// Devuelve el nombre de la etiqueta del tipo, tal como está en el proyecto. La crea si falta.
export async function ensureLabel(client, type) {
  if (!Object.hasOwn(LABELS, type)) {
    throw new GitLabError("El tipo tiene que ser feat, fix, docs, refactor, test, chore o knowledge.");
  }
  const find = async () => (await client.paginate(client.scoped("labels"), { search: type }))
    .find((label) => label.name.toLowerCase() === type)?.name;
  const existing = await find();
  if (existing) return { name: existing, created: false };
  const [color, description] = LABELS[type];
  try {
    await client.request("POST", client.scoped("labels"), { body: { name: type, color, description } });
  } catch (error) {
    if (!error.status) throw error;
    throw new GitLabError(`Etiqueta ${type}: no se pudo crear con esta cuenta. Sigue sin etiqueta.`, { code: 2, status: error.status });
  }
  return { name: type, created: true };
}

// La etiqueta del tipo, o null si la cuenta no puede crearla.
async function typeLabel(client, type, lines, warn) {
  try {
    const found = await ensureLabel(client, type);
    lines.push(`Etiqueta ${type}: ${found.created ? "creada" : "ya existe"}.`);
    return found.name;
  } catch (error) {
    // Sin permiso se crea sin etiqueta: pasarla al crear la crearía igual o se perdería sin aviso.
    if (error.code !== 2) throw error;
    warn(error.message);
    return null;
  }
}

function checkCreated(what, data, me, label, warn) {
  if (!data.assignees?.some((person) => person.id === me.id)) warn(`${what} quedó sin asignar: hazlo a mano.`);
  if (label && !data.labels?.includes(label)) warn(`${what} quedó sin etiqueta: ponla a mano.`);
}

export async function createIssue(client, { title, body, type }, warn = console.error) {
  checkText(body);
  const lines = [];
  const label = await typeLabel(client, type, lines, warn);
  const me = await whoami(client);
  const request = { title, description: body, assignee_ids: [me.id], ...(label ? { labels: label } : {}) };
  const { data } = await client.request("POST", client.scoped("issues"), { body: request });
  checkCreated("La issue", data, me, label, warn);
  return [...lines, data.web_url].join("\n");
}

const stateName = (issue) => (issue.state === "closed" ? "CLOSED" : "OPEN");

export async function setIssueState(client, number, event) {
  const state = stateName(await updateIssue(client, number, { state_event: event }));
  // GitLab puede ignorar el cambio sin dar error.
  if (state !== (event === "close" ? "CLOSED" : "OPEN")) {
    throw new GitLabError(`La issue #${number} sigue en ${state}: GitLab no aplicó el cambio, quizá porque la cuenta no tiene permiso.`);
  }
  return state;
}

// Añade la cuenta del token sin quitar a nadie. Un plan con una sola persona asignada no lo permite.
async function assignSelf(client, what, read, write) {
  const me = await whoami(client);
  const ids = (item) => (item.assignees ?? []).map((person) => person.id);
  const before = ids(await read());
  if (before.includes(me.id)) return me.username;
  const after = ids(await write([...before, me.id]));
  const lost = before.filter((id) => !after.includes(id));
  if (lost.length) await write(before);
  if (lost.length) {
    throw new GitLabError(`${what} no admite añadir a ${me.username} sin quitar a quien ya estaba. La asignación queda pendiente.`);
  }
  if (!after.includes(me.id)) {
    const limit = before.length ? "el proyecto admite una sola persona asignada o " : "";
    throw new GitLabError(`${what}: GitLab no asignó a ${me.username}, quizá porque ${limit}la cuenta no tiene permiso. La asignación queda pendiente.`);
  }
  return me.username;
}

export function assignIssue(client, number) {
  return assignSelf(client, `La issue #${number}`, () => getIssue(client, number),
    (ids) => updateIssue(client, number, { assignee_ids: ids }));
}

const mrPath = (client, number, suffix = "") => client.scoped(`merge_requests/${number}${suffix}`);

export const draftless = (title) => title.replace(DRAFT, "");
const withDraft = (title, draft) => (draft ? `Draft: ${draftless(title)}` : draftless(title));

export async function getMergeRequest(client, number) {
  return (await client.request("GET", mrPath(client, number))).data;
}

export async function updateMergeRequest(client, number, changes) {
  if (changes.description !== undefined) {
    checkText(changes.description, (await getMergeRequest(client, number)).description);
  }
  return (await client.request("PUT", mrPath(client, number), { body: changes })).data;
}

export function listOpenMergeRequests(client, query = {}) {
  return client.paginate(client.scoped("merge_requests"), { state: "opened", ...query });
}

// El merge request abierto de una rama del propio proyecto, o null.
export async function findMergeRequest(client, branch, base) {
  const found = await listOpenMergeRequests(client, { source_branch: branch, target_branch: base });
  return found.find((item) => item.source_project_id === item.target_project_id) ?? null;
}

// El aviso para un proyecto que es un fork, o null. Si no se puede consultar, no hay aviso.
export async function forkWarning(client) {
  let origin;
  await problemOf(async () => {
    origin = (await client.request("GET", client.scoped())).data?.forked_from_project?.path_with_namespace;
  });
  return origin
    ? `Aviso: este proyecto es un fork de ${origin}. El flujo no admite forks en GitLab: no ve ni abre merge requests hacia el proyecto original.`
    : null;
}

export async function createMergeRequest(client, { branch, base, title, body, type }, warn = console.error) {
  checkText(body);
  const fork = await forkWarning(client);
  if (fork) warn(fork);
  const lines = [];
  const label = await typeLabel(client, type, lines, warn);
  const me = await whoami(client);
  const request = {
    source_branch: branch, target_branch: base, title: withDraft(title, true), description: body,
    assignee_ids: [me.id], ...(label ? { labels: label } : {}),
  };
  const { data } = await client.request("POST", client.scoped("merge_requests"), { body: request });
  if (!data.draft) warn("El merge request no quedó en draft: pásalo a draft a mano.");
  checkCreated("El merge request", data, me, label, warn);
  return [...lines, data.web_url].join("\n");
}

export async function setDraft(client, number, draft) {
  const current = await getMergeRequest(client, number);
  if (current.draft === draft) return false;
  const updated = await updateMergeRequest(client, number, { title: withDraft(current.title, draft) });
  if (updated.draft !== draft) throw new GitLabError(`El merge request #${number} no cambió de estado.`);
  return true;
}

// El título llega sin prefijo: el merge request conserva su estado de draft.
export async function editMergeRequest(client, number, { title, body }) {
  const changes = {};
  if (title !== undefined) changes.title = withDraft(title, (await getMergeRequest(client, number)).draft);
  if (body !== undefined) changes.description = body;
  return updateMergeRequest(client, number, changes);
}

export function assignMergeRequest(client, number) {
  return assignSelf(client, `El merge request #${number}`, () => getMergeRequest(client, number),
    (ids) => updateMergeRequest(client, number, { assignee_ids: ids }));
}

// El estado de revisión de cada revisor, o null si la instancia no lo dice por su API.
export async function reviewStates(client, number) {
  const query = "query($path: ID!, $iid: String!) { project(fullPath: $path) { mergeRequest(iid: $iid) { reviewers { nodes { username mergeRequestInteraction { reviewState } } } } } }";
  try {
    const data = await client.graphql(query, { path: client.project, iid: String(number) });
    const nodes = data?.project?.mergeRequest?.reviewers?.nodes;
    if (!nodes) return null;
    return new Map(nodes.map((node) => [node.username, node.mergeRequestInteraction?.reviewState ?? null]));
  } catch (error) {
    if (error.graphql || error.status === 404) return null;
    throw error;
  }
}

// Pide cambios quien lo marcó en su revisión o dejó un hilo sin resolver. El autor no cuenta.
export async function reviewSummary(client, mergeRequest) {
  const number = mergeRequest.iid;
  const states = await reviewStates(client, number);
  const discussions = await client.paginate(mrPath(client, number, "/discussions"));
  const requested = states ? [...states].filter(([, state]) => state === "REQUESTED_CHANGES").map(([name]) => name) : [];
  const threads = discussions.filter((thread) =>
    thread.notes.some((note) => note.resolvable && !note.resolved) && thread.notes[0].author.id !== mergeRequest.author.id);
  const askers = [...new Set([...requested, ...threads.map((thread) => thread.notes[0].author.username)])];
  // Un comentario general no es un hilo: se recoge de quien pide cambios. Si la instancia no dice quién los
  // marcó en su revisión, de cualquiera que no sea el autor.
  const notes = discussions.flatMap((thread) => thread.notes).filter((note) => !note.resolvable && !note.system
    && note.author.id !== mergeRequest.author.id && (!states || askers.includes(note.author.username)));
  let decision = "CHANGES_REQUESTED";
  if (!askers.length) {
    const { data } = await client.request("GET", mrPath(client, number, "/approvals"));
    // approvals_left solo llega donde el proyecto puede exigir varias aprobaciones.
    decision = data?.approved_by?.length && !(data.approvals_left > 0) ? "APPROVED" : "—";
  }
  return { decision, requested, askers, threads, notes, statesAvailable: Boolean(states) };
}

export async function findUser(client, username) {
  const { data } = await client.request("GET", "users", { query: { username } });
  if (!data?.[0]) throw new GitLabError(`No existe el usuario ${username} en GitLab.`);
  return data[0];
}

export async function isMember(client, id) {
  try {
    await client.request("GET", client.scoped(`members/all/${id}`));
    return true;
  } catch (error) {
    if (error.status === 404) return false;
    throw error;
  }
}

// Devuelve el problema de volver a pedir la revisión, o null.
async function requestAgain(client, number, user) {
  const query = "mutation($input: MergeRequestReviewerRereviewInput!) { mergeRequestReviewerRereview(input: $input) { errors } }";
  const input = { projectPath: client.project, iid: String(number), userId: `gid://gitlab/User/${user.id}` };
  const data = await client.graphql(query, { input });
  return data?.mergeRequestReviewerRereview?.errors?.join(" ") || null;
}

// El mensaje de un fallo de GitLab, para anotarlo y seguir. Otro error es un fallo del script.
async function problemOf(action) {
  try {
    return (await action()) ?? null;
  } catch (error) {
    if (error instanceof GitLabError) return error.message;
    throw error;
  }
}

// Añade revisores sin quitar a nadie, vuelve a pedirla a quien ya revisó y comprueba el resultado leyendo.
export async function requestReview(client, number, usernames) {
  const mergeRequest = await getMergeRequest(client, number);
  const author = mergeRequest.author.username.toLowerCase();
  const names = [...new Map(usernames.map((name) => [name.toLowerCase(), name])).values()]
    .filter((name) => name.toLowerCase() !== author);
  if (!names.length) throw new GitLabError("No queda nadie a quien pedir revisión: el autor no cuenta.");
  const pending = new Map();
  const wanted = [];
  for (const name of names) {
    const problem = await problemOf(async () => {
      const user = await findUser(client, name);
      if (!(await isMember(client, user.id))) return "no es miembro del proyecto";
      wanted.push(user);
    });
    if (problem) pending.set(name, problem);
  }
  const current = (mergeRequest.reviewers ?? []).map((person) => person.id);
  const added = wanted.filter((user) => !current.includes(user.id));
  if (added.length) {
    const problem = await problemOf(async () => {
      const updated = await updateMergeRequest(client, number, { reviewer_ids: [...current, ...added.map((user) => user.id)] });
      const kept = (updated.reviewers ?? []).map((person) => person.id);
      if (current.some((id) => !kept.includes(id))) await updateMergeRequest(client, number, { reviewer_ids: current });
    });
    if (problem) for (const user of added) pending.set(user.username, problem);
  }
  const again = wanted.filter((user) => current.includes(user.id));
  if (again.length) {
    let states = null;
    await problemOf(async () => {
      states = await reviewStates(client, number);
    });
    for (const user of again) {
      if (states?.get(user.username) === "UNREVIEWED") continue;
      const problem = await problemOf(() => requestAgain(client, number, user));
      if (problem) pending.set(user.username, `no se pudo volver a pedir: ${problem}`);
    }
  }
  let final = [];
  const unread = await problemOf(async () => {
    final = ((await getMergeRequest(client, number)).reviewers ?? []).map((person) => person.id);
  });
  for (const user of wanted) {
    if (pending.has(user.username)) continue;
    if (unread) pending.set(user.username, `no se pudo confirmar: ${unread}`);
    else if (!final.includes(user.id)) pending.set(user.username, "no figura como revisor: puede que el plan admita uno solo o que la cuenta no pueda asignarlo");
  }
  const done = wanted.map((user) => user.username).filter((name) => !pending.has(name));
  const lines = [];
  if (done.length) lines.push(`Revisión pedida: ${done.join(", ")}.`);
  for (const [name, reason] of pending) lines.push(`Sin pedir: ${name} (${reason}).`);
  if (pending.size) throw new GitLabError(lines.join("\n"));
  return lines.join("\n");
}

export function viewMergeRequest(item, decision) {
  const names = (list) => (list ?? []).map((person) => person.username);
  return {
    number: item.iid, url: item.web_url, title: draftless(item.title), body: item.description ?? "", isDraft: item.draft,
    state: item.state, author: item.author?.username, assignees: names(item.assignees), reviewers: names(item.reviewers),
    reviewDecision: decision,
  };
}

// Las líneas de check-status sobre el forge, el token y la cuenta. Nunca fallan.
export async function status(options = {}) {
  const found = await resolveForge(options);
  const lines = [`Forge: GitLab (${found.host})`];
  try {
    await readToken(found.root);
    lines.push("Token de GitLab: GITLAB_TOKEN en .env");
  } catch (error) {
    return [...lines, `Token de GitLab: ${error.message}`].join("\n");
  }
  try {
    lines.push(`GitLab: cuenta ${(await whoami(await connect(options))).username}`);
  } catch (error) {
    lines.push(`GitLab: ${error.message}`);
  }
  return lines.join("\n");
}

// La línea de check-status sobre el merge request de la rama.
export async function statusLine(client, branch) {
  const fork = await forkWarning(client);
  const lines = (line) => [fork, line].filter(Boolean).join("\n");
  const found = await findMergeRequest(client, branch);
  if (!found) return lines("Pull request: ninguna abierta en esta rama");
  const { decision } = await reviewSummary(client, found);
  const issue = (found.description ?? "").match(/(?:closes|close|closed|fix|fixes|fixed|resolve|resolves|resolved)\s+#(\d+)/i);
  return lines(`Pull request: #${found.iid} ${decision}${issue ? ` issue #${issue[1]}` : ""}`);
}

function issueNumber(value) {
  if (!/^[1-9]\d*$/.test(value ?? "")) throw new GitLabError("Indica el número de la issue.");
  return value;
}

function mergeRequestNumber(value) {
  const match = String(value ?? "").match(/^(?:!?|https:\/\/\S+\/-\/merge_requests\/)([1-9]\d*)\/?$/);
  if (!match) throw new GitLabError("Indica el número o la dirección del merge request.");
  return match[1];
}

// El cliente y el número. Una dirección de otro proyecto no vale: se actuaría sobre el merge request de este.
async function mergeRequestTarget(value, options) {
  const number = mergeRequestNumber(value);
  const client = await connect(options);
  if (/^https:/.test(value)) {
    // GitLab no distingue mayúsculas en las rutas.
    const plain = (address) => {
      const url = new URL(address);
      return `${url.host}${decodeURIComponent(url.pathname)}`.replace(/\/+$/, "").toLowerCase();
    };
    if (plain(value) !== plain(`${client.url}/${client.project}/-/merge_requests/${number}`)) {
      throw new GitLabError(`Esa dirección no es de un merge request de ${client.project}. No se hace nada.`);
    }
  }
  return { client, number };
}

async function readBody(file, options) {
  return readFile(resolve(options.cwd ?? process.cwd(), file), "utf8").catch(() => {
    throw new GitLabError("El fichero del cuerpo debe existir y ser legible.");
  });
}

async function runMergeRequest(action, rest, options) {
  const { warn = console.error } = options;
  const filled = (count) => rest.length === count && rest.every(Boolean);
  if (action === "find" && filled(2)) return (await findMergeRequest(await connect(options), ...rest))?.web_url ?? "";
  if (action === "status" && filled(1)) return statusLine(await connect(options), rest[0]);
  if (action === "create" && filled(5)) {
    const [branch, title, file, type, base] = rest;
    const body = await readBody(file, options);
    return createMergeRequest(await connect(options), { branch, base, title, body, type }, warn);
  }
  const [value, ...extra] = rest;
  if (action === "edit") {
    mergeRequestNumber(value);
    const changes = {};
    for (let i = 0; i < extra.length; i += 2) {
      if (extra[i] === "--title" && extra[i + 1]) changes.title = extra[i + 1];
      else if (extra[i] === "--body-file" && extra[i + 1]) changes.body = await readBody(extra[i + 1], options);
      else throw new GitLabError(USAGE);
    }
    if (!Object.keys(changes).length) throw new GitLabError("Indica --title o --body-file.");
    const { client, number } = await mergeRequestTarget(value, options);
    await editMergeRequest(client, number, changes);
    return `Merge request #${number}: editado.`;
  }
  if (action === "request-review" && extra.length) {
    const { client, number } = await mergeRequestTarget(value, options);
    return requestReview(client, number, extra);
  }
  if (["view", "draft", "ready", "assign-me"].includes(action) && !extra.length) {
    const { client, number } = await mergeRequestTarget(value, options);
    if (action === "view") {
      const item = await getMergeRequest(client, number);
      return JSON.stringify(viewMergeRequest(item, (await reviewSummary(client, item)).decision));
    }
    if (action === "assign-me") return `Merge request #${number}: asignado a ${await assignMergeRequest(client, number)}.`;
    const draft = action === "draft";
    const changed = await setDraft(client, number, draft);
    return `Merge request #${number}: ${changed ? "ahora" : "ya"} ${draft ? "en draft" : "listo para revisión"}.`;
  }
  throw new GitLabError(USAGE);
}

export async function run(args, options = {}) {
  const [command, action, ...rest] = args;
  const { warn = console.error } = options;
  if (command === "forge" && args.length === 1) return (await checkForge(options)).forge;
  if (command === "status" && args.length === 1) return status(options);
  if (command === "mr") return runMergeRequest(action, rest, options);
  if (command === "member" && action === "check" && rest.length === 1) {
    const client = await connect(options);
    const user = await findUser(client, rest[0]);
    if (!(await isMember(client, user.id))) throw new GitLabError(`${user.username} no es miembro del proyecto.`);
    return `${user.username} es miembro del proyecto.`;
  }
  if (command === "whoami" && args.length === 1) return (await whoami(await connect(options))).username;
  if (command === "label" && action === "ensure" && rest.length === 1) {
    const [type] = rest;
    const found = await ensureLabel(await connect(options), type);
    return `Etiqueta ${type}: ${found.created ? "creada" : "ya existe"}.`;
  }
  if (command === "issue" && action === "create" && rest.length === 3 && rest.every(Boolean)) {
    const [title, file, type] = rest;
    const body = await readBody(file, options);
    return createIssue(await connect(options), { title, body, type }, warn);
  }
  if (command === "issue" && ["state", "close", "reopen", "assign-me"].includes(action)) {
    const [value, reason, ...extra] = rest;
    if (extra.length || (reason !== undefined && action !== "close")) throw new GitLabError(USAGE);
    const number = issueNumber(value);
    if (reason !== undefined && !["completed", "not planned"].includes(reason)) {
      throw new GitLabError("El motivo tiene que ser completed o not planned.");
    }
    const client = await connect(options);
    if (action === "state") return stateName(await getIssue(client, number));
    if (action === "assign-me") return `Issue #${number}: asignada a ${await assignIssue(client, number)}.`;
    if (action === "reopen") return `Issue #${number}: ${await setIssueState(client, number, "reopen")}.`;
    const state = await setIssueState(client, number, "close");
    return `Issue #${number}: ${state}. GitLab no guarda el motivo de cierre.`;
  }
  throw new GitLabError(USAGE);
}

// Node da en import.meta.url la ruta real: la de la llamada puede pasar por un enlace simbólico.
if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  run(process.argv.slice(2))
    .then((output) => console.log(output))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = typeof error.code === "number" ? error.code : 1;
    });
}
