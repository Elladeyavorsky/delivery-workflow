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
  unregisterServer,
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

test("detect da versiones del lockfile y runtimes", () => {
  const root = project();
  write(root, "package.json", { dependencies: { react: "^19.0.0" }, devDependencies: { typescript: "^5" } });
  write(root, "package-lock.json", { lockfileVersion: 3, packages: { "node_modules/react": { version: "19.1.0" }, "node_modules/typescript": { version: "5.6.0" } } });
  write(root, ".nvmrc", "20\n");
  write(root, "pyproject.toml", `[project]\nname = "x"\nrequires-python = ">=3.12"\ndependencies = ["fastapi>=0.110"]\n`);
  const inv = buildInventory({ root });
  const react = inv.dependencias.find((d) => d.paquete === "react");
  assert.deepEqual([react.version, react.origen, react.fuente], ["19.1.0", "lockfile", "package-lock.json"]);
  assert.deepEqual(inv.descartadas.map((d) => d.paquete), ["typescript"]);
  const fastapi = inv.dependencias.find((d) => d.paquete === "fastapi");
  assert.deepEqual([fastapi.version, fastapi.origen], ["0.110", "rango"]);
  assert.ok(inv.avisos.some((a) => a.includes("fastapi") && a.includes("mínima")));
  const rt = Object.fromEntries(inv.runtimes.map((r) => [r.paquete, r]));
  assert.equal(rt.node.version, "20");
  assert.equal(rt.node.origen, "fijado");
  assert.equal(rt.python.version, "3.12");
  assert.equal(rt.python.origen, "rango");
  assert.ok(inv.avisos.some((a) => a.includes("python") && a.includes("rango")));
  assert.ok(inv.runtimes.every((r) => r.ecosistema === "runtime"));
});

test("detectRuntimes: alias no se indexa, toolchain de Go y rust-toolchain", () => {
  const root = project();
  write(root, ".nvmrc", "lts/iron\n");
  write(root, "go.mod", "module x\n\ngo 1.22\n\ntoolchain go1.22.3\n");
  write(root, "rust-toolchain.toml", `[toolchain]\nchannel = "1.80.0"\n`);
  const { runtimes, avisos } = detectRuntimes(root);
  assert.deepEqual(runtimes.map((r) => [r.paquete, r.version]).sort(), [["go", "1.22.3"], ["rust", "1.80.0"]]);
  assert.ok(avisos.some((a) => a.includes("alias") && a.includes("lts/iron")));
});

test("un lockfile roto avisa y usa el rango", () => {
  const root = project();
  write(root, "package.json", { dependencies: { react: "^19.0.0" } });
  write(root, "package-lock.json", "{roto");
  const inv = buildInventory({ root });
  assert.equal(inv.dependencias[0].origen, "rango");
  assert.ok(inv.avisos.some((a) => a.includes("package-lock.json no se ha podido leer")));
});

test("buildRequest limita a las librerías confirmadas y quita runtimes si se pide", () => {
  const inv = { dependencias: [{ paquete: "react", ecosistema: "npm", version: "19.1.0" }, { paquete: "vue", ecosistema: "npm", version: "3.0.0" }, { paquete: "x", ecosistema: "npm", version: null }], runtimes: [{ paquete: "node", ecosistema: "runtime", version: "20", runtime: true }] };
  assert.deepEqual(buildRequest(inv).paquetes.map((p) => p.paquete), ["node", "react", "vue"]);
  assert.deepEqual(buildRequest(inv, { libs: ["react"], withRuntimes: false }).paquetes.map((p) => p.paquete), ["react"]);
});

test("registerServer pone docs-rag, quita context7 y no toca lo demás; unregister lo quita", () => {
  const root = project(["claude", "cursor", "codex"]);
  const home = homeOf(root);
  write(home, ".claude.json", { numStartups: 2, mcpServers: { context7: { type: "http", url: "u" }, otro: { command: "echo" } } });
  write(home, ".codex/config.toml", `[mcp_servers.context7]\nurl = "u"\n`);
  for (const tool of ["claude", "cursor", "codex"]) registerServer({ home, tool, uvPath: "/bin/uv" });
  const claude = JSON.parse(readHome(root, ".claude.json"));
  assert.equal(claude.numStartups, 2);
  assert.deepEqual(Object.keys(claude.mcpServers).sort(), ["docs-rag", "otro"]);
  assert.equal(claude.mcpServers["docs-rag"].type, "stdio");
  assert.ok(claude.mcpServers["docs-rag"].args.includes("docs_rag.servidor"));
  const cursor = JSON.parse(readHome(root, ".cursor/mcp.json")).mcpServers["docs-rag"];
  assert.deepEqual(cursor.args.slice(-2), ["--root", "${workspaceFolder}"]);
  const codex = readHome(root, ".codex/config.toml");
  assert.match(codex, /\[mcp_servers\."docs-rag"\]\ncommand = "\/bin\/uv"/);
  assert.doesNotMatch(codex, /context7/);
  assert.equal(registerServer({ home, tool: "claude", uvPath: "/bin/uv" }).result, "igual");
  unregisterServer({ home, tool: "claude" });
  assert.deepEqual(Object.keys(JSON.parse(readHome(root, ".claude.json")).mcpServers), ["otro"]);
  assert.equal(unregisterServer({ home, tool: "codex" }).result, "cambiado");
  assert.ok(!existsSync(join(home, ".codex/config.toml")), "solo tenía docs-rag");
});

test("serverEntry: el entorno de uv vive en la carpeta personal, no en el proyecto", () => {
  const e = serverEntry("codex", { uvPath: "uv", home: "/h" });
  assert.equal(e.env.UV_PROJECT_ENVIRONMENT.replace(/\\/g, "/"), "/h/.docs-rag/venv");
  assert.ok(e.args.join(" ").replace(/\\/g, "/").includes("/h/.docs-rag/app"));
});

test("ensureRagDir crea .docs-rag/.gitignore con * y es idempotente", () => {
  const root = project();
  ensureRagDir(root);
  ensureRagDir(root);
  assert.equal(readFileSync(join(root, ".docs-rag/.gitignore"), "utf8"), "*\n");
});

test("indexState resume el inventario del proyecto", () => {
  const root = project();
  assert.deepEqual(indexState(root), { existe: false });
  write(root, ".docs-rag/inventario.json", { coleccion: "docs_x", actualizado: "hoy", paquetes: { "npm:react": { paquete: "react", estado: "indexado", fragmentos: 10 }, "runtime:rust": { paquete: "rust", estado: "sin_doc", motivo: "no hay" } } });
  const s = indexState(root);
  assert.equal(s.indexados, 1);
  assert.equal(s.fragmentos, 10);
  assert.deepEqual(s.sin_doc, [{ paquete: "rust", motivo: "no hay" }]);
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
  assert.match(r.docker.detalle, /no responde/);
  assert.equal(r.modelo.ok, true);
  assert.match(r.uv.detalle, /no está instalado/);
});

test("parseArgs y run validan las órdenes y las herramientas", async () => {
  assert.equal(parseArgs(["apply", "--sin-runtimes"]).withRuntimes, false);
  assert.deepEqual(parseArgs(["apply", "--libs", "react,vue"]).libs, ["react", "vue"]);
  assert.throws(() => parseArgs(["apply", "--nope"]), SetupDocsRagError);
  await assert.rejects(run(["otra"]), (e) => e.code === 2);
  const empty = project([]);
  await assert.rejects(run(["detect", "--root", empty, "--home", homeOf(empty)]), /apm install/);
});
