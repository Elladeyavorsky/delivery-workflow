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
  SERVER_NAME as CONTEXT7_SERVER,
  TOOLS,
  channelOf,
  displayPath,
  findManifests,
  loadProfiles,
  classify,
  parseLibs,
  removeServerJson,
  removeServerToml,
  setServerJson,
  setServerTomlBlock,
  tomlStdioBlock,
  toolsPresent,
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
function findLock(root, dir, ecosystem, avisos) {
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
        avisos.push(`${relFile} no se ha podido leer: se usan los rangos del manifiesto.`);
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
  const avisos = [];
  const add = (paquete, value, fuente, rango) => {
    const raw = String(value ?? "").trim();
    if (!raw) return;
    if (ALIAS.test(raw.replace(/^v/, ""))) {
      avisos.push(`${fuente} fija ${paquete} con el alias «${raw}»: no se indexa. Pon una versión (por ejemplo 20 o 1.80).`);
      return;
    }
    const v = versionFromRange(raw);
    if (!v) {
      avisos.push(`${fuente}: no se entiende la versión de ${paquete} «${raw}».`);
      return;
    }
    const aviso = rango ? `${paquete} sale de un rango (${raw}) en ${fuente}: se usa la mínima, ${v.version}.` : null;
    if (aviso) avisos.push(aviso);
    out.push({ paquete, ecosistema: "runtime", version: v.version, origen: rango ? "rango" : "fijado", fuente, runtime: true });
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
  return { runtimes: out, avisos };
}

// --- Inventario ---

// Dependencias directas con versión, descartes y runtimes. Reutiliza la búsqueda de manifiestos de setup-context7.
export function buildInventory({ root, profiles = loadProfiles() }) {
  const avisos = [];
  const manifests = [];
  const byKey = new Map();
  const descartadas = [];
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
    const lock = findLock(root, dir, ecosystem, avisos);
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
        descartadas.push({ paquete: name, ecosistema: ecosystem, motivo: c.why });
        byKey.set(key, { skip: true, sources: [rel] });
        continue;
      }
      const locked = lock?.versions.get(name);
      const range = ranges.get(name);
      let entry;
      if (locked) entry = { version: locked.replace(/^v/, ""), origen: "lockfile", fuente: lock.file };
      else {
        const v = versionFromRange(range);
        if (v?.exact) entry = { version: v.version, origen: "fijado", fuente: rel };
        else if (v) {
          entry = { version: v.version, origen: "rango", fuente: rel };
          avisos.push(`${name} (${ecosystem}) no está en ningún lockfile: se usa la mínima del rango «${range}», ${v.version}.`);
        } else {
          entry = { version: null, origen: "desconocido", fuente: rel };
          avisos.push(`${name} (${ecosystem}) no tiene versión en el lockfile ni en ${rel}: no se indexa.`);
        }
      }
      byKey.set(key, { paquete: name, ecosistema: ecosystem, ...entry, runtime: false, sources: [rel] });
    }
  }
  const { runtimes, avisos: avisosRuntime } = detectRuntimes(root);
  const dependencias = [...byKey.values()].filter((d) => !d.skip);
  return { manifests, dependencias, runtimes, descartadas, avisos: [...avisos, ...avisosRuntime] };
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
    docker: { ok: docker.ok, detalle: docker.ok ? `Docker ${docker.out}` : docker.missing ? "Docker no está instalado." : "Docker no responde: arranca Docker Desktop o el servicio." },
    ollama: { ok: ollama.ok, detalle: ollama.ok ? "Ollama responde." : ollama.missing ? "Ollama no está instalado (ollama.com)." : "Ollama no responde: arráncalo." },
    uv: { ok: uv.ok, detalle: uv.ok ? uv.out : "uv no está instalado (docs.astral.sh/uv)." },
    modelo: { ok: ollama.ok && ollama.out.split("\n").some((l) => l.startsWith(`${EMBED_MODEL}:`)), detalle: EMBED_MODEL },
    qdrant: { ok: /^Up/.test(container.out ?? ""), detalle: container.out ? `${QDRANT_CONTAINER}: ${container.out}` : `${QDRANT_CONTAINER} no existe todavía.` },
  };
}

