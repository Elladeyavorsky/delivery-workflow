import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOMAINS = ["api.github.com", "github.com"];
const MCP_FILES = [".mcp.json", ".cursor/mcp.json"];
const CODEX = ".codex/config.toml";
const FORBIDDEN_KEYS = ["sandbox_mode", "sandbox_workspace_write", "network_access"];

const PY_PARSE = "import sys, json, tomllib\nprint(json.dumps(tomllib.load(open(sys.argv[1], 'rb'))))";
const py = spawnSync("python3", ["-c", "import tomllib"], { encoding: "utf8" });
const hasToml = py.status === 0;
const tomlSkip = hasToml ? false : "python3 con tomllib (3.11+) no está disponible";
if (!hasToml) console.warn("AVISO: se saltan las comprobaciones de TOML: python3 con tomllib no está disponible");

function parseToml(base) {
  const out = execFileSync("python3", ["-c", PY_PARSE, join(base, CODEX)], { encoding: "utf8" });
  return JSON.parse(out);
}

// Bloque [mcp_servers.eur-lex] y sus subtablas, tal cual está escrito.
function eurLexBlock(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === "[mcp_servers.eur-lex]");
  assert.ok(start >= 0, "falta [mcp_servers.eur-lex]");
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s*\[+([^\]]+)\]+/);
    if (m && !m[1].trim().startsWith("mcp_servers.eur-lex")) { end = i; break; }
  }
  return lines.slice(start, end).join("\n").trimEnd();
}

function findKeys(node, names, path = "") {
  const found = [];
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (names.includes(k)) found.push(`${path}${k}`);
      found.push(...findKeys(v, names, `${path}${k}.`));
    }
  }
  return found;
}

function checkCodex(base) {
  const text = readFileSync(join(base, CODEX), "utf8");
  const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
  assert.equal(firstLine, 'default_permissions = "github-net"', "default_permissions debe ser la primera clave, antes de cualquier tabla");
  const c = parseToml(base);
  assert.equal(c.default_permissions, "github-net");
  assert.equal(c.features.network_proxy, true);
  const profile = c.permissions["github-net"];
  assert.equal(profile.extends, ":workspace");
  assert.equal(profile.network.enabled, true);
  assert.deepEqual(profile.network.domains, { "api.github.com": "allow", "github.com": "allow" });
  for (const d of Object.keys(profile.network.domains)) assert.ok(!d.includes("*"), "sin comodines");
  assert.deepEqual(Object.keys(c.permissions), ["github-net"], "solo el perfil github-net");
  assert.deepEqual(Object.keys(profile).sort(), ["extends", "network"], "el perfil no redefine permisos de ficheros");
  assert.deepEqual(Object.keys(profile.network).sort(), ["domains", "enabled"]);
  assert.deepEqual(findKeys(c, FORBIDDEN_KEYS), [], "claves prohibidas en la config de Codex");
  assert.deepEqual(c.mcp_servers["eur-lex"], parseStaging()["mcp_servers"]["eur-lex"]);
  assert.equal(eurLexBlock(text), eurLexBlock(stagingCodexText()), "el bloque eur-lex difiere de staging");
}

// La rama local staging y, si no existe (como en el CI), origin/staging.
function stagingRef() {
  const ref = ["refs/heads/staging", "refs/remotes/origin/staging"]
    .find((r) => spawnSync("git", ["rev-parse", "--verify", "--quiet", `${r}^{commit}`], { cwd: root }).status === 0);
  assert.ok(ref, "no hay ref base para comparar: no existe la rama local staging ni origin/staging (tráela con `git fetch origin staging`)");
  return ref;
}

function stagingCodexText() {
  return execFileSync("git", ["show", `${stagingRef()}:${CODEX}`], { cwd: root, encoding: "utf8" });
}

function parseStaging() {
  const out = execFileSync("python3", ["-c", "import sys, json, tomllib\nprint(json.dumps(tomllib.loads(sys.stdin.read())))"],
    { input: stagingCodexText(), encoding: "utf8" });
  return JSON.parse(out);
}

