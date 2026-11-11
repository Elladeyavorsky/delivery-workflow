import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  loadProfiles,
  resolveModel,
  proposeAll,
  parseCursorModels,
  normalizeChoice,
  isModelShape,
} from "../.apm/skills/configure-models/scripts/configure-models.mjs";

const FIXTURES = new URL("./fixtures/configure-models/", import.meta.url).pathname;
const AGENTS = new URL("../.apm/agents/", import.meta.url).pathname;
const profiles = loadProfiles();
const cursorOutput = readFileSync(join(FIXTURES, "cursor-agent-models.txt"), "utf8");

test("los agentes del catálogo son exactamente los archivos de .apm/agents", () => {
  const files = readdirSync(AGENTS)
    .filter((f) => f.endsWith(".agent.md"))
    .map((f) => f.replace(/\.agent\.md$/, ""))
    .sort();
  assert.deepEqual(Object.keys(profiles.agents).sort(), files);
});

test("cada agente tiene un nivel que existe y una explicación", () => {
  for (const [name, { tier, why }] of Object.entries(profiles.agents)) {
    assert.ok(profiles.tiers[tier], `${name}: nivel desconocido ${tier}`);
    assert.ok(why.length > 5, `${name}: falta el motivo`);
  }
});

test("los fixtures no llevan correos ni datos de la cuenta", () => {
  for (const file of readdirSync(FIXTURES)) {
    const text = readFileSync(join(FIXTURES, file), "utf8");
    assert.ok(!text.includes("@"), `${file} contiene una @`);
    assert.ok(!text.includes(process.env.HOME ?? "\0"), `${file} contiene la ruta personal`);
  }
});

test("el parser de Cursor lee la salida real de cursor-agent models", () => {
  const models = parseCursorModels(cursorOutput);
  const ids = models.map((m) => m.id);
  assert.ok(ids.includes("composer-2.5"));
  assert.ok(ids.includes("grok-4.7-medium"));
  assert.ok(ids.includes("cursor-grok-4.6-medium"));
  assert.ok(ids.every((id) => !/\s/.test(id) && !id.includes("[")), "ids sin variantes entre corchetes");
  assert.ok(!ids.includes("Tip:"));
});

test("sin la cabecera «Available models» el parser no inventa modelos", () => {
  assert.deepEqual(parseCursorModels(""), []);
  assert.deepEqual(parseCursorModels("Starting login process...\nfoo - bar"), []);
});

test("cada nivel elige el primer patrón que coincide", () => {
  const models = parseCursorModels(cursorOutput);
  assert.equal(resolveModel(profiles, "cursor", "heavy", models), "grok-4.7-medium");
  assert.equal(resolveModel(profiles, "cursor", "light", models), "composer-2.5");
  const withOpus = [{ id: "claude-opus-4-8" }, ...models];
  assert.equal(resolveModel(profiles, "cursor", "heavy", withOpus), "claude-opus-4-8");
});

test("sin modelos detectados no se propone ninguno y todos heredan", () => {
  const proposal = proposeAll(profiles, "cursor", []);
  assert.equal(proposal.length, 8);
  assert.ok(proposal.every((p) => p.model === null));
});

test("la propuesta lleva nivel y motivo por agente", () => {
  const proposal = proposeAll(profiles, "cursor", parseCursorModels(cursorOutput));
  const cd = proposal.find((p) => p.agent === "concept-developer");
  assert.equal(cd.tier, "heavy");
  assert.match(cd.why, /spec/);
});

test("un modelo a mano se valida y «inherit» o vacío significan heredar", () => {
  assert.equal(normalizeChoice("grok-4.7-medium"), "grok-4.7-medium");
  assert.equal(normalizeChoice("claude-opus-4-8[effort=high]"), "claude-opus-4-8[effort=high]");
  assert.equal(normalizeChoice(""), null);
  assert.equal(normalizeChoice("INHERIT"), null);
  assert.equal(normalizeChoice(undefined), null);
  assert.throws(() => normalizeChoice("a b"), /no válido/);
  assert.throws(() => normalizeChoice('x"\nname: y'), /no válido/);
  assert.equal(isModelShape("-x"), false);
});
