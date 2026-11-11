#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const PROFILES_PATH = join(here, "..", "assets", "agent-profiles.json");

export class ConfigureModelsError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

export function loadProfiles(path = PROFILES_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Un modelo escrito a mano acaba en el frontmatter: nada de espacios, comillas ni saltos de línea.
const MODEL_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._\-[\]=,]*$/;

export function isModelShape(model) {
  return typeof model === "string" && MODEL_SHAPE.test(model);
}

// "inherit", vacío o null significan lo mismo: el agente no lleva línea `model`.
export function normalizeChoice(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "" || text.toLowerCase() === "inherit") return null;
  if (!isModelShape(text)) throw new ConfigureModelsError(`Modelo no válido: «${text}». Sin espacios ni comillas.`, 2);
  return text;
}

// Primera coincidencia gana. Los modelos se prueban en el orden de la lista del nivel.
export function resolveModel(profiles, tool, tier, models) {
  const patterns = profiles.tools?.[tool]?.patterns?.[tier] ?? [];
  const ids = models.map((m) => (typeof m === "string" ? m : m.id));
  for (const source of patterns) {
    const found = ids.find((id) => new RegExp(source).test(id));
    if (found) return found;
  }
  return null;
}

export function proposeAll(profiles, tool, models) {
  return Object.entries(profiles.agents).map(([agent, { tier, why }]) => ({
    agent,
    tier,
    why,
    model: resolveModel(profiles, tool, tier, models),
  }));
}

// `cursor-agent models` imprime «id - Nombre (current, default)». Si no hay cabecera, no se fía.
export function parseCursorModels(text) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  if (!lines.some((l) => /^Available models\s*$/.test(l.trim()))) return [];
  const models = [];
  for (const line of lines) {
    const m = /^([A-Za-z0-9][A-Za-z0-9._\-[\]=,]*) - (.+)$/.exec(line.trim());
    if (m) models.push({ id: m[1], name: m[2].replace(/[​-‏﻿]/g, "").trim() });
  }
  return models;
}

// --- Detección ---

export const COMMAND_TIMEOUT_MS = 10000;

// Lanza un comando externo con límite de tiempo. Nunca rechaza: devuelve el estado.
// Se ejecuta en una carpeta vacía: un cursor-agent antiguo trata «models» como un prompt.
export function runCommand(command, args, { timeout = COMMAND_TIMEOUT_MS, cwd = tmpdir(), env = process.env } = {}) {
  return new Promise((done) => {
    let out = "";
    let finished = false;
    let child;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      done(result);
    };
    try {
      child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return done({ status: "missing", stdout: "" });
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ status: "timeout", stdout: out });
    }, timeout);
    child.stdout.on("data", (chunk) => {
      out += chunk;
      if (out.length > 1_000_000) child.kill("SIGKILL");
    });
    child.on("error", (e) => finish({ status: e.code === "ENOENT" ? "missing" : "error", stdout: out }));
    child.on("close", (code) => finish({ status: code === 0 ? "ok" : "error", stdout: out }));
  });
}

// Primero cursor-agent: «agent» es un nombre genérico que puede ser otro programa.
const CURSOR_ATTEMPTS = [
  ["cursor-agent", ["models"]],
  ["cursor-agent", ["--list-models"]],
  ["agent", ["models"]],
  ["agent", ["--list-models"]],
];

const REASONS = {
  missing: "no está instalado el comando de Cursor (cursor-agent)",
  timeout: "el comando de Cursor no respondió a tiempo; puede que falte iniciar sesión",
  error: "el comando de Cursor falló; puede que falte iniciar sesión",
  empty: "el comando de Cursor no devolvió una lista de modelos que se entienda",
};

// Devuelve {status: "ok"|"unknown", models, reason}. «unknown» significa que no se sabe, no que no haya.
export async function detectCursor({ run = runCommand } = {}) {
  let reason = REASONS.missing;
  let informative = false; // el primer fallo que no sea «no existe» es el que se cuenta
  const skipped = new Set();
  for (const [command, args] of CURSOR_ATTEMPTS) {
    if (skipped.has(command)) continue;
    const result = await run(command, args);
    if (result.status === "missing" || result.status === "timeout") skipped.add(command);
    let failure = result.status;
    if (result.status === "ok") {
      const models = parseCursorModels(result.stdout);
      if (models.length) return { status: "ok", models, reason: null };
      failure = "empty";
    }
    if (failure !== "missing" && !informative) {
      reason = REASONS[failure] ?? REASONS.error;
      informative = true;
    }
  }
  return { status: "unknown", models: [], reason };
}

export const DETECTORS = { cursor: detectCursor };

// Solo las herramientas cuya carpeta de agentes existe en el proyecto.
export function toolsPresent(profiles, root, exists = existsSync) {
  return Object.entries(profiles.tools)
    .filter(([, t]) => exists(join(root, t.agentsDir)))
    .map(([tool]) => tool);
}

export async function detect({ profiles = loadProfiles(), root, tools, run } = {}) {
  const present = tools ?? toolsPresent(profiles, root);
  const result = [];
  for (const tool of present) {
    const detection = await DETECTORS[tool]({ run });
    result.push({
      tool,
      name: profiles.tools[tool].name,
      ...detection,
      proposal: proposeAll(profiles, tool, detection.models),
    });
  }
  return result;
}

// --- fin ---

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log("pendiente");
}
