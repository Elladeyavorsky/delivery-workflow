import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseBody, hashTop, replaceSections, tickTask, setState, findSecret, run, MAX_BODY,
} from "../.apm/skills/issue-spec/scripts/issue-spec.mjs";

const TOP = "## Qué hay que hacer\n\nAlgo.\n\n## Cómo probarlo\n\n1. Mirar.\n\nRevisan: Ada";
const BODY = `${TOP}\n\n## Spec\n\n> Estado: **Borrador** · Creada: 2026-11-07 · Aprobada: —\n\n### Metadata\n\n## Tasks\n\n- [ ] **TASK-01:** Uno\n- [ ] **TASK-10:** Diez\n`;

test("la parte de arriba es lo anterior a las tres secciones", () => {
  const parsed = parseBody(BODY);
  assert.equal(parsed.top, TOP);
  assert.ok(parsed.sections.spec.startsWith("> Estado"));
  assert.equal(parsed.sections.plan, undefined);
});

test("escribir el plan conserva la spec, las tasks y la parte de arriba", () => {
  const next = replaceSections(BODY, { plan: "## Plan\n\n### Diseño técnico\n\nX" }, hashTop(TOP));
  const parsed = parseBody(next);
  assert.equal(parsed.top, TOP);
  assert.equal(parsed.sections.plan, "### Diseño técnico\n\nX");
  assert.ok(parsed.sections.tasks.includes("TASK-10"));
  assert.ok(next.indexOf("## Spec") < next.indexOf("## Plan") && next.indexOf("## Plan") < next.indexOf("## Tasks"));
});

test("si la parte de arriba cambió, no se escribe y sale con 3", () => {
  const edited = BODY.replace("Algo.", "Otra cosa.");
  assert.throws(() => replaceSections(edited, { plan: "X" }, hashTop(TOP)), { code: 3 });
});

test("sin huella no se escribe", () => {
  assert.throws(() => replaceSections(BODY, { plan: "X" }), { code: 1 });
});

test("un secreto bloquea la escritura sin mostrar el valor", () => {
  const token = `ghp_${"a".repeat(36)}`;
  assert.equal(findSecret(`token ${token}`), "token de GitHub");
  assert.throws(() => replaceSections(BODY, { plan: `usa ${token}` }, hashTop(TOP)), (error) => error.code === 4 && !error.message.includes(token));
});

test("un cuerpo de más de 65 536 caracteres sale con 5", () => {
  assert.throws(() => replaceSections(BODY, { plan: "x".repeat(MAX_BODY) }, hashTop(TOP)), { code: 5 });
});

test("tick marca solo la task pedida, no la que empieza igual", () => {
  const next = tickTask(BODY, "TASK-01", hashTop(TOP));
  assert.ok(next.includes("- [x] **TASK-01:**"));
  assert.ok(next.includes("- [ ] **TASK-10:**"));
  assert.equal(tickTask(next, "TASK-01", hashTop(TOP)), null);
  assert.throws(() => tickTask(BODY, "TASK-02", hashTop(TOP)), { code: 1 });
});

test("state cambia la línea Estado con la fecha", () => {
  const next = setState(BODY, "Implementada", "2026-11-08", hashTop(TOP));
  assert.ok(next.includes("> Estado: **Implementada (2026-11-08)** · Creada: 2026-11-07"));
  assert.throws(() => setState(BODY, "Aprobada", "2026-11-08", hashTop(TOP)), { code: 1 });
});

test("run write lee, sustituye y escribe con gh", async () => {
  const dir = await mkdtemp(join(tmpdir(), "issue-spec-test-"));
  const plan = join(dir, "plan.md");
  await writeFile(plan, "## Plan\n\nNuevo");
  const calls = [];
  let written;
  const call = async (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "view") return JSON.stringify({ body: BODY });
    if (args[1] === "edit") {
      const { readFile } = await import("node:fs/promises");
      written = await readFile(args[args.indexOf("--body-file") + 1], "utf8");
    }
    return "";
  };
  const output = await run(["write", "7", "--expect-top", hashTop(TOP), "--plan", plan], { run: call });
  assert.match(output, /plan escritas/);
  assert.deepEqual(calls[0], ["issue", "view", "7", "--json", "body"]);
  assert.equal(parseBody(written).sections.plan, "Nuevo");
  assert.equal(parseBody(written).top, TOP);
});

test("run read --section devuelve una sección", async () => {
  const call = async () => JSON.stringify({ body: BODY });
  assert.equal(await run(["read", "7", "--section", "top"], { run: call }), TOP);
  assert.equal(await run(["top-hash", "7"], { run: call }), hashTop(TOP));
});
