#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const SIGNALS_PATH = join(here, "..", "assets", "ai-signals.json");

export class SetupComplianceError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

export const DOCS = ["ai-act", "dpia", "model-card", "data-card", "system-card", "security"];
export const DISCLAIMER = "Documento orientativo: no certifica cumplimiento ni es asesoramiento jurídico.";
export const HUECO_PREFIX = "> **Hueco:**";
const MARKER_RE = /^<!-- setup-compliance sha256=([0-9a-f]{64}) -->$/;

export function loadSignals(path = SIGNALS_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// --- Manifiestos (parsers copiados de setup-context7: la skill es autocontenida) ---

const normalizePy = (name) => name.toLowerCase().replace(/[_.]+/g, "-");

export function parsePackageJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SetupComplianceError("package.json no es un JSON válido.", 3);
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

// --- Ficheros del proyecto ---

// Sin git se recorren las carpetas hasta MAX_DEPTH niveles, sin ocultas ni de dependencias o build.
export const MAX_DEPTH = 3;
const SKIP_DIRS = new Set(["node_modules", "vendor", "dist", "build", "out", "target", "venv", "coverage", "__pycache__", "apm_modules", "storybook-static"]);
const skipped = (name) => name.startsWith(".") || SKIP_DIRS.has(name);

function walkFiles(root) {
  const files = [];
  let level = [""];
  for (let depth = 0; depth <= MAX_DEPTH; depth++) {
    const next = [];
    for (const rel of level) {
      let entries = [];
      try {
        entries = readdirSync(join(root, rel), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries.sort((x, y) => x.name.localeCompare(y.name))) {
        const path = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (!skipped(e.name) && depth < MAX_DEPTH) next.push(path);
        } else if (e.isFile()) files.push(path);
      }
    }
    level = next;
  }
  return files;
}

// Rutas del proyecto (relativas a la raíz): las que git conoce y no ignora, o el recorrido si no hay git.
export function listProjectFiles(root) {
  let out = null;
  try {
    out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    /* sin git */
  }
  const rels = out === null ? walkFiles(root) : out.split("\0").filter(Boolean);
  return [...new Set(rels)].filter((rel) => !rel.split("/").slice(0, -1).some(skipped) && existsSync(join(root, rel))).sort();
}

export function findManifests(root, files = listProjectFiles(root)) {
  const found = [];
  for (const rel of files) {
    const index = MANIFESTS.findIndex((m) => m.file === basename(rel));
    if (index === -1) continue;
    const parts = rel.split("/");
    found.push({ rel, dir: parts.slice(0, -1).join("/"), depth: parts.length - 1, index });
  }
  found.sort((a, b) => a.depth - b.depth || a.dir.localeCompare(b.dir) || a.index - b.index);
  return found.map(({ rel, index }) => ({ rel, ...MANIFESTS[index] }));
}

export function findModelFiles(root, signals = loadSignals(), files = listProjectFiles(root)) {
  const exts = new Set(signals.modelExtensions.map((e) => e.toLowerCase()));
  return files.filter((rel) => exts.has(extname(rel).toLowerCase()));
}

const globToRegExp = (glob) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");

export function findDatasetFiles(root, signals = loadSignals(), files = listProjectFiles(root)) {
  const res = signals.datasetGlobs.map(globToRegExp);
  return files.filter((rel) => res.some((re) => re.test(basename(rel))));
}

// Dependencias de IA de los manifiestos: [{type, name, kind, ecosystem, source}], y los manifiestos leídos.
export function readAiDependencies(root, signals = loadSignals(), files = listProjectFiles(root)) {
  const kinds = [...signals.inference.map((n) => [n, "inference"]), ...signals.training.map((n) => [n, "training"])];
  const lookup = (name) => kinds.find(([n]) => name === n || name.startsWith(`${n}/`));
  const manifests = [];
  const found = [];
  for (const { rel, ecosystem, parse } of findManifests(root, files)) {
    let names;
    try {
      names = parse(readFileSync(join(root, rel), "utf8"));
    } catch (e) {
      manifests.push({ file: rel, ecosystem, count: 0, error: e instanceof SetupComplianceError ? e.message : `No se pudo leer ${rel}.` });
      continue;
    }
    manifests.push({ file: rel, ecosystem, count: names.length });
    for (const name of names) {
      const hit = lookup(name);
      if (hit) found.push({ type: "dependency", name, kind: hit[1], ecosystem, source: rel });
    }
  }
  return { manifests, dependencies: found };
}

// --- Datos personales de docs/CONSTITUTION.md ---

const FIELDS = [
  ["role", /^rol en el tratamiento$/i],
  ["dataSubjects", /^interesados$/i],
  ["specialCategories", /^categorías especiales$/i],
  ["dpiaStatus", /^estado de la dpia$/i],
];

export function readPersonalData(text) {
  const empty = { declared: false, role: null, dataSubjects: null, specialCategories: null, dpiaStatus: null };
  if (text === null || text === undefined) return empty;
  const lines = String(text).replace(/\r/g, "").split("\n");
  const start = lines.findIndex((l) => /^##\s+Datos personales\s*$/i.test(l));
  if (start === -1) return empty;
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end === -1) end = lines.length;
  const section = lines.slice(start + 1, end).join("\n").replace(/<!--[\s\S]*?-->/g, "");
  const result = { ...empty, declared: true };
  for (const line of section.split("\n")) {
    const m = /^\s*[-*]\s+\*\*([^*:]+):\*\*\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = FIELDS.find(([, re]) => re.test(m[1].trim()));
    const value = m[2].trim();
    if (field && value !== "") result[field[0]] = value;
  }
  return result;
}

// --- Documentos con marca ---

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const withNewline = (body) => (body.endsWith("\n") ? body : `${body}\n`);

export function marker(body) {
  return `<!-- setup-compliance sha256=${sha256(body)} -->`;
}

// Separa la marca (primera línea) del resto. {hash, rest} o null si no hay marca.
function splitMarker(text) {
  const nl = text.indexOf("\n");
  if (nl === -1) return null;
  const m = MARKER_RE.exec(text.slice(0, nl).replace(/\r$/, ""));
  return m ? { hash: m[1], rest: text.slice(nl + 1) } : null;
}

export function docState(text) {
  if (text === null) return "ausente";
  const parts = splitMarker(text);
  return parts && sha256(parts.rest) === parts.hash ? "generado" : "editado";
}

export const docPath = (root, doc) => join(root, "docs", `${doc}.md`);

function readIfExists(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

export function writeDoc({ root, doc, body }) {
  if (!DOCS.includes(doc)) throw new SetupComplianceError(`Documento desconocido: «${doc}». Los válidos son: ${DOCS.join(", ")}.`, 2);
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  if (lines[lines.length - 1] !== DISCLAIMER) {
    throw new SetupComplianceError(`El contenido de ${doc} debe terminar con la línea «${DISCLAIMER}»: no se escribe nada.`, 2);
  }
  const clean = withNewline(body);
  const path = docPath(root, doc);
  const file = `docs/${doc}.md`;
  const before = readIfExists(path);
  const state = docState(before);
  if (state === "editado") return { doc, file, result: "conservado" };
  const text = `${marker(clean)}\n${clean}`;
  if (state === "generado") {
    if (before === text) return { doc, file, result: "igual" };
    writeAtomic(path, text);
    return { doc, file, result: "actualizado" };
  }
  writeAtomic(path, text);
  return { doc, file, result: "creado" };
}

// --- Propuesta de documentos ---

export function suggest({ aiSignals = [], datasetFiles = [] }) {
  const own = aiSignals.some((s) => s.type === "model-file" || s.kind === "training");
  const out = ["ai-act", "dpia", "security", "system-card"];
  if (own) out.push("model-card");
  if (own || datasetFiles.length > 0) out.push("data-card");
  return DOCS.filter((d) => out.includes(d));
}

// --- Órdenes ---

export const USAGE = [
  "Uso: setup-compliance.mjs <detect|write> [opciones]",
  "  detect                              Señales de IA, datos personales, estado de los seis documentos y los propuestos (JSON). No escribe nada.",
  `  write --doc NOMBRE --from FICHERO   Escribe docs/NOMBRE.md con su marca. NOMBRE: ${DOCS.join(", ")}.`,
  "Opciones: --root RUTA",
].join("\n");

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, root: null, doc: null, from: null };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--root") opts.root = rest[++i];
    else if (a === "--doc") opts.doc = rest[++i];
    else if (a === "--from") opts.from = rest[++i];
    else throw new SetupComplianceError(`Argumento desconocido: ${a}\n${USAGE}`, 2);
  }
  return opts;
}

