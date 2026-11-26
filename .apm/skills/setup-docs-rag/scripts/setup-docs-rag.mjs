#!/usr/bin/env node
// Canal RAG local de documentación: inventario con versiones, índice en Qdrant y MCP docs-rag.
// El script escribe JSON y nunca pregunta: la skill habla con la persona.
import { execFile as execFileCb, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  DOCS_RAG_SERVER,
  TOOLS,
  channelOf,
  displayPath,
  findManifests,
  loadProfiles,
  classify,
  jsoncNotes,
  parseLibs,
  removeServerFromFile,
  resetAll as removeContext7,
  setServerJson,
  serversKey,
  setServerTomlBlock,
  tomlStdioBlock,
  toolsPresent,
  userConfigPath,
} from "../../setup-context7/scripts/setup-context7.mjs";

const execFile = promisify(execFileCb);
const here = dirname(fileURLToPath(import.meta.url));

export class SetupDocsRagError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

export const RAG_DIR = ".docs-rag";
export const INVENTORY_FILE = "inventory.json";
export const REQUEST_FILE = "request.json";
// El formato anterior (claves en español). El indexador lo migra; aquí solo se detecta.
export const LEGACY_INVENTORY_FILE = "inventario.json";
// Las funciones de config compartidas con setup-context7 devuelven el resultado en español.
const RESULT = { cambiado: "changed", igual: "unchanged", ausente: "missing" };
const resultInEnglish = (result) => RESULT[result] ?? result;
export const QDRANT_CONTAINER = "docs-rag-qdrant";
export const QDRANT_IMAGE = "qdrant/qdrant:v1.20.2";
export const QDRANT_URL = "http://localhost:6333";
export const EMBED_MODEL = "nomic-embed-text";
export const APP_SOURCE = join(here, "docs_rag");

// --- Versiones ---

// Primera versión numérica de un rango («^19.0.0» → 19.0.0, «>=3.12» → 3.12). exact si el rango fija una sola versión.
export function versionFromRange(range) {
  const text = String(range ?? "").trim();
  const m = /(\d+(?:\.\d+){0,3})/.exec(text);
  if (!m) return null;
  const exact = /^(?:==|=)?\s*v?\d+(?:\.\d+){2,3}$/.test(text);
  return { version: m[1], exact };
}

const normalizePy = (name) => name.toLowerCase().replace(/[_.]+/g, "-");

// package-lock.json v1, v2 y v3: solo las dependencias de primer nivel.
export function parsePackageLock(text) {
  const data = JSON.parse(text);
  const out = new Map();
  if (data.packages) {
    for (const [key, info] of Object.entries(data.packages)) {
      const m = /^node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(key);
      if (m && info?.version) out.set(m[1], info.version);
    }
  } else if (data.dependencies) {
    for (const [name, info] of Object.entries(data.dependencies)) if (info?.version) out.set(name, info.version);
  }
  return out;
}

