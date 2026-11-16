#!/usr/bin/env node
import { execFile as execFileCb } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

// Descartadas (con motivo), sugeridas (por familia) u otras (se listan pero no se proponen).
export function classify(profiles, name) {
  for (const { why, match } of profiles.skip) {
    if (match.some((p) => new RegExp(p).test(name))) return { status: "descartada", why };
  }
  for (const { label, match } of profiles.suggest) {
    if (match.some((p) => new RegExp(p).test(name))) return { status: "sugerida", why: label };
  }
  return { status: "otra", why: "Sin criterio: se lista por si quieres añadirla." };
}

export function readDependencies({ root, profiles = loadProfiles() }) {
  const manifests = [];
  const dependencies = [];
  const seen = new Set();
  for (const { file, ecosystem, parse } of MANIFESTS) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const names = parse(readFileSync(path, "utf8"));
    manifests.push({ file, ecosystem, count: names.length });
    for (const name of names) {
      const key = `${ecosystem}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dependencies.push({ name, ecosystem, source: file, ...classify(profiles, name) });
    }
  }
  return { manifests, dependencies };
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
  "  detect                 Dependencias del proyecto (sugeridas, descartadas, otras) y estado de Context7 (JSON).",
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

export function applyAll({ root, tools, libs, withKey, env = process.env }) {
  return tools.map((tool) => {
    const t = TOOLS[tool];
    const config = applyConfig(root, tool, withKey);
    const rule = libs.length ? applyRule(root, tool, libs) : null;
    const notes = [];
    if (withKey) {
      notes.push(`La config usa la variable ${ENV_VAR}: expórtala en la terminal desde la que abres ${t.name}.`);
      if (!env[ENV_VAR]) notes.push(`${ENV_VAR} no está definida en esta terminal: sin ella, ${t.name} no podrá autenticarse.`);
    } else {
      notes.push(`Sin clave: Context7 funciona con el límite por defecto. Para más peticiones, consigue una clave en context7.com/dashboard, expórtala como ${ENV_VAR} y repite con --with-key.`);
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
  if (opts.command === "detect") return JSON.stringify(detectReport({ root, tools }), null, 2);
  if (opts.command === "reset") return JSON.stringify(resetAll({ root, tools }), null, 2);
  return JSON.stringify(applyAll({ root, tools, libs: opts.libs, withKey: opts.withKey }), null, 2);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  run(process.argv.slice(2))
    .then((out) => console.log(out))
    .catch((e) => {
      console.error(e.message);
      process.exit(e instanceof SetupContext7Error ? e.code : 1);
    });
}
