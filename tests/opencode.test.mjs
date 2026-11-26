// opencode como target del paquete: manifiesto, agentes, skills de setup y modelos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  agentsWithSkills,
  detectOpencode,
  getModelMd,
  loadProfiles,
  opencodeCommands,
  parseOpencodeModels,
  run as configureModels,
  statusLine,
  stripSkills,
} from "../.apm/skills/configure-models/scripts/configure-models.mjs";
import { run as context7, serverStateIn, userConfigPath } from "../.apm/skills/setup-context7/scripts/setup-context7.mjs";
import { registerServer, registerTools, serverEntry, unregisterServer } from "../.apm/skills/setup-docs-rag/scripts/setup-docs-rag.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const AGENTS = join(root, ".apm", "agents");
const SKILLS = join(root, ".apm", "skills");
const profiles = loadProfiles();

const temp = (prefix) => mkdtempSync(join(tmpdir(), prefix));
const write = (base, file, text) => {
  mkdirSync(dirname(join(base, file)), { recursive: true });
  writeFileSync(join(base, file), typeof text === "string" ? text : JSON.stringify(text, null, 2));
};
const read = (base, file) => readFileSync(join(base, file), "utf8");
const json = (base, file) => JSON.parse(read(base, file));

// Un proyecto desechable con git, los agentes del paquete en las carpetas pedidas y una carpeta personal aparte.
function project(tools = ["opencode"]) {
  const base = temp("dw-opencode-");
  execFileSync("git", ["init", "-q"], { cwd: base });
  for (const tool of tools) {
    mkdirSync(join(base, `.${tool}`, "agents"), { recursive: true });
    for (const f of readdirSync(AGENTS)) copyFileSync(join(AGENTS, f), join(base, `.${tool}`, "agents", f.replace(".agent.md", ".md")));
  }
  return { base, home: temp("dw-home-") };
}

// --- Paquete ---

test("apm.yml declara opencode primero", () => {
  const manifest = read(root, "apm.yml");
  assert.match(manifest, /^targets: \[opencode, claude, cursor, codex\]$/m);
  assert.match(manifest, /^description: Flujo de entrega para opencode, /m);
  assert.match(manifest, /^keywords: \[.*opencode, claude-code.*\]$/m);
});

test("cada agente declara mode: all, que opencode 2 exige para lanzarlo como subagente", () => {
  for (const file of readdirSync(AGENTS)) assert.match(read(AGENTS, file).split("---")[1], /^mode: all$/m, file);
});

test("cada agente nombra en su texto las skills de su campo skills", () => {
  for (const file of readdirSync(AGENTS)) {
    const [, front, ...body] = read(AGENTS, file).split("---");
    const skills = [...front.matchAll(/^\s+-\s+(\S+)/gm)].map((m) => m[1]);
    assert.ok(skills.length, `${file} sin skills`);
    for (const skill of skills) assert.ok(body.join("---").includes(`\`${skill}\``), `${file} no nombra ${skill}`);
  }
});

