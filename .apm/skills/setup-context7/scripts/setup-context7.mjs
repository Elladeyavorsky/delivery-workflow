#!/usr/bin/env node
import { execFile as execFileCb, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

// Cada herramienta nombra la variable de entorno a su manera (verificado en su documentación).
export const TOOLS = {
  cursor: {
    name: "Cursor",
    agentsDir: ".cursor/agents",
    configFile: ".cursor/mcp.json",
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
    configFile: ".mcp.json",
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

// --- Config JSON (Cursor y Claude Code) ---

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

// Devuelve {text, result}. Solo cambia la clave context7; los demás MCP quedan como estaban.
export function setServerJson(text, entry, file = "mcp.json") {
  const data = parseJsonFile(text, file);
  if (data.mcpServers !== undefined && (data.mcpServers === null || typeof data.mcpServers !== "object" || Array.isArray(data.mcpServers))) {
    throw new SetupContext7Error(`${file}: «mcpServers» no es un objeto: no se toca.`, 3);
  }
  const current = data.mcpServers?.[SERVER_NAME];
  if (current !== undefined && JSON.stringify(current) === JSON.stringify(entry)) return { text, result: "igual" };
  data.mcpServers = { ...(data.mcpServers ?? {}), [SERVER_NAME]: entry };
  return { text: `${JSON.stringify(data, null, 2)}\n`, result: "cambiado" };
}

export function removeServerJson(text, file = "mcp.json") {
  if (text === null) return { text: null, result: "ausente" };
  const data = parseJsonFile(text, file);
  if (!data.mcpServers || !(SERVER_NAME in data.mcpServers)) return { text, result: "igual" };
  delete data.mcpServers[SERVER_NAME];
  if (Object.keys(data.mcpServers).length === 0) delete data.mcpServers;
  if (Object.keys(data).length === 0) return { text: "", result: "cambiado" };
  return { text: `${JSON.stringify(data, null, 2)}\n`, result: "cambiado" };
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

const isOurs = (name) => name === `mcp_servers.${SERVER_NAME}` || name.startsWith(`mcp_servers.${SERVER_NAME}.`);

function dropServerToml(lines) {
  const headers = tableHeaders(lines);
  const out = [];
  let skipping = false;
  lines.forEach((line, i) => {
    if (headers[i] !== null) skipping = isOurs(headers[i]);
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

export function setServerToml(text, withKey) {
  const eol = text?.includes("\r\n") ? "\r\n" : "\n";
  const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");
  const kept = dropServerToml(lines);
  const next = [...kept, ...(kept.length ? [""] : []), ...tomlBlock(withKey)].join("\n") + "\n";
  const out = next.replace(/\n/g, eol);
  return { text: out, result: out === text ? "igual" : "cambiado" };
}

export function removeServerToml(text) {
  if (text === null) return { text: null, result: "ausente" };
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const kept = dropServerToml(lines);
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

export function serverState(root, tool) {
  const t = TOOLS[tool];
  const text = readIfExists(join(root, t.configFile));
  if (text === null) return { configured: false, withKey: false };
  if (t.format === "toml") {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const headers = tableHeaders(lines);
    const start = headers.findIndex((h) => h === `mcp_servers.${SERVER_NAME}`);
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
  const entry = data?.mcpServers?.[SERVER_NAME];
  return { configured: entry !== undefined, withKey: Boolean(entry?.headers) };
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
  const opts = { command, target: null, root: null, libs: [], withKey: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--target") opts.target = rest[++i];
    else if (a === "--root") opts.root = rest[++i];
    else if (a === "--libs") opts.libs = [...new Set([...opts.libs, ...parseLibs(rest[++i])])];
    else if (a === "--with-key") opts.withKey = true;
    else throw new SetupContext7Error(`Argumento desconocido: ${a}\n${USAGE}`, 2);
  }
  return opts;
}

export const USAGE = [
  "Uso: setup-context7.mjs <detect|apply|reset> [opciones]",
  "  detect                 Dependencias del proyecto (sugeridas y descartadas) y estado de Context7 (JSON).",
  "  apply                  Escribe el MCP de Context7 en cada herramienta y, con --libs, la regla del proyecto.",
  "  reset                  Quita el MCP de Context7 y la regla.",
  "Opciones: --target cursor|claude|codex  --libs a,b,c  --with-key (añade la cabecera con la variable CONTEXT7_API_KEY)  --root RUTA",
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

export function detectReport({ root, tools, profiles = loadProfiles() }) {
  const { manifests, dependencies } = readDependencies({ root, profiles });
  return {
    manifests,
    dependencies,
    tools: tools.map((tool) => {
      const t = TOOLS[tool];
      return {
        tool,
        name: t.name,
        configFile: t.configFile,
        ...serverState(root, tool),
        ruleFile: t.ruleFile,
        rule: hasRule(readIfExists(join(root, t.ruleFile))),
      };
    }),
  };
}

function applyConfig(root, tool, withKey) {
  const t = TOOLS[tool];
  const path = join(root, t.configFile);
  const before = readIfExists(path);
  const { text, result } = t.format === "toml" ? setServerToml(before, withKey) : setServerJson(before, t.entry(withKey), t.configFile);
  if (result === "cambiado") writeAtomic(path, text);
  return { file: t.configFile, result };
}

function applyRule(root, tool, libs) {
  const t = TOOLS[tool];
  const path = join(root, t.ruleFile);
  const before = readIfExists(path);
  const { text, result } = setRule(before, libs);
  if (result === "cambiado") writeAtomic(path, text);
  return { file: t.ruleFile, result, libs };
}

export function applyAll({ root, tools, libs, withKey, key = { inEnv: false, inShell: false, envIgnored: null } }) {
  return tools.map((tool, index) => {
    const t = TOOLS[tool];
    const config = applyConfig(root, tool, withKey);
    const rule = libs.length ? applyRule(root, tool, libs) : null;
    const notes = [];
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
    return { tool, name: t.name, config, rule, notes };
  });
}

export function resetAll({ root, tools }) {
  const results = tools.map((tool) => {
    const t = TOOLS[tool];
    const path = join(root, t.configFile);
    const before = readIfExists(path);
    const { text, result } = t.format === "toml" ? removeServerToml(before) : removeServerJson(before, t.configFile);
    if (result === "cambiado") {
      if (text === "") rmSync(path, { force: true });
      else writeAtomic(path, text);
    }
    return { tool, name: t.name, config: { file: t.configFile, result }, rule: null, notes: [] };
  });
  // Cursor y Codex comparten AGENTS.md: el bloque solo se quita si ninguna herramienta que siga usando Context7 lo necesita.
  const stillUsing = toolsPresent(root).filter((tool) => !tools.includes(tool) && serverState(root, tool).configured);
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
    throw new SetupContext7Error("No hay carpetas de agentes en este proyecto (.cursor/agents, .claude/agents, .codex/agents). Ejecuta apm install antes.", 3);
  }
  if (opts.command === "detect") return JSON.stringify({ ...detectReport({ root, tools }), key: await keyState(root) }, null, 2);
  if (opts.command === "reset") return JSON.stringify(resetAll({ root, tools }), null, 2);
  return JSON.stringify(applyAll({ root, tools, libs: opts.libs, withKey: opts.withKey, key: await keyState(root) }), null, 2);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  run(process.argv.slice(2))
    .then((out) => console.log(out))
    .catch((e) => {
      console.error(e.message);
      process.exit(e instanceof SetupContext7Error ? e.code : 1);
    });
}
