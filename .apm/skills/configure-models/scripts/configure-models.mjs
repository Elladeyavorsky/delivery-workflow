#!/usr/bin/env node
import { readFileSync } from "node:fs";
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

// --- fin ---

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log("pendiente");
}