export function indexState(root) {
  const text = readText(join(root, RAG_DIR, "inventario.json"));
  if (text === null) return { existe: false };
  try {
    const inv = JSON.parse(text);
    const paquetes = Object.values(inv.paquetes ?? {});
    return {
      existe: true,
      coleccion: inv.coleccion,
      actualizado: inv.actualizado,
      indexados: paquetes.filter((p) => p.estado === "indexado").length,
      sin_doc: paquetes.filter((p) => p.estado === "sin_doc").map((p) => ({ paquete: p.paquete, motivo: p.motivo })),
      fragmentos: paquetes.reduce((n, p) => n + (p.fragmentos ?? 0), 0),
    };
  } catch {
    return { existe: true, error: `${RAG_DIR}/inventario.json no es un JSON válido.` };
  }
}

// --- Registro del MCP docs-rag en la config de usuario ---

export function appDirs(home) {
  return { app: join(home, ".docs-rag", "app"), venv: join(home, ".docs-rag", "venv") };
}

// Cómo arranca cada herramienta el servidor. Cursor le pasa la carpeta del proyecto; Claude Code y Codex lo arrancan en ella.
export function serverEntry(tool, { uvPath = "uv", home }) {
  const { app, venv } = appDirs(home);
  const args = ["run", "--quiet", "--project", app, "python", "-m", "docs_rag.servidor"];
  if (tool === "cursor") args.push("--root", "${workspaceFolder}");
  const env = { UV_PROJECT_ENVIRONMENT: venv };
  if (tool === "claude") return { type: "stdio", command: uvPath, args, env };
  return { command: uvPath, args, env };
}

// Registra docs-rag y quita context7: un solo canal por ordenador.
export function registerServer({ home, tool, uvPath }) {
  const t = TOOLS[tool];
  const file = displayPath(tool);
  const path = join(home, t.configFile);
  const before = readText(path);
  const entry = serverEntry(tool, { uvPath, home });
  const set = t.format === "toml" ? setServerTomlBlock(before, DOCS_RAG_SERVER, tomlStdioBlock(DOCS_RAG_SERVER, entry)) : setServerJson(before, entry, file, DOCS_RAG_SERVER);
  const drop = t.format === "toml" ? removeServerToml(set.text, CONTEXT7_SERVER) : removeServerJson(set.text, file, CONTEXT7_SERVER);
  const changed = set.result === "cambiado" || drop.result === "cambiado";
  if (changed) writeAtomic(path, drop.text);
  return { file, result: changed ? "cambiado" : "igual", removed: drop.result === "cambiado" ? [CONTEXT7_SERVER] : [] };
}

export function unregisterServer({ home, tool }) {
  const t = TOOLS[tool];
  const file = displayPath(tool);
  const path = join(home, t.configFile);
  const before = readText(path);
  const { text, result } = t.format === "toml" ? removeServerToml(before, DOCS_RAG_SERVER) : removeServerJson(before, file, DOCS_RAG_SERVER);
  if (result === "cambiado") {
    if (text === "") rmSync(path, { force: true });
    else writeAtomic(path, text);
  }
  return { file, result };
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
  const deps = inventory.dependencias.filter((d) => d.version && (!wanted || wanted.has(d.paquete)));
  const runtimes = withRuntimes ? inventory.runtimes : [];
  return {
    paquetes: [...runtimes, ...deps].map(({ paquete, ecosistema, version, origen, fuente, runtime }) => ({ paquete, ecosistema, version, origen, fuente, runtime })),
  };
}

// --- Órdenes ---