function resolveRoot(opts) {
  if (opts.root) return resolve(opts.root);
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim() || process.cwd();
  } catch {
    return process.cwd();
  }
}

export function detectReport({ root, signals = loadSignals() }) {
  const files = listProjectFiles(root);
  const { manifests, dependencies } = readAiDependencies(root, signals, files);
  const modelFiles = findModelFiles(root, signals, files).map((f) => ({ type: "model-file", name: f, source: f }));
  const datasetFiles = findDatasetFiles(root, signals, files);
  const aiSignals = [...dependencies, ...modelFiles];
  const docs = Object.fromEntries(DOCS.map((d) => [d, docState(readIfExists(docPath(root, d)))]));
  return {
    manifests,
    aiSignals,
    datasetFiles,
    personalData: readPersonalData(readIfExists(join(root, "docs", "CONSTITUTION.md"))),
    docs,
    suggested: suggest({ aiSignals, datasetFiles }),
  };
}

export function run(argv) {
  const opts = parseArgs(argv);
  if (!["detect", "write"].includes(opts.command)) throw new SetupComplianceError(USAGE, 2);
  const root = resolveRoot(opts);
  if (opts.command === "detect") return JSON.stringify(detectReport({ root }), null, 2);
  if (!opts.doc || !DOCS.includes(opts.doc)) {
    throw new SetupComplianceError(`Falta --doc con uno de: ${DOCS.join(", ")}.`, 2);
  }
  if (!opts.from) throw new SetupComplianceError("Falta --from con el fichero que trae el contenido.", 2);
  const body = readIfExists(resolve(opts.from));
  if (body === null) throw new SetupComplianceError(`No existe el fichero ${opts.from}.`, 2);
  return JSON.stringify(writeDoc({ root, doc: opts.doc, body }), null, 2);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    console.log(run(process.argv.slice(2)));
  } catch (e) {
    console.error(e.message);
    process.exit(e instanceof SetupComplianceError ? e.code : 1);
  }
}