// pnpm-lock.yaml: importers['.'] (v6 y v9) o las secciones de primer nivel (v5). Lectura por líneas, sin YAML completo.
export function parsePnpmLock(text) {
  const out = new Map();
  const lines = String(text).replace(/\r/g, "").split("\n");
  let section = null;
  let inImporterRoot = false;
  let pending = null;
  for (const line of lines) {
    if (/^\S/.test(line)) {
      section = line.replace(/:.*$/, "");
      inImporterRoot = false;
      continue;
    }
    if (section === "importers") {
      const imp = /^ {2}(['"]?)([^\s'":][^'":]*)\1:\s*$/.exec(line);
      if (imp) {
        inImporterRoot = imp[2] === ".";
        continue;
      }
      if (!inImporterRoot) continue;
      const dep = /^ {6}(['"]?)(@?[^'":]+)\1:\s*$/.exec(line);
      if (dep) {
        pending = dep[2];
        continue;
      }
      const ver = /^ {8}version:\s*['"]?([^\s('"]+)/.exec(line);
      if (ver && pending) {
        out.set(pending, ver[1]);
        pending = null;
      }
    } else if (section === "dependencies" || section === "devDependencies") {
      const v5 = /^ {2}(['"]?)(@?[^'":]+)\1:\s*['"]?(\d[^\s('"]*)/.exec(line);
      if (v5) out.set(v5[2], v5[3]);
    }
  }
  return out;
}

// yarn.lock v1 («version "x"») y berry («version: x»). Devuelve nombre → versión (la primera entrada del nombre).
export function parseYarnLock(text) {
  const out = new Map();
  const lines = String(text).replace(/\r/g, "").split("\n");
  let names = [];
  for (const line of lines) {
    if (/^\S/.test(line) && line.trim().endsWith(":") && !line.startsWith("#") && !line.startsWith("__metadata")) {
      names = line
        .slice(0, -1)
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, ""))
        .map((spec) => {
          const at = spec.lastIndexOf("@");
          return at > 0 ? spec.slice(0, at) : spec;
        });
      continue;
    }
    const v = /^\s+version:?\s+"?([^"\s]+)"?/.exec(line);
    if (v && names.length) {
      for (const n of names) if (!out.has(n)) out.set(n, v[1]);
      names = [];
    }
  }
  return out;
}

// uv.lock, poetry.lock y Cargo.lock: bloques [[package]] con name y version.
export function parseTomlPackages(text, normalize = (n) => n) {
  const out = new Map();
  let name = null;
  for (const raw of String(text).replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (line === "[[package]]") {
      name = null;
      continue;
    }
    const n = /^name\s*=\s*"([^"]+)"/.exec(line);
    if (n) {
      name = normalize(n[1]);
      continue;
    }
    const v = /^version\s*=\s*"([^"]+)"/.exec(line);
    if (v && name && !out.has(name)) {
      out.set(name, v[1]);
      name = null;
    }
  }
  return out;
}

// --- Rangos declarados en cada manifiesto ---

