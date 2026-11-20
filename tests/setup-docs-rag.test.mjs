import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  versionFromRange,
  parsePackageLock,
  parsePnpmLock,
  parseYarnLock,
  parseTomlPackages,
  rangesFromManifest,
  detectRuntimes,
  buildInventory,
  buildRequest,
  serverEntry,
  registerServer,
  registerTools,
  unregisterServer,
  unregisterUserServer,
  ensureRagDir,
  indexState,
  checkRequirements,
  parseArgs,
  run,
  SetupDocsRagError,
} from "../.apm/skills/setup-docs-rag/scripts/setup-docs-rag.mjs";

function project(tools = ["claude"]) {
  const root = mkdtempSync(join(tmpdir(), "rag-"));
  for (const t of tools) mkdirSync(join(root, `.${t}`, "agents"), { recursive: true });
  return root;
}
const write = (root, file, text) => {
  mkdirSync(join(root, file, ".."), { recursive: true });
  writeFileSync(join(root, file), typeof text === "string" ? text : JSON.stringify(text));
};
const homeOf = (root) => join(root, "_home");
const readHome = (root, file) => readFileSync(join(homeOf(root), file), "utf8");

test("versionFromRange toma la primera versión y dice si es exacta", () => {
  assert.deepEqual(versionFromRange("^19.0.0"), { version: "19.0.0", exact: false });
  assert.deepEqual(versionFromRange(">=3.12"), { version: "3.12", exact: false });
  assert.deepEqual(versionFromRange("==2.32.3"), { version: "2.32.3", exact: true });
  assert.deepEqual(versionFromRange("1.10.0"), { version: "1.10.0", exact: true });
  assert.equal(versionFromRange("latest"), null);
});

test("package-lock v3 y v1: solo primer nivel", () => {
  const v3 = { lockfileVersion: 3, packages: { "": {}, "node_modules/react": { version: "19.1.0" }, "node_modules/@types/node": { version: "20.1.0" }, "node_modules/a/node_modules/react": { version: "1.0.0" } } };
  const m = parsePackageLock(JSON.stringify(v3));
  assert.equal(m.get("react"), "19.1.0");
  assert.equal(m.get("@types/node"), "20.1.0");
  assert.equal(parsePackageLock(JSON.stringify({ lockfileVersion: 1, dependencies: { vue: { version: "3.4.0" } } })).get("vue"), "3.4.0");
});

test("pnpm-lock v9 (importers) y v5 (primer nivel)", () => {
  const v9 = `lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      react:\n        specifier: ^19.0.0\n        version: 19.1.0\n      '@tanstack/query':\n        specifier: ^5\n        version: 5.2.0(react@19.1.0)\n  packages/b:\n    dependencies:\n      vue:\n        specifier: ^3\n        version: 3.0.0\n`;
  const m = parsePnpmLock(v9);
  assert.equal(m.get("react"), "19.1.0");
  assert.equal(m.get("@tanstack/query"), "5.2.0");
  assert.equal(m.has("vue"), false, "solo el importer raíz");
  const v5 = `lockfileVersion: 5.4\n\ndependencies:\n  react: 18.2.0\n  '@scope/x': 1.0.0_peer\n`;
  assert.equal(parsePnpmLock(v5).get("react"), "18.2.0");
});

test("yarn.lock v1 y berry", () => {
  const v1 = `# yarn lockfile v1\n\n"react@^18.2.0", react@^18.0.0:\n  version "18.2.0"\n  resolved "x"\n\n"@babel/core@^7.0.0":\n  version "7.24.0"\n`;
  const m = parseYarnLock(v1);
  assert.equal(m.get("react"), "18.2.0");
  assert.equal(m.get("@babel/core"), "7.24.0");
  const berry = `__metadata:\n  version: 8\n\n"react@npm:^19.0.0":\n  version: 19.1.0\n  resolution: "react@npm:19.1.0"\n`;
  assert.equal(parseYarnLock(berry).get("react@npm"), undefined);
  assert.equal(parseYarnLock(berry).get("react"), "19.1.0");
});

