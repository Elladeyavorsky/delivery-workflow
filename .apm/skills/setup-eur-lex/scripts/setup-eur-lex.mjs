#!/usr/bin/env node
import { execFile as execFileCb } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export class SetupEurLexError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

export const SERVER_NAME = "eur-lex";
export const PACKAGE = "@cyanheads/eur-lex-mcp-server";
export const VERSION = "0.21.0";
export const COMMAND = "npx";
export const ARGS = ["-y", `${PACKAGE}@${VERSION}`];
// engines.node del paquete: >=24.0.0.
export const MIN_NODE_MAJOR = 24;

// El servidor corre en local por stdio y no necesita clave.
export const TOOLS = {
  cursor: {
    name: "Cursor",
    agentsDir: ".cursor/agents",
    configFile: ".cursor/mcp.json",
    format: "json",
    entry: () => ({ command: COMMAND, args: [...ARGS] }),
  },
  claude: {
    name: "Claude Code",
    agentsDir: ".claude/agents",
    configFile: ".mcp.json",
    format: "json",
    entry: () => ({ type: "stdio", command: COMMAND, args: [...ARGS] }),
  },
  codex: {
    name: "Codex",
    agentsDir: ".codex/agents",
    configFile: ".codex/config.toml",
    format: "toml",
  },
};

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
    throw new SetupEurLexError(`${file} no es un JSON válido: no se toca. Arréglalo y repite.`, 3);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new SetupEurLexError(`${file} no es un objeto JSON: no se toca.`, 3);
  }
  return data;
}

// Devuelve {text, result}. Solo cambia la clave eur-lex; los demás MCP quedan como estaban.
export function setServerJson(text, entry, file = "mcp.json") {
  const data = parseJsonFile(text, file);
  if (data.mcpServers !== undefined && (data.mcpServers === null || typeof data.mcpServers !== "object" || Array.isArray(data.mcpServers))) {
    throw new SetupEurLexError(`${file}: «mcpServers» no es un objeto: no se toca.`, 3);
  }
  const current = data.mcpServers?.[SERVER_NAME];
  if (current !== undefined && JSON.stringify(current) === JSON.stringify(entry)) return { text, result: "igual" };
  data.mcpServers = { ...(data.mcpServers ?? {}), [SERVER_NAME]: entry };
  return { text: `${JSON.stringify(data, null, 2)}\n`, result: "cambiado" };
}

export function removeServerJson(text, file = "mcp.json") {
  if (text === null) return { text: null, result: "ausente" };
  const data = parseJsonFile(text, file);
  if (!data.mcpServers || typeof data.mcpServers !== "object" || !(SERVER_NAME in data.mcpServers)) return { text, result: "igual" };
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

const OUR_TABLES = [`mcp_servers.${SERVER_NAME}`, `mcp_servers."${SERVER_NAME}"`];
const isOurs = (name) => OUR_TABLES.some((t) => name === t || name.startsWith(`${t}.`));

// Comprobación mínima de TOML: cabeceras de tabla bien cerradas, arrays cerrados y cadenas multilínea cerradas.
// No es un parser completo: lo que no detecta lo rechazará la herramienta al cargar la config.
const HEADER = /^\[\[?\s*[^\[\]]+?\s*\]\]?\s*(#.*)?$/;
const STRINGS = /"(?:[^"\\]|\\.)*"|'[^']*'/g;

