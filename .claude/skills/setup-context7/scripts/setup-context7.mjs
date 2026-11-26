#!/usr/bin/env node
import { execFile as execFileCb, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

const here = dirname(fileURLToPath(import.meta.url));
export const PROFILES_PATH = join(here, "..", "assets", "library-profiles.json");

export class SetupContext7Error extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

export function loadProfiles(path = PROFILES_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export const SERVER_NAME = "context7";
export const SERVER_URL = "https://mcp.context7.com/mcp";
// Solo se escribe el NOMBRE de la variable, nunca su valor.
export const ENV_VAR = "CONTEXT7_API_KEY";
export const RULE_START = "<!-- delivery-workflow:context7 -->";
export const RULE_END = "<!-- /delivery-workflow:context7 -->";
// El otro canal de documentación. Solo hay uno registrado a la vez por ordenador.
export const DOCS_RAG_SERVER = "docs-rag";
export const CHANNELS = [SERVER_NAME, DOCS_RAG_SERVER];

// El MCP se registra en la config de usuario de cada herramienta (configFile, relativo a la carpeta personal),
// fuera del repositorio. projectConfigFile es donde lo escribían versiones anteriores: solo se lee para avisar.
// Cada herramienta nombra la variable de entorno a su manera (verificado en su documentación).
export const TOOLS = {
  opencode: {
    name: "opencode",
    agentsDir: ".opencode/agents",
    // Config de usuario de opencode; XDG_CONFIG_HOME cambia su carpeta (ver userConfigPath).
    configFile: ".config/opencode/opencode.json",
    projectConfigFile: "opencode.json",
    format: "opencode",
    ruleFile: "AGENTS.md",
    entry: (withKey) => ({
      type: "remote",
      url: SERVER_URL,
      enabled: true,
      ...(withKey ? { headers: { Authorization: `Bearer {env:${ENV_VAR}}` } } : {}),
    }),
  },
  cursor: {
    name: "Cursor",
    agentsDir: ".cursor/agents",
    configFile: ".cursor/mcp.json",
    projectConfigFile: ".cursor/mcp.json",
    format: "json",
    ruleFile: "AGENTS.md",
    entry: (withKey) => ({
      url: SERVER_URL,
      ...(withKey ? { headers: { Authorization: `Bearer \${env:${ENV_VAR}}` } } : {}),
    }),
  },
  claude: {
    name: "Claude Code",
    agentsDir: ".claude/agents",
    // mcpServers en la raíz de ~/.claude.json es el ámbito de usuario de Claude Code.
    configFile: ".claude.json",
    projectConfigFile: ".mcp.json",
    format: "json",
    ruleFile: "CLAUDE.md",
    entry: (withKey) => ({
      type: "http",
      url: SERVER_URL,
      ...(withKey ? { headers: { Authorization: `Bearer \${${ENV_VAR}}` } } : {}),
    }),
  },
  codex: {
    name: "Codex",
    agentsDir: ".codex/agents",
    configFile: ".codex/config.toml",
    projectConfigFile: ".codex/config.toml",
    format: "toml",
    ruleFile: "AGENTS.md",
  },
};

// Un nombre de librería acaba en una regla de Markdown: nada de espacios, comillas ni acentos graves.
const LIB_SHAPE = /^[@A-Za-z0-9][A-Za-z0-9._\-/@]*$/;

export function parseLibs(value) {
  const libs = [];
  for (const raw of String(value ?? "").split(",")) {
    const lib = raw.trim();
    if (lib === "") continue;
    if (!LIB_SHAPE.test(lib)) throw new SetupContext7Error(`Librería no válida: «${lib}». Sin espacios ni comillas.`, 2);
    if (!libs.includes(lib)) libs.push(lib);
  }
  return libs;
}

// --- Dependencias ---

const normalizePy = (name) => name.toLowerCase().replace(/[_.]+/g, "-");

export function parsePackageJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SetupContext7Error("package.json no es un JSON válido.", 3);
  }
  const names = new Set();
  for (const key of ["dependencies", "devDependencies"]) {
    if (data?.[key] && typeof data[key] === "object") for (const name of Object.keys(data[key])) names.add(name);
  }
  return [...names];
}

