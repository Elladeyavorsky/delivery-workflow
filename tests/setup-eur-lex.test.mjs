import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SERVER_NAME,
  PACKAGE,
  VERSION,
  ARGS,
  MIN_NODE_MAJOR,
  setServerJson,
  removeServerJson,
  setServerToml,
  removeServerToml,
  nodeNote,
  parseArgs,
  applyAll,
  resetAll,
  toolsPresent,
  SetupEurLexError,
} from "../.apm/skills/setup-eur-lex/scripts/setup-eur-lex.mjs";

const SCRIPT = new URL("../.apm/skills/setup-eur-lex/scripts/setup-eur-lex.mjs", import.meta.url).pathname;
const PINNED = "@cyanheads/eur-lex-mcp-server@0.21.0";

// Un proyecto desechable con las carpetas de agentes de las tres herramientas.
function project(tools = [".cursor/agents", ".claude/agents", ".codex/agents"]) {
  const root = mkdtempSync(join(tmpdir(), "eurlex-proj-"));
  for (const d of tools) mkdirSync(join(root, d), { recursive: true });
  return root;
}

const CONFIGS = [".cursor/mcp.json", ".mcp.json", ".codex/config.toml"];
const snapshot = (root) => Object.fromEntries(CONFIGS.map((f) => [f, existsSync(join(root, f)) ? readFileSync(join(root, f), "utf8") : null]));

test("la versión del MCP está fijada a 0.21.0 y pide Node 24", () => {
  assert.equal(SERVER_NAME, "eur-lex");
  assert.equal(`${PACKAGE}@${VERSION}`, PINNED);
  assert.deepEqual(ARGS, ["-y", PINNED]);
  assert.equal(MIN_NODE_MAJOR, 24);
});

test("apply escribe eur-lex fijado a 0.21.0 sin tocar otros MCP", () => {
  const root = project();
  writeFileSync(join(root, ".cursor/mcp.json"), JSON.stringify({ mcpServers: { context7: { url: "https://mcp.context7.com/mcp" } } }, null, 2));
  writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { otro: { command: "otro" } }, extra: 1 }, null, 2));
  writeFileSync(join(root, ".codex/config.toml"), 'model = "x"\n\n[mcp_servers.context7]\nurl = "https://mcp.context7.com/mcp"\n');
  const out = applyAll({ root, tools: ["cursor", "claude", "codex"], nodeVersion: "24.1.0" });
  assert.ok(out.every((r) => r.config.result === "cambiado"));

  const cursor = JSON.parse(readFileSync(join(root, ".cursor/mcp.json"), "utf8"));
  assert.deepEqual(cursor.mcpServers.context7, { url: "https://mcp.context7.com/mcp" });
  assert.deepEqual(cursor.mcpServers["eur-lex"], { command: "npx", args: ["-y", PINNED] });

  const claude = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"));
  assert.deepEqual(claude.mcpServers.otro, { command: "otro" });
  assert.equal(claude.extra, 1);
  assert.deepEqual(claude.mcpServers["eur-lex"], { type: "stdio", command: "npx", args: ["-y", PINNED] });

  const codex = readFileSync(join(root, ".codex/config.toml"), "utf8");
  assert.ok(codex.startsWith('model = "x"\n\n[mcp_servers.context7]\nurl = "https://mcp.context7.com/mcp"\n'));
  assert.match(codex, /\[mcp_servers\.eur-lex\]\ncommand = "npx"\nargs = \["-y", "@cyanheads\/eur-lex-mcp-server@0\.21\.0"\]\n$/);
  // Con Node 24 no hay aviso de versión.
  assert.ok(out.every((r) => !r.notes.some((n) => n.includes("Node"))));
});

test("apply dos veces da los mismos ficheros", () => {
  const root = project();
  applyAll({ root, tools: ["cursor", "claude", "codex"], nodeVersion: "24.0.0" });
  const first = snapshot(root);
  const out = applyAll({ root, tools: ["cursor", "claude", "codex"], nodeVersion: "24.0.0" });
  assert.ok(out.every((r) => r.config.result === "igual"));
  assert.deepEqual(snapshot(root), first);
});

test("apply cambia una versión antigua de eur-lex por la fijada", () => {
  const old = JSON.stringify({ mcpServers: { "eur-lex": { command: "npx", args: ["-y", "@cyanheads/eur-lex-mcp-server@latest"] } } });
  const { text, result } = setServerJson(old, { command: "npx", args: [...ARGS] });
  assert.equal(result, "cambiado");
  assert.deepEqual(JSON.parse(text).mcpServers["eur-lex"].args, ["-y", PINNED]);
  const toml = '[mcp_servers.eur-lex]\ncommand = "npx"\nargs = ["-y", "@cyanheads/eur-lex-mcp-server@0.1.0"]\n';
  const t = setServerToml(toml);
  assert.equal(t.result, "cambiado");
  assert.ok(!t.text.includes("0.1.0"));
  assert.equal(t.text.match(/\[mcp_servers\.eur-lex\]/g).length, 1);
});