export function rangesFromManifest(file, text) {
  const ranges = new Map();
  if (file === "package.json") {
    const data = JSON.parse(text);
    for (const key of ["dependencies", "devDependencies"]) for (const [n, r] of Object.entries(data?.[key] ?? {})) ranges.set(n, String(r));
  } else if (file === "requirements.txt") {
    for (const raw of String(text).split(/\r?\n/)) {
      const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*([<>=!~].*?)?\s*(?:#.*)?$/.exec(raw);
      if (m && !raw.trim().startsWith("-")) ranges.set(normalizePy(m[1]), (m[2] ?? "").trim());
    }
  } else if (file === "pyproject.toml") {
    for (const m of String(text).matchAll(/["']([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*([<>=!~][^"';]*)?[^"']*["']/g)) {
      if (!ranges.has(normalizePy(m[1]))) ranges.set(normalizePy(m[1]), (m[2] ?? "").trim());
    }
    for (const m of String(text).matchAll(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/gm)) {
      ranges.set(normalizePy(m[1]), m[2] ?? m[3]);
    }
  } else if (file === "go.mod") {
    for (const m of String(text).matchAll(/^\s*(?:require\s+)?(\S+)\s+(v\d\S*)/gm)) ranges.set(m[1], m[2].replace(/^v/, ""));
  } else if (file === "Cargo.toml") {
    for (const m of String(text).matchAll(/^([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/gm)) ranges.set(m[1], m[2] ?? m[3]);
  }
  return ranges;
}

const LOCKFILES = {
  npm: [
    { file: "package-lock.json", parse: parsePackageLock },
    { file: "pnpm-lock.yaml", parse: parsePnpmLock },
    { file: "yarn.lock", parse: parseYarnLock },
  ],
  python: [
    { file: "uv.lock", parse: (t) => parseTomlPackages(t, normalizePy) },
    { file: "poetry.lock", parse: (t) => parseTomlPackages(t, normalizePy) },
  ],
  rust: [{ file: "Cargo.lock", parse: (t) => parseTomlPackages(t) }],
  go: [],
};

const readText = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

// Lockfile del ecosistema en la carpeta del manifiesto o en una superior (monorepos), hasta la raíz.
function findLock(root, dir, ecosystem, warnings) {
  const parts = dir ? dir.split("/") : [];
  for (let i = parts.length; i >= 0; i--) {
    const rel = parts.slice(0, i).join("/");
    for (const { file, parse } of LOCKFILES[ecosystem] ?? []) {
      const relFile = rel ? `${rel}/${file}` : file;
      const text = readText(join(root, relFile));
      if (text === null) continue;
      try {
        return { file: relFile, versions: parse(text) };
      } catch {
        warnings.push(`${relFile} no se ha podido leer: se usan los rangos del manifiesto.`);
        return null;
      }
    }
  }
  return null;
}

// --- Runtimes fijados ---

const ALIAS = /^(lts|latest|stable|nightly|beta|node|system)/i;

export function detectRuntimes(root) {
  const out = [];
  const warnings = [];
  const add = (runtime, value, file, fromRange) => {
    const raw = String(value ?? "").trim();
    if (!raw) return;
    if (ALIAS.test(raw.replace(/^v/, ""))) {
      warnings.push(`${file} fija ${runtime} con el alias «${raw}»: no se indexa. Pon una versión (por ejemplo 20 o 1.80).`);
      return;
    }
    const v = versionFromRange(raw);
    if (!v) {
      warnings.push(`${file}: no se entiende la versión de ${runtime} «${raw}».`);
      return;
    }
    const rangeWarning = fromRange ? `${runtime} sale de un rango (${raw}) en ${file}: se usa la mínima, ${v.version}.` : null;
    if (rangeWarning) warnings.push(rangeWarning);
    out.push({ package: runtime, ecosystem: "runtime", version: v.version, origin: fromRange ? "range" : "pinned", source: file, runtime: true });
  };

  const pyVersion = readText(join(root, ".python-version"));
  const pyproject = readText(join(root, "pyproject.toml"));
  if (pyVersion?.trim()) add("python", pyVersion.trim().split(/\s+/)[0], ".python-version", false);
  else if (pyproject) {
    const m = /^requires-python\s*=\s*"([^"]+)"/m.exec(pyproject);
    if (m) add("python", m[1], "pyproject.toml (requires-python)", true);
  }

  const nvm = readText(join(root, ".nvmrc")) ?? readText(join(root, ".node-version"));
  const nvmFile = readText(join(root, ".nvmrc")) !== null ? ".nvmrc" : ".node-version";
  const pkg = readText(join(root, "package.json"));
  if (nvm?.trim()) add("node", nvm.trim().split(/\s+/)[0], nvmFile, false);
  else if (pkg) {
    try {
      const engines = JSON.parse(pkg)?.engines?.node;
      if (engines) add("node", engines, "package.json (engines.node)", !versionFromRange(engines)?.exact);
    } catch {
      /* package.json roto: lo avisa el inventario de dependencias */
    }
  }

  const gomod = readText(join(root, "go.mod"));
  if (gomod) {
    const tc = /^toolchain\s+go(\S+)/m.exec(gomod);
    const go = /^go\s+(\S+)/m.exec(gomod);
    if (tc) add("go", tc[1], "go.mod (toolchain)", false);
    else if (go) add("go", go[1], "go.mod (go)", false);
  }

  const toolchain = readText(join(root, "rust-toolchain.toml")) ?? readText(join(root, "rust-toolchain"));
  const cargo = readText(join(root, "Cargo.toml"));
  if (toolchain?.trim()) {
    const m = /channel\s*=\s*"([^"]+)"/.exec(toolchain);
    add("rust", m ? m[1] : toolchain.trim(), existsSync(join(root, "rust-toolchain.toml")) ? "rust-toolchain.toml" : "rust-toolchain", false);
  } else if (cargo) {
    const m = /^rust-version\s*=\s*"([^"]+)"/m.exec(cargo);
    if (m) add("rust", m[1], "Cargo.toml (rust-version)", true);
  }
  return { runtimes: out, warnings };
}

// --- Inventario ---

