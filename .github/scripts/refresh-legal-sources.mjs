#!/usr/bin/env node
// Descarga los artículos que lista sources.json de data-protection-guideline y reescribe
// los ficheros de artículo y sources.json. Solo para quien mantiene el paquete.
//
// Uso: node .github/scripts/refresh-legal-sources.mjs [--sources RUTA] [--out CARPETA]
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SOURCES = join(here, "..", "..", ".apm", "skills", "data-protection-guideline", "assets", "sources.json");

// RGPD consolidado en el Cellar de EUR-Lex; el identificador del consolidado va al final.
export const CELLAR_BASE = "http://publications.europa.eu/resource/celex/";
export const CELLAR_HEADERS = { Accept: "application/xhtml+xml", "Accept-Language": "spa" };
// LOPDGDD consolidada en la API de datos abiertos del BOE: índice en JSON, bloques en XML.
export const BOE_BASE = "https://www.boe.es/datosabiertos/api/legislacion-consolidada/id/";
export const BOE_INDEX_HEADERS = { Accept: "application/json" };
export const BOE_BLOCK_HEADERS = { Accept: "application/xml" };

// Cada norma lleva su aviso. El de la LOPDGDD y su fuente siguen las condiciones de reutilización del BOE.
export const AVISO = {
  rgpd: "Copia informativa, no auténtica: el texto auténtico es el publicado en el Diario Oficial.",
  lopdgdd: "Texto consolidado de carácter informativo, no auténtico: el texto auténtico es el publicado en el Boletín Oficial del Estado.",
};
export const FUENTE_BOE = "Agencia Estatal Boletín Oficial del Estado";
export const ADAPTACION = {
  rgpd: "Extracto de un artículo del texto consolidado, sin considerandos. Formato XHTML convertido a Markdown sin cambiar el texto; se conservan las marcas ▼B y ▼C del consolidado.",
  lopdgdd: "Extracto de la última versión del bloque del texto consolidado. Formato XML convertido a Markdown sin cambiar el texto.",
};

export class RefreshError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

export function cellarUrl(version) {
  return `${CELLAR_BASE}${version}`;
}

export function boeIndexUrl(version) {
  return `${BOE_BASE}${version}/texto/indice`;
}

export function boeBlockUrl(version, bloque) {
  return `${BOE_BASE}${version}/texto/bloque/${bloque}`;
}

// ---------- HTML a Markdown ----------

const VOID = new Set(["br", "hr", "col", "img", "meta", "link", "input", "wbr", "area", "base", "source"]);
const BLOCK = new Set(["p", "div", "blockquote", "table", "tr", "li", "ul", "ol", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6"]);
// Clases cuyo texto es la etiqueta de un apartado («1.», «a)»): se une al texto que sigue.
const LABEL_CLASSES = ["no-parag", "grid-list-column-1"];

const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e] ?? m;
  });
}

function tokenize(html) {
  const tokens = [];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
  let last = 0;
  let m;
  while ((m = re.exec(html))) {
    if (m.index > last) tokens.push({ type: "text", text: html.slice(last, m.index) });
    if (m[1] !== undefined) tokens.push({ type: "text", text: m[1], raw: true });
    else if (m[3]) {
      const name = m[3].toLowerCase().replace(/^.*:/, "");
      if (m[2] === "/") tokens.push({ type: "close", name });
      else tokens.push({ type: "open", name, attrs: parseAttrs(m[4] || ""), selfClosing: m[5] === "/" || VOID.has(name) });
    }
    last = re.lastIndex;
  }
  if (last < html.length) tokens.push({ type: "text", text: html.slice(last) });
  return tokens;
}

export function parseAttrs(text) {
  const attrs = {};
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(text))) attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return attrs;
}

function classesOf(attrs) {
  return (attrs.class || "").split(/\s+/).filter(Boolean);
}

/**
 * Convierte HTML o XHTML a Markdown: un párrafo por bloque, listas de apartados con «-»,
 * blockquote con «>». No cambia el texto: solo normaliza los espacios.
 * `omit` son clases cuyo elemento (y su contenido) se descarta, como el título del artículo.
 */
