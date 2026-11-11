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

// --- Detección ---

import { mkdtempSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { detectCursor, detect, runCommand, toolsPresent } from "../.apm/skills/configure-models/scripts/configure-models.mjs";

const fake = (table) => async (command, args) => table[`${command} ${args.join(" ")}`] ?? { status: "missing", stdout: "" };

test("detecta los modelos con cursor-agent models", async () => {
  const d = await detectCursor({ run: fake({ "cursor-agent models": { status: "ok", stdout: cursorOutput } }) });
  assert.equal(d.status, "ok");
  assert.ok(d.models.some((m) => m.id === "composer-2.5"));
});

test("prueba primero cursor-agent y solo después agent", async () => {
  const calls = [];
  const run = async (command, args) => {
    calls.push(command);
    return { status: "ok", stdout: cursorOutput };
  };
  await detectCursor({ run });
  assert.deepEqual(calls, ["cursor-agent"]);
});

test("si cursor-agent no existe usa agent", async () => {
  const d = await detectCursor({ run: fake({ "agent models": { status: "ok", stdout: cursorOutput } }) });
  assert.equal(d.status, "ok");
});

test("sin ningún comando el estado es desconocido y lo dice", async () => {
  const d = await detectCursor({ run: fake({}) });
  assert.equal(d.status, "unknown");
  assert.deepEqual(d.models, []);
  assert.match(d.reason, /no está instalado/);
});

test("un tiempo agotado es desconocido y no se reintenta con el mismo comando", async () => {
  const calls = [];
  const run = async (command, args) => {
    calls.push(`${command} ${args[0]}`);
    return { status: "timeout", stdout: "" };
  };
  const d = await detectCursor({ run });
  assert.equal(d.status, "unknown");
  assert.match(d.reason, /iniciar sesión/);
  assert.deepEqual(calls, ["cursor-agent models", "agent models"]);
});

test("una salida que no es una lista de modelos es desconocido", async () => {
  const d = await detectCursor({ run: fake({ "cursor-agent models": { status: "ok", stdout: "Starting login process...\n" } }) });
  assert.equal(d.status, "unknown");
  assert.match(d.reason, /no devolvió una lista/);
});

test("runCommand corta un comando que no responde", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cm-"));
  const bin = join(dir, "colgado");
  writeFileSync(bin, "#!/bin/sh\nsleep 30\n");
  chmodSync(bin, 0o755);
  const started = Date.now();
  const result = await runCommand(bin, [], { timeout: 300 });
  assert.equal(result.status, "timeout");
  assert.ok(Date.now() - started < 5000);
});

test("runCommand distingue comando ausente, error y éxito", async () => {
  assert.equal((await runCommand("no-existe-este-comando-xyz", [])).status, "missing");
  assert.equal((await runCommand("sh", ["-c", "exit 3"])).status, "error");
  const ok = await runCommand("sh", ["-c", "echo hola"]);
  assert.equal(ok.status, "ok");
  assert.equal(ok.stdout.trim(), "hola");
});

test("solo se detectan las herramientas con carpeta de agentes", () => {
  const root = mkdtempSync(join(tmpdir(), "cm-"));
  assert.deepEqual(toolsPresent(profiles, root), []);
  mkdirSync(join(root, ".cursor", "agents"), { recursive: true });
  assert.deepEqual(toolsPresent(profiles, root), ["cursor"]);
});

test("detect junta modelos y propuesta por herramienta", async () => {
  const [r] = await detect({ tools: ["cursor"], run: fake({ "cursor-agent models": { status: "ok", stdout: cursorOutput } }) });
  assert.equal(r.tool, "cursor");
  assert.equal(r.proposal.length, 8);
  assert.equal(r.proposal.find((p) => p.agent === "create-branch").model, "composer-2.5");
});

test("sin modelos detectados ninguna propuesta lleva modelo", async () => {
  const [r] = await detect({ tools: ["cursor"], run: fake({}) });
  assert.ok(r.proposal.every((p) => p.model === null));
});