// Dependencias directas con versión, descartes y runtimes. Reutiliza la búsqueda de manifiestos de setup-context7.
export function buildInventory({ root, profiles = loadProfiles() }) {
  const warnings = [];
  const manifests = [];
  const byKey = new Map();
  const discarded = [];
  for (const { rel, ecosystem, parse } of findManifests(root)) {
    const text = readText(join(root, rel));
    const file = rel.split("/").pop();
    const dir = rel.split("/").slice(0, -1).join("/");
    let names;
    let ranges;
    try {
      names = parse(text);
      ranges = rangesFromManifest(file, text);
    } catch (e) {
      manifests.push({ file: rel, ecosystem, count: 0, error: e.message });
      continue;
    }
    const lock = findLock(root, dir, ecosystem, warnings);
    manifests.push({ file: rel, ecosystem, count: names.length, lockfile: lock?.file ?? null });
    for (const name of names) {
      const key = `${ecosystem}:${name}`;
      const known = byKey.get(key);
      if (known) {
        known.sources.push(rel);
        continue;
      }
      const c = classify(profiles, name);
      if (c.status === "descartada") {
        discarded.push({ package: name, ecosystem, reason: c.why });
        byKey.set(key, { skip: true, sources: [rel] });
        continue;
      }
      const locked = lock?.versions.get(name);
      const range = ranges.get(name);
      let entry;
      if (locked) entry = { version: locked.replace(/^v/, ""), origin: "lockfile", source: lock.file };
      else {
        const v = versionFromRange(range);
        if (v?.exact) entry = { version: v.version, origin: "pinned", source: rel };
        else if (v) {
          entry = { version: v.version, origin: "range", source: rel };
          warnings.push(`${name} (${ecosystem}) no está en ningún lockfile: se usa la mínima del rango «${range}», ${v.version}.`);
        } else {
          entry = { version: null, origin: "unknown", source: rel };
          warnings.push(`${name} (${ecosystem}) no tiene versión en el lockfile ni en ${rel}: no se indexa.`);
        }
      }
      byKey.set(key, { package: name, ecosystem, ...entry, runtime: false, sources: [rel] });
    }
  }
  const { runtimes, warnings: runtimeWarnings } = detectRuntimes(root);
  const dependencies = [...byKey.values()].filter((d) => !d.skip);
  return { manifests, dependencies, runtimes, discarded, warnings: [...warnings, ...runtimeWarnings] };
}

// --- Requisitos y estado ---

async function tryRun(cmd, args, opts = {}) {
  try {
    const { stdout } = await execFile(cmd, args, { timeout: opts.timeout ?? 20000, windowsHide: true, ...opts });
    return { ok: true, out: stdout.trim() };
  } catch (e) {
    return { ok: false, out: String(e.stderr ?? e.message ?? "").trim(), missing: e.code === "ENOENT" };
  }
}

export async function checkRequirements(run = tryRun) {
  const docker = await run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  const ollama = await run("ollama", ["list"]);
  const uv = await run("uv", ["--version"]);
  const container = docker.ok ? await run("docker", ["ps", "-a", "--filter", `name=^${QDRANT_CONTAINER}$`, "--format", "{{.Status}}"]) : { ok: false, out: "" };
  return {
    docker: { ok: docker.ok, detail: docker.ok ? `Docker ${docker.out}` : docker.missing ? "Docker no está instalado." : "Docker no responde: arranca Docker Desktop o el servicio." },
    ollama: { ok: ollama.ok, detail: ollama.ok ? "Ollama responde." : ollama.missing ? "Ollama no está instalado (ollama.com)." : "Ollama no responde: arráncalo." },
    uv: { ok: uv.ok, detail: uv.ok ? uv.out : "uv no está instalado (docs.astral.sh/uv)." },
    model: { ok: ollama.ok && ollama.out.split("\n").some((l) => l.startsWith(`${EMBED_MODEL}:`)), detail: EMBED_MODEL },
    qdrant: { ok: /^Up/.test(container.out ?? ""), detail: container.out ? `${QDRANT_CONTAINER}: ${container.out}` : `${QDRANT_CONTAINER} no existe todavía.` },
  };
}