test("uv.lock, poetry.lock y Cargo.lock: [[package]] con name y version", () => {
  const uv = `version = 1\n\n[[package]]\nname = "FastAPI"\nversion = "0.115.0"\nsource = { registry = "x" }\n\n[[package]]\nname = "pydantic_core"\nversion = "2.20.1"\n`;
  const m = parseTomlPackages(uv, (n) => n.toLowerCase().replace(/[_.]+/g, "-"));
  assert.equal(m.get("fastapi"), "0.115.0");
  assert.equal(m.get("pydantic-core"), "2.20.1");
  assert.equal(parseTomlPackages(`[[package]]\nname = "serde"\nversion = "1.0.228"\n`).get("serde"), "1.0.228");
});

test("rangesFromManifest lee los rangos de cada manifiesto", () => {
  assert.equal(rangesFromManifest("package.json", JSON.stringify({ dependencies: { react: "^19.0.0" } })).get("react"), "^19.0.0");
  assert.equal(rangesFromManifest("requirements.txt", "Django>=5.0  # web\nrequests[socks]==2.32.3\n").get("requests"), "==2.32.3");
  assert.equal(rangesFromManifest("pyproject.toml", `[project]\ndependencies = ["fastapi>=0.110", "pydantic"]\n`).get("fastapi"), ">=0.110");
  assert.equal(rangesFromManifest("go.mod", "require (\n\tgithub.com/gin-gonic/gin v1.10.0\n)\n").get("github.com/gin-gonic/gin"), "1.10.0");
  assert.equal(rangesFromManifest("Cargo.toml", `[dependencies]\nserde = { version = "1.0", features = ["derive"] }\ntokio = "1.40"\n`).get("serde"), "1.0");
});

const SPANISH_KEYS = ["paquete", "paquetes", "ecosistema", "origen", "fuente", "dependencias", "descartadas", "avisos", "detalle", "motivo", "inventario", "requisitos", "indice", "herramientas", "existe", "coleccion", "indexados", "sin_doc", "fragmentos", "modelo"];
const keysOf = (value) => (Array.isArray(value) ? value.flatMap(keysOf) : value && typeof value === "object" ? Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]) : []);

test("detect da versiones del lockfile y runtimes, con las claves en inglés", () => {
  const root = project();
  write(root, "package.json", { dependencies: { react: "^19.0.0" }, devDependencies: { typescript: "^5" } });
  write(root, "package-lock.json", { lockfileVersion: 3, packages: { "node_modules/react": { version: "19.1.0" }, "node_modules/typescript": { version: "5.6.0" } } });
  write(root, ".nvmrc", "20\n");
  write(root, "pyproject.toml", `[project]\nname = "x"\nrequires-python = ">=3.12"\ndependencies = ["fastapi>=0.110"]\n`);
  const inv = buildInventory({ root });
  const react = inv.dependencies.find((d) => d.package === "react");
  assert.deepEqual([react.ecosystem, react.version, react.origin, react.source, react.runtime], ["npm", "19.1.0", "lockfile", "package-lock.json", false]);
  assert.deepEqual(inv.discarded.map((d) => d.package), ["typescript"]);
  const fastapi = inv.dependencies.find((d) => d.package === "fastapi");
  assert.deepEqual([fastapi.version, fastapi.origin], ["0.110", "range"]);
  assert.ok(inv.warnings.some((a) => a.includes("fastapi") && a.includes("mínima")));
  const rt = Object.fromEntries(inv.runtimes.map((r) => [r.package, r]));
  assert.equal(rt.node.version, "20");
  assert.equal(rt.node.origin, "pinned");
  assert.equal(rt.python.version, "3.12");
  assert.equal(rt.python.origin, "range");
  assert.ok(inv.warnings.some((a) => a.includes("python") && a.includes("rango")));
  assert.ok(inv.runtimes.every((r) => r.ecosystem === "runtime"));
  assert.deepEqual(keysOf(inv).filter((k) => SPANISH_KEYS.includes(k)), []);
});

test("detectRuntimes: alias no se indexa, toolchain de Go y rust-toolchain", () => {
  const root = project();
  write(root, ".nvmrc", "lts/iron\n");
  write(root, "go.mod", "module x\n\ngo 1.22\n\ntoolchain go1.22.3\n");
  write(root, "rust-toolchain.toml", `[toolchain]\nchannel = "1.80.0"\n`);
  const { runtimes, warnings } = detectRuntimes(root);
  assert.deepEqual(runtimes.map((r) => [r.package, r.version]).sort(), [["go", "1.22.3"], ["rust", "1.80.0"]]);
  assert.ok(warnings.some((a) => a.includes("alias") && a.includes("lts/iron")));
});

