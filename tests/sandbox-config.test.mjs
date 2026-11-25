import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOMAINS = ["api.github.com", "github.com"];
const MCP_FILES = [".mcp.json", ".cursor/mcp.json", ".codex/config.toml"];

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

test("mcp y codex iguales que staging", () => {
  const diff = spawnSync("git", ["diff", "--exit-code", "staging", "--", ...MCP_FILES], { cwd: root, encoding: "utf8" });
  assert.equal(diff.status, 0, `hay diferencias con staging:\n${diff.stdout}${diff.stderr}`);
});

const hasApm = spawnSync("apm", ["--version"], { encoding: "utf8" }).status === 0;
const hasRuby = spawnSync("ruby", ["-v"], { encoding: "utf8" }).status === 0;

test("apm install conserva claves", { skip: !hasApm ? "apm no está instalado" : !hasRuby ? "ruby no está instalado" : false }, () => {
  const work = mkdtempSync(join(tmpdir(), "delivery-workflow-sandbox-"));
  try {
    execFileSync("sh", ["-c",
      `tar -C "${root}" --exclude='./.git' --exclude='./.env' --exclude='./apm_modules' --exclude='./apm.lock.yaml' -cf - . | tar -C "${work}" -xf -`]);
    // Los despliegues locales de skills y agentes chocan con apm install: se
    // dejan solo los ficheros de configuración que la prueba comprueba.
    execFileSync("sh", ["-c",
      `cd "${work}" && rm -rf .agents .apm-local && for d in .claude .cursor .codex; do find "$d" -mindepth 1 -maxdepth 1 ! -name settings.json ! -name sandbox.json ! -name mcp.json ! -name config.toml -exec rm -rf {} +; done`]);
    // Como en tests/apm-audit.test.sh: sin dependencias externas.
    execFileSync("ruby", ["-ryaml", "-e",
      'p = ARGV[0]; m = YAML.load_file(p); m.delete("dependencies"); File.write(p, YAML.dump(m))',
      join(work, "apm.yml")]);
    const before = MCP_FILES.map((f) => existsSync(join(work, f)) ? readFileSync(join(work, f), "utf8") : null);
    execFileSync("apm", ["install", "--only", "apm", "--no-audit"], { cwd: work, stdio: "pipe" });
    checkClaude(work);
    checkCursor(work);
    const after = MCP_FILES.map((f) => existsSync(join(work, f)) ? readFileSync(join(work, f), "utf8") : null);
    assert.deepEqual(after, before, "apm install cambió algún fichero de MCP o Codex");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