export function parseRequirements(text) {
  const names = new Set();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#") || line.startsWith("-") || /^[a-z][a-z+.-]*:\/\//i.test(line)) continue;
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line);
    if (m) names.add(normalizePy(m[1]));
  }
  return [...names];
}

// Lectura sencilla de pyproject.toml: [project].dependencies y las tablas de Poetry. No es un parser TOML completo.
export function parsePyproject(text) {
  const names = new Set();
  const lines = String(text).replace(/\r/g, "").split("\n");
  let table = "";
  let inArray = false;
  for (const raw of lines) {
    const line = raw.trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header && !inArray) {
      table = header[1].trim();
      continue;
    }
    if (table === "project") {
      if (!inArray && /^dependencies\s*=\s*\[/.test(line)) inArray = true;
      if (inArray) {
        for (const m of line.matchAll(/["']([A-Za-z0-9][A-Za-z0-9._-]*)[^"']*["']/g)) names.add(normalizePy(m[1]));
        if (/\]/.test(line.replace(/["'][^"']*["']/g, ""))) inArray = false;
      }
    } else if (/^tool\.poetry\.(group\.[^.]+\.)?dependencies$/.test(table)) {
      const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/.exec(line);
      if (m && m[1].toLowerCase() !== "python") names.add(normalizePy(m[1]));
    }
  }
  return [...names];
}

export function parseGoMod(text) {
  const names = new Set();
  let inBlock = false;
  for (const raw of String(text).replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (/^require\s*\($/.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock && line === ")") {
      inBlock = false;
      continue;
    }
    const single = /^require\s+(\S+)\s+v\S+/.exec(line);
    const inside = inBlock ? /^(\S+)\s+v\S+/.exec(line) : null;
    const m = single ?? inside;
    if (m && !/\/\/\s*indirect/.test(line)) names.add(m[1]);
  }
  return [...names];
}

export function parseCargo(text) {
  const names = new Set();
  let table = "";
  for (const raw of String(text).replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      table = header[1].trim();
      const inline = /^(?:dependencies|dev-dependencies)\.([A-Za-z0-9_-]+)$/.exec(table);
      if (inline) names.add(inline[1]);
      continue;
    }
    if (table === "dependencies" || table === "dev-dependencies") {
      const m = /^([A-Za-z0-9_-]+)(?:\.workspace)?\s*=/.exec(line);
      if (m) names.add(m[1]);
    }
  }
  return [...names];
}

export const MANIFESTS = [
  { file: "package.json", ecosystem: "npm", parse: parsePackageJson },
  { file: "requirements.txt", ecosystem: "python", parse: parseRequirements },
  { file: "pyproject.toml", ecosystem: "python", parse: parsePyproject },
  { file: "go.mod", ecosystem: "go", parse: parseGoMod },
  { file: "Cargo.toml", ecosystem: "rust", parse: parseCargo },
];

// Todo se sugiere salvo lo que está en la lista de descartes (con su motivo).
export function classify(profiles, name) {
  for (const { why, match } of profiles.skip) {
    if (match.some((p) => new RegExp(p).test(name))) return { status: "descartada", why };
  }
  return { status: "sugerida", why: "Dependencia directa del proyecto." };
}

// Un proyecto suele tener su package.json (o similar) en una subcarpeta: app/, desktop/, packages/x…
// Sin git se recorren las carpetas hasta MAX_DEPTH niveles.
export const MAX_DEPTH = 3;
const SKIP_DIRS = new Set(["node_modules", "vendor", "dist", "build", "out", "target", "venv", "coverage", "__pycache__", "apm_modules", "storybook-static"]);

const skipped = (name) => name.startsWith(".") || SKIP_DIRS.has(name);