export function htmlToMarkdown(html, { omit = [] } = {}) {
  const tokens = tokenize(html);
  const blocks = [];
  const stack = [];
  let line = "";
  let lineIsLabel = false;
  let lineListDepth = 0;
  let omitDepth = 0;

  const listDepth = () => stack.filter((e) => e.classes.includes("grid-list")).length;
  const quoteDepth = () => stack.filter((e) => e.name === "blockquote").length;
  const inLabel = () => stack.some((e) => e.classes.some((c) => LABEL_CLASSES.includes(c)));

  const flush = () => {
    if (lineIsLabel) return; // la etiqueta espera a su texto
    const text = line.replace(/\s+/g, " ").trim();
    if (text) {
      const indent = lineListDepth > 0 ? "  ".repeat(lineListDepth - 1) + "- " : "";
      const quote = "> ".repeat(quoteDepth());
      blocks.push(quote + indent + text);
    }
    line = "";
    lineListDepth = 0;
  };

  for (const tok of tokens) {
    if (tok.type === "open") {
      const classes = classesOf(tok.attrs);
      const omitted = omitDepth > 0 || classes.some((c) => omit.includes(c));
      if (omitted && !tok.selfClosing) {
        omitDepth++;
        stack.push({ name: tok.name, classes });
        continue;
      }
      if (omitted) continue;
      if (BLOCK.has(tok.name)) flush();
      if (tok.name === "td" || tok.name === "th") line += line.trim() ? " | " : "";
      if (!tok.selfClosing) stack.push({ name: tok.name, classes });
      continue;
    }
    if (tok.type === "close") {
      // Cierra hasta el elemento abierto con ese nombre; ignora cierres sueltos.
      const idx = stack.map((e) => e.name).lastIndexOf(tok.name);
      if (idx === -1) continue;
      while (stack.length > idx) {
        stack.pop();
        if (omitDepth > 0) omitDepth--;
      }
      if (omitDepth === 0 && BLOCK.has(tok.name)) {
        // Al cerrar un bloque, la etiqueta deja de esperar si ya tiene texto detrás.
        flush();
      }
      continue;
    }
    if (omitDepth > 0) continue;
    const text = tok.raw ? tok.text : decodeEntities(tok.text);
    if (!text.trim()) {
      if (line) line += " ";
      continue;
    }
    const startsLine = !line.trim();
    if (startsLine) lineListDepth = listDepth();
    if (inLabel()) {
      if (startsLine) lineIsLabel = true;
    } else {
      lineIsLabel = false;
    }
    line += text;
  }
  lineIsLabel = false;
  flush();
  return blocks.join("\n\n");
}

// ---------- RGPD (Cellar) ----------

/** Devuelve el `<div>` completo del artículo, contando aperturas y cierres de `div`. */
export function extractRgpdArticle(xhtml, numero) {
  const re = new RegExp(`<div\\b[^>]*\\bid\\s*=\\s*"art_${numero}"[^>]*>`);
  const m = re.exec(xhtml);
  if (!m) throw new RefreshError(`El XHTML del RGPD no tiene id="art_${numero}" (artículo ${numero}).`);
  const divRe = /<(\/?)div\b[^>]*?(\/?)>/g;
  divRe.lastIndex = m.index + m[0].length;
  let depth = 1;
  let d;
  while ((d = divRe.exec(xhtml))) {
    if (d[1] === "/") depth--;
    else if (d[2] !== "/") depth++;
    if (depth === 0) return xhtml.slice(m.index, d.index + d[0].length);
  }
  throw new RefreshError(`El <div> del artículo ${numero} del RGPD no se cierra.`);
}

function textOfClass(html, cls) {
  const re = new RegExp(`<p\\b[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)</p>`);
  const m = re.exec(html);
  return m ? htmlToMarkdown(m[1]).replace(/\s+/g, " ").trim() : "";
}

/** Título y texto en Markdown de un artículo del RGPD ya extraído. */
export function rgpdArticleParts(articleHtml, numero) {
  const titulo = textOfClass(articleHtml, "title-article-norm") || `Artículo ${numero}`;
  const subtitulo = textOfClass(articleHtml, "stitle-article-norm");
  const texto = htmlToMarkdown(articleHtml, { omit: ["title-article-norm", "eli-title"] });
  return { titulo: subtitulo ? `${titulo}. ${subtitulo}` : titulo, texto };
}

// ---------- LOPDGDD (BOE) ----------

function boeBlocks(indice) {
  if (Array.isArray(indice)) return indice;
  const data = indice?.data;
  if (Array.isArray(data)) return data.flatMap((d) => (Array.isArray(d?.bloque) ? d.bloque : []));
  if (Array.isArray(data?.bloque)) return data.bloque;
  throw new RefreshError("El índice del BOE no tiene la lista de bloques (data[].bloque).");
}

/** Busca el bloque cuyo título es «Artículo N», seguido de punto o fin. No usa el id. */
export function findBoeBlock(indice, numero) {
  const re = new RegExp(`^Art[ií]culo\\s+${numero}(?:\\.|\\s*$)`);
  const bloque = boeBlocks(indice).find((b) => re.test(String(b?.titulo ?? "").trim()));
  if (!bloque) throw new RefreshError(`El índice del BOE no tiene un bloque titulado «Artículo ${numero}».`);
  return bloque;
}

function compactDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(value ?? ""));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : String(value ?? "");
}

/** `fecha_actualizacion` del bloque del índice, en AAAA-MM-DD. Error con el número si falta o no es AAAAMMDD. */
export function boeUpdateDate(bloque, numero) {
  const value = bloque?.fecha_actualizacion;
  if (typeof value !== "string" || !/^\d{8}$/.test(value)) {
    throw new RefreshError(`El bloque del índice del BOE del artículo ${numero} no trae fecha_actualizacion con la forma AAAAMMDD.`);
  }
  return compactDate(value);
}

/** Texto, id_norma, fecha_publicacion y fecha_vigencia de la última versión del bloque. */
export function lastBoeVersion(bloqueXml) {
  const versions = [...bloqueXml.matchAll(/<version\b([^>]*)>([\s\S]*?)<\/version>/g)];
  if (versions.length === 0) throw new RefreshError("El bloque del BOE no tiene ninguna <version>.");
  const [, rawAttrs, body] = versions[versions.length - 1];
  const attrs = parseAttrs(rawAttrs);
  const titulo = textOfClass(body, "articulo").replace(/\.$/, "");
  return {
    titulo,
    texto: htmlToMarkdown(body, { omit: ["articulo"] }),
    idNorma: attrs.id_norma ?? "",
    fechaPublicacion: compactDate(attrs.fecha_publicacion),
    fechaVigencia: compactDate(attrs.fecha_vigencia),
  };
}

// ---------- Fichero de artículo ----------

/**
 * Escribe el fichero de artículo con la cabecera de su norma (`norma` es «RGPD» o «LOPDGDD»).
 * RGPD: Fuente, Enlace, Versión, Fecha de descarga, Aviso y Adaptación.
 * LOPDGDD: Fuente de los datos, Enlace, Versión, Última actualización, Fecha de descarga, Aviso y Adaptación.
 */
export function renderArticle({ norma, titulo, fuente, enlace, version, ultimaActualizacion, fechaDescarga, adaptacion, texto }) {
  const id = String(norma).toLowerCase();
  const aviso = AVISO[id];
  if (!aviso) throw new RefreshError(`Norma sin aviso: ${norma}.`);
  const campos = id === "lopdgdd"
    ? [
      `- **Fuente de los datos:** ${FUENTE_BOE}`,
      `- **Enlace:** ${enlace}`,
      `- **Versión:** ${version}`,
      `- **Última actualización:** ${ultimaActualizacion}`,
    ]
    : [
      `- **Fuente:** ${fuente}`,
      `- **Enlace:** ${enlace}`,
      `- **Versión:** ${version}`,
    ];
  return [
    `# ${norma} · ${titulo}`,
    "",
    ...campos,
    `- **Fecha de descarga:** ${fechaDescarga}`,
    `- **Aviso:** ${aviso}`,
    `- **Adaptación:** ${adaptacion}`,
    "",
    texto.trim(),
    "",
  ].join("\n");
}

// ---------- Descarga ----------

async function download(fetchImpl, url, headers) {
  let res;
  try {
    res = await fetchImpl(url, { headers, redirect: "follow" });
  } catch (e) {
    throw new RefreshError(`Fallo de red al pedir ${url}: ${e?.message ?? e}`);
  }
  if (res.status !== 200) throw new RefreshError(`${url} respondió ${res.status}.`);
  return res.text();
}

function articleFile(normaId, numero) {
  return `${normaId}/articulo-${numero}.md`;
}

async function refreshRgpd(norma, { fetchImpl, fechaDescarga, files }) {
  const enlace = cellarUrl(norma.version);
  const xhtml = await download(fetchImpl, enlace, CELLAR_HEADERS);
  const articulos = norma.articulos.map((a) => {
    const { titulo, texto } = rgpdArticleParts(extractRgpdArticle(xhtml, a.numero), a.numero);
    const fichero = articleFile(norma.id, a.numero);
    files.set(fichero, renderArticle({
      norma: "RGPD", titulo, fuente: norma.fuente, enlace, version: norma.version, fechaDescarga, adaptacion: ADAPTACION.rgpd, texto,
    }));
    return { ...a, numero: a.numero, fichero };
  });
  return { ...norma, enlace, fechaDescarga, articulos };
}

