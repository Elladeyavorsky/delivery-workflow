import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadProfiles,
  parseArgs,
  parseLibs,
  parsePackageJson,
  parseRequirements,
  parsePyproject,
  parseGoMod,
  parseCargo,
  classify,
  readDependencies,
  projectDirs,
  findManifests,
  setServerJson,
  removeServerJson,
  setServerToml,
  removeServerToml,
  setServerTomlBlock,
  tomlStdioBlock,
  serverStateIn,
  setRule,
  removeRule,
  ruleBlock,
  RULE_START,
  envFileHasKey,
  keyState,
  applyAll,
  run,
  SetupContext7Error,
} from "../.apm/skills/setup-context7/scripts/setup-context7.mjs";

const profiles = loadProfiles();

// Un proyecto desechable con las carpetas de agentes que se pidan.
function project(tools = ["cursor"]) {
  const root = mkdtempSync(join(tmpdir(), "c7-"));
  for (const t of tools) mkdirSync(join(root, `.${t}`, "agents"), { recursive: true });
  return root;
}
const read = (root, file) => readFileSync(join(root, file), "utf8");
// La config de usuario de cada prueba vive en una carpeta personal falsa, nunca en la de verdad.
const homeOf = (root) => join(root, "_home");
const readHome = (root, file) => read(homeOf(root), file);
const writeHome = (root, file, text) => {
  mkdirSync(join(homeOf(root), file, ".."), { recursive: true });
  writeFileSync(join(homeOf(root), file), text);
};
const exec = async (root, args) => JSON.parse(await run([...args, "--root", root, "--home", homeOf(root)]));

test("parseLibs separa por comas, quita duplicados y rechaza nombres raros", () => {
  assert.deepEqual(parseLibs("react, prisma,react,@tanstack/query"), ["react", "prisma", "@tanstack/query"]);
  assert.throws(() => parseLibs("buena,mala libreria"), /no válida/);
  assert.throws(() => parseLibs("`x`"), /no válida/);
  assert.deepEqual(parseLibs(""), []);
});

test("parseArgs lee --libs repetido, --with-key y rechaza lo desconocido", () => {
  const o = parseArgs(["apply", "--libs", "a,b", "--libs", "c", "--with-key", "--target", "cursor"]);
  assert.deepEqual(o.libs, ["a", "b", "c"]);
  assert.equal(o.withKey, true);
  assert.equal(o.target, "cursor");
  assert.equal(parseArgs(["detect"]).withKey, false);
  assert.throws(() => parseArgs(["detect", "--nope"]), SetupContext7Error);
});

test("package.json: dependencies y devDependencies; un JSON roto da exit 3", () => {
  const text = JSON.stringify({ dependencies: { react: "^19" }, devDependencies: { eslint: "^9", prisma: "^6" } });
  assert.deepEqual(parsePackageJson(text).sort(), ["eslint", "prisma", "react"]);
  assert.throws(() => parsePackageJson("{no"), (e) => e.code === 3);
});

test("requirements.txt: nombres sin versiones, extras, comentarios ni opciones", () => {
  const text = "# comentario\nDjango>=5.0  # web\nrequests[socks]==2.32\n-r otro.txt\nsome_pkg\ngit+https://x/y.git\n";
  assert.deepEqual(parseRequirements(text).sort(), ["django", "requests", "some-pkg"]);
});

test("pyproject.toml: [project].dependencies y Poetry, sin python", () => {
  const text = `[project]\nname = "x"\ndependencies = [\n  "fastapi>=0.110",\n  "pydantic",\n]\n\n[tool.poetry.dependencies]\npython = "^3.12"\nsqlalchemy = "^2"\n`;
  assert.deepEqual(parsePyproject(text).sort(), ["fastapi", "pydantic", "sqlalchemy"]);
});

test("go.mod: bloque require y require suelto, sin las indirectas", () => {
  const text = `module x\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.10.0\n\tgolang.org/x/sys v0.1.0 // indirect\n)\n\nrequire gorm.io/gorm v1.25.0\n`;
  assert.deepEqual(parseGoMod(text).sort(), ["github.com/gin-gonic/gin", "gorm.io/gorm"]);
});

