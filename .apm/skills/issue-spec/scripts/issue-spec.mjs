#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const SECTIONS = ["spec", "plan", "tasks"];
const HEADINGS = { spec: "## Spec", plan: "## Plan", tasks: "## Tasks" };
const HEADING = /^## (Spec|Plan|Tasks)[ \t]*$/;
const STATES = ["Borrador", "Implementada", "Fallida"];
export const MAX_BODY = 65536;

// Formas típicas de credenciales. Solo se informa del tipo, nunca del valor.
const SECRETS = [
  ["token de GitHub", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ["clave de API", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["clave de AWS", /\bAKIA[0-9A-Z]{16}\b/],
  ["clave de Google", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["token de Slack", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ["clave privada", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

export class IssueSpecError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function normalize(text) {
  return text.replace(/\r\n/g, "\n");
}

// La parte de arriba es todo lo anterior a la primera de las tres secciones.
export function parseBody(body) {
  const lines = normalize(body).split("\n");
  const sections = {};
  let current = null;
  const top = [];
  for (const line of lines) {
    const match = line.match(HEADING);
    if (match) {
      current = match[1].toLowerCase();
      sections[current] = [];
    } else if (current) sections[current].push(line);
    else top.push(line);
  }
  const result = { top: top.join("\n").trim(), sections: {} };
  for (const name of SECTIONS) {
    if (sections[name]) result.sections[name] = sections[name].join("\n").trim();
  }
  return result;
}

export function hashTop(top) {
  return createHash("sha256").update(normalize(top).trim()).digest("hex").slice(0, 16);
}

export function buildBody({ top, sections }) {
  const parts = [top.trim()];
  for (const name of SECTIONS) {
    if (sections[name] !== undefined) parts.push(`${HEADINGS[name]}\n\n${sections[name].trim()}`);
  }
  return `${parts.join("\n\n")}\n`;
}

// Acepta el contenido con o sin su propio encabezado.
export function stripHeading(name, content) {
  const text = normalize(content).trim();
  const [first, ...rest] = text.split("\n");
  return first.trim() === HEADINGS[name] ? rest.join("\n").trim() : text;
}

export function findSecret(text) {
  for (const [kind, pattern] of SECRETS) {
    if (pattern.test(text)) return kind;
  }
  return null;
}

function checkTop(parsed, expected) {
  if (!expected) throw new IssueSpecError("Falta --expect-top con la huella de la parte de arriba.", 1);
  if (hashTop(parsed.top) !== expected) {
    throw new IssueSpecError("La parte de arriba de la issue cambió desde que empezó el ciclo. No se escribe nada.", 3);
  }
}

function checkWritable(body) {
  const secret = findSecret(body);
  if (secret) throw new IssueSpecError(`El texto contiene lo que parece un ${secret}. No se escribe nada.`, 4);
  if (body.length > MAX_BODY) {
    throw new IssueSpecError(`El cuerpo tendría ${body.length} caracteres y el límite es ${MAX_BODY}. Acorta el plan.`, 5);
  }
}

export function replaceSections(body, replacements, expected) {
  const parsed = parseBody(body);
  checkTop(parsed, expected);
  for (const [name, content] of Object.entries(replacements)) parsed.sections[name] = stripHeading(name, content);
  const next = buildBody(parsed);
  checkWritable(next);
  return next;
}

export function tickTask(body, task, expected) {
  const parsed = parseBody(body);
  checkTop(parsed, expected);
  if (parsed.sections.tasks === undefined) throw new IssueSpecError("La issue no tiene sección Tasks.", 1);
  const pattern = new RegExp(`^(\\s*- )\\[ \\]( \\*\\*${task}:\\*\\*)`, "m");
  if (!pattern.test(parsed.sections.tasks)) {
    const done = new RegExp(`^\\s*- \\[x\\] \\*\\*${task}:\\*\\*`, "mi");
    if (done.test(parsed.sections.tasks)) return null;
    throw new IssueSpecError(`No hay ninguna ${task} sin marcar en Tasks.`, 1);
  }
  parsed.sections.tasks = parsed.sections.tasks.replace(pattern, "$1[x]$2");
  return buildBody(parsed);
}

export function setState(body, state, date, expected) {
  if (!STATES.includes(state)) throw new IssueSpecError(`El estado tiene que ser ${STATES.join(", ")}.`, 1);
  const parsed = parseBody(body);
  checkTop(parsed, expected);
  if (parsed.sections.spec === undefined) throw new IssueSpecError("La issue no tiene sección Spec.", 1);
  const line = /^> Estado: \*\*[^*]+\*\*/m;
  if (!line.test(parsed.sections.spec)) throw new IssueSpecError("La spec no tiene la línea Estado.", 1);
  parsed.sections.spec = parsed.sections.spec.replace(line, `> Estado: **${state} (${date})**`);
  return buildBody(parsed);
}

function parseArgs(args) {
  const [command, number, ...rest] = args;
  if (!command || !/^\d+$/.test(number ?? "")) {
    throw new IssueSpecError(
      "Uso: read N [--section top|spec|plan|tasks] | top-hash N | write N --expect-top H [--spec F] [--plan F] [--tasks F] | tick N TASK-NN --expect-top H | state N Borrador|Implementada|Fallida --expect-top H | comment N F",
      1,
    );
  }
  const options = { positional: [] };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) options[rest[i].slice(2)] = rest[++i];
    else options.positional.push(rest[i]);
  }
  return { command, number, options };
}

// gh.sh lanza gh con el token del .env del proyecto, nunca con la sesión de gh.
function gh() {
  const binary = process.env.ISSUE_SPEC_GH;
  const [command, prefix] = binary ? [binary, []] : ["bash", [join(dirname(fileURLToPath(import.meta.url)), "gh.sh")]];
  return async (args) => (await exec(command, [...prefix, ...args], { maxBuffer: 8 * 1024 * 1024 })).stdout;
}

async function withTemporary(text, action) {
  const path = join(tmpdir(), `issue-spec-${randomUUID()}.md`);
  await writeFile(path, text, { encoding: "utf8", mode: 0o600 });
  try {
    return await action(path);
  } finally {
    await unlink(path).catch(() => {});
  }
}

export async function run(args, { run: call = gh(), today = () => new Date().toISOString().slice(0, 10) } = {}) {
  const { command, number, options } = parseArgs(args);
  const repo = options.repo ? ["--repo", options.repo] : [];
  const readBody = async () => JSON.parse(await call(["issue", "view", number, ...repo, "--json", "body"])).body ?? "";
  const writeBody = (body) => withTemporary(body, (path) => call(["issue", "edit", number, ...repo, "--body-file", path]));

  if (command === "read") {
    const body = await readBody();
    if (!options.section) return normalize(body);
    const parsed = parseBody(body);
    if (options.section === "top") return parsed.top;
    if (!SECTIONS.includes(options.section)) throw new IssueSpecError("La sección tiene que ser top, spec, plan o tasks.", 1);
    return parsed.sections[options.section] ?? "";
  }
  if (command === "top-hash") return hashTop(parseBody(await readBody()).top);
  if (command === "write") {
    const replacements = {};
    for (const name of SECTIONS) {
      if (options[name]) replacements[name] = await readFile(options[name], "utf8");
    }
    if (!Object.keys(replacements).length) throw new IssueSpecError("Indica al menos --spec, --plan o --tasks.", 1);
    await writeBody(replaceSections(await readBody(), replacements, options["expect-top"]));
    return `Issue #${number}: ${Object.keys(replacements).join(", ")} escritas.`;
  }
  if (command === "tick") {
    const task = options.positional[0];
    if (!/^TASK-\d+$/.test(task ?? "")) throw new IssueSpecError("Indica la task como TASK-NN.", 1);
    const next = tickTask(await readBody(), task, options["expect-top"]);
    if (next === null) return `Issue #${number}: ${task} ya estaba marcada.`;
    await writeBody(next);
    return `Issue #${number}: ${task} marcada.`;
  }
  if (command === "state") {
    await writeBody(setState(await readBody(), options.positional[0], today(), options["expect-top"]));
    return `Issue #${number}: estado ${options.positional[0]}.`;
  }
  if (command === "comment") {
    const file = options.positional[0];
    if (!file) throw new IssueSpecError("Indica el fichero del comentario.", 1);
    const text = await readFile(file, "utf8");
    checkWritable(text);
    await withTemporary(text, (path) => call(["issue", "comment", number, ...repo, "--body-file", path]));
    return `Issue #${number}: comentario publicado.`;
  }
  throw new IssueSpecError(`Comando desconocido: ${command}.`, 1);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  run(process.argv.slice(2))
    .then((output) => console.log(output))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = error.code ?? 1;
    });
}
