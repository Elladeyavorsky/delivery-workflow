import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DOCS,
  DISCLAIMER,
  HUECO_PREFIX,
  readPersonalData,
  marker,
  docState,
  writeDoc,
  run,
  SetupComplianceError,
} from "../.apm/skills/setup-compliance/scripts/setup-compliance.mjs";

const assets = new URL("../.apm/skills/setup-compliance/assets/", import.meta.url);

// Un proyecto desechable, sin git salvo que se pida.
function project({ git = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sc-"));
  if (git) execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}
const put = (root, file, text = "") => {
  mkdirSync(join(root, file, ".."), { recursive: true });
  writeFileSync(join(root, file), text);
};
const read = (root, file) => readFileSync(join(root, file), "utf8");
const exec = (root, args) => JSON.parse(run([...args, "--root", root]));
const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const body = (extra = "texto") => `# Título\n\n${extra}\n\n${DISCLAIMER}\n`;
const source = (root, text) => {
  const f = join(root, "_src.md");
  writeFileSync(f, text);
  return f;
};

test("detect encuentra openai y propone los cuatro documentos base", () => {
  const root = project();
  put(root, "package.json", JSON.stringify({ dependencies: { openai: "^4.0.0" } }));
  const r = exec(root, ["detect"]);
  const hit = r.aiSignals.find((s) => s.name === "openai");
  assert.ok(hit);
  assert.equal(hit.source, "package.json");
  assert.deepEqual(Object.keys(r.docs), DOCS);
  assert.ok(Object.values(r.docs).every((s) => s === "ausente"));
  assert.deepEqual(r.suggested, ["ai-act", "dpia", "system-card", "security"].sort((a, b) => DOCS.indexOf(a) - DOCS.indexOf(b)));
  assert.ok(!r.suggested.includes("model-card"));
  assert.ok(!r.suggested.includes("data-card"));
  assert.deepEqual(r.manifests.map((m) => m.file), ["package.json"]);
});

test("detect propone model-card y data-card con pesos en git", () => {
  const root = project({ git: true });
  put(root, "model/weights.safetensors", "x");
  const r = exec(root, ["detect"]);
  assert.ok(r.aiSignals.some((s) => s.source === "model/weights.safetensors"));
  assert.ok(r.suggested.includes("model-card"));
  assert.ok(r.suggested.includes("data-card"));
});

test("detect descarta rutas ocultas y de dependencias, y respeta .gitignore", () => {
  const root = project({ git: true });
  put(root, "node_modules/x/m.onnx", "x");
  put(root, ".hidden/m.pt", "x");
  put(root, "ignored/m.gguf", "x");
  put(root, ".gitignore", "ignored/\n");
  put(root, "ok/m.h5", "x");
  const r = exec(root, ["detect"]);
  assert.deepEqual(r.aiSignals.map((s) => s.source), ["ok/m.h5"]);
});

test("detect sin git recorre el proyecto y encuentra datos de entrenamiento", () => {
  const root = project();
  put(root, "data/train.csv", "a,b");
  put(root, "node_modules/p/train.csv", "a,b");
  const r = exec(root, ["detect"]);
  assert.deepEqual(r.datasetFiles, ["data/train.csv"]);
  assert.ok(r.suggested.includes("data-card"));
  assert.ok(!r.suggested.includes("model-card"));
});

test("detect con un manifiesto ilegible lo marca con error y lee el resto (CB-01)", () => {
  const root = project();
  put(root, "package.json", "{ no es json");
  put(root, "requirements.txt", "openai==1.0\n");
  const r = exec(root, ["detect"]);
  assert.ok(r.manifests.find((m) => m.file === "package.json").error);
  assert.ok(r.aiSignals.some((s) => s.name === "openai" && s.source === "requirements.txt"));
});

test("detect sin señales de IA devuelve aiSignals vacío (CB-06)", () => {
  const root = project();
  put(root, "package.json", JSON.stringify({ dependencies: { express: "1" } }));
  assert.deepEqual(exec(root, ["detect"]).aiSignals, []);
});

test("readPersonalData da null al campo con solo el comentario", () => {
  const text = [
    "# Constitución",
    "",
    "## Datos personales",
    "",
    "- **Rol en el tratamiento:** responsable",
    "- **Interesados:** <!-- quiénes son -->",
    "- **Categorías especiales:** ninguna",
    "- **Estado de la DPIA:** <!-- pendiente, hecha o no aplica -->",
    "",
    "## Otra",
    "- **Estado de la DPIA:** no debe leerse",
  ].join("\n");
  const r = readPersonalData(text);
  assert.equal(r.declared, true);
  assert.equal(r.role, "responsable");
  assert.equal(r.dataSubjects, null);
  assert.equal(r.specialCategories, "ninguna");
  assert.equal(r.dpiaStatus, null);
});

test("detect sin CONSTITUTION da declared false", () => {
  const root = project();
  assert.equal(exec(root, ["detect"]).personalData.declared, false);
  assert.equal(readPersonalData(null).declared, false);
  assert.equal(readPersonalData("# Sin sección\n").declared, false);
});

test("detect lee la sección de datos personales de docs/CONSTITUTION.md", () => {
  const root = project();
  put(root, "docs/CONSTITUTION.md", "## Datos personales\n\n- **Rol en el tratamiento:** encargado\n");
  const r = exec(root, ["detect"]).personalData;
  assert.equal(r.declared, true);
  assert.equal(r.role, "encargado");
});

test("write crea el documento con su marca", () => {
  const root = project();
  const text = body();
  const r = exec(root, ["write", "--doc", "ai-act", "--from", source(root, text)]);
  assert.equal(r.result, "creado");
  const file = read(root, "docs/ai-act.md");
  const [first, ...rest] = file.split("\n");
  assert.match(first, /^<!-- setup-compliance sha256=[0-9a-f]{64} -->$/);
  assert.equal(first, `<!-- setup-compliance sha256=${sha(rest.join("\n"))} -->`);
  assert.equal(rest.join("\n"), text);
  assert.equal(first, marker(text));
  assert.equal(docState(file), "generado");
});

test("write repetido da igual", () => {
  const root = project();
  const text = body();
  writeDoc({ root, doc: "ai-act", body: text });
  const before = read(root, "docs/ai-act.md");
  assert.equal(writeDoc({ root, doc: "ai-act", body: text }).result, "igual");
  assert.equal(read(root, "docs/ai-act.md"), before);
  assert.equal(exec(root, ["detect"]).docs["ai-act"], "generado");
});

test("write con otro contenido da actualizado", () => {
  const root = project();
  writeDoc({ root, doc: "ai-act", body: body("uno") });
  const next = body("dos");
  assert.equal(writeDoc({ root, doc: "ai-act", body: next }).result, "actualizado");
  assert.equal(read(root, "docs/ai-act.md"), `${marker(next)}\n${next}`);
});

test("write conserva un documento editado", () => {
  const root = project();
  writeDoc({ root, doc: "dpia", body: body("uno") });
  put(root, "docs/dpia.md", `${read(root, "docs/dpia.md")}\nEditado a mano.\n`);
  const before = readFileSync(join(root, "docs/dpia.md"));
  assert.equal(writeDoc({ root, doc: "dpia", body: body("dos") }).result, "conservado");
  assert.ok(readFileSync(join(root, "docs/dpia.md")).equals(before));
  assert.equal(exec(root, ["detect"]).docs.dpia, "editado");
});

test("write conserva un documento escrito a mano sin marca (CB-03)", () => {
  const root = project();
  put(root, "docs/security.md", "# Mío\n");
  assert.equal(exec(root, ["detect"]).docs.security, "editado");
  assert.equal(writeDoc({ root, doc: "security", body: body() }).result, "conservado");
  assert.equal(read(root, "docs/security.md"), "# Mío\n");
});

test("write crea docs/ si no existe (CB-02)", () => {
  const root = project();
  assert.ok(!existsSync(join(root, "docs")));
  writeDoc({ root, doc: "security", body: body() });
  assert.ok(existsSync(join(root, "docs", "security.md")));
});

test("write rechaza un contenido sin la línea orientativa", () => {
  const root = project();
  assert.throws(() => writeDoc({ root, doc: "ai-act", body: "# Sin aviso\n" }), (e) => e instanceof SetupComplianceError && e.code === 2);
  assert.ok(!existsSync(join(root, "docs", "ai-act.md")));
});

test("write rechaza un contenido con texto tras la línea orientativa", () => {
  const root = project();
  const text = `# Doc\n\n${DISCLAIMER}\n\nOtro párrafo.\n`;
  assert.throws(() => run(["write", "--doc", "ai-act", "--from", source(root, text), "--root", root]), (e) => e instanceof SetupComplianceError && e.code === 2);
  assert.ok(!existsSync(join(root, "docs", "ai-act.md")));
});

test("write rechaza una última línea que solo contiene la orientativa (CB-05)", () => {
  const root = project();
  const code2 = (e) => e instanceof SetupComplianceError && e.code === 2;
  assert.throws(() => writeDoc({ root, doc: "ai-act", body: `# Doc\n\nVer ${DISCLAIMER} y más.\n` }), code2);
  assert.throws(() => writeDoc({ root, doc: "ai-act", body: `# Doc\n\n${DISCLAIMER} Otro texto.\n` }), code2);
  assert.ok(!existsSync(join(root, "docs")));
});

test("write acepta líneas en blanco tras la línea orientativa", () => {
  const root = project();
  assert.equal(writeDoc({ root, doc: "ai-act", body: `# Doc\n\n${DISCLAIMER}\n\n\n` }).result, "creado");
});

test("write sale con código 2 sin doc válido, sin --from o con fichero inexistente (CB-04)", () => {
  const root = project();
  const code2 = (e) => e instanceof SetupComplianceError && e.code === 2;
  assert.throws(() => run(["write", "--doc", "otro", "--from", source(root, body()), "--root", root]), code2);
  assert.throws(() => run(["write", "--doc", "dpia", "--root", root]), code2);
  assert.throws(() => run(["write", "--doc", "dpia", "--from", join(root, "no-existe.md"), "--root", root]), code2);
  assert.ok(!existsSync(join(root, "docs")));
});

test("una orden desconocida o ausente sale con código 2 y la lista de órdenes (CB-07)", () => {
  const code2 = (e) => e instanceof SetupComplianceError && e.code === 2 && /detect/.test(e.message) && /write/.test(e.message);
  assert.throws(() => run(["nada"]), code2);
  assert.throws(() => run([]), code2);
});

test("las plantillas traen aviso, fuente y hueco", () => {
  for (const doc of DOCS) {
    const text = readFileSync(new URL(`${doc}.md`, assets), "utf8");
    const lines = text.split("\n").filter((l) => l.trim() !== "");
    assert.equal(lines.at(-1).trim(), DISCLAIMER, `${doc}: última línea`);
    assert.ok(lines.some((l) => l.startsWith("Fuente:")), `${doc}: Fuente:`);
    assert.ok(text.includes(HUECO_PREFIX), `${doc}: hueco`);
    assert.ok(!/cumple/i.test(text), `${doc}: «cumple»`);
  }
  assert.equal(readdirSync(assets).filter((f) => DOCS.includes(f.replace(/\.md$/, ""))).length, DOCS.length);
});