export function indexState(root) {
  const text = readText(join(root, RAG_DIR, INVENTORY_FILE));
  if (text === null) {
    if (readText(join(root, RAG_DIR, LEGACY_INVENTORY_FILE)) !== null) return { exists: false, legacy: true };
    return { exists: false };
  }
  try {
    const inv = JSON.parse(text);
    const packages = Object.values(inv.packages ?? {});
    return {
      exists: true,
      collection: inv.collection,
      updated: inv.updated,
      indexed: packages.filter((p) => p.status === "indexed").length,
      no_docs: packages.filter((p) => p.status === "no_docs").map((p) => ({ package: p.package, reason: p.reason })),
      chunks: packages.reduce((n, p) => n + (p.chunks ?? 0), 0),
    };
  } catch {
    return { exists: true, error: `${RAG_DIR}/${INVENTORY_FILE} no es un JSON válido.` };
  }
}

// --- Registro del MCP docs-rag en la config del proyecto ---

// El código y el entorno del MCP viven en el proyecto, dentro de .docs-rag/ (fuera de git por su .gitignore).
export function appDirs(root) {
  return { app: join(root, RAG_DIR, "app"), venv: join(root, RAG_DIR, "venv") };
}

// Rutas relativas a la raíz del proyecto: la entrada no lleva rutas de este ordenador.
// Claude Code y Codex arrancan el servidor en la raíz del proyecto. Cursor no lo garantiza: usa ${workspaceFolder}.
// uv resuelve un UV_PROJECT_ENVIRONMENT relativo desde la carpeta de --project (.docs-rag/app), no desde el directorio
// de trabajo: por eso el entorno es ../venv.
// opencode arranca el servidor en la carpeta desde la que se lanza, que puede ser una subcarpeta: el comando
// va antes a la raíz del repositorio.
const OPENCODE_COMMAND = `cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && exec uv run --quiet --project ${RAG_DIR}/app python -m docs_rag.server`;

export function serverEntry(tool) {
  if (tool === "opencode") {
    return { type: "local", enabled: true, command: ["bash", "-c", OPENCODE_COMMAND], environment: { UV_PROJECT_ENVIRONMENT: "../venv" } };
  }
  const cursor = tool === "cursor";
  const args = ["run", "--quiet", "--project", `${cursor ? "${workspaceFolder}/" : ""}${RAG_DIR}/app`, "python", "-m", "docs_rag.server"];
  if (cursor) args.push("--root", "${workspaceFolder}");
  const env = { UV_PROJECT_ENVIRONMENT: cursor ? `\${workspaceFolder}/${RAG_DIR}/venv` : "../venv" };
  if (tool === "claude") return { type: "stdio", command: "uv", args, env };
  return { command: "uv", args, env };
}

const projectFile = (tool) => TOOLS[tool].projectConfigFile;

function removeDocsRag(path, tool, file) {
  const { result } = removeServerFromFile(path, tool, file, DOCS_RAG_SERVER);
  return { file, result: resultInEnglish(result) };
}

// Registra docs-rag en la config del proyecto. No toca los demás servidores: context7 lo quita registerTools.
export function registerServer({ root, tool }) {
  const t = TOOLS[tool];
  const file = projectFile(tool);
  const path = join(root, file);
  const before = readText(path);
  const entry = serverEntry(tool);
  const set = t.format === "toml" ? setServerTomlBlock(before, DOCS_RAG_SERVER, tomlStdioBlock(DOCS_RAG_SERVER, entry)) : setServerJson(before, entry, file, DOCS_RAG_SERVER, serversKey(t.format));
  if (set.result === "cambiado") writeAtomic(path, set.text);
  return { file, result: resultInEnglish(set.result) };
}

export function unregisterServer({ root, tool }) {
  return removeDocsRag(join(root, projectFile(tool)), tool, projectFile(tool));
}

// Quita el registro de usuario que dejaban las versiones anteriores (la #64 lo escribía en ~/).
export function unregisterUserServer({ home, tool }) {
  return removeDocsRag(userConfigPath(home, tool), tool, displayPath(tool, home));
}

function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

// --- Carpeta del proyecto ---