test("un fichero de config inválido no se modifica", () => {
  const root = project();
  const brokenJson = "{ mcpServers: roto";
  const brokenToml = '[mcp_servers.context7\nurl = "x"\n';
  writeFileSync(join(root, ".mcp.json"), brokenJson);
  writeFileSync(join(root, ".codex/config.toml"), brokenToml);
  assert.throws(
    () => applyAll({ root, tools: ["cursor", "claude", "codex"], nodeVersion: "24.0.0" }),
    (e) => e instanceof SetupEurLexError && e.code === 3,
  );
  assert.equal(readFileSync(join(root, ".mcp.json"), "utf8"), brokenJson);
  assert.equal(readFileSync(join(root, ".codex/config.toml"), "utf8"), brokenToml);
  // Se calcula todo antes de escribir: Cursor, que era válido, tampoco se toca.
  assert.equal(existsSync(join(root, ".cursor/mcp.json")), false);
  // Sin restos de escritura atómica.
  assert.deepEqual(readdirSync(root).filter((f) => f.endsWith(".tmp")), []);
});

test("un TOML inválido sale con 3 por la CLI y no se escribe nada", () => {
  const root = project([".codex/agents"]);
  const broken = 'args = ["sin cerrar"\n';
  writeFileSync(join(root, ".codex/config.toml"), broken);
  let status = 0;
  try {
    execFileSync("node", [SCRIPT, "apply", "--root", root], { stdio: "pipe" });
  } catch (e) {
    status = e.status;
  }
  assert.equal(status, 3);
  assert.equal(readFileSync(join(root, ".codex/config.toml"), "utf8"), broken);
});

test("mcpServers que no es un objeto no se toca", () => {
  assert.throws(() => setServerJson(JSON.stringify({ mcpServers: [] }), {}), (e) => e.code === 3);
});

test("reset deja los ficheros como estaban antes de apply", () => {
  const root = project();
  writeFileSync(join(root, ".cursor/mcp.json"), `${JSON.stringify({ mcpServers: { context7: { url: "u" } } }, null, 2)}\n`);
  writeFileSync(join(root, ".codex/config.toml"), '[mcp_servers.context7]\nurl = "u"\n');
  const before = snapshot(root);
  applyAll({ root, tools: ["cursor", "claude", "codex"], nodeVersion: "24.0.0" });
  resetAll({ root, tools: ["cursor", "claude", "codex"] });
  assert.deepEqual(snapshot(root), before);
});

test("removeServerJson y removeServerToml solo quitan eur-lex", () => {
  const json = JSON.stringify({ mcpServers: { "eur-lex": {}, context7: { url: "u" } } });
  assert.deepEqual(JSON.parse(removeServerJson(json).text).mcpServers, { context7: { url: "u" } });
  assert.equal(removeServerJson(JSON.stringify({ mcpServers: { "eur-lex": {} } })).text, "");
  const toml = '[mcp_servers.eur-lex]\ncommand = "npx"\n\n[mcp_servers.context7]\nurl = "u"\n';
  assert.equal(removeServerToml(toml).text, '[mcp_servers.context7]\nurl = "u"\n');
});

test("con Node menor que 24 apply escribe la config y avisa", () => {
  const root = project([".claude/agents"]);
  const [r] = applyAll({ root, tools: ["claude"], nodeVersion: "20.11.0" });
  assert.equal(r.config.result, "cambiado");
  assert.ok(r.notes.some((n) => n.includes("Node 20.11.0") && n.includes("24") && n.includes("data-protection-guideline")));
  assert.equal(nodeNote("24.0.0"), null);
  assert.equal(nodeNote("v23.9.0").includes("23.9.0"), true);
});

test("toolsPresent y parseArgs", () => {
  const root = project([".cursor/agents", ".codex/agents"]);
  assert.deepEqual(toolsPresent(root), ["cursor", "codex"]);
  assert.deepEqual(parseArgs(["apply", "--target", "codex", "--root", "/x"]), { command: "apply", target: "codex", root: "/x" });
  assert.throws(() => parseArgs(["apply", "--libs", "x"]), (e) => e.code === 2);
});

test("sin carpetas de agentes la CLI sale con 3", () => {
  const root = mkdtempSync(join(tmpdir(), "eurlex-empty-"));
  let status = 0;
  try {
    execFileSync("node", [SCRIPT, "apply", "--root", root], { stdio: "pipe" });
  } catch (e) {
    status = e.status;
  }
  assert.equal(status, 3);
});
