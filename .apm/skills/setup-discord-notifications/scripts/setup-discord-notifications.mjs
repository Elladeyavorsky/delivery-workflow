#!/usr/bin/env node
import { execFile as execFileCb } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

const here = dirname(fileURLToPath(import.meta.url));
export const ASSETS_DIR = join(here, "..", "assets");

export class SetupDiscordError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

export const ENVIRONMENT = "discord-pr-notifications";
export const BOT_TOKEN_VAR = "DISCORD_BOT_TOKEN";
export const CACHE_KEY_VAR = "DISCORD_CACHE_KEY";
export const SECRETS = [BOT_TOKEN_VAR, CACHE_KEY_VAR];
export const VARIABLES = ["DISCORD_GUILD_ID", "DISCORD_GIT_CHANNEL_ID"];
export const WORKFLOWS = ["discord-pr-trigger.yml", "discord-pr-confirmation-trigger.yml", "discord-pr-publish.yml"];
export const ACTION_DIR = "discord-pr-notifications";
export const MARK = "setup-discord-notifications";

const MARKER_RE = /^(?:#|\/\/) setup-discord-notifications sha256=([0-9a-f]{64})$/;

// --- Marca de hash ---

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

// La marca es un comentario de la primera línea: «#» en YAML y «//» en .mjs.
const commentPrefix = (name) => (name.endsWith(".mjs") ? "//" : "#");

export function marker(body, name = "x.yml") {
  return `${commentPrefix(name)} ${MARK} sha256=${sha256(body)}`;
}

// Separa la marca (primera línea) del resto. {hash, rest} o null si no hay marca.
function splitMarker(text) {
  const nl = text.indexOf("\n");
  if (nl === -1) return null;
  const m = MARKER_RE.exec(text.slice(0, nl).replace(/\r$/, ""));
  return m ? { hash: m[1], rest: text.slice(nl + 1) } : null;
}

// Rellena los marcadores {{...}} y antepone la marca con el hash del resto.
export function render(template, values, name = "x.yml") {
  const body = template.replace(/\{\{([A-Z_]+)\}\}/g, (all, key) => (key in values ? String(values[key]) : all));
  return `${marker(body, name)}\n${body}`;
}

// ausente, igual (marca válida y hash que coincide: la skill lo escribió y nadie lo tocó) o editado (sin marca o con hash roto).
// Si la plantilla cambió, el fichero «igual» se actualiza al repetir apply: eso lo decide apply comparando con `expected`.
export function fileState(text) {
  if (text === null) return "ausente";
  const parts = splitMarker(text);
  return parts && sha256(parts.rest) === parts.hash ? "igual" : "editado";
}

// --- Argumentos ---

export const USAGE = [
  "Uso: setup-discord-notifications.mjs <detect|apply|reset|verify> [opciones]",
  "  detect   Repositorio, rama predeterminada, acceso de gh, ficheros de Discord y su estado, y entorno, secretos y variables (JSON). No escribe.",
  "  apply    Copia workflows y acción, crea el entorno protegido y fija secretos y variables. Pide --guild-id y --channel-id la primera vez.",
  "  reset    Quita los ficheros de Discord que escribió apply y no están editados. Con --remove-environment borra también el entorno, sus secretos y sus variables; sin ella los lista como pendientes.",
  "  verify   Solo lectura. Con DISCORD_BOT_TOKEN del .env, --guild-id y --channel-id comprueba contra discord.com el token, que el bot está en el servidor y que ve el canal. Sale con código 6 si alguna falla.",
  "Opciones: --base RAMA  --guild-id ID  --channel-id ID  --minimum-reviewers N  --remove-environment  --root RUTA",
].join("\n");

const NUMERIC = /^[0-9]+$/;

function numeric(value, flag) {
  if (typeof value !== "string" || !NUMERIC.test(value)) throw new SetupDiscordError(`${flag} debe ser numérico.`, 2);
  return value;
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, root: null, base: null, guildId: null, channelId: null, minimumReviewers: 1, removeEnvironment: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--root") {
      const value = rest[++i];
      if (value === undefined || value === "" || value.startsWith("--")) throw new SetupDiscordError("--root necesita una ruta.", 2);
      opts.root = value;
    }
    else if (a === "--base") opts.base = rest[++i];
    else if (a === "--guild-id") opts.guildId = numeric(rest[++i], "--guild-id");
    else if (a === "--channel-id") opts.channelId = numeric(rest[++i], "--channel-id");
    else if (a === "--minimum-reviewers") {
      const n = Number(numeric(rest[++i], "--minimum-reviewers"));
      if (n < 1) throw new SetupDiscordError("--minimum-reviewers debe ser 1 o más.", 2);
      opts.minimumReviewers = n;
    } else if (a === "--remove-environment") opts.removeEnvironment = true;
    else throw new SetupDiscordError(`Argumento desconocido: ${a}\n${USAGE}`, 2);
  }
  return opts;
}