const readJson = (base, rel) => JSON.parse(readFileSync(join(base, rel), "utf8"));

function checkClaude(base) {
  const config = readJson(base, ".claude/settings.json");
  assert.deepEqual(config.sandbox.network.allowedDomains, DOMAINS);
  assert.ok(!("enabled" in config.sandbox), "no debe haber sandbox.enabled");
  for (const d of config.sandbox.network.allowedDomains) assert.ok(!d.includes("*"), "sin comodines");
}

function checkCursor(base) {
  const config = readJson(base, ".cursor/sandbox.json");
  assert.deepEqual(config.networkPolicy.allow, DOMAINS);
  assert.ok(!("default" in config.networkPolicy), "no debe haber networkPolicy.default");
  for (const d of config.networkPolicy.allow) assert.ok(!d.includes("*"), "sin comodines");
}

test("claude allowedDomains", () => {
  checkClaude(root);
});

test("cursor networkPolicy", () => {
  checkCursor(root);
});

test("mcp y bloque eur-lex iguales que staging", { skip: tomlSkip }, () => {
  const diff = spawnSync("git", ["diff", "--exit-code", stagingRef(), "--", ...MCP_FILES], { cwd: root, encoding: "utf8" });
  assert.equal(diff.status, 0, `hay diferencias con staging:\n${diff.stdout}${diff.stderr}`);
  assert.equal(eurLexBlock(readFileSync(join(root, CODEX), "utf8")), eurLexBlock(stagingCodexText()));
  assert.deepEqual(parseToml(root).mcp_servers["eur-lex"], parseStaging().mcp_servers["eur-lex"]);
});

test("codex perfil github-net", { skip: tomlSkip }, () => {
  checkCodex(root);
});

const hasApm = spawnSync("apm", ["--version"], { encoding: "utf8" }).status === 0;
const hasRuby = spawnSync("ruby", ["-v"], { encoding: "utf8" }).status === 0;

test("apm install conserva claves", { skip: !hasApm ? "apm no está instalado" : !hasRuby ? "ruby no está instalado" : tomlSkip }, () => {
  const work = mkdtempSync(join(tmpdir(), "delivery-workflow-sandbox-"));
  try {
    execFileSync("sh", ["-c",
      `tar -C "${root}" --exclude='./.git' --exclude='./.env' --exclude='./apm_modules' --exclude='./apm.lock.yaml' -cf - . | tar -C "${work}" -xf -`]);
    // Los despliegues locales de skills y agentes chocan con apm install: se
    // dejan solo los ficheros de configuración que la prueba comprueba.
    execFileSync("sh", ["-c",
      `cd "${work}" && rm -rf .agents .apm-local .opencode && for d in .claude .cursor .codex; do find "$d" -mindepth 1 -maxdepth 1 ! -name settings.json ! -name sandbox.json ! -name mcp.json ! -name config.toml -exec rm -rf {} +; done`]);
    // Como en tests/apm-audit.test.sh: sin dependencias externas.
    execFileSync("ruby", ["-ryaml", "-e",
      'p = ARGV[0]; m = YAML.load_file(p); m.delete("dependencies"); File.write(p, YAML.dump(m))',
      join(work, "apm.yml")]);
    const tracked = [...MCP_FILES, CODEX];
    const before = tracked.map((f) => existsSync(join(work, f)) ? readFileSync(join(work, f), "utf8") : null);
    execFileSync("apm", ["install", "--only", "apm", "--no-audit"], { cwd: work, stdio: "pipe" });
    checkClaude(work);
    checkCursor(work);
    checkCodex(work);
    const after = tracked.map((f) => existsSync(join(work, f)) ? readFileSync(join(work, f), "utf8") : null);
    assert.deepEqual(after, before, "apm install cambió algún fichero de MCP o el perfil de Codex");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