export function ensureRagDir(root) {
  const dir = join(root, RAG_DIR);
  mkdirSync(dir, { recursive: true });
  const ignore = join(dir, ".gitignore");
  if (readText(ignore) !== "*\n") writeFileSync(ignore, "*\n");
  return dir;
}

// Petición para el indexador: lo que hay que tener indexado. libs limita las dependencias a las confirmadas.
export function buildRequest(inventory, { libs = [], withRuntimes = true } = {}) {
  const wanted = libs.length ? new Set(libs) : null;
  const deps = inventory.dependencies.filter((d) => d.version && (!wanted || wanted.has(d.package)));
  const runtimes = withRuntimes ? inventory.runtimes : [];
  return {
    packages: [...runtimes, ...deps].map(({ package: name, ecosystem, version, origin, source, runtime }) => ({ package: name, ecosystem, version, origin, source, runtime })),
  };
}

// --- Órdenes ---

export const USAGE = [
  "Uso: setup-docs-rag.mjs <detect|apply|reset> [opciones]",
  "  detect        Inventario (dependencias con versión, runtimes, descartes), requisitos, índice y canal de cada herramienta (JSON).",
  "  apply         Arranca Qdrant, descarga el modelo, instala el MCP en .docs-rag/, indexa lo que haya cambiado, registra docs-rag en la config del proyecto y quita Context7 (canal único).",
  "  reset         Quita el MCP docs-rag de la config del proyecto. Con --drop-index borra también la colección y .docs-rag/.",
  "Opciones: --libs a,b,c  --no-runtimes  --target opencode|cursor|claude|codex  --drop-index  --root RUTA  --home RUTA",
].join("\n");

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, root: null, home: null, target: null, libs: [], withRuntimes: true, dropIndex: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--root") opts.root = rest[++i];
    else if (a === "--home") opts.home = rest[++i];
    else if (a === "--target") opts.target = rest[++i];
    else if (a === "--libs") opts.libs = [...new Set([...opts.libs, ...parseLibs(rest[++i])])];
    else if (a === "--no-runtimes") opts.withRuntimes = false;
    else if (a === "--drop-index") opts.dropIndex = true;
    else throw new SetupDocsRagError(`Argumento desconocido: ${a}\n${USAGE}`, 2);
  }
  return opts;
}

async function resolveRoot(opts) {
  if (opts.root) return resolve(opts.root);
  const r = await tryRun("git", ["rev-parse", "--show-toplevel"]);
  return r.ok && r.out ? resolve(r.out) : process.cwd();
}

function selectTools(opts, root) {
  const present = toolsPresent(root);
  if (!opts.target) return present;
  if (!TOOLS[opts.target]) throw new SetupDocsRagError(`Herramienta desconocida: «${opts.target}».`, 2);
  if (!present.includes(opts.target)) throw new SetupDocsRagError(`No hay carpeta de agentes de ${opts.target} en este proyecto. ¿Has ejecutado apm install?`, 3);
  return [opts.target];
}

export async function detect({ root, home, tools, run = tryRun }) {
  return {
    inventory: buildInventory({ root }),
    requirements: await checkRequirements(run),
    index: indexState(root),
    tools: tools.map((tool) => ({ tool, name: TOOLS[tool].name, configFile: projectFile(tool), channel: channelOf(home, tool, root) })),
  };
}