test("un lockfile roto avisa y usa el rango", () => {
  const root = project();
  write(root, "package.json", { dependencies: { react: "^19.0.0" } });
  write(root, "package-lock.json", "{roto");
  const inv = buildInventory({ root });
  assert.equal(inv.dependencies[0].origin, "range");
  assert.ok(inv.warnings.some((a) => a.includes("package-lock.json no se ha podido leer")));
});

test("buildRequest limita a las librerías confirmadas y quita runtimes si se pide", () => {
  const inv = { dependencies: [{ package: "react", ecosystem: "npm", version: "19.1.0" }, { package: "vue", ecosystem: "npm", version: "3.0.0" }, { package: "x", ecosystem: "npm", version: null }], runtimes: [{ package: "node", ecosystem: "runtime", version: "20", runtime: true }] };
  assert.deepEqual(buildRequest(inv).packages.map((p) => p.package), ["node", "react", "vue"]);
  assert.deepEqual(buildRequest(inv, { libs: ["react"], withRuntimes: false }).packages.map((p) => p.package), ["react"]);
  assert.deepEqual(Object.keys(buildRequest(inv).packages[1]), ["package", "ecosystem", "version", "origin", "source", "runtime"]);
});

test("registerServer pone docs-rag en la config del proyecto con rutas relativas y no toca lo demás", () => {
  const root = project(["claude", "cursor", "codex"]);
  write(root, ".mcp.json", { mcpServers: { context7: { type: "http", url: "u" }, otro: { command: "echo" } } });
  write(root, ".codex/config.toml", `[mcp_servers.otro]\ncommand = "echo"\n`);
  for (const tool of ["claude", "cursor", "codex"]) assert.equal(registerServer({ root, tool }).result, "changed");
  const claude = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"));
  assert.deepEqual(Object.keys(claude.mcpServers).sort(), ["context7", "docs-rag", "otro"], "context7 y otro se quedan");
  assert.deepEqual(claude.mcpServers["docs-rag"], {
    type: "stdio",
    command: "uv",
    args: ["run", "--quiet", "--project", ".docs-rag/app", "python", "-m", "docs_rag.servidor"],
    env: { UV_PROJECT_ENVIRONMENT: "../venv" },
  });
  const cursor = JSON.parse(readFileSync(join(root, ".cursor/mcp.json"), "utf8")).mcpServers["docs-rag"];
  assert.ok(cursor.args.includes("${workspaceFolder}/.docs-rag/app"));
  assert.equal(cursor.env.UV_PROJECT_ENVIRONMENT, "${workspaceFolder}/.docs-rag/venv");
  assert.deepEqual(cursor.args.slice(-2), ["--root", "${workspaceFolder}"]);
  const codex = readFileSync(join(root, ".codex/config.toml"), "utf8");
  assert.match(codex, /\[mcp_servers\."docs-rag"\]\ncommand = "uv"/);
  assert.match(codex, /\[mcp_servers\.otro\]/);
  assert.equal(registerServer({ root, tool: "claude" }).result, "unchanged");
  assert.equal(unregisterServer({ root, tool: "claude" }).result, "changed");
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")).mcpServers).sort(), ["context7", "otro"]);
  assert.equal(unregisterServer({ root, tool: "cursor" }).result, "changed");
  assert.ok(!existsSync(join(root, ".cursor/mcp.json")), "solo tenía docs-rag");
  assert.equal(unregisterServer({ root, tool: "cursor" }).result, "missing");
});

test("serverEntry no lleva rutas absolutas de este ordenador", () => {
  for (const tool of ["claude", "codex", "cursor"]) {
    const e = serverEntry(tool);
    assert.equal(e.command, "uv");
    assert.ok([...e.args, e.env.UV_PROJECT_ENVIRONMENT].every((a) => !/^([A-Za-z]:|\/)/.test(a)), tool);
  }
});