function checkToml(lines, file) {
  const invalid = (where) => new SetupEurLexError(`${file} no es un TOML válido (${where}): no se toca. Arréglalo y repite.`, 3);
  let quote = null;
  let depth = 0;
  lines.forEach((line, i) => {
    if (quote) {
      if (line.includes(quote)) quote = null;
      return;
    }
    const open = /("""|''')/.exec(line);
    if (open && line.split(open[1]).length % 2 === 0) {
      quote = open[1];
      return;
    }
    const bare = line.replace(STRINGS, '""').replace(/#.*$/, "").trim();
    if (bare === "") return;
    if (depth === 0 && bare.startsWith("[")) {
      if (!HEADER.test(bare)) throw invalid(`línea ${i + 1}`);
      return;
    }
    if (depth === 0 && !bare.includes("=")) throw invalid(`línea ${i + 1}`);
    for (const ch of bare) {
      if (ch === "[" || ch === "{") depth++;
      else if (ch === "]" || ch === "}") depth--;
      if (depth < 0) throw invalid(`línea ${i + 1}`);
    }
  });
  if (quote) throw invalid("cadena sin cerrar");
  if (depth !== 0) throw invalid("array o tabla en línea sin cerrar");
}

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

export function tomlBlock() {
  return [`[mcp_servers.${SERVER_NAME}]`, `command = "${COMMAND}"`, `args = [${ARGS.map((a) => `"${a}"`).join(", ")}]`];
}

export function setServerToml(text, file = "config.toml") {
  const eol = text?.includes("\r\n") ? "\r\n" : "\n";
  const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");
  checkToml(lines, file);
  const kept = dropServerToml(lines);
  const next = [...kept, ...(kept.length ? [""] : []), ...tomlBlock()].join("\n") + "\n";
  const out = next.replace(/\n/g, eol);
  return { text: out, result: out === text ? "igual" : "cambiado" };
}

export function removeServerToml(text, file = "config.toml") {
  if (text === null) return { text: null, result: "ausente" };
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  checkToml(lines, file);
  const kept = dropServerToml(lines);
  const out = kept.length ? kept.join("\n").replace(/\n/g, eol) + eol : "";
  return { text: out, result: out === text ? "igual" : "cambiado" };
}

// --- Node ---

export function nodeMajor(version = process.versions.node) {
  return Number.parseInt(String(version).replace(/^v/, "").split(".")[0], 10);
}

export function nodeNote(version = process.versions.node) {
  if (nodeMajor(version) >= MIN_NODE_MAJOR) return null;
  return `Esta terminal tiene Node ${version}. ${PACKAGE} necesita Node ${MIN_NODE_MAJOR} o superior: sin él, legal-advisor responde solo con data-protection-guideline y lo dice en su comentario.`;
}

// --- Órdenes ---

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, target: null, root: null };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--target") opts.target = rest[++i];
    else if (a === "--root") opts.root = rest[++i];
    else throw new SetupEurLexError(`Argumento desconocido: ${a}\n${USAGE}`, 2);
  }
  return opts;
}

export const USAGE = [
  "Uso: setup-eur-lex.mjs <apply|reset> [opciones]",
  `  apply                  Escribe el MCP eur-lex (${PACKAGE}@${VERSION}) en cada herramienta.`,
  "  reset                  Quita el MCP eur-lex.",
  "Opciones: --target cursor|claude|codex  --root RUTA",
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
  if (!TOOLS[opts.target]) throw new SetupEurLexError(`Herramienta desconocida: «${opts.target}».`, 2);
  if (!present.includes(opts.target)) {
    throw new SetupEurLexError(`No hay carpeta de agentes de ${opts.target} en este proyecto. ¿Has ejecutado apm install?`, 3);
  }
  return [opts.target];
}

// Calcula todos los cambios antes de escribir: un fichero inválido no deja los demás a medias.
function plan(root, tools, compute) {
  return tools.map((tool) => {
    const t = TOOLS[tool];
    const path = join(root, t.configFile);
    return { tool, t, path, ...compute(t, readIfExists(path)) };
  });
}

export function applyAll({ root, tools, nodeVersion = process.versions.node }) {
  const changes = plan(root, tools, (t, before) =>
    t.format === "toml" ? setServerToml(before, t.configFile) : setServerJson(before, t.entry(), t.configFile),
  );
  const warning = nodeNote(nodeVersion);
  return changes.map(({ tool, t, path, text, result }) => {
    if (result === "cambiado") writeAtomic(path, text);
    const notes = [];
    if (warning) notes.push(warning);
    notes.push(`Recarga ${t.name} para que cargue el MCP nuevo.`);
    return { tool, name: t.name, config: { file: t.configFile, result }, notes };
  });
}

export function resetAll({ root, tools }) {
  const changes = plan(root, tools, (t, before) =>
    t.format === "toml" ? removeServerToml(before, t.configFile) : removeServerJson(before, t.configFile),
  );
  return changes.map(({ tool, t, path, text, result }) => {
    if (result === "cambiado") {
      if (text === "") rmSync(path, { force: true });
      else writeAtomic(path, text);
    }
    return { tool, name: t.name, config: { file: t.configFile, result }, notes: [] };
  });
}

export async function run(argv) {
  const opts = parseArgs(argv);
  if (!["apply", "reset"].includes(opts.command)) throw new SetupEurLexError(USAGE, 2);
  const root = await resolveRoot(opts);
  const tools = selectTools(opts, root);
  if (tools.length === 0) {
    throw new SetupEurLexError("No hay carpetas de agentes en este proyecto (.cursor/agents, .claude/agents, .codex/agents). Ejecuta apm install antes.", 3);
  }
  if (opts.command === "reset") return JSON.stringify(resetAll({ root, tools }), null, 2);
  return JSON.stringify(applyAll({ root, tools }), null, 2);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  run(process.argv.slice(2))
    .then((out) => console.log(out))
    .catch((e) => {
      console.error(e.message);
      process.exit(e instanceof SetupEurLexError ? e.code : 1);
    });
}