async function waitForQdrant(timeoutMs = 60000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${QDRANT_URL}/readyz`);
      if (res.ok) return true;
    } catch {
      /* todavía arrancando */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// Si ya responde un Qdrant en el puerto, se reutiliza: cada proyecto usa su propia colección (docs_v2_<hash>).
async function ensureQdrant() {
  if (await waitForQdrant(1500)) return "existing";
  const ps = await tryRun("docker", ["ps", "-a", "--filter", `name=^${QDRANT_CONTAINER}$`, "--format", "{{.Status}}"]);
  if (!ps.out) {
    const r = await tryRun("docker", ["run", "-d", "--name", QDRANT_CONTAINER, "-p", "6333:6333", "-v", `${QDRANT_CONTAINER}:/qdrant/storage`, "--restart", "unless-stopped", QDRANT_IMAGE], { timeout: 600000 });
    if (!r.ok) {
      await tryRun("docker", ["rm", "-f", QDRANT_CONTAINER]);
      throw new SetupDocsRagError(`No se pudo arrancar Qdrant: ${r.out}`, 4);
    }
  } else if (!/^Up/.test(ps.out)) {
    const r = await tryRun("docker", ["start", QDRANT_CONTAINER]);
    if (!r.ok) throw new SetupDocsRagError(`No se pudo arrancar ${QDRANT_CONTAINER}: ${r.out}`, 4);
  }
  if (!(await waitForQdrant())) throw new SetupDocsRagError(`Qdrant no responde en ${QDRANT_URL}.`, 4);
  return QDRANT_CONTAINER;
}

async function ensureModel() {
  const list = await tryRun("ollama", ["list"]);
  if (list.ok && list.out.split("\n").some((l) => l.startsWith(`${EMBED_MODEL}:`))) return "unchanged";
  const r = await tryRun("ollama", ["pull", EMBED_MODEL], { timeout: 1800000 });
  if (!r.ok) throw new SetupDocsRagError(`No se pudo descargar ${EMBED_MODEL}: ${r.out}`, 4);
  return "downloaded";
}

// Copia el paquete Python a .docs-rag/app del proyecto y prepara su entorno en .docs-rag/venv.
async function installApp(root) {
  const { app, venv } = appDirs(root);
  rmSync(app, { recursive: true, force: true });
  mkdirSync(dirname(app), { recursive: true });
  cpSync(APP_SOURCE, app, { recursive: true, filter: (src) => !/(__pycache__|\.pytest_cache|\.venv)/.test(src) });
  const r = await tryRun("uv", ["sync", "--quiet", "--project", app], { timeout: 1800000, env: { ...process.env, UV_PROJECT_ENVIRONMENT: venv } });
  if (!r.ok) throw new SetupDocsRagError(`uv no pudo preparar el entorno de docs-rag: ${r.out}`, 4);
  return { app, venv };
}

// Lanza el indexador. El progreso va a stderr (se ve en la terminal) y el resumen JSON a stdout.
function runIndexer(root, extra = []) {
  const { app, venv } = appDirs(root);
  return new Promise((resolvePromise, reject) => {
    const child = spawn("uv", ["run", "--quiet", "--project", app, "python", "-m", "docs_rag.indexer", "--root", root, ...extra], {
      env: { ...process.env, UV_PROJECT_ENVIRONMENT: venv, PYTHONIOENCODING: "utf-8" },
      stdio: ["ignore", "pipe", "inherit"],
      windowsHide: true,
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", (e) => reject(new SetupDocsRagError(`No se pudo lanzar el indexador: ${e.message}`, 4)));
    child.on("close", (code) => {
      if (code !== 0) return reject(new SetupDocsRagError(`El indexador terminó con el código ${code}.`, 4));
      try {
        resolvePromise(JSON.parse(out));
      } catch {
        reject(new SetupDocsRagError(`El indexador no devolvió JSON: ${out.slice(0, 500)}`, 4));
      }
    });
  });
}

// Solo hay un canal de documentación: registra docs-rag en el proyecto y quita Context7 (su MCP de la config de
// usuario y su regla del proyecto) y el docs-rag de usuario de versiones anteriores. Notas para la persona.
export function registerTools({ root, home, tools }) {
  const legacyApp = existsSync(join(home, RAG_DIR));
  const context7 = removeContext7({ root, home, tools });
  return tools.map((tool, index) => {
    const t = TOOLS[tool];
    const config = registerServer({ root, tool });
    const legacy = unregisterUserServer({ home, tool });
    const removed = context7[index];
    const context7Removed = { config: { file: removed.config.file, result: resultInEnglish(removed.config.result) }, rule: { file: removed.rule.file, result: resultInEnglish(removed.rule.result) } };
    const notes = [];
    if (context7Removed.config.result === "changed") {
      notes.push(`Se ha quitado context7 de ${removed.config.file}: el canal de documentación pasa a ser docs-rag. Esa config es de usuario, así que ${t.name} deja de usar Context7 también en tus otros proyectos. Para volver, lanza /setup-context7.`);
    }
    if (context7Removed.rule.result === "changed") notes.push(`Se ha quitado la regla de Context7 de ${removed.rule.file}.`);
    notes.push(...removed.notes);
    if (t.format === "opencode") notes.push(...jsoncNotes(join(root, projectFile(tool)), projectFile(tool)));
    if (legacy.result === "changed") notes.push(`Se ha quitado docs-rag de ${legacy.file}: ahora se registra en ${config.file} del proyecto.`);
    if (legacyApp && index === 0) notes.push(`~/${RAG_DIR}/ es de una versión anterior y ya no se usa. Bórralo si ningún otro proyecto lo necesita.`);
    notes.push(`${config.file} usa rutas relativas al proyecto. Si lo subes a git, quien no haya lanzado /setup-docs-rag verá un MCP docs-rag que no arranca.`);
    notes.push(`Recarga ${t.name} para que cargue el MCP docs-rag.`);
    return { tool, name: t.name, config, context7Removed, notes };
  });
}

export async function apply({ root, home, tools, libs, withRuntimes }) {
  const req = await checkRequirements();
  const faltan = ["docker", "ollama", "uv"].filter((k) => !req[k].ok);
  if (faltan.length) throw new SetupDocsRagError(`Faltan requisitos: ${faltan.map((k) => req[k].detail).join(" ")} No se ha tocado nada.`, 3);
  const inventory = buildInventory({ root });
  const request = buildRequest(inventory, { libs, withRuntimes });
  ensureRagDir(root);
  writeFileSync(join(root, RAG_DIR, REQUEST_FILE), `${JSON.stringify(request, null, 2)}\n`);
  const qdrant = await ensureQdrant();
  const model = await ensureModel();
  await installApp(root);
  const index = await runIndexer(root);
  return { qdrant, model, index, warnings: inventory.warnings, tools: registerTools({ root, home, tools }) };
}

export async function reset({ root, home, tools, dropIndex }) {
  const results = tools.map((tool) => {
    const config = unregisterServer({ root, tool });
    const legacy = unregisterUserServer({ home, tool });
    return { tool, name: TOOLS[tool].name, config, removedFromUserConfig: legacy.result === "changed" };
  });
  let index = null;
  if (dropIndex) {
    const { app } = appDirs(root);
    if (existsSync(app) && existsSync(join(root, RAG_DIR, INVENTORY_FILE))) {
      try {
        index = await runIndexer(root, ["--drop"]);
      } catch (e) {
        index = { error: e.message };
      }
    }
    rmSync(join(root, RAG_DIR), { recursive: true, force: true });
    index = { ...(index ?? {}), folder: `${RAG_DIR}/ deleted` };
  }
  return { tools: results, index };
}

export async function run(argv) {
  const opts = parseArgs(argv);
  if (!["detect", "apply", "reset"].includes(opts.command)) throw new SetupDocsRagError(USAGE, 2);
  const root = await resolveRoot(opts);
  const home = resolve(opts.home ?? homedir());
  const tools = selectTools(opts, root);
  if (tools.length === 0) throw new SetupDocsRagError("No hay carpetas de agentes en este proyecto (.opencode/agents, .cursor/agents, .claude/agents, .codex/agents). Ejecuta apm install antes.", 3);
  if (opts.command === "detect") return JSON.stringify(await detect({ root, home, tools }), null, 2);
  if (opts.command === "reset") return JSON.stringify(await reset({ root, home, tools, dropIndex: opts.dropIndex }), null, 2);
  return JSON.stringify(await apply({ root, home, tools, libs: opts.libs, withRuntimes: opts.withRuntimes }), null, 2);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  run(process.argv.slice(2))
    .then((out) => console.log(out))
    .catch((e) => {
      console.error(e.message);
      process.exit(e instanceof SetupDocsRagError ? e.code : 1);
    });
}