export const USAGE = [
  "Uso: setup-docs-rag.mjs <detect|apply|reset> [opciones]",
  "  detect        Inventario (dependencias con versión, runtimes, descartes), requisitos, índice y canal de cada herramienta (JSON).",
  "  apply         Arranca Qdrant, descarga el modelo, indexa lo que haya cambiado y registra el MCP docs-rag (quita context7).",
  "  reset         Quita el MCP docs-rag de la config de usuario. Con --drop-index borra también la colección y .docs-rag/.",
  "Opciones: --libs a,b,c  --sin-runtimes  --target cursor|claude|codex  --drop-index  --root RUTA  --home RUTA",
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
    else if (a === "--sin-runtimes") opts.withRuntimes = false;
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
    inventario: buildInventory({ root }),
    requisitos: await checkRequirements(run),
    indice: indexState(root),
    herramientas: tools.map((tool) => ({ tool, name: TOOLS[tool].name, configFile: displayPath(tool), channel: channelOf(home, tool) })),
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

// Si ya responde un Qdrant en el puerto, se reutiliza: cada proyecto usa su propia colección (docs_<hash>).
async function ensureQdrant() {
  if (await waitForQdrant(1500)) return "existente";
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
  if (list.ok && list.out.split("\n").some((l) => l.startsWith(`${EMBED_MODEL}:`))) return "igual";
  const r = await tryRun("ollama", ["pull", EMBED_MODEL], { timeout: 1800000 });
  if (!r.ok) throw new SetupDocsRagError(`No se pudo descargar ${EMBED_MODEL}: ${r.out}`, 4);
  return "descargado";
}

// Copia el paquete Python a ~/.docs-rag/app y prepara su entorno en ~/.docs-rag/venv. Es del ordenador, no del proyecto.
async function installApp(home) {
  const { app, venv } = appDirs(home);
  rmSync(app, { recursive: true, force: true });
  mkdirSync(dirname(app), { recursive: true });
  cpSync(APP_SOURCE, app, { recursive: true, filter: (src) => !/(__pycache__|\.pytest_cache|\.venv)/.test(src) });
  const r = await tryRun("uv", ["sync", "--quiet", "--project", app], { timeout: 1800000, env: { ...process.env, UV_PROJECT_ENVIRONMENT: venv } });
  if (!r.ok) throw new SetupDocsRagError(`uv no pudo preparar el entorno de docs-rag: ${r.out}`, 4);
  return { app, venv };
}

// Lanza el indexador. El progreso va a stderr (se ve en la terminal) y el resumen JSON a stdout.
function runIndexer(home, root, extra = []) {
  const { app, venv } = appDirs(home);
  return new Promise((resolvePromise, reject) => {
    const child = spawn("uv", ["run", "--quiet", "--project", app, "python", "-m", "docs_rag.indexar", "--root", root, ...extra], {
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

async function uvPath() {
  const r = await tryRun(process.platform === "win32" ? "where" : "which", ["uv"]);
  return r.ok ? r.out.split(/\r?\n/)[0].trim() : "uv";
}

export async function apply({ root, home, tools, libs, withRuntimes }) {
  const req = await checkRequirements();
  const faltan = ["docker", "ollama", "uv"].filter((k) => !req[k].ok);
  if (faltan.length) throw new SetupDocsRagError(`Faltan requisitos: ${faltan.map((k) => req[k].detalle).join(" ")} No se ha tocado nada.`, 3);
  const inventory = buildInventory({ root });
  const request = buildRequest(inventory, { libs, withRuntimes });
  ensureRagDir(root);
  writeFileSync(join(root, RAG_DIR, "peticion.json"), `${JSON.stringify(request, null, 2)}\n`);
  const qdrant = await ensureQdrant();
  const modelo = await ensureModel();
  await installApp(home);
  const indice = await runIndexer(home, root);
  const uv = await uvPath();
  const herramientas = tools.map((tool) => {
    const config = registerServer({ home, tool, uvPath: uv });
    const notes = [];
    if (config.removed.length) notes.push(`Se ha quitado context7 de ${config.file}: el canal de documentación de este ordenador pasa a ser docs-rag.`);
    notes.push(`Recarga ${TOOLS[tool].name} para que cargue el MCP docs-rag.`);
    return { tool, name: TOOLS[tool].name, config, notes };
  });
  return { qdrant, modelo, indice, avisos: inventory.avisos, herramientas };
}

export async function reset({ root, home, tools, dropIndex }) {
  const herramientas = tools.map((tool) => ({ tool, name: TOOLS[tool].name, config: unregisterServer({ home, tool }) }));
  let indice = null;
  if (dropIndex) {
    const { app } = appDirs(home);
    if (existsSync(app) && existsSync(join(root, RAG_DIR, "inventario.json"))) {
      try {
        indice = await runIndexer(home, root, ["--borrar"]);
      } catch (e) {
        indice = { error: e.message };
      }
    }
    rmSync(join(root, RAG_DIR), { recursive: true, force: true });
    indice = { ...(indice ?? {}), carpeta: `${RAG_DIR}/ borrada` };
  }
  return { herramientas, indice };
}

export async function run(argv) {
  const opts = parseArgs(argv);
  if (!["detect", "apply", "reset"].includes(opts.command)) throw new SetupDocsRagError(USAGE, 2);
  const root = await resolveRoot(opts);
  const home = resolve(opts.home ?? homedir());
  const tools = selectTools(opts, root);
  if (tools.length === 0) throw new SetupDocsRagError("No hay carpetas de agentes en este proyecto (.cursor/agents, .claude/agents, .codex/agents). Ejecuta apm install antes.", 3);
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