// Carpetas del proyecto (relativas a la raíz), la raíz primero y por niveles. Sin ocultas ni de dependencias o build.
export function projectDirs(root, maxDepth = MAX_DEPTH) {
  const dirs = [""];
  let level = [""];
  for (let depth = 1; depth <= maxDepth; depth++) {
    const next = [];
    for (const rel of level) {
      let entries = [];
      try {
        entries = readdirSync(join(root, rel), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries.sort((x, y) => x.name.localeCompare(y.name))) {
        if (!e.isDirectory() || skipped(e.name)) continue;
        next.push(rel ? `${rel}/${e.name}` : e.name);
      }
    }
    dirs.push(...next);
    level = next;
  }
  return dirs;
}

// Rutas (relativas a la raíz) de los manifiestos que git conoce, a cualquier profundidad y sin lo que .gitignore ignora.
// Devuelve null si la raíz no es un repositorio git o git no está instalado.
function gitManifests(root) {
  let out;
  try {
    out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...MANIFESTS.map((m) => `:(glob)**/${m.file}`)], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
  return out.split("\0").filter(Boolean);
}

// Manifiestos del proyecto: [{rel, ecosystem, parse}], la raíz primero, luego por nivel, carpeta y orden de MANIFESTS.
export function findManifests(root) {
  const fromGit = gitManifests(root);
  const rels = fromGit ?? projectDirs(root).flatMap((dir) => MANIFESTS.map(({ file }) => (dir ? `${dir}/${file}` : file)));
  const found = [];
  for (const rel of new Set(rels)) {
    const parts = rel.split("/");
    const index = MANIFESTS.findIndex((m) => m.file === parts[parts.length - 1]);
    if (index === -1 || parts.slice(0, -1).some(skipped) || !existsSync(join(root, rel))) continue;
    found.push({ rel, dir: parts.slice(0, -1).join("/"), depth: parts.length - 1, index });
  }
  found.sort((a, b) => a.depth - b.depth || a.dir.localeCompare(b.dir) || a.index - b.index);
  return found.map(({ rel, index }) => ({ rel, ...MANIFESTS[index] }));
}

export function readDependencies({ root, profiles = loadProfiles() }) {
  const manifests = [];
  const byKey = new Map();
  for (const { rel, ecosystem, parse } of findManifests(root)) {
    let names;
    try {
      names = parse(readFileSync(join(root, rel), "utf8"));
    } catch (e) {
      if (!(e instanceof SetupContext7Error)) throw e;
      manifests.push({ file: rel, ecosystem, count: 0, error: e.message });
      continue;
    }
    manifests.push({ file: rel, ecosystem, count: names.length });
    for (const name of names) {
      const key = `${ecosystem}:${name}`;
      const known = byKey.get(key);
      if (known) known.sources.push(rel);
      else byKey.set(key, { name, ecosystem, sources: [rel], ...classify(profiles, name) });
    }
  }
  return { manifests, dependencies: [...byKey.values()] };
}

// --- Herramientas presentes ---

export function toolsPresent(root, exists = existsSync) {
  return Object.entries(TOOLS)
    .filter(([, t]) => exists(join(root, t.agentsDir)))
    .map(([tool]) => tool);
}

// --- Escritura atómica ---

function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function readIfExists(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

// --- Config JSON (opencode, Cursor y Claude Code) ---

// Clave que agrupa los servidores MCP en cada formato JSON.
export const serversKey = (format) => (format === "opencode" ? "mcp" : "mcpServers");

function parseJsonFile(text, file) {
  if (text === null || text.trim() === "") return {};
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SetupContext7Error(`${file} no es un JSON válido: no se toca. Arréglalo y repite.`, 3);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new SetupContext7Error(`${file} no es un objeto JSON: no se toca.`, 3);
  }
  return data;
}

// Devuelve {text, result}. Solo cambia la clave del servidor; los demás MCP y claves quedan como estaban.
export function setServerJson(text, entry, file = "mcp.json", name = SERVER_NAME, key = "mcpServers") {
  const data = parseJsonFile(text, file);
  if (data[key] !== undefined && (data[key] === null || typeof data[key] !== "object" || Array.isArray(data[key]))) {
    throw new SetupContext7Error(`${file}: «${key}» no es un objeto: no se toca.`, 3);
  }
  const current = data[key]?.[name];
  if (current !== undefined && JSON.stringify(current) === JSON.stringify(entry)) return { text, result: "igual" };
  data[key] = { ...(data[key] ?? {}), [name]: entry };
  return { text: `${JSON.stringify(data, null, 2)}\n`, result: "cambiado" };
}

export function removeServerJson(text, file = "mcp.json", name = SERVER_NAME, key = "mcpServers") {
  if (text === null) return { text: null, result: "ausente" };
  const data = parseJsonFile(text, file);
  if (!data[key] || typeof data[key] !== "object" || !(name in data[key])) return { text, result: "igual" };
  delete data[key][name];
  if (Object.keys(data[key]).length === 0) delete data[key];
  if (Object.keys(data).length === 0) return { text: "", result: "cambiado" };
  return { text: `${JSON.stringify(data, null, 2)}\n`, result: "cambiado" };
}

// --- opencode.jsonc: solo se lee ---

// Quita los comentarios de un JSONC sin tocar lo que va dentro de las cadenas.
const stripJsonComments = (text) => text.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_, string) => string ?? "");