test("Cargo.toml: dependencies, dev-dependencies y tablas en línea", () => {
  const text = `[package]\nname = "x"\n\n[dependencies]\ntokio = { version = "1" }\nserde.workspace = true\n\n[dev-dependencies]\ncriterion = "0.5"\n\n[dependencies.axum]\nversion = "0.7"\n`;
  assert.deepEqual(parseCargo(text).sort(), ["axum", "criterion", "serde", "tokio"]);
});

test("classify: solo se descartan tipos y utilidades de build; todo lo demás se sugiere, linters incluidos", () => {
  assert.equal(classify(profiles, "@types/node").status, "descartada");
  assert.equal(classify(profiles, "typescript").status, "descartada");
  assert.equal(classify(profiles, "rimraf").status, "descartada");
  assert.ok(classify(profiles, "typescript").why.length > 5);
  for (const name of ["react", "@prisma/client", "left-pad", "eslint", "prettier", "ruff"]) {
    assert.equal(classify(profiles, name).status, "sugerida", name);
  }
  assert.deepEqual(Object.keys(profiles), ["skip"]);
});

test("readDependencies junta manifiestos y no repite una librería", () => {
  const root = project();
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { react: "1", prisma: "1" }, devDependencies: { eslint: "1" } }));
  writeFileSync(join(root, "requirements.txt"), "fastapi\n");
  const { manifests, dependencies } = readDependencies({ root, profiles });
  assert.deepEqual(manifests.map((m) => m.file), ["package.json", "requirements.txt"]);
  const by = Object.fromEntries(dependencies.map((d) => [d.name, d.status]));
  assert.deepEqual(by, { react: "sugerida", prisma: "sugerida", eslint: "sugerida", fastapi: "sugerida" });
});

const writePkg = (root, dir, deps) => {
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, "package.json"), JSON.stringify({ dependencies: deps }));
};

test("projectDirs recorre hasta 3 niveles y se salta ocultas, node_modules y carpetas de build", () => {
  const root = project();
  for (const d of ["app", "app/src", "app/src/ui", "app/src/ui/deep", "node_modules/x", ".git/y", "dist", "packages/a"]) {
    mkdirSync(join(root, d), { recursive: true });
  }
  const dirs = projectDirs(root);
  assert.equal(dirs[0], "");
  assert.ok(dirs.includes("app") && dirs.includes("app/src") && dirs.includes("app/src/ui") && dirs.includes("packages/a"));
  assert.ok(!dirs.includes("app/src/ui/deep"), "nivel 4");
  assert.ok(!dirs.some((d) => d.includes("node_modules") || d.startsWith(".") || d === "dist"));
});

test("readDependencies encuentra el package.json de una subcarpeta y dice de dónde sale", () => {
  const root = project();
  writePkg(root, "app", { react: "19", typescript: "5" });
  const { manifests, dependencies } = readDependencies({ root, profiles });
  assert.deepEqual(manifests.map((m) => m.file), ["app/package.json"]);
  const react = dependencies.find((d) => d.name === "react");
  assert.deepEqual(react.sources, ["app/package.json"]);
  assert.equal(dependencies.find((d) => d.name === "typescript").status, "descartada");
});

test("una librería en varias carpetas sale una vez, con todas sus fuentes; la raíz va primero", () => {
  const root = project();
  writePkg(root, "", { react: "19" });
  writePkg(root, "web", { react: "19", vue: "3" });
  writePkg(root, "node_modules/dep", { fantasma: "1" });
  const { manifests, dependencies } = readDependencies({ root, profiles });
  assert.deepEqual(manifests.map((m) => m.file), ["package.json", "web/package.json"]);
  assert.deepEqual(dependencies.find((d) => d.name === "react").sources, ["package.json", "web/package.json"]);
  assert.ok(!dependencies.some((d) => d.name === "fantasma"));
});

test("un manifiesto roto en una subcarpeta no impide leer los demás y queda anotado", () => {
  const root = project();
  writePkg(root, "app", { react: "19" });
  mkdirSync(join(root, "otra"), { recursive: true });
  writeFileSync(join(root, "otra", "package.json"), "{roto");
  const { manifests, dependencies } = readDependencies({ root, profiles });
  assert.deepEqual(dependencies.map((d) => d.name), ["react"]);
  const broken = manifests.find((m) => m.file === "otra/package.json");
  assert.equal(broken.count, 0);
  assert.match(broken.error, /no es un JSON válido/);
});