// --- .env ---

export function parseEnv(text) {
  const values = {};
  for (const raw of String(text).replace(/\r/g, "").split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw);
    if (!m) continue;
    const value = m[2].trim();
    const quoted = /^(["'])(.*?)\1(?:\s+#.*)?$/.exec(value);
    const plain = quoted ? quoted[2] : value.replace(/\s+#.*$/, "").trim();
    if (plain !== "") values[m[1]] = plain;
  }
  return values;
}

// Lee solo los dos valores que usa el script. Quien llama los guarda en el contexto y nunca los imprime.
export function loadEnv(root) {
  const path = join(root, ".env");
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return { GITHUB_TOKEN: null, DISCORD_BOT_TOKEN: null, exists: false };
    throw e;
  }
  const values = parseEnv(text);
  return { GITHUB_TOKEN: values.GITHUB_TOKEN ?? null, DISCORD_BOT_TOKEN: values.DISCORD_BOT_TOKEN ?? null, exists: true };
}

// --- gh ---

// exec(args, {input, env}) -> stdout. Lanza SetupDiscordError con `status` si gh falla.
export function defaultExec(args, { input, env, cwd } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = execFileCb("gh", args, { env: { ...process.env, ...env }, cwd, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolvePromise(stdout);
      const err = new SetupDiscordError(error.code === "ENOENT" ? "gh no está instalado." : String(stderr || error.message).trim(), 4);
      err.missing = error.code === "ENOENT";
      err.stderr = String(stderr ?? "");
      reject(err);
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

// El token de gh va solo en el entorno del proceso hijo; el cuerpo secreto, solo por la entrada estándar.
export function makeGh({ token, exec = defaultExec, root }) {
  const env = token ? { GH_TOKEN: token, GITHUB_TOKEN: token, GH_ENTERPRISE_TOKEN: token } : {};
  return (args, { input, cwd } = {}) => exec(args, { input, env, cwd: cwd ?? root });
}

const notFound = (e) => /404|not found/i.test(e?.stderr ?? e?.message ?? "");

// gh responde 403 cuando el token no tiene permiso de administración sobre el repositorio.
const FORBIDDEN_RE = /\b403\b|must have admin|forbidden|resource not accessible/i;
export const isForbidden = (e) => !e?.forbidden && FORBIDDEN_RE.test(`${e?.stderr ?? ""} ${e?.message ?? ""}`);

export function permissionError(repository) {
  const err = new SetupDiscordError(
    `El GITHUB_TOKEN del .env no tiene permiso de administración sobre ${repository ?? "el repositorio"} (gh respondió 403). Hace falta para crear el entorno y fijar secretos y variables. Da al token permiso de administración del repositorio y repite, o sigue los pasos manuales de docs/DISCORD-PR-NOTIFICATIONS.md.`,
    4,
  );
  err.forbidden = true;
  return err;
}

// Cambia el 403 de gh por el mensaje de permiso; el resto de errores pasa igual.
export function guardAdmin(gh, repository) {
  return async (args, options) => {
    try {
      return await gh(args, options);
    } catch (e) {
      throw isForbidden(e) ? permissionError(repository) : e;
    }
  };
}

export async function repoInfo(gh, root) {
  const out = JSON.parse(await gh(["repo", "view", "--json", "nameWithOwner,defaultBranchRef"], { cwd: root }));
  return { repository: out.nameWithOwner, defaultBranch: out.defaultBranchRef?.name ?? null };
}

// owner/repo del remoto origin, solo si es de github.com.
export async function remoteRepository(root) {
  let url;
  try {
    ({ stdout: url } = await execFile("git", ["remote", "get-url", "origin"], { cwd: root }));
  } catch {
    throw new SetupDiscordError("No hay remoto origin. Los avisos de Discord son workflows de GitHub Actions.", 3);
  }
  const m = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (!m) throw new SetupDiscordError("El remoto origin no es de GitHub. Los avisos de Discord son workflows de GitHub Actions; otros forges quedan fuera.", 3);
  return m[1];
}

export async function branchExists(gh, repository, branch) {
  try {
    await gh(["api", `repos/${repository}/branches/${encodeURIComponent(branch)}`, "--silent"]);
    return true;
  } catch (e) {
    if (notFound(e)) return false;
    throw e;
  }
}

async function names(gh, args) {
  try {
    return new Set(JSON.parse((await gh(args)) || "[]").map((item) => item.name));
  } catch (e) {
    if (notFound(e)) return new Set();
    throw e;
  }
}

export async function environmentState(gh, repository) {
  try {
    await gh(["api", `repos/${repository}/environments/${ENVIRONMENT}`, "--silent"]);
  } catch (e) {
    if (notFound(e)) {
      return {
        exists: false,
        secrets: Object.fromEntries(SECRETS.map((n) => [n, false])),
        variables: Object.fromEntries(VARIABLES.map((n) => [n, false])),
      };
    }
    throw e;
  }
  const secrets = await names(gh, ["secret", "list", "--env", ENVIRONMENT, "--repo", repository, "--json", "name"]);
  const variables = await names(gh, ["variable", "list", "--env", ENVIRONMENT, "--repo", repository, "--json", "name"]);
  return {
    exists: true,
    secrets: Object.fromEntries(SECRETS.map((n) => [n, secrets.has(n)])),
    variables: Object.fromEntries(VARIABLES.map((n) => [n, variables.has(n)])),
  };
}

// --- Ficheros ---

function readIfExists(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

export function actionFiles(assetsDir = ASSETS_DIR) {
  return readdirSync(join(assetsDir, ACTION_DIR)).sort();
}

// Ficheros que escribe apply: ruta relativa al proyecto y plantilla de origen.
export function managedFiles(assetsDir = ASSETS_DIR) {
  return [
    ...WORKFLOWS.map((name) => ({ rel: join(".github", "workflows", name), source: join(assetsDir, "workflows", name) })),
    ...actionFiles(assetsDir).map((name) => ({ rel: join(".github", "actions", ACTION_DIR, name), source: join(assetsDir, ACTION_DIR, name) })),
  ];
}

export function fileReport({ root, assetsDir = ASSETS_DIR }) {
  return managedFiles(assetsDir).map(({ rel, source }) => {
    return { path: rel, state: fileState(readIfExists(join(root, rel))) };
  });
}

// --- Órdenes ---

export async function detectAll({ root, gh, remote, env }) {
  const report = {
    repository: remote,
    defaultBranch: null,
    gh: { available: false, reason: null },
    files: [],
    environment: {
      exists: false,
      secrets: Object.fromEntries(SECRETS.map((n) => [n, false])),
      variables: Object.fromEntries(VARIABLES.map((n) => [n, false])),
    },
  };
  report.gh.reason = env.GITHUB_TOKEN ? null : env.exists ? "El .env no tiene GITHUB_TOKEN." : "Falta el .env con GITHUB_TOKEN.";
  if (!report.gh.reason) {
    try {
      const info = await repoInfo(guardAdmin(gh, remote), root);
      report.repository = info.repository;
      report.defaultBranch = info.defaultBranch;
      report.environment = await environmentState(guardAdmin(gh, info.repository), info.repository);
      report.gh.available = true;
    } catch (e) {
      report.gh.reason = e.missing ? "gh no está instalado." : e.forbidden ? e.message : `gh no responde con el token del proyecto: ${e.message}`;
    }
  }
  report.files = fileReport({ root });
  report.botToken = { inEnv: env.DISCORD_BOT_TOKEN !== null };
  return report;
}

// --- apply ---

// El nombre de rama acaba en YAML entre comillas y en una URL: solo caracteres seguros, sin comillas ni «\».
export function validateBranch(name, label = "La rama") {
  const ok =
    typeof name === "string" &&
    /^[A-Za-z0-9_][A-Za-z0-9_.\/-]*$/.test(name) &&
    !name.includes("..") &&
    !name.includes("//") &&
    !/[\/.]$/.test(name) &&
    !name.endsWith(".lock");
  if (!ok) throw new SetupDiscordError(`${label} «${name}» no es válida: usa letras, números, «_», «.», «-» y «/», sin «..» ni «//».`, 2);
  return name;
}

export function generateCacheKey(random = randomBytes) {
  return random(32).toString("base64");
}

const httpStatus = (e) => /\b(40[34])\b|not found|forbidden/i.exec(e?.stderr ?? e?.message ?? "");

async function variableValues(gh, repository) {
  try {
    const list = JSON.parse((await gh(["variable", "list", "--env", ENVIRONMENT, "--repo", repository, "--json", "name,value"])) || "[]");
    return new Map(list.map((item) => [item.name, item.value]));
  } catch (e) {
    if (notFound(e)) return new Map();
    throw e;
  }
}

// Crea el entorno limitado a la rama predeterminada. Si no se puede (plan sin entornos, sin permiso), para sin usar el nivel de repositorio (D-09).
export async function ensureEnvironment(gh, repository, defaultBranch) {
  const path = `repos/${repository}/environments/${ENVIRONMENT}`;
  let current = null;
  try {
    current = JSON.parse(await gh(["api", path]));
  } catch (e) {
    if (!notFound(e)) throw e;
  }
  const policy = current?.deployment_branch_policy;
  const configured = policy?.custom_branch_policies === true && policy?.protected_branches === false;
  let result = current ? "igual" : "creado";
  if (!configured) {
    try {
      await gh(["api", "-X", "PUT", path, "--input", "-"], {
        input: JSON.stringify({ deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }),
      });
    } catch (e) {
      if (e.forbidden) {
        throw new SetupDiscordError(`${e.message} No se ha fijado nada ni se usan secretos de repositorio.`, 5);
      }
      if (httpStatus(e)) {
        throw new SetupDiscordError(
          `No se pudo crear el entorno ${ENVIRONMENT} (${String(e.stderr || e.message).trim()}). El plan del repositorio puede no admitir entornos protegidos, o el token no tiene permiso de administración. No se ha fijado nada ni se usan secretos de repositorio. Sigue los pasos manuales de docs/DISCORD-PR-NOTIFICATIONS.md.`,
          5,
        );
      }
      throw e;
    }
    if (current) result = "actualizado";
  }
  const listed = JSON.parse((await gh(["api", `${path}/deployment-branch-policies`])) || "{}");
  const hasPolicy = (listed.branch_policies ?? []).some((p) => p.name === defaultBranch);
  if (!hasPolicy) {
    await gh(["api", "-X", "POST", `${path}/deployment-branch-policies`, "--input", "-"], {
      input: JSON.stringify({ name: defaultBranch, type: "branch" }),
    });
    if (result === "igual") result = "actualizado";
  }
  return result;
}

// Variable del entorno: igual si el valor coincide, actualizado si cambia, creado si falta. Sin valor dado y existente: conservado.
export async function ensureVariable(gh, repository, name, value, existing) {
  const has = existing.has(name);
  if (value === null || value === undefined) {
    if (has) return "conservado";
    throw new SetupDiscordError(`Falta el valor de ${name}: pásalo como opción.`, 2);
  }
  if (has && existing.get(name) === value) return "igual";
  await gh(["variable", "set", name, "--env", ENVIRONMENT, "--repo", repository], { input: value });
  return has ? "actualizado" : "creado";
}

// El valor del secreto va solo por la entrada estándar.
export async function ensureSecret(gh, repository, name, value, exists) {
  if (value === null || value === undefined) return "conservado";
  await gh(["secret", "set", name, "--env", ENVIRONMENT, "--repo", repository], { input: value });
  return exists ? "actualizado" : "creado";
}

export function writeFiles({ root, values, assetsDir = ASSETS_DIR }) {
  return managedFiles(assetsDir).map(({ rel, source }) => {
    const name = rel.split(/[\\/]/).pop();
    const rendered = render(readFileSync(source, "utf8"), values, name);
    const target = join(root, rel);
    const existing = readIfExists(target);
    const state = fileState(existing);
    let result;
    if (state === "editado") result = "conservado";
    else if (state === "igual" && existing === rendered) result = "igual";
    else result = state === "ausente" ? "creado" : "actualizado";
    if (result === "creado" || result === "actualizado") {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, rendered);
    }
    return { path: rel, result };
  });
}

const MANUAL = "Sigue los pasos manuales de docs/DISCORD-PR-NOTIFICATIONS.md.";

// Si gh falla a mitad, el error dice qué quedó hecho y qué no (CB-05). Repetir apply termina el trabajo (RF-09).
function partialError(e, done, pending) {
  if (done.length === 0) return e;
  const err = new SetupDiscordError(
    `${e.message}\nQuedó hecho: ${done.join(", ")}.\nNo se hizo: ${pending.join(", ") || "nada más"}.\nRepite apply para terminar.`,
    e instanceof SetupDiscordError ? e.code : 5,
  );
  err.forbidden = e.forbidden;
  return err;
}

// Ejecuta los pasos en orden y anota los hechos. Un paso devuelve su resultado, que se guarda en `results[label]`.
async function runSteps(steps) {
  const done = [];
  const results = {};
  for (let i = 0; i < steps.length; i++) {
    const [label, fn] = steps[i];
    try {
      results[label] = await fn();
    } catch (e) {
      throw partialError(e, done, steps.slice(i).map(([l]) => l));
    }
    done.push(label);
  }
  return results;
}

export async function applyAll({ root, gh: rawGh, opts, env, random = randomBytes, assetsDir = ASSETS_DIR }) {
  if (!env.GITHUB_TOKEN) {
    throw new SetupDiscordError(`${env.exists ? "El .env no tiene GITHUB_TOKEN." : "Falta el .env con GITHUB_TOKEN."} No se ha escrito nada. ${MANUAL}`, 4);
  }
  let info;
  try {
    info = await repoInfo(guardAdmin(rawGh, null), root);
  } catch (e) {
    if (e.forbidden) throw new SetupDiscordError(`${e.message} No se ha escrito nada.`, 4);
    throw new SetupDiscordError(
      `${e.missing ? "gh no está instalado." : `gh no responde con el token del proyecto: ${e.message}`} No se ha escrito nada. ${MANUAL}`,
      4,
    );
  }
  const { repository } = info;
  const gh = guardAdmin(rawGh, repository);
  if (!info.defaultBranch) throw new SetupDiscordError("El repositorio no tiene rama predeterminada en el remoto.", 3);
  const defaultBranch = validateBranch(info.defaultBranch, "La rama predeterminada");
  let baseBranch = opts.base;
  let state;
  let existingVars;
  try {
    if (baseBranch) validateBranch(baseBranch, "La rama base");
    else baseBranch = (await branchExists(gh, repository, "staging")) ? "staging" : defaultBranch;
    if (!(await branchExists(gh, repository, baseBranch))) throw new SetupDiscordError(`La rama base ${baseBranch} no existe en el remoto.`, 3);
    state = await environmentState(gh, repository);
    existingVars = state.exists ? await variableValues(gh, repository) : new Map();
  } catch (e) {
    if (e.forbidden) throw new SetupDiscordError(`${e.message} No se ha escrito nada.`, 4);
    throw e;
  }
  const botToken = env.DISCORD_BOT_TOKEN;
  if (botToken === null && !state.secrets[BOT_TOKEN_VAR]) {
    throw new SetupDiscordError(`Falta ${BOT_TOKEN_VAR} en el .env y el secreto no existe en el entorno ${ENVIRONMENT}. No se ha escrito nada.`, 2);
  }
  for (const [flag, name, value] of [["--guild-id", VARIABLES[0], opts.guildId], ["--channel-id", VARIABLES[1], opts.channelId]]) {
    if (value === null && !existingVars.has(name)) throw new SetupDiscordError(`Falta ${flag}: ${name} no existe en el entorno. No se ha escrito nada.`, 2);
  }

  const results = await runSteps([
    ["entorno", () => ensureEnvironment(gh, repository, defaultBranch)],
    [
      "ficheros",
      () =>
        writeFiles({
          root,
          assetsDir,
          values: { REPOSITORY: repository, BASE_BRANCH: baseBranch, DEFAULT_BRANCH: defaultBranch, MINIMUM_REVIEWERS: opts.minimumReviewers },
        }),
    ],
    [VARIABLES[0], () => ensureVariable(gh, repository, VARIABLES[0], opts.guildId, existingVars)],
    [VARIABLES[1], () => ensureVariable(gh, repository, VARIABLES[1], opts.channelId, existingVars)],
    [BOT_TOKEN_VAR, () => (botToken === null ? "conservado" : ensureSecret(gh, repository, BOT_TOKEN_VAR, botToken, state.secrets[BOT_TOKEN_VAR]))],
    [CACHE_KEY_VAR, () => (state.secrets[CACHE_KEY_VAR] ? "igual" : ensureSecret(gh, repository, CACHE_KEY_VAR, generateCacheKey(random), false))],
  ]);
  const files = results.ficheros;
  const warnings = files.filter((f) => f.result === "conservado").map((f) => `${f.path} está editado o sin la marca de la skill: se conserva.`);
  return {
    repository,
    defaultBranch,
    baseBranch,
    minimumReviewers: opts.minimumReviewers,
    environment: results.entorno,
    files,
    secrets: { [BOT_TOKEN_VAR]: results[BOT_TOKEN_VAR], [CACHE_KEY_VAR]: results[CACHE_KEY_VAR] },
    variables: { [VARIABLES[0]]: results[VARIABLES[0]], [VARIABLES[1]]: results[VARIABLES[1]] },
    warnings,
  };
}

// --- reset ---

// Quita los ficheros con marca válida y hash intacto; los editados o sin marca se conservan con aviso (CB-06).
export function removeFiles({ root, assetsDir = ASSETS_DIR }) {
  const files = managedFiles(assetsDir).map(({ rel }) => {
    const target = join(root, rel);
    const state = fileState(readIfExists(target));
    if (state === "ausente") return { path: rel, result: "ausente" };
    if (state === "editado") return { path: rel, result: "conservado" };
    unlinkSync(target);
    return { path: rel, result: "quitado" };
  });
  // La carpeta de la acción solo se quita si quedó vacía.
  try {
    rmdirSync(join(root, ".github", "actions", ACTION_DIR));
  } catch {
    // no existe o tiene ficheros conservados
  }
  return files;
}

export async function resetAll({ root, gh: rawGh, opts, env, remote, assetsDir = ASSETS_DIR }) {
  const warnings = [];
  const pendingEnvironment = (state) => ({
    environment: state.exists ? ENVIRONMENT : null,
    secrets: SECRETS.filter((n) => state.secrets[n]),
    variables: VARIABLES.filter((n) => state.variables[n]),
  });
  let repository = remote;
  let gh = rawGh;
  let state = null;
  if (opts.removeEnvironment && !env.GITHUB_TOKEN) {
    throw new SetupDiscordError(
      `${env.exists ? "El .env no tiene GITHUB_TOKEN." : "Falta el .env con GITHUB_TOKEN."} Para borrar el entorno hace falta. No se ha quitado nada. ${MANUAL}`,
      4,
    );
  }
  if (env.GITHUB_TOKEN) {
    try {
      repository = (await repoInfo(guardAdmin(rawGh, remote), root)).repository;
      gh = guardAdmin(rawGh, repository);
      state = await environmentState(gh, repository);
    } catch (e) {
      const reason = e.missing ? "gh no está instalado." : e.forbidden ? e.message : `gh no responde con el token del proyecto: ${e.message}`;
      if (opts.removeEnvironment) throw new SetupDiscordError(`${reason} No se ha quitado nada. ${MANUAL}`, 4);
      warnings.push(`No se pudo consultar el entorno ${ENVIRONMENT}: ${reason}`);
    }
  } else {
    warnings.push(`Sin GITHUB_TOKEN en el .env no se puede consultar el entorno ${ENVIRONMENT}.`);
  }

  const files = removeFiles({ root, assetsDir });
  for (const f of files) if (f.result === "conservado") warnings.push(`${f.path} está editado o sin la marca de la skill: se conserva.`);

  const out = { repository, files, environment: null, pending: null, warnings };
  if (!state) return out;
  if (!opts.removeEnvironment) {
    out.pending = pendingEnvironment(state);
    if (state.exists) warnings.push(`El entorno ${ENVIRONMENT}, sus secretos y sus variables siguen en ${repository}. Para borrarlos, repite reset con --remove-environment.`);
    return out;
  }
  const path = `repos/${repository}/environments/${ENVIRONMENT}`;
  const steps = [
    ...SECRETS.filter((n) => state.secrets[n]).map((n) => [n, async () => (await gh(["secret", "delete", n, "--env", ENVIRONMENT, "--repo", repository]), "quitado")]),
    ...VARIABLES.filter((n) => state.variables[n]).map((n) => [n, async () => (await gh(["variable", "delete", n, "--env", ENVIRONMENT, "--repo", repository]), "quitado")]),
    ...(state.exists ? [["entorno", async () => (await gh(["api", "-X", "DELETE", path]), "quitado")]] : []),
  ];
  let results;
  try {
    results = await runSteps(steps);
  } catch (e) {
    // La parte de ficheros ya está quitada: el error lo dice.
    throw new SetupDiscordError(`${e.message}\nFicheros: ${files.map((f) => `${f.path} ${f.result}`).join(", ")}.`, e.code ?? 5);
  }
  out.environment = {
    environment: state.exists ? results.entorno : "ausente",
    secrets: Object.fromEntries(SECRETS.map((n) => [n, results[n] ?? "ausente"])),
    variables: Object.fromEntries(VARIABLES.map((n) => [n, results[n] ?? "ausente"])),
  };
  return out;
}

// --- verify ---

export const DISCORD_API = "https://discord.com/api/v10";

// GET a la API de Discord. El token va solo en la cabecera. Devuelve {status, body} sin lanzar por 4xx; si falla la red, {status: null, body: null}.
export async function discordGet(fetchFn, path, token) {
  let response;
  try {
    response = await fetchFn(`${DISCORD_API}${path}`, { method: "GET", headers: { Authorization: `Bot ${token}`, Accept: "application/json" } });
  } catch {
    return { status: null, body: null };
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    // sin cuerpo JSON
  }
  return { status: response.status, body };
}

const check = (result, reason, status = null) => ({ result, reason, status });

// Motivo fijo según el código HTTP: nunca el cuerpo de la respuesta ni el token.
function failure(status, rejected) {
  if (status === null) return check("fallo", "No se pudo contactar con discord.com (error de red).");
  if (status === 429) return check("fallo", "Discord limita las peticiones (HTTP 429). Espera y repite verify.", status);
  return check("fallo", `${rejected} (HTTP ${status}).`, status);
}

export async function verifyAll({ env, opts, fetchFn = globalThis.fetch }) {
  const token = env.DISCORD_BOT_TOKEN;
  if (!token) throw new SetupDiscordError(`Falta ${BOT_TOKEN_VAR} en el .env. No se ha llamado a Discord.`, 2);
  for (const [flag, value] of [["--guild-id", opts.guildId], ["--channel-id", opts.channelId]]) {
    if (value === null || value === undefined) throw new SetupDiscordError(`Falta ${flag}. No se ha llamado a Discord.`, 2);
    numeric(value, flag);
  }
  if (typeof fetchFn !== "function") throw new SetupDiscordError("Este Node no trae fetch: usa Node 20 o superior.", 3);
  const skipped = check("omitida", "El token no es válido: no se comprueba.");
  const checks = { token: null, servidor: skipped, canal: skipped };

  const me = await discordGet(fetchFn, "/users/@me", token);
  checks.token = me.status === 200 ? check("correcto", "El token vale.", 200) : failure(me.status, "Discord rechazó el token");
  if (checks.token.result === "correcto") {
    const guild = await discordGet(fetchFn, `/guilds/${opts.guildId}`, token);
    checks.servidor = guild.status === 200 ? check("correcto", "El bot está en el servidor.", 200) : failure(guild.status, "El bot no está en el servidor o no lo ve");
    const channel = await discordGet(fetchFn, `/channels/${opts.channelId}`, token);
    if (channel.status === 200) {
      checks.canal =
        String(channel.body?.guild_id) === opts.guildId
          ? check("correcto", "El bot ve el canal y es del servidor.", 200)
          : check("fallo", "El canal pertenece a otro servidor que --guild-id.", 200);
    } else {
      checks.canal = failure(channel.status, "El bot no ve el canal o no existe");
    }
  }
  return { ok: Object.values(checks).every((c) => c.result === "correcto"), checks };
}

async function resolveRoot(opts) {
  if (opts.root) return resolve(opts.root);
  try {
    const { stdout } = await execFile("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd() });
    return stdout.trim() || process.cwd();
  } catch {
    return process.cwd();
  }
}

export async function run(argv, { exec = defaultExec, random = randomBytes, fetchFn = globalThis.fetch } = {}) {
  const opts = parseArgs(argv);
  if (!["detect", "apply", "reset", "verify"].includes(opts.command)) throw new SetupDiscordError(USAGE, 2);
  const root = await resolveRoot(opts);
  if (opts.command === "verify") return JSON.stringify(await verifyAll({ env: loadEnv(root), opts, fetchFn }), null, 2);
  const remote = await remoteRepository(root);
  const env = loadEnv(root);
  const gh = makeGh({ token: env.GITHUB_TOKEN, exec, root });
  if (opts.command === "reset") return JSON.stringify(await resetAll({ root, gh, opts, env, remote }), null, 2);
  if (opts.command === "apply") return JSON.stringify(await applyAll({ root, gh, opts, env, random }), null, 2);
  const report = await detectAll({ root, gh, remote, env });
  return JSON.stringify(report, null, 2);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  run(process.argv.slice(2))
    .then((out) => {
      console.log(out);
      if (process.argv[2] === "verify" && JSON.parse(out).ok === false) process.exit(6);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(e instanceof SetupDiscordError ? e.code : 1);
    });
}