test("registerTools migra el registro de usuario de la #64 al proyecto", () => {
  const root = project(["claude", "codex"]);
  const home = homeOf(root);
  write(home, ".claude.json", { numStartups: 2, mcpServers: { "docs-rag": { command: "C:/u/uv.exe" }, otro: { command: "echo" } } });
  write(home, ".codex/config.toml", `[mcp_servers."docs-rag"]\ncommand = "uv"\n`);
  mkdirSync(join(home, ".docs-rag", "app"), { recursive: true });
  const out = registerTools({ root, home, tools: ["claude", "codex"] });
  const claudeUser = JSON.parse(readHome(root, ".claude.json"));
  assert.equal(claudeUser.numStartups, 2);
  assert.deepEqual(Object.keys(claudeUser.mcpServers), ["otro"]);
  assert.ok(!existsSync(join(home, ".codex/config.toml")), "solo tenía docs-rag");
  assert.ok(existsSync(join(root, ".mcp.json")) && existsSync(join(root, ".codex/config.toml")));
  assert.deepEqual(out.map((t) => t.config.file), [".mcp.json", ".codex/config.toml"]);
  assert.ok(out[0].notes.some((n) => n.includes("~/.claude.json") && n.includes(".mcp.json")));
  assert.ok(out[0].notes.some((n) => n.includes("~/.docs-rag/")));
  assert.ok(!out[1].notes.some((n) => n.includes("~/.docs-rag/")), "el aviso de ~/.docs-rag/ sale una vez");
  assert.equal(unregisterUserServer({ home, tool: "claude" }).result, "unchanged");
});

test("ensureRagDir crea .docs-rag/.gitignore con * y es idempotente", () => {
  const root = project();
  ensureRagDir(root);
  ensureRagDir(root);
  assert.equal(readFileSync(join(root, ".docs-rag/.gitignore"), "utf8"), "*\n");
});

test("indexState resume inventory.json y detecta el formato anterior", () => {
  const root = project();
  assert.deepEqual(indexState(root), { exists: false });
  write(root, ".docs-rag/inventario.json", { coleccion: "docs_x", paquetes: {} });
  assert.deepEqual(indexState(root), { exists: false, legacy: true });
  write(root, ".docs-rag/inventory.json", { collection: "docs_v2_x", updated: "hoy", packages: { "npm:react": { package: "react", status: "indexed", chunks: 10 }, "runtime:rust": { package: "rust", status: "no_docs", reason: "no hay" } } });
  const s = indexState(root);
  assert.equal(s.exists, true);
  assert.equal(s.collection, "docs_v2_x");
  assert.equal(s.indexed, 1);
  assert.equal(s.chunks, 10);
  assert.deepEqual(s.no_docs, [{ package: "rust", reason: "no hay" }]);
});

test("checkRequirements traduce las respuestas de docker, ollama y uv", async () => {
  const fake = async (cmd, args) => {
    if (cmd === "docker" && args[0] === "info") return { ok: false, out: "", missing: false };
    if (cmd === "ollama") return { ok: true, out: "NAME ID\nnomic-embed-text:latest abc" };
    if (cmd === "uv") return { ok: false, out: "", missing: true };
    return { ok: false, out: "" };
  };
  const r = await checkRequirements(fake);
  assert.equal(r.docker.ok, false);
  assert.match(r.docker.detail, /no responde/);
  assert.equal(r.model.ok, true);
  assert.match(r.uv.detail, /no está instalado/);
});

test("detect da el canal mirando docs-rag en el proyecto y context7 en el usuario", async () => {
  const root = project(["claude"]);
  const home = homeOf(root);
  write(home, ".claude.json", { mcpServers: { context7: { type: "http", url: "u" } } });
  write(root, ".mcp.json", { mcpServers: { "docs-rag": { command: "uv" } } });
  const out = JSON.parse(await run(["detect", "--root", root, "--home", home]));
  assert.deepEqual(Object.keys(out), ["inventory", "requirements", "index", "tools"]);
  assert.deepEqual(out.tools, [{ tool: "claude", name: "Claude Code", configFile: ".mcp.json", channel: "both" }]);
  assert.deepEqual(keysOf(out).filter((k) => SPANISH_KEYS.includes(k)), []);
});

test("parseArgs y run validan las órdenes y las herramientas", async () => {
  assert.equal(parseArgs(["apply", "--sin-runtimes"]).withRuntimes, false);
  assert.deepEqual(parseArgs(["apply", "--libs", "react,vue"]).libs, ["react", "vue"]);
  assert.throws(() => parseArgs(["apply", "--nope"]), SetupDocsRagError);
  await assert.rejects(run(["otra"]), (e) => e.code === 2);
  const empty = project([]);
  await assert.rejects(run(["detect", "--root", empty, "--home", homeOf(empty)]), /apm install/);
});