async function refreshLopdgdd(norma, { fetchImpl, fechaDescarga, files }) {
  const enlace = boeIndexUrl(norma.version);
  let indice;
  const raw = await download(fetchImpl, enlace, BOE_INDEX_HEADERS);
  try {
    indice = JSON.parse(raw);
  } catch {
    throw new RefreshError(`${enlace} no devolvió JSON.`);
  }
  // Antes de descargar ningún bloque: cada artículo tiene su bloque y su fecha de actualización (CB-02, CB-07).
  const bloques = norma.articulos.map((a) => {
    const bloque = findBoeBlock(indice, a.numero);
    return { a, bloque, fechaActualizacion: boeUpdateDate(bloque, a.numero) };
  });
  const articulos = [];
  for (const { a, bloque, fechaActualizacion } of bloques) {
    const url = boeBlockUrl(norma.version, bloque.id);
    const v = lastBoeVersion(await download(fetchImpl, url, BOE_BLOCK_HEADERS));
    const fichero = articleFile(norma.id, a.numero);
    files.set(fichero, renderArticle({
      norma: "LOPDGDD",
      titulo: v.titulo || `Artículo ${a.numero}`,
      enlace: url,
      version: `${v.idNorma}, vigente desde ${v.fechaVigencia}`,
      ultimaActualizacion: fechaActualizacion,
      fechaDescarga,
      adaptacion: ADAPTACION.lopdgdd,
      texto: v.texto,
    }));
    articulos.push({
      ...a, numero: a.numero, fichero, bloque: bloque.id, idNorma: v.idNorma, fechaVigencia: v.fechaVigencia, fechaActualizacion,
    });
  }
  return { ...norma, fuente: FUENTE_BOE, enlace, fechaDescarga, articulos };
}

const REFRESHERS = { rgpd: refreshRgpd, lopdgdd: refreshLopdgdd };

export function parseArgs(argv) {
  const opts = { sources: DEFAULT_SOURCES, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--sources" || arg === "--out") {
      const value = argv[++i];
      if (!value) throw new RefreshError(`Falta el valor de ${arg}.\n${USAGE}`, 2);
      opts[arg.slice(2)] = value;
    } else {
      throw new RefreshError(`Argumento desconocido: ${arg}\n${USAGE}`, 2);
    }
  }
  return opts;
}

export const USAGE = "Uso: node .github/scripts/refresh-legal-sources.mjs [--sources RUTA] [--out CARPETA]";

/**
 * Lee sources.json, descarga cada artículo y escribe los ficheros en una carpeta temporal.
 * Solo si todo ha ido bien, sustituye las carpetas de cada norma y sources.json en `out`.
 */
export async function run(argv, { fetch: fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  const opts = parseArgs(argv);
  const sourcesPath = resolve(opts.sources);
  const out = resolve(opts.out ?? dirname(sourcesPath));
  let sources;
  try {
    sources = JSON.parse(readFileSync(sourcesPath, "utf8"));
  } catch (e) {
    throw new RefreshError(`No se puede leer ${sourcesPath}: ${e.message}`);
  }
  if (!Array.isArray(sources?.normas)) throw new RefreshError(`${sourcesPath} no tiene la lista "normas".`);

  const fechaDescarga = now().toISOString().slice(0, 10);
  const files = new Map();
  const normas = [];
  for (const norma of sources.normas) {
    const refresh = REFRESHERS[norma.id];
    if (!refresh) throw new RefreshError(`Norma desconocida en sources.json: ${norma.id}.`);
    if (!Array.isArray(norma.articulos)) throw new RefreshError(`La norma ${norma.id} no tiene la lista "articulos".`);
    normas.push(await refresh(norma, { fetchImpl, fechaDescarga, files }));
  }
  files.set("sources.json", `${JSON.stringify({ ...sources, normas }, null, 2)}\n`);

  // Todo descargado: se escribe en una carpeta temporal junto a `out` y se mueve al final.
  mkdirSync(dirname(out), { recursive: true });
  const tmp = mkdtempSync(join(dirname(out), `.${basename(out)}-refresh-`));
  try {
    for (const [rel, content] of files) {
      const path = join(tmp, rel);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    mkdirSync(out, { recursive: true });
    for (const norma of normas) {
      const target = join(out, norma.id);
      rmSync(target, { recursive: true, force: true });
      renameSync(join(tmp, norma.id), target);
    }
    renameSync(join(tmp, "sources.json"), join(out, "sources.json"));
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  }
  return `Escritos ${files.size - 1} artículos y sources.json en ${out}.`;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  run(process.argv.slice(2))
    .then((msg) => console.log(msg))
    .catch((e) => {
      console.error(e.message);
      process.exit(e instanceof RefreshError ? e.code : 1);
    });
}