// Un proyecto desechable que es un repo git (sin commits: basta con el índice y lo no ignorado).
function gitProject() {
  const root = project(["cursor"]);
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

test("con git, findManifests llega a cualquier profundidad y respeta .gitignore", () => {
  const root = gitProject();
  writeFileSync(join(root, ".gitignore"), "node_modules/\ngenerado/\n");
  writePkg(root, "a/b/c/d/e", { react: "19" });
  writePkg(root, "node_modules/dep", { fantasma: "1" });
  writePkg(root, "generado", { otro: "1" });
  assert.deepEqual(findManifests(root).map((m) => m.rel), ["a/b/c/d/e/package.json"]);
});

test("con git, un manifiesto nuevo sin añadir cuenta, uno borrado no, y vendor y ocultas se saltan aunque estén versionados", () => {
  const root = gitProject();
  writePkg(root, "web", { vue: "3" });
  writePkg(root, "vendor/lib", { fantasma: "1" });
  writePkg(root, ".hidden", { fantasma: "1" });
  writePkg(root, "viejo", { fantasma: "1" });
  execFileSync("git", ["add", "-f", "."], { cwd: root });
  rmSync(join(root, "viejo"), { recursive: true });
  writePkg(root, "nuevo", { react: "19" });
  const { manifests } = readDependencies({ root, profiles });
  assert.deepEqual(manifests.map((m) => m.file), ["nuevo/package.json", "web/package.json"]);
});

test("con git, el orden es la raíz primero, luego por nivel y carpeta", () => {
  const root = gitProject();
  writePkg(root, "z", { a: "1" });
  writePkg(root, "a/b", { a: "1" });
  writePkg(root, "", { a: "1" });
  writeFileSync(join(root, "go.mod"), "module x\n");
  assert.deepEqual(findManifests(root).map((m) => m.rel), ["package.json", "go.mod", "z/package.json", "a/b/package.json"]);
});

test("sin git, findManifests recorre las carpetas hasta 3 niveles", () => {
  const root = project();
  writePkg(root, "a/b/c", { react: "19" });
  writePkg(root, "a/b/c/d", { fantasma: "1" });
  assert.deepEqual(findManifests(root).map((m) => m.rel), ["a/b/c/package.json"]);
});

test("detect por la CLI encuentra las dependencias de una subcarpeta", async () => {
  const root = project(["cursor"]);
  writePkg(root, "desktop", { electron: "30", react: "19" });
  const out = await exec(root, ["detect"]);
  assert.deepEqual(out.manifests.map((m) => m.file), ["desktop/package.json"]);
  assert.deepEqual(out.dependencies.map((d) => d.name).sort(), ["electron", "react"]);
});

test("setServerJson crea el archivo, conserva otros MCP y es idempotente", () => {
  const entry = { url: "https://x/mcp" };
  const a = setServerJson(null, entry);
  assert.equal(a.result, "cambiado");
  assert.deepEqual(JSON.parse(a.text), { mcpServers: { context7: entry } });
  const withOther = JSON.stringify({ theme: "x", mcpServers: { otro: { command: "echo" } } });
  const b = setServerJson(withOther, entry);
  assert.deepEqual(JSON.parse(b.text), { theme: "x", mcpServers: { otro: { command: "echo" }, context7: entry } });
  const c = setServerJson(b.text, entry);
  assert.equal(c.result, "igual");
  assert.equal(c.text, b.text);
});

test("setServerJson con un JSON inválido sale con 3 y no devuelve texto", () => {
  assert.throws(() => setServerJson("{roto", { url: "x" }, ".mcp.json"), (e) => e.code === 3 && /\.mcp\.json/.test(e.message));
  assert.throws(() => setServerJson('{"mcpServers": []}', { url: "x" }), (e) => e.code === 3);
  assert.throws(() => setServerJson("[1]", { url: "x" }), (e) => e.code === 3);
});

test("removeServerJson quita solo context7 y deja vacío si no queda nada", () => {
  const both = JSON.stringify({ mcpServers: { context7: { url: "x" }, otro: { command: "echo" } } });
  assert.deepEqual(JSON.parse(removeServerJson(both).text), { mcpServers: { otro: { command: "echo" } } });
  assert.equal(removeServerJson(JSON.stringify({ mcpServers: { context7: { url: "x" } } })).text, "");
  assert.equal(removeServerJson(null).result, "ausente");
  assert.equal(removeServerJson('{"mcpServers":{}}').result, "igual");
});

test("setServerToml añade la tabla al final sin tocar las demás y es idempotente", () => {
  const original = `model = "gpt-5"\n\n[mcp_servers.otro]\ncommand = "echo"\n`;
  const a = setServerToml(original, false);
  assert.ok(a.text.startsWith(original.trimEnd()));
  assert.match(a.text, /\[mcp_servers\.context7\]\nurl = "https:\/\/mcp\.context7\.com\/mcp"\n$/);
  assert.doesNotMatch(a.text, /bearer_token_env_var/);
  assert.equal(setServerToml(a.text, false).result, "igual");
  const b = setServerToml(a.text, true);
  assert.equal(b.result, "cambiado");
  assert.match(b.text, /bearer_token_env_var = "CONTEXT7_API_KEY"/);
  assert.equal((b.text.match(/\[mcp_servers\.context7\]/g) ?? []).length, 1);
});

test("setServerToml respeta CRLF y no se confunde con un [mcp_servers.context7] dentro de una cadena multilínea", () => {
  const crlf = setServerToml('a = 1\r\n', false);
  assert.ok(crlf.text.includes("\r\n") && !/[^\r]\n/.test(crlf.text));
  const tricky = `note = """\n[mcp_servers.context7]\nurl = "falso"\n"""\n`;
  const out = setServerToml(tricky, false);
  assert.ok(out.text.startsWith(tricky.trimEnd()));
  assert.match(out.text, /url = "falso"/);
  assert.match(out.text, /\n\[mcp_servers\.context7\]\nurl = "https/);
});

test("removeServerToml quita la tabla de context7 y sus subtablas, y deja las demás", () => {
  const text = `[mcp_servers.otro]\ncommand = "echo"\n\n[mcp_servers.context7]\nurl = "x"\n\n[mcp_servers.context7.env]\nA = "1"\n\n[otra]\nk = 1\n`;
  const out = removeServerToml(text);
  assert.equal(out.text, `[mcp_servers.otro]\ncommand = "echo"\n\n[otra]\nk = 1\n`);
  assert.doesNotMatch(out.text, /context7/);
  assert.match(out.text, /\[mcp_servers\.otro\]/);
  assert.match(out.text, /\[otra\]\nk = 1/);
  assert.equal(removeServerToml(null).result, "ausente");
});

test("setRule crea, añade al final, reemplaza el bloque y conserva el resto", () => {
  const created = setRule(null, ["react"]);
  assert.ok(created.text.startsWith(RULE_START));
  assert.match(created.text, /- react/);
  const original = "# Mi proyecto\n\nTexto mío.\n";
  const added = setRule(original, ["react", "prisma"]);
  assert.ok(added.text.startsWith(original));
  assert.match(added.text, /- prisma/);
  const replaced = setRule(`${added.text}\n## Después\nOtra cosa.\n`, ["vue"]);
  assert.match(replaced.text, /- vue/);
  assert.doesNotMatch(replaced.text, /- react/);
  assert.match(replaced.text, /## Después\nOtra cosa\./);
  assert.equal(setRule(replaced.text, ["vue"]).result, "igual");
});

test("removeRule quita el bloque, deja el texto del usuario y vacía lo que solo era el bloque", () => {
  const withText = setRule("# Mi proyecto\n\nTexto.\n", ["react"]).text;
  assert.equal(removeRule(withText).text, "# Mi proyecto\n\nTexto.\n");
  assert.equal(removeRule(`${ruleBlock(["x"])}\n`).text, "");
  assert.equal(removeRule("sin bloque\n").result, "igual");
  assert.equal(removeRule(null).result, "ausente");
});

test("apply escribe config y regla en Cursor, y un segundo apply no cambia nada", async () => {
  const root = project(["cursor"]);
  const [r1] = await exec(root, ["apply", "--libs", "react,prisma"]);
  assert.equal(r1.config.result, "cambiado");
  assert.equal(r1.rule.result, "cambiado");
  const cfg = JSON.parse(readHome(root, ".cursor/mcp.json"));
  assert.deepEqual(cfg.mcpServers.context7, { url: "https://mcp.context7.com/mcp" });
  assert.match(read(root, "AGENTS.md"), /- react\n- prisma/);
  const before = [readHome(root, ".cursor/mcp.json"), read(root, "AGENTS.md")];
  const [r2] = await exec(root, ["apply", "--libs", "react,prisma"]);
  assert.equal(r2.config.result, "igual");
  assert.equal(r2.rule.result, "igual");
  assert.deepEqual([readHome(root, ".cursor/mcp.json"), read(root, "AGENTS.md")], before);
});

test("apply sin --libs escribe solo la config y lo dice", async () => {
  const root = project(["cursor"]);
  const [r] = await exec(root, ["apply"]);
  assert.equal(r.rule, null);
  assert.ok(r.notes.some((n) => n.includes("--libs")));
  assert.ok(!existsSync(join(root, "AGENTS.md")));
});

test("con --with-key cada herramienta usa su sintaxis y el valor de la clave nunca se escribe", async () => {
  const root = project(["cursor", "claude", "codex"]);
  const secret = "ctx7sk-no-debe-aparecer";
  process.env.CONTEXT7_API_KEY = secret;
  try {
    const out = await exec(root, ["apply", "--with-key", "--libs", "react"]);
    assert.equal(out.length, 3);
  } finally {
    delete process.env.CONTEXT7_API_KEY;
  }
  assert.equal(JSON.parse(readHome(root, ".cursor/mcp.json")).mcpServers.context7.headers.Authorization, "Bearer ${env:CONTEXT7_API_KEY}");
  const claude = JSON.parse(readHome(root, ".claude.json")).mcpServers.context7;
  assert.equal(claude.type, "http");
  assert.equal(claude.headers.Authorization, "Bearer ${CONTEXT7_API_KEY}");
  assert.match(readHome(root, ".codex/config.toml"), /bearer_token_env_var = "CONTEXT7_API_KEY"/);
  for (const f of [".cursor/mcp.json", ".claude.json", ".codex/config.toml"]) {
    assert.ok(!readHome(root, f).includes(secret), `${f} contiene la clave`);
  }
  for (const f of ["AGENTS.md", "CLAUDE.md"]) {
    assert.ok(!read(root, f).includes(secret), `${f} contiene la clave`);
  }
});

test("envFileHasKey lee el .env sin ejecutarlo: export, comillas, comentarios y valor vacío", () => {
  assert.equal(envFileHasKey("A=1\nCONTEXT7_API_KEY=abc\n"), true);
  assert.equal(envFileHasKey('export CONTEXT7_API_KEY="abc" # mía\n'), true);
  assert.equal(envFileHasKey("CONTEXT7_API_KEY=\n"), false);
  assert.equal(envFileHasKey('CONTEXT7_API_KEY=""\n'), false);
  assert.equal(envFileHasKey("# CONTEXT7_API_KEY=abc\n"), false);
  assert.equal(envFileHasKey("OTRA_CONTEXT7_API_KEY=abc\n"), false);
  assert.equal(envFileHasKey("GITHUB_TOKEN=x\n"), false);
});

test("keyState dice si la clave está en el .env, en la terminal y si git ignora el .env, sin devolver el valor", async () => {
  const root = project(["cursor"]);
  execFileSync("git", ["init", "-q"], { cwd: root });
  assert.deepEqual(await keyState(root, {}), { inEnv: false, inShell: false, envIgnored: null });
  writeFileSync(join(root, ".env"), "CONTEXT7_API_KEY=ctx7sk-secreto\n");
  const open = await keyState(root, { CONTEXT7_API_KEY: "x" });
  assert.deepEqual(open, { inEnv: true, inShell: true, envIgnored: false });
  writeFileSync(join(root, ".gitignore"), ".env\n");
  assert.equal((await keyState(root, {})).envIgnored, true);
  assert.ok(!JSON.stringify(await keyState(root, {})).includes("ctx7sk-secreto"));
});

test("--with-key sin la clave en el .env ni en la terminal avisa de dónde ponerla", async () => {
  const root = project(["cursor"]);
  const out = applyAll({ root, home: homeOf(root), tools: ["cursor"], libs: [], withKey: true, key: { inEnv: false, inShell: false, envIgnored: null } });
  assert.ok(out[0].notes.some((n) => n.includes("no está en tu .env ni en esta terminal")));
});

test("--with-key con la clave solo en el .env explica cómo cargarla y avisa si el .env no está ignorado", async () => {
  const root = project(["cursor", "claude"]);
  const out = applyAll({ root, home: homeOf(root), tools: ["cursor", "claude"], libs: [], withKey: true, key: { inEnv: true, inShell: false, envIgnored: false } });
  for (const r of out) assert.ok(r.notes.some((n) => n.includes("set -a; source .env; set +a")));
  assert.equal(out.filter((r) => r.notes.some((n) => n.includes(".gitignore"))).length, 1, "el aviso del .gitignore sale una vez");
});

test("con la clave ya en la terminal no hace falta cargar el .env", () => {
  const root = project(["cursor"]);
  const out = applyAll({ root, home: homeOf(root), tools: ["cursor"], libs: [], withKey: true, key: { inEnv: true, inShell: true, envIgnored: true } });
  assert.ok(!out[0].notes.some((n) => n.includes("source .env")));
});

test("sin --with-key, si la clave está en el .env, sugiere usarla", () => {
  const root = project(["cursor"]);
  const out = applyAll({ root, home: homeOf(root), tools: ["cursor"], libs: [], withKey: false, key: { inEnv: true, inShell: false, envIgnored: true } });
  assert.ok(out[0].notes.some((n) => n.includes("repite con --with-key")));
});

test("detect incluye el estado de la clave y nunca su valor", async () => {
  const root = project(["cursor"]);
  writeFileSync(join(root, ".env"), "CONTEXT7_API_KEY=ctx7sk-secreto\n");
  const raw = await run(["detect", "--root", root]);
  assert.equal(JSON.parse(raw).key.inEnv, true);
  assert.ok(!raw.includes("ctx7sk-secreto"));
});

test("apply no pisa otros MCP del archivo", async () => {
  const root = project(["claude"]);
  writeHome(root, ".claude.json", JSON.stringify({ numStartups: 3, mcpServers: { github: { type: "http", url: "https://g/mcp" } } }));
  await exec(root, ["apply"]);
  const cfg = JSON.parse(readHome(root, ".claude.json"));
  assert.deepEqual(Object.keys(cfg.mcpServers).sort(), ["context7", "github"]);
  assert.equal(cfg.numStartups, 3, "conserva las demás claves de ~/.claude.json");
  assert.ok(!existsSync(join(root, ".mcp.json")), "no escribe en el proyecto");
});

test("un JSON inválido en la config sale con 3 y no escribe nada más", async () => {
  const root = project(["cursor"]);
  writeHome(root, ".cursor/mcp.json", "{roto");
  await assert.rejects(exec(root, ["apply", "--libs", "react"]), (e) => e.code === 3);
  assert.equal(readHome(root, ".cursor/mcp.json"), "{roto");
  assert.ok(!existsSync(join(root, "AGENTS.md")));
});

test("Cursor y Codex comparten AGENTS.md: reset de uno conserva la regla, reset del otro la quita", async () => {
  const root = project(["cursor", "codex"]);
  writeFileSync(join(root, "AGENTS.md"), "# Reglas mías\n");
  await exec(root, ["apply", "--libs", "react"]);
  assert.equal((read(root, "AGENTS.md").match(new RegExp(RULE_START, "g")) ?? []).length, 1);
  await exec(root, ["reset", "--target", "cursor"]);
  assert.ok(read(root, "AGENTS.md").includes(RULE_START), "codex sigue usando Context7");
  assert.ok(!existsSync(join(homeOf(root), ".cursor/mcp.json")));
  await exec(root, ["reset", "--target", "codex"]);
  assert.equal(read(root, "AGENTS.md"), "# Reglas mías\n");
  assert.ok(!existsSync(join(homeOf(root), ".codex/config.toml")), "el archivo solo tenía la tabla de Context7");
});

test("reset deja los archivos como estaban antes de apply", async () => {
  const root = project(["claude"]);
  writeHome(root, ".claude.json", `${JSON.stringify({ mcpServers: { github: { type: "http", url: "u" } } }, null, 2)}\n`);
  writeFileSync(join(root, "CLAUDE.md"), "# Mi proyecto\n");
  const before = [readHome(root, ".claude.json"), read(root, "CLAUDE.md")];
  await exec(root, ["apply", "--libs", "react"]);
  const [r] = await exec(root, ["reset"]);
  assert.equal(r.config.result, "cambiado");
  assert.deepEqual([readHome(root, ".claude.json"), read(root, "CLAUDE.md")], before);
});

test("detect junta dependencias, herramientas y estado, y no escribe nada", async () => {
  const root = project(["cursor", "claude"]);
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { react: "1", prisma: "1" }, devDependencies: { eslint: "1", typescript: "5" } }));
  const out = await exec(root, ["detect"]);
  const by = Object.fromEntries(out.dependencies.map((d) => [d.name, d.status]));
  assert.deepEqual(by, { react: "sugerida", prisma: "sugerida", eslint: "sugerida", typescript: "descartada" });
  assert.deepEqual(out.tools.map((t) => [t.tool, t.configured, t.channel]), [["cursor", false, "none"], ["claude", false, "none"]]);
  assert.ok(!existsSync(join(homeOf(root), ".cursor/mcp.json")));
  await exec(root, ["apply", "--target", "cursor", "--libs", "react"]);
  const after = await exec(root, ["detect"]);
  const cursor = after.tools.find((t) => t.tool === "cursor");
  assert.equal(cursor.configured, true);
  assert.equal(cursor.channel, "context7");
  assert.equal(cursor.configFile, "~/.cursor/mcp.json");
  assert.equal(cursor.rule, true);
  assert.equal(cursor.withKey, false);
});