// ¿Declara `name` el opencode.jsonc que hay junto a este opencode.json?
export function jsoncDeclares(jsonPath, name) {
  const text = readIfExists(`${jsonPath}c`);
  return text !== null && new RegExp(`"${name}"\\s*:\\s*\\{`).test(stripJsonComments(text));
}

// Avisos para la persona: la skill no escribe en un .jsonc, y opencode lee los dos ficheros.
export function jsoncNotes(jsonPath, file) {
  return CHANNELS.filter((name) => jsoncDeclares(jsonPath, name)).map(
    (name) => `${file}c declara ${name} y no se modifica. opencode lee ese fichero además de ${file}: revísalo y quítalo a mano.`,
  );
}

// Ruta de la config de usuario. En opencode manda XDG_CONFIG_HOME cuando la carpeta personal es la real.
export function userConfigPath(home, tool, env = process.env) {
  if (tool === "opencode" && env.XDG_CONFIG_HOME && resolve(home) === resolve(homedir())) {
    return join(env.XDG_CONFIG_HOME, "opencode", "opencode.json");
  }
  return join(home, TOOLS[tool].configFile);
}

// --- Config TOML (Codex) ---

// Marca cada línea que abre una tabla [x] fuera de cadenas multilínea.
function tableHeaders(lines) {
  let quote = null;
  return lines.map((line) => {
    if (quote) {
      if (line.includes(quote)) quote = null;
      return null;
    }
    const open = /("""|''')/.exec(line);
    if (open && line.split(open[1]).length % 2 === 0) quote = open[1];
    const m = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(line);
    return !open && m ? m[1] : null;
  });
}

// En TOML el nombre va entre comillas si lleva guion: [mcp_servers."docs-rag"].
const tomlKey = (name) => (/^[A-Za-z0-9_]+$/.test(name) ? name : `"${name}"`);
const isOurs = (header, name) => {
  const base = `mcp_servers.${tomlKey(name)}`;
  return header === base || header.startsWith(`${base}.`);
};

function dropServerToml(lines, name = SERVER_NAME) {
  const headers = tableHeaders(lines);
  const out = [];
  let skipping = false;
  lines.forEach((line, i) => {
    if (headers[i] !== null) skipping = isOurs(headers[i], name);
    if (!skipping) out.push(line);
  });
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  return out;
}

export function tomlBlock(withKey) {
  const body = [`[mcp_servers.${SERVER_NAME}]`, `url = "${SERVER_URL}"`];
  if (withKey) body.push(`bearer_token_env_var = "${ENV_VAR}"`);
  return body;
}

const tomlString = (value) => JSON.stringify(String(value));

// Tabla TOML de un servidor stdio: command, args y, si hay, env.
export function tomlStdioBlock(name, { command, args = [], env = {} }) {
  const body = [`[mcp_servers.${tomlKey(name)}]`, `command = ${tomlString(command)}`, `args = [${args.map(tomlString).join(", ")}]`];
  const vars = Object.entries(env);
  if (vars.length) body.push(`env = { ${vars.map(([k, v]) => `${k} = ${tomlString(v)}`).join(", ")} }`);
  return body;
}

// Sustituye (o añade) la tabla del servidor `name` por las líneas `block`. Las demás tablas quedan igual.
export function setServerTomlBlock(text, name, block) {
  const eol = text?.includes("\r\n") ? "\r\n" : "\n";
  const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");
  const kept = dropServerToml(lines, name);
  const next = [...kept, ...(kept.length ? [""] : []), ...block].join("\n") + "\n";
  const out = next.replace(/\n/g, eol);
  return { text: out, result: out === text ? "igual" : "cambiado" };
}

export function setServerToml(text, withKey) {
  return setServerTomlBlock(text, SERVER_NAME, tomlBlock(withKey));
}

export function removeServerToml(text, name = SERVER_NAME) {
  if (text === null) return { text: null, result: "ausente" };
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const kept = dropServerToml(lines, name);
  const out = kept.length ? kept.join("\n").replace(/\n/g, eol) + eol : "";
  return { text: out, result: out === text ? "igual" : "cambiado" };
}

// --- Regla del proyecto (bloque con marcadores) ---

export function ruleBlock(libs) {
  return [
    RULE_START,
    "## Context7",
    "",
    "Antes de escribir código o configuración con estas librerías, consulta su documentación actual con Context7 (use context7) y respeta la versión que usa el proyecto:",
    "",
    ...libs.map((l) => `- ${l}`),
    "",
    "Context7 envía el nombre de la librería y la pregunta a un servicio de terceros: no incluyas secretos, datos personales ni código privado en una consulta.",
    RULE_END,
  ].join("\n");
}

function findBlock(text) {
  const start = text.indexOf(RULE_START);
  if (start === -1) return null;
  const endAt = text.indexOf(RULE_END, start);
  if (endAt === -1) return null;
  return { start, end: endAt + RULE_END.length };
}

export function setRule(text, libs) {
  const block = ruleBlock(libs);
  if (text === null || text.trim() === "") return { text: `${block}\n`, result: "cambiado" };
  const found = findBlock(text);
  if (found) {
    const next = text.slice(0, found.start) + block + text.slice(found.end);
    return { text: next, result: next === text ? "igual" : "cambiado" };
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const sep = text.endsWith("\n") ? eol : eol + eol;
  return { text: `${text}${sep}${block.replace(/\n/g, eol)}${eol}`, result: "cambiado" };
}

export function removeRule(text) {
  if (text === null) return { text: null, result: "ausente" };
  const found = findBlock(text);
  if (!found) return { text, result: "igual" };
  const before = text.slice(0, found.start).replace(/\s+$/, "");
  const after = text.slice(found.end).replace(/^\s+/, "");
  const joined = before && after ? `${before}\n\n${after}` : before || after;
  return { text: joined ? `${joined.replace(/\n*$/, "")}\n` : "", result: "cambiado" };
}

export function hasRule(text) {
  return text !== null && findBlock(text) !== null;
}

// --- Estado actual ---

// Ruta que se enseña a la persona: la config de usuario, relativa a su carpeta personal.
export function displayPath(tool, home = homedir()) {
  const path = userConfigPath(home, tool);
  return path === join(home, TOOLS[tool].configFile) ? `~/${TOOLS[tool].configFile}` : path;
}

// ¿Está el servidor `name` en este texto de config? {configured, withKey, invalid?}
export function serverStateIn(text, format, name = SERVER_NAME) {
  if (text === null) return { configured: false, withKey: false };
  if (format === "toml") {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const headers = tableHeaders(lines);
    const start = headers.findIndex((h) => h === `mcp_servers.${tomlKey(name)}`);
    if (start === -1) return { configured: false, withKey: false };
    const block = [];
    for (let i = start + 1; i < lines.length && headers[i] === null; i++) block.push(lines[i]);
    return { configured: true, withKey: block.some((l) => /^\s*bearer_token_env_var\s*=/.test(l)) };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { configured: false, withKey: false, invalid: true };
  }
  const entry = data?.[serversKey(format)]?.[name];
  return { configured: entry !== undefined, withKey: Boolean(entry?.headers) };
}

// Estado del servidor en la config de usuario de la herramienta.
export function serverState(home, tool, name = SERVER_NAME) {
  const t = TOOLS[tool];
  return serverStateIn(readIfExists(userConfigPath(home, tool)), t.format, name);
}

// ¿Está docs-rag registrado? En la config del proyecto o, de versiones anteriores, en la de usuario.
function docsRagConfigured(home, tool, root) {
  const t = TOOLS[tool];
  const inProject = root ? serverStateIn(readIfExists(join(root, t.projectConfigFile)), t.format, DOCS_RAG_SERVER).configured : false;
  return inProject || serverState(home, tool, DOCS_RAG_SERVER).configured;
}

// Canal de documentación: context7 (config de usuario), docs-rag (config del proyecto), none o both.
export function channelOf(home, tool, root = null) {
  const on = CHANNELS.filter((name) => (name === DOCS_RAG_SERVER ? docsRagConfigured(home, tool, root) : serverState(home, tool, name).configured));
  if (on.length === 0) return "none";
  if (on.length > 1) return "both";
  return on[0];
}

// ¿Queda un context7 de una versión anterior en la config del proyecto?
export function legacyProjectConfig(root, tool) {
  const t = TOOLS[tool];
  return serverStateIn(readIfExists(join(root, t.projectConfigFile)), t.format, SERVER_NAME).configured;
}

// --- La clave: se mira si está, nunca se copia ---

// Lee el .env línea a línea sin ejecutarlo (como gh.sh). Solo dice si la variable tiene valor.
export function envFileHasKey(text) {
  const line = new RegExp(`^\\s*(?:export\\s+)?${ENV_VAR}\\s*=\\s*(.*)$`);
  for (const raw of String(text).replace(/\r/g, "").split("\n")) {
    const m = line.exec(raw);
    if (!m) continue;
    const value = m[1].trim();
    const quoted = /^(["'])(.*?)\1/.exec(value);
    const plain = quoted ? quoted[2] : value.replace(/\s+#.*$/, "");
    if (plain.trim() !== "") return true;
  }
  return false;
}

// {inEnv, inShell, envIgnored}: ¿está en el .env?, ¿en esta terminal?, ¿git ignora el .env? (null si no se sabe).
export async function keyState(root, env = process.env) {
  const text = readIfExists(join(root, ".env"));
  const state = { inEnv: text !== null && envFileHasKey(text), inShell: Boolean(env[ENV_VAR]), envIgnored: null };
  if (text !== null) {
    try {
      await execFile("git", ["check-ignore", "-q", ".env"], { cwd: root });
      state.envIgnored = true;
    } catch (e) {
      state.envIgnored = e.code === 1 ? false : null;
    }
  }
  return state;
}

// --- Órdenes ---

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, target: null, root: null, home: null, libs: [], withKey: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--target") opts.target = rest[++i];
    else if (a === "--root") opts.root = rest[++i];
    else if (a === "--home") opts.home = rest[++i];
    else if (a === "--libs") opts.libs = [...new Set([...opts.libs, ...parseLibs(rest[++i])])];
    else if (a === "--with-key") opts.withKey = true;
    else throw new SetupContext7Error(`Argumento desconocido: ${a}\n${USAGE}`, 2);
  }
  return opts;
}

export const USAGE = [
  "Uso: setup-context7.mjs <detect|apply|reset> [opciones]",
  "  detect                 Dependencias del proyecto (sugeridas y descartadas) y canal de documentación de cada herramienta (JSON).",
  "  apply                  Registra el MCP de Context7 en la config de usuario de cada herramienta (quita docs-rag) y, con --libs, la regla del proyecto.",
  "  reset                  Quita el MCP de Context7 de la config de usuario y la regla del proyecto.",
  "Opciones: --target opencode|cursor|claude|codex  --libs a,b,c  --with-key (añade la cabecera con la variable CONTEXT7_API_KEY)  --root RUTA  --home RUTA",
].join("\n");

async function resolveRoot(opts) {
  if (opts.root) return resolve(opts.root);
  try {
    const { stdout } = await execFile("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd() });
    return stdout.trim() || process.cwd();
  } catch {
    return process.cwd();
  }
}

function selectTools(opts, root) {
  const present = toolsPresent(root);
  if (!opts.target) return present;
  if (!TOOLS[opts.target]) throw new SetupContext7Error(`Herramienta desconocida: «${opts.target}».`, 2);
  if (!present.includes(opts.target)) {
    throw new SetupContext7Error(`No hay carpeta de agentes de ${opts.target} en este proyecto. ¿Has ejecutado apm install?`, 3);
  }
  return [opts.target];
}

export function detectReport({ root, home = homedir(), tools, profiles = loadProfiles() }) {
  const { manifests, dependencies } = readDependencies({ root, profiles });
  return {
    manifests,
    dependencies,
    tools: tools.map((tool) => {
      const t = TOOLS[tool];
      return {
        tool,
        name: t.name,
        configFile: displayPath(tool, home),
        ...serverState(home, tool),
        channel: channelOf(home, tool, root),
        legacyProjectConfig: legacyProjectConfig(root, tool) ? t.projectConfigFile : null,
        ruleFile: t.ruleFile,
        rule: hasRule(readIfExists(join(root, t.ruleFile))),
      };
    }),
  };
}

// Quita el servidor `name` del archivo de config `path` y borra el archivo si se queda vacío. Devuelve {file, result}.
export function removeServerFromFile(path, tool, file, name) {
  const { format } = TOOLS[tool];
  const { text, result } = format === "toml" ? removeServerToml(readIfExists(path), name) : removeServerJson(readIfExists(path), file, name, serversKey(format));
  if (result === "cambiado") {
    if (text === "") rmSync(path, { force: true });
    else writeAtomic(path, text);
  }
  return { file, result };
}

// Registra context7 en la config de usuario y quita el docs-rag que dejaban ahí versiones anteriores.
// El docs-rag de la config del proyecto lo quita applyAll: solo hay un canal de documentación.
function applyConfig(home, tool, withKey) {
  const t = TOOLS[tool];
  const file = displayPath(tool, home);
  const path = userConfigPath(home, tool);
  const before = readIfExists(path);
  const key = serversKey(t.format);
  const set = t.format === "toml" ? setServerToml(before, withKey) : setServerJson(before, t.entry(withKey), file, SERVER_NAME, key);
  const drop = t.format === "toml" ? removeServerToml(set.text, DOCS_RAG_SERVER) : removeServerJson(set.text, file, DOCS_RAG_SERVER, key);
  const changed = set.result === "cambiado" || drop.result === "cambiado";
  if (changed) writeAtomic(path, drop.text);
  return { file, result: changed ? "cambiado" : "igual", removed: drop.result === "cambiado" ? [DOCS_RAG_SERVER] : [] };
}

function applyRule(root, tool, libs) {
  const t = TOOLS[tool];
  const path = join(root, t.ruleFile);
  const before = readIfExists(path);
  const { text, result } = setRule(before, libs);
  if (result === "cambiado") writeAtomic(path, text);
  return { file: t.ruleFile, result, libs };
}

export function applyAll({ root, home = homedir(), tools, libs, withKey, key = { inEnv: false, inShell: false, envIgnored: null } }) {
  return tools.map((tool, index) => {
    const t = TOOLS[tool];
    const config = applyConfig(home, tool, withKey);
    const projectConfig = removeServerFromFile(join(root, t.projectConfigFile), tool, t.projectConfigFile, DOCS_RAG_SERVER);
    const rule = libs.length ? applyRule(root, tool, libs) : null;
    const notes = [];
    if (config.removed.length) notes.push(`Se ha quitado ${DOCS_RAG_SERVER} de ${config.file}: era el registro de usuario de una versión anterior.`);
    if (projectConfig.result === "cambiado") {
      notes.push(`Se ha quitado ${DOCS_RAG_SERVER} de ${projectConfig.file} del proyecto: el canal de documentación pasa a ser Context7. El índice sigue en .docs-rag/; si no lo vas a usar, bórralo con «setup-docs-rag.mjs reset --drop-index».`);
    }
    if (t.format === "opencode") {
      notes.push(...jsoncNotes(userConfigPath(home, tool), config.file), ...jsoncNotes(join(root, t.projectConfigFile), t.projectConfigFile));
    }
    if (legacyProjectConfig(root, tool)) {
      const origin = t.format === "opencode" ? "" : " de una versión anterior";
      notes.push(`${t.projectConfigFile} del proyecto aún tiene context7${origin}. El MCP ya está en ${config.file}: quítalo del proyecto si nadie más del equipo lo usa.`);
    }
    if (withKey) {
      notes.push(`La config usa la variable ${ENV_VAR}. El valor no se escribe en ningún archivo.`);
      if (key.inShell) {
        /* ya está en el entorno de esta terminal: nada que añadir */
      } else if (key.inEnv) {
        notes.push(`La clave está en tu .env, pero ${t.name} no lee el .env solo: cárgalo con «set -a; source .env; set +a» y abre ${t.name} desde esa misma terminal.`);
      } else {
        notes.push(`${ENV_VAR} no está en tu .env ni en esta terminal: añádela al .env y cárgalo antes de abrir ${t.name}, o no podrá autenticarse.`);
      }
      if (key.inEnv && key.envIgnored === false && index === 0) {
        notes.push("El .env no está en .gitignore: añádelo («echo .env >> .gitignore») para no subir la clave.");
      }
    } else if (key.inEnv) {
      notes.push(`Tienes ${ENV_VAR} en el .env: repite con --with-key para usarla.`);
    } else {
      notes.push(`Sin clave: Context7 funciona con el límite por defecto. Para más peticiones, consigue una clave en context7.com/dashboard, añádela como ${ENV_VAR} a tu .env y repite con --with-key.`);
    }
    if (!libs.length) notes.push("No se ha escrito ninguna regla: pasa --libs con las librerías confirmadas.");
    notes.push(`Recarga ${t.name} para que cargue el MCP nuevo.`);
    return { tool, name: t.name, config, projectConfig, rule, notes };
  });
}

// Quita context7 de la config de usuario y la regla del proyecto. También lo usa setup-docs-rag al cambiar de canal.
export function resetAll({ root, home = homedir(), tools }) {
  const results = tools.map((tool) => {
    const t = TOOLS[tool];
    const config = removeServerFromFile(userConfigPath(home, tool), tool, displayPath(tool, home), SERVER_NAME);
    const notes = t.format === "opencode" ? jsoncNotes(userConfigPath(home, tool), config.file) : [];
    return { tool, name: t.name, config, rule: null, notes };
  });
  // opencode, Cursor y Codex comparten AGENTS.md: el bloque solo se quita si ninguna herramienta que siga usando Context7 lo necesita.
  const stillUsing = toolsPresent(root).filter((tool) => !tools.includes(tool) && serverState(home, tool).configured);
  const needed = new Set(stillUsing.map((tool) => TOOLS[tool].ruleFile));
  for (const r of results) {
    const file = TOOLS[r.tool].ruleFile;
    if (needed.has(file)) {
      r.rule = { file, result: "igual" };
      r.notes.push(`${file} conserva la regla: otra herramienta sigue usando Context7.`);
      continue;
    }
    const path = join(root, file);
    const { text, result } = removeRule(readIfExists(path));
    if (result === "cambiado") {
      if (text === "") rmSync(path, { force: true });
      else writeAtomic(path, text);
    }
    r.rule = { file, result };
  }
  return results;
}

export async function run(argv) {
  const opts = parseArgs(argv);
  if (!["detect", "apply", "reset"].includes(opts.command)) throw new SetupContext7Error(USAGE, 2);
  const root = await resolveRoot(opts);
  const tools = selectTools(opts, root);
  if (tools.length === 0) {
    throw new SetupContext7Error("No hay carpetas de agentes en este proyecto (.opencode/agents, .cursor/agents, .claude/agents, .codex/agents). Ejecuta apm install antes.", 3);
  }
  const home = resolve(opts.home ?? homedir());
  if (opts.command === "detect") return JSON.stringify({ ...detectReport({ root, home, tools }), key: await keyState(root) }, null, 2);
  if (opts.command === "reset") return JSON.stringify(resetAll({ root, home, tools }), null, 2);
  return JSON.stringify(applyAll({ root, home, tools, libs: opts.libs, withKey: opts.withKey, key: await keyState(root) }), null, 2);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  run(process.argv.slice(2))
    .then((out) => console.log(out))
    .catch((e) => {
      console.error(e.message);
      process.exit(e instanceof SetupContext7Error ? e.code : 1);
    });
}