test("los SKILL.md que dan la carpeta de la skill nombran opencode primero", () => {
  for (const skill of readdirSync(SKILLS)) {
    const text = read(SKILLS, join(skill, "SKILL.md"));
    assert.ok(!/(?<!opencode, )Cursor y Codex[,;]? `\.agents/.test(text), skill);
  }
});

const hasApm = spawnSync("apm", ["--version"], { encoding: "utf8" }).status === 0;

test("apm install --target opencode deja agentes, skills y eur-lex", { skip: hasApm ? false : "apm no está instalado" }, () => {
  const work = temp("dw-apm-opencode-");
  try {
    const pkg = join(work, "pkg");
    cpSync(join(root, ".apm"), join(pkg, ".apm"), { recursive: true });
    // Sin la dependencia a la release publicada: la prueba usa solo las fuentes locales y no sale a la red.
    writeFileSync(join(pkg, "apm.yml"), read(root, "apm.yml").replace(/^ {2}apm:\n(?: {4}- .*\n)+/m, ""));
    const target = join(work, "proj");
    mkdirSync(target);
    mkdirSync(join(work, "home"));
    execFileSync("git", ["init", "-q"], { cwd: target });
    execFileSync("apm", ["install", "../pkg", "--target", "opencode"], { cwd: target, stdio: "pipe", env: { ...process.env, HOME: join(work, "home") } });
    assert.equal(readdirSync(join(target, ".opencode", "agents")).length, 9);
    assert.equal(readdirSync(join(target, ".agents", "skills")).length, readdirSync(SKILLS).length);
    assert.equal(json(target, "opencode.json").mcp["eur-lex"].type, "local");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

// --- setup-context7 ---

const USER = ".config/opencode/opencode.json";
const setup = async ({ base, home }, args) => JSON.parse(await context7([...args, "--root", base, "--home", home]));

test("context7 se registra en la config de usuario, conserva lo demás y deja la regla en AGENTS.md", async () => {
  const p = project();
  write(p.home, USER, { model: "a/b", mcp: { otro: { type: "local", command: ["echo"] } } });
  write(p.base, ".env", "CONTEXT7_API_KEY=ctx7sk-no-debe-salir\n");
  const args = ["apply", "--target", "opencode", "--with-key", "--libs", "react"];
  const [first] = await setup(p, args);
  assert.equal(first.config.result, "cambiado");
  const config = json(p.home, USER);
  assert.deepEqual(config.mcp.context7, {
    type: "remote",
    url: "https://mcp.context7.com/mcp",
    enabled: true,
    headers: { Authorization: "Bearer {env:CONTEXT7_API_KEY}" },
  });
  assert.equal(config.model, "a/b");
  assert.ok(config.mcp.otro);
  assert.match(read(p.base, "AGENTS.md"), /- react/);
  assert.doesNotMatch(read(p.home, USER) + JSON.stringify(first), /ctx7sk/);
  const [second] = await setup(p, args);
  assert.equal(second.config.result, "igual");
  assert.equal(second.rule.result, "igual");
  const detect = await setup(p, ["detect"]);
  assert.deepEqual([detect.tools[0].configured, detect.tools[0].withKey, detect.tools[0].channel], [true, true, "context7"]);
});

test("reset de opencode conserva la regla mientras Cursor use Context7", async () => {
  const p = project(["opencode", "cursor"]);
  await setup(p, ["apply", "--libs", "react"]);
  await setup(p, ["reset", "--target", "opencode"]);
  assert.ok(!existsSync(join(p.home, USER)), "solo tenía context7");
  assert.match(read(p.base, "AGENTS.md"), /- react/);
  await setup(p, ["reset", "--target", "cursor"]);
  assert.ok(!existsSync(join(p.base, "AGENTS.md")));
});

test("un opencode.json de usuario que no es JSON no se modifica", async () => {
  const p = project();
  write(p.home, USER, "// con comentario\n{}\n");
  await assert.rejects(setup(p, ["apply"]), /no es un JSON válido/);
  assert.equal(read(p.home, USER), "// con comentario\n{}\n");
});

test("un opencode.jsonc que declara context7 no se toca y se avisa", async () => {
  const p = project();
  const jsonc = '{\n  // mío\n  "mcp": { "context7": { "type": "remote", "url": "https://example.invalid" } },\n}\n';
  write(p.home, `${USER}c`, jsonc);
  const [r] = await setup(p, ["apply"]);
  assert.equal(read(p.home, `${USER}c`), jsonc);
  assert.ok(r.notes.some((n) => n.includes("opencode.jsonc declara context7")));
});

test("una entrada comentada en opencode.jsonc no cuenta", async () => {
  const p = project();
  write(p.home, `${USER}c`, '{\n  // "context7": { }\n  /* "docs-rag": { } */\n  "url": "https://x//y"\n}\n');
  const [r] = await setup(p, ["apply"]);
  assert.ok(!r.notes.some((n) => n.includes("opencode.jsonc")));
});

test("XDG_CONFIG_HOME manda solo con la carpeta personal real", () => {
  const env = { XDG_CONFIG_HOME: "/tmp/xdg" };
  assert.equal(userConfigPath(process.env.HOME, "opencode", env), "/tmp/xdg/opencode/opencode.json");
  assert.equal(userConfigPath("/tmp/otra", "opencode", env), `/tmp/otra/${USER}`);
  assert.equal(userConfigPath(process.env.HOME, "cursor", env), join(process.env.HOME, ".cursor/mcp.json"));
});

// --- setup-docs-rag ---

const EUR_LEX = { type: "local", enabled: true, command: ["npx", "-y", "eur-lex"] };

test("docs-rag se registra en opencode.json sin rutas del ordenador y conserva eur-lex", () => {
  const p = project();
  write(p.base, "opencode.json", { mcp: { "eur-lex": EUR_LEX } });
  assert.equal(registerServer({ root: p.base, tool: "opencode" }).result, "changed");
  const { mcp } = json(p.base, "opencode.json");
  assert.deepEqual(mcp["eur-lex"], EUR_LEX);
  assert.deepEqual(mcp["docs-rag"], serverEntry("opencode"));
  assert.ok(!JSON.stringify(mcp["docs-rag"]).includes(p.base));
  assert.equal(registerServer({ root: p.base, tool: "opencode" }).result, "unchanged");
  assert.equal(unregisterServer({ root: p.base, tool: "opencode" }).result, "changed");
  assert.deepEqual(Object.keys(json(p.base, "opencode.json").mcp), ["eur-lex"]);
});

test("el comando de docs-rag para opencode se ejecuta en la raíz del repositorio desde una subcarpeta", () => {
  const p = project();
  const sub = join(p.base, "a", "b");
  const bin = temp("dw-bin-");
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(bin, "uv"), '#!/bin/sh\npwd\necho "$@"\n');
  chmodSync(join(bin, "uv"), 0o755);
  const [command, ...args] = serverEntry("opencode").command;
  const out = execFileSync(command, args, { cwd: sub, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  const [cwd, uvArgs] = out.trim().split("\n");
  assert.equal(realpathSync(cwd), realpathSync(p.base));
  assert.equal(uvArgs, "run --quiet --project .docs-rag/app python -m docs_rag.server");
});

test("cambiar de canal quita en opencode el otro servidor", async () => {
  const p = project();
  write(p.base, "opencode.json", { mcp: { "eur-lex": EUR_LEX } });
  await setup(p, ["apply", "--libs", "react"]);
  const [r] = registerTools({ root: p.base, home: p.home, tools: ["opencode"] });
  assert.equal(r.context7Removed.config.result, "changed");
  assert.ok(!existsSync(join(p.home, USER)), "solo tenía context7");
  assert.ok(json(p.base, "opencode.json").mcp["docs-rag"]);
  await setup(p, ["apply"]);
  assert.deepEqual(Object.keys(json(p.base, "opencode.json").mcp), ["eur-lex"]);
  assert.equal(serverStateIn(read(p.home, USER), "opencode").configured, true);
});

test("docs-rag avisa de un opencode.jsonc de proyecto que declara el servidor", () => {
  const p = project();
  write(p.base, "opencode.jsonc", '{ "mcp": { "docs-rag": {} } }\n');
  const [r] = registerTools({ root: p.base, home: p.home, tools: ["opencode"] });
  assert.ok(r.notes.some((n) => n.includes("opencode.jsonc declara docs-rag")));
});

// --- configure-models ---

const ONE = "anthropic/claude-haiku-5-5\nanthropic/claude-opus-5-5\nanthropic/claude-sonnet-5-5\n";
const TWO = `${ONE}openai/gpt-5.1\nopenai/gpt-5.1-codex\nopenai/gpt-5.1-mini\n`;
const models = (stdout, status = "ok") => async (command, args) =>
  command === "opencode" && args.join(" ") === "models" ? { status, stdout } : { status: "missing", stdout: "" };
const cli = async ({ base }, args, runner = models(ONE)) => JSON.parse(await configureModels([...args, "--root", base], { run: runner }));
const agent = ({ base }, name, tool = "opencode") => read(base, `.${tool}/agents/${name}.md`);

test("parseOpencodeModels admite ids con /, : y @ y descarta lo demás", () => {
  const out = parseOpencodeModels("Aviso: algo\nopenrouter/meta/llama:free\ncf/@cf/modelo\nsin-barra\n\na/b\na/b\n");
  assert.deepEqual(out.map((m) => m.id), ["openrouter/meta/llama:free", "cf/@cf/modelo", "a/b"]);
});

test("opencode models se lanza en la raíz del proyecto", async () => {
  let seen;
  await detectOpencode({ root: "/raiz", run: async (...call) => ((seen = call), { status: "ok", stdout: ONE }) });
  assert.equal(seen[2].cwd, "/raiz");
});

test("sin opencode en el PATH, en macOS se usa el comando de la app de escritorio", async () => {
  const tried = [];
  const app = "/Applications/OpenCode.app/Contents/Resources/opencode-cli";
  const only = (found) => async (command) => (tried.push(command), command === found ? { status: "ok", stdout: ONE } : { status: "missing", stdout: "" });
  const detection = await detectOpencode({ run: only(app), root: "/raiz", home: "/casa", platform: "darwin" });
  assert.equal(detection.status, "ok");
  assert.deepEqual(tried, ["opencode", app]);
  assert.deepEqual(opencodeCommands({ platform: "darwin", home: "/casa" }).at(-1), `/casa${app}`);
  assert.deepEqual(opencodeCommands({ platform: "linux", home: "/casa" }), ["opencode"]);
});

test("un fallo del comando que existe no pasa al de la app", async () => {
  const tried = [];
  const run = async (command) => (tried.push(command), { status: "error", stdout: "" });
  const detection = await detectOpencode({ run, root: "/raiz", home: "/casa", platform: "darwin" });
  assert.match(detection.reason, /falló/);
  assert.deepEqual(tried, ["opencode"]);
});

test("con un proveedor, apply escribe un modelo por nivel en los 9 agentes", async () => {
  const p = project();
  const [r] = await cli(p, ["apply"]);
  assert.equal(r.agents.length, 9);
  assert.equal(getModelMd(agent(p, "concept-developer")), "anthropic/claude-opus-5-5");
  assert.equal(getModelMd(agent(p, "code-developer")), "anthropic/claude-sonnet-5-5");
  assert.equal(getModelMd(agent(p, "manage-commit")), "anthropic/claude-haiku-5-5");
});

test("con varios proveedores no hay propuesta hasta elegir uno", async () => {
  const p = project();
  const [none] = await cli(p, ["detect"], models(TWO));
  assert.deepEqual(none.providers, ["anthropic", "openai"]);
  assert.equal(none.provider, null);
  assert.ok(none.proposal.every((a) => a.model === null));
  assert.ok(none.notes.some((n) => n.includes("anthropic, openai")));
  assert.ok(!("proposalModels" in none) && !("ask" in none));
  const [chosen] = await cli(p, ["detect", "--provider", "openai"], models(TWO));
  assert.ok(chosen.proposal.every((a) => a.model.startsWith("openai/")));
  assert.equal(chosen.proposal.find((a) => a.agent === "manage-pr").model, "openai/gpt-5.1-mini");
});

test("el proveedor elegido se guarda, sobrevive a una reinstalación y se puede cambiar", async () => {
  const p = project();
  await cli(p, ["apply", "--provider", "openai"], models(TWO));
  copyFileSync(join(AGENTS, "manage-pr.agent.md"), join(p.base, ".opencode/agents/manage-pr.md"));
  await cli(p, ["apply"], models(TWO));
  assert.equal(getModelMd(agent(p, "manage-pr")), "openai/gpt-5.1-mini");
  await cli(p, ["apply"], models("", "timeout"));
  const [kept] = await cli(p, ["detect"], models(TWO));
  assert.equal(kept.provider, "openai");
  await cli(p, ["apply", "--provider", "anthropic"], models(TWO));
  assert.equal(getModelMd(agent(p, "manage-pr")), "anthropic/claude-haiku-5-5");
});

test("un proveedor que no existe es un error que nombra los disponibles", async () => {
  await assert.rejects(cli(project(), ["detect", "--provider", "otro"], models(TWO)), /anthropic, openai/);
  await assert.rejects(cli(project(["cursor"]), ["detect", "--provider", "openai"]), /solo vale para opencode/);
});

test("sin opencode, con fallo o sin modelos la detección es unknown y --models sirve", async () => {
  for (const [status, expected] of [["missing", /no está instalado/], ["error", /falló/], ["ok", /ningún modelo/]]) {
    const [d] = await cli(project(), ["detect"], models("", status));
    assert.equal(d.status, "unknown");
    assert.match(d.reason, expected);
  }
  const p = project();
  await cli(p, ["apply", "--target", "opencode", "--models", "local/mini-mini"], models("", "missing"));
  assert.equal(getModelMd(agent(p, "manage-pr")), "local/mini-mini");
});

test("la forma proveedor/modelo es de opencode: ni se exige ni se admite en las demás", async () => {
  await assert.rejects(cli(project(), ["apply", "--models", "sin-barra"]), /proveedor\/modelo/);
  await assert.rejects(cli(project(), ["apply", "--set", "manage-pr=sin-barra"]), /proveedor\/modelo/);
  await assert.rejects(cli(project(["cursor"]), ["apply", "--models", "a/b"]), /no válido/);
  await assert.rejects(cli(project(["cursor"]), ["apply", "--set", "manage-pr=a/b"]), /no válido/);
});

test("stripSkills quita el bloque de la cabecera y respeta el resto", () => {
  const text = '---\nname: x\nskills:\n  - a\n  - b\nother: 1\n---\nskills:\n  - del cuerpo\n';
  assert.equal(stripSkills(text), "---\nname: x\nother: 1\n---\nskills:\n  - del cuerpo\n");
  assert.equal(stripSkills(stripSkills(text)), stripSkills(text));
  assert.equal(stripSkills("---\r\nskills: [a]\r\nname: x\r\n---\r\nc\r\n"), "---\r\nname: x\r\n---\r\nc\r\n");
  assert.equal(stripSkills("---\nskills:\n- a\n---\n"), "---\n---\n");
});

test("apply quita skills solo en los agentes del paquete de opencode, aunque no haya modelos", async () => {
  const p = project(["opencode", "claude"]);
  const own = "---\nname: propio\nskills:\n  - x\n---\n";
  write(p.base, ".opencode/agents/propio.md", own);
  const before = agent(p, "manage-commit");
  const claude = agent(p, "manage-commit", "claude");
  const [r] = await cli(p, ["apply", "--target", "opencode"], models("", "missing"));
  assert.ok(r.agents.every((a) => a.model === null && a.result === "cambiado"));
  assert.ok(r.notes.some((n) => n.includes("«skills:» de 9 agentes")));
  assert.deepEqual(agentsWithSkills({ profiles, root: p.base, tool: "opencode" }), []);
  assert.equal(agent(p, "manage-commit"), stripSkills(before));
  assert.equal(agent(p, "manage-commit", "claude"), claude);
  assert.equal(read(p.base, ".opencode/agents/propio.md"), own);
  const [again] = await cli(p, ["apply", "--target", "opencode"], models("", "missing"));
  assert.ok(again.agents.every((a) => a.result === "igual"));
});

test("reset no repone skills", async () => {
  const p = project();
  await cli(p, ["apply"]);
  await cli(p, ["reset"]);
  assert.equal(getModelMd(agent(p, "manage-pr")), null);
  assert.doesNotMatch(agent(p, "manage-pr"), /^skills:/m);
});

test("apply sin modelos queda anotado en opencode, con el proveedor elegido", async () => {
  const p = project();
  const free = "libre/uno\nlibre/dos\notro/tres\n";
  await cli(p, ["apply", "--provider", "libre"], models(free));
  assert.equal(statusLine({ profiles, root: p.base }), "configurado, pero ningún agente lleva modelo (opencode 9/9): heredan el del chat");
  const [after] = await cli(p, ["detect"], models(free));
  assert.equal(after.provider, "libre");
  assert.equal(after.saved, false);
  await cli(p, ["reset"], models(free));
  assert.equal(statusLine({ profiles, root: p.base }), "sin configurar (ejecuta /configure-models)");
});

test("en las demás herramientas, apply sin modelos sigue sin anotar nada", async () => {
  const p = project(["cursor"]);
  await cli(p, ["apply"], models("", "missing"));
  assert.equal(statusLine({ profiles, root: p.base }), "sin configurar (ejecuta /configure-models)");
});

test("status pide configure-models mientras un agente de opencode lleve skills", async () => {
  const p = project();
  assert.match(statusLine({ profiles, root: p.base }), /sin configurar \(ejecuta \/configure-models: los agentes de opencode/);
  await cli(p, ["apply"]);
  assert.equal(statusLine({ profiles, root: p.base }), "configurado (opencode 9/9)");
  const file = join(p.base, ".opencode/agents/manage-pr.md");
  writeFileSync(file, readFileSync(file, "utf8").replace("---\n", "---\nskills:\n  - x\n"));
  assert.match(statusLine({ profiles, root: p.base }), /^desincronizado .*skills.*\/configure-models/);
});