test("--target rechaza una herramienta desconocida o sin carpeta, y sin carpetas de agentes explica qué hacer", async () => {
  const root = project(["cursor"]);
  await assert.rejects(exec(root, ["apply", "--target", "vim"]), (e) => e.code === 2);
  await assert.rejects(exec(root, ["apply", "--target", "codex"]), (e) => e.code === 3);
  await assert.rejects(exec(project([]), ["apply"]), /apm install/);
  await assert.rejects(run(["otra"]), (e) => e.code === 2);
});

test("apply registra context7 en la config de usuario y quita docs-rag", async () => {
  const root = project(["claude", "codex"]);
  writeHome(root, ".claude.json", JSON.stringify({ mcpServers: { otro: { command: "echo" }, "docs-rag": { command: "uv" } } }));
  writeHome(root, ".codex/config.toml", `[mcp_servers."docs-rag"]\ncommand = "uv"\n\n[mcp_servers.otro]\ncommand = "echo"\n`);
  const out = await exec(root, ["apply"]);
  for (const r of out) {
    assert.deepEqual(r.config.removed, ["docs-rag"]);
    assert.ok(r.notes.some((n) => n.includes("versión anterior")));
  }
  const claude = JSON.parse(readHome(root, ".claude.json")).mcpServers;
  assert.deepEqual(Object.keys(claude).sort(), ["context7", "otro"]);
  const codex = readHome(root, ".codex/config.toml");
  assert.doesNotMatch(codex, /docs-rag/);
  assert.match(codex, /\[mcp_servers\.otro\]/);
  assert.match(codex, /\[mcp_servers\.context7\]/);
  assert.ok(!existsSync(join(root, ".mcp.json")) && !existsSync(join(root, ".codex/config.toml")), "nada en el proyecto");
  const detect = await exec(root, ["detect"]);
  assert.deepEqual(detect.tools.map((t) => t.channel), ["context7", "context7"]);
});

test("detect y apply avisan de un context7 antiguo en la config del proyecto sin tocarlo", async () => {
  const root = project(["claude"]);
  const legacy = JSON.stringify({ mcpServers: { context7: { type: "http", url: "https://mcp.context7.com/mcp" } } });
  writeFileSync(join(root, ".mcp.json"), legacy);
  const detect = await exec(root, ["detect"]);
  assert.equal(detect.tools[0].legacyProjectConfig, ".mcp.json");
  const [r] = await exec(root, ["apply"]);
  assert.ok(r.notes.some((n) => n.includes(".mcp.json del proyecto")));
  assert.equal(read(root, ".mcp.json"), legacy);
});

test("las tablas TOML con guion van entre comillas y se reconocen al quitarlas", () => {
  const block = tomlStdioBlock("docs-rag", { command: "uv", args: ["run", "x"], env: { A: "1" } });
  assert.deepEqual(block, ['[mcp_servers."docs-rag"]', 'command = "uv"', 'args = ["run", "x"]', 'env = { A = "1" }']);
  const set = setServerTomlBlock("a = 1\n", "docs-rag", block);
  assert.equal(serverStateIn(set.text, "toml", "docs-rag").configured, true);
  assert.equal(setServerTomlBlock(set.text, "docs-rag", block).result, "igual");
  assert.equal(removeServerToml(set.text, "docs-rag").text, "a = 1\n");
});
