import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ASSETS_DIR,
  SetupDiscordError,
  detectAll,
  environmentState,
  fileState,
  loadEnv,
  makeGh,
  managedFiles,
  marker,
  parseArgs,
  parseEnv,
  remoteRepository,
  render,
  repoInfo,
  run,
} from "../.apm/skills/setup-discord-notifications/scripts/setup-discord-notifications.mjs";
import {
  RELATION_LIFETIME_MS,
  parseMappingComment,
} from "../.apm/skills/setup-discord-notifications/assets/discord-pr-notifications/confirmed-relations.mjs";
import { parseUserMap } from "../.apm/skills/setup-discord-notifications/assets/discord-pr-notifications/user-map.mjs";

const SKILL = new URL("../.apm/skills/setup-discord-notifications/", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, SKILL), "utf8");
const notFound = () => Object.assign(new SetupDiscordError("HTTP 404: Not Found", 4), { stderr: "HTTP 404: Not Found" });

// Un proyecto desechable con git y el remoto indicado.
function project({ remote = "https://github.com/acme/app.git", env } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sdn-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  if (remote) execFileSync("git", ["remote", "add", "origin", remote], { cwd: root });
  if (env !== undefined) writeFileSync(join(root, ".env"), env);
  return root;
}

// gh doble: registra las llamadas y responde según el comando.
function fakeGh({ environment = false, secrets = [], variables = [] } = {}) {
  const calls = [];
  const exec = async (args, opts = {}) => {
    calls.push({ args, input: opts.input, env: opts.env });
    const [a, b] = args;
    if (a === "repo" && b === "view") return JSON.stringify({ nameWithOwner: "acme/app", defaultBranchRef: { name: "main" } });
    if (a === "api" && /\/environments\//.test(args[1])) {
      if (!environment) throw notFound();
      return "";
    }
    if (a === "secret" && b === "list") return JSON.stringify(secrets.map((name) => ({ name })));
    if (a === "variable" && b === "list") return JSON.stringify(variables.map((name) => ({ name })));
    throw new Error(`llamada inesperada: ${args.join(" ")}`);
  };
  return { exec, calls };
}

test("parseArgs lee la orden y las opciones, con 1 revisor por defecto", () => {
  const o = parseArgs(["detect"]);
  assert.equal(o.command, "detect");
  assert.equal(o.minimumReviewers, 1);
  assert.equal(o.removeEnvironment, false);
  const p = parseArgs(["apply", "--root", "/x", "--base", "staging", "--guild-id", "123", "--channel-id", "456", "--minimum-reviewers", "2", "--remove-environment"]);
  assert.deepEqual(p, { command: "apply", root: "/x", base: "staging", guildId: "123", channelId: "456", minimumReviewers: 2, removeEnvironment: true });
});

test("parseArgs rechaza IDs no numéricos, mínimos menores que 1 y argumentos desconocidos", () => {
  assert.throws(() => parseArgs(["apply", "--guild-id", "abc"]), /--guild-id debe ser numérico/);
  assert.throws(() => parseArgs(["apply", "--channel-id", "12x"]), /--channel-id debe ser numérico/);
  assert.throws(() => parseArgs(["apply", "--channel-id"]), /numérico/);
  assert.throws(() => parseArgs(["apply", "--minimum-reviewers", "0"]), /1 o más/);
  assert.throws(() => parseArgs(["apply", "--minimum-reviewers", "-1"]), /numérico/);
  assert.throws(() => parseArgs(["detect", "--nope"]), /Argumento desconocido/);
});

test("parseEnv lee comillas, export, comentarios y descarta vacíos", () => {
  const v = parseEnv(['A=1', 'export B="dos # no"', "C='tres'", "D=cuatro # nota", "E=", "# F=x", "  G = siete ", "1X=no"].join("\r\n"));
  assert.deepEqual(v, { A: "1", B: "dos # no", C: "tres", D: "cuatro", G: "siete" });
});

test("loadEnv devuelve solo los dos valores y avisa si no hay .env", () => {
  const sin = loadEnv(project());
  assert.deepEqual(sin, { GITHUB_TOKEN: null, DISCORD_BOT_TOKEN: null, exists: false });
  const con = loadEnv(project({ env: "GITHUB_TOKEN=ghp_x\nDISCORD_BOT_TOKEN=bot\nOTRA=1\n" }));
  assert.deepEqual(con, { GITHUB_TOKEN: "ghp_x", DISCORD_BOT_TOKEN: "bot", exists: true });
});

test("makeGh pone el token en el entorno, nunca en los argumentos, y el cuerpo por input", async () => {
  const seen = [];
  const gh = makeGh({ token: "tok123", exec: async (args, opts) => (seen.push({ args, ...opts }), "ok") });
  assert.equal(await gh(["secret", "set", "X", "--env", "e"], { input: "valor-secreto" }), "ok");
  assert.equal(seen[0].input, "valor-secreto");
  assert.equal(seen[0].env.GH_TOKEN, "tok123");
  assert.equal(seen[0].env.GITHUB_TOKEN, "tok123");
  assert.ok(!seen[0].args.join(" ").includes("tok123"));
  assert.ok(!seen[0].args.join(" ").includes("valor-secreto"));
  const sinToken = makeGh({ token: null, exec: async (args, opts) => (seen.push(opts), "") });
  await sinToken(["x"]);
  assert.deepEqual(seen.at(-1).env, {});
});

test("repoInfo devuelve owner/repo y la rama predeterminada", async () => {
  const { exec } = fakeGh();
  assert.deepEqual(await repoInfo(makeGh({ token: "t", exec })), { repository: "acme/app", defaultBranch: "main" });
  const vacio = makeGh({ token: "t", exec: async () => JSON.stringify({ nameWithOwner: "a/b", defaultBranchRef: null }) });
  assert.deepEqual(await repoInfo(vacio), { repository: "a/b", defaultBranch: null });
});

test("remoteRepository acepta remotos de GitHub y rechaza el resto o su ausencia", async () => {
  for (const url of ["https://github.com/acme/app.git", "https://github.com/acme/app", "https://user@github.com/acme/app.git", "git@github.com:acme/app.git", "ssh://git@github.com/acme/app.git"]) {
    assert.equal(await remoteRepository(project({ remote: url })), "acme/app", url);
  }
  await assert.rejects(remoteRepository(project({ remote: "https://gitlab.com/acme/app.git" })), /no es de GitHub/);
  await assert.rejects(remoteRepository(project({ remote: "https://github.com.evil.io/acme/app.git" })), /no es de GitHub/);
  await assert.rejects(remoteRepository(project({ remote: null })), /No hay remoto origin/);
});

test("environmentState: sin entorno todo falta; con entorno marca secretos y variables", async () => {
  const sin = fakeGh();
  assert.deepEqual(await environmentState(makeGh({ token: "t", exec: sin.exec }), "acme/app"), {
    exists: false,
    secrets: { DISCORD_BOT_TOKEN: false, DISCORD_CACHE_KEY: false },
    variables: { DISCORD_GUILD_ID: false, DISCORD_GIT_CHANNEL_ID: false },
  });
  const con = fakeGh({ environment: true, secrets: ["DISCORD_BOT_TOKEN", "OTRO"], variables: ["DISCORD_GUILD_ID"] });
  assert.deepEqual(await environmentState(makeGh({ token: "t", exec: con.exec }), "acme/app"), {
    exists: true,
    secrets: { DISCORD_BOT_TOKEN: true, DISCORD_CACHE_KEY: false },
    variables: { DISCORD_GUILD_ID: true, DISCORD_GIT_CHANNEL_ID: false },
  });
  const roto = makeGh({ token: "t", exec: async () => { throw new SetupDiscordError("HTTP 500", 4); } });
  await assert.rejects(environmentState(roto, "acme/app"), /500/);
});

test("marker y render: marca de la primera línea con el hash del resto", () => {
  const body = "a: 1\n";
  assert.match(marker(body), /^# setup-discord-notifications sha256=[0-9a-f]{64}$/);
  assert.match(marker(body, "x.mjs"), /^\/\/ setup-discord-notifications/);
  const out = render("repo: {{REPOSITORY}}\nbase: {{BASE_BRANCH}}\nexpr: ${{ github.sha }}\nlibre: {{OTRO}}\n", { REPOSITORY: "acme/app", BASE_BRANCH: "staging" });
  const [first, ...rest] = out.split("\n");
  assert.equal(first, marker(rest.join("\n")));
  assert.match(out, /repo: acme\/app\nbase: staging\nexpr: \$\{\{ github\.sha \}\}\nlibre: \{\{OTRO\}\}/);
});

test("fileState: ausente, igual, y editado sin marca, con hash roto o con el cuerpo cambiado", () => {
  assert.equal(fileState(null), "ausente");
  const ok = render("x: {{BASE_BRANCH}}\n", { BASE_BRANCH: "main" });
  assert.equal(fileState(ok), "igual");
  assert.equal(fileState("x: main\n"), "editado");
  assert.equal(fileState(ok.replace("x: main", "x: dev")), "editado");
  assert.equal(fileState(ok.replace(/sha256=[0-9a-f]/, "sha256=z")), "editado");
  assert.equal(fileState(ok.replace(/\n/, "\r\n")), "igual");
  assert.equal(fileState("sin salto"), "editado");
});

test("managedFiles lista los tres workflows y la acción completa", () => {
  const files = managedFiles();
  const rels = files.map((f) => f.rel);
  for (const w of ["discord-pr-trigger.yml", "discord-pr-confirmation-trigger.yml", "discord-pr-publish.yml"]) {
    assert.ok(rels.includes(join(".github", "workflows", w)), w);
  }
  const action = readdirSync(join(ASSETS_DIR, "discord-pr-notifications"));
  assert.equal(rels.filter((r) => r.includes("actions")).length, action.length);
  assert.ok(rels.includes(join(".github", "actions", "discord-pr-notifications", "action.yml")));
  for (const f of files) assert.ok(readFileSync(f.source, "utf8").length > 0, f.source);
});

test("detectAll sin .env informa de que gh no puede usarse y no llama a gh", async () => {
  const root = project();
  const { exec, calls } = fakeGh();
  const env = loadEnv(root);
  const r = await detectAll({ root, gh: makeGh({ token: env.GITHUB_TOKEN, exec }), remote: "acme/app", env });
  assert.equal(r.gh.available, false);
  assert.match(r.gh.reason, /Falta el \.env/);
  assert.equal(calls.length, 0);
  assert.equal(r.repository, "acme/app");
  assert.ok(r.files.every((f) => f.state === "ausente"));
  assert.deepEqual(r.botToken, { inEnv: false });
  assert.deepEqual(r.environment, {
    exists: false,
    secrets: { DISCORD_BOT_TOKEN: false, DISCORD_CACHE_KEY: false },
    variables: { DISCORD_GUILD_ID: false, DISCORD_GIT_CHANNEL_ID: false },
  });
  const sinToken = project({ env: "OTRA=1\n" });
  const r2 = await detectAll({ root: sinToken, gh: makeGh({ token: null, exec }), remote: "acme/app", env: loadEnv(sinToken) });
  assert.match(r2.gh.reason, /no tiene GITHUB_TOKEN/);
});

test("detectAll con gh que falla da el motivo y sigue con los ficheros", async () => {
  const root = project({ env: "GITHUB_TOKEN=t\n" });
  const gh = makeGh({ token: "t", exec: async () => { throw new SetupDiscordError("HTTP 403: Forbidden", 4); } });
  const r = await detectAll({ root, gh, remote: "acme/app", env: loadEnv(root) });
  assert.equal(r.gh.available, false);
  assert.match(r.gh.reason, /403/);
  assert.equal(r.files.length, managedFiles().length);
  const ausente = makeGh({ token: "t", exec: async () => { throw Object.assign(new SetupDiscordError("x", 4), { missing: true }); } });
  assert.match((await detectAll({ root, gh: ausente, remote: "a/b", env: loadEnv(root) })).gh.reason, /no está instalado/);
});

test("detect devuelve repositorio, rama, ficheros y entorno, sin escribir ni exponer secretos", async () => {
  const root = project({ env: "GITHUB_TOKEN=ghp_proyecto\nDISCORD_BOT_TOKEN=bot-super-secreto\n" });
  const wf = join(root, ".github", "workflows");
  mkdirSync(wf, { recursive: true });
  writeFileSync(join(wf, "discord-pr-trigger.yml"), render("a: 1\n", {}));
  writeFileSync(join(wf, "discord-pr-publish.yml"), "# editado a mano\n");
  const { exec, calls } = fakeGh({ environment: true, secrets: ["DISCORD_CACHE_KEY"], variables: ["DISCORD_GUILD_ID"] });
  const before = readdirSync(root, { recursive: true }).sort();
  const out = await run(["detect", "--root", root], { exec });
  assert.deepEqual(readdirSync(root, { recursive: true }).sort(), before);
  const r = JSON.parse(out);
  assert.equal(r.repository, "acme/app");
  assert.equal(r.defaultBranch, "main");
  assert.equal(r.gh.available, true);
  const state = Object.fromEntries(r.files.map((f) => [f.path, f.state]));
  assert.equal(state[join(".github", "workflows", "discord-pr-trigger.yml")], "igual");
  assert.equal(state[join(".github", "workflows", "discord-pr-publish.yml")], "editado");
  assert.equal(state[join(".github", "workflows", "discord-pr-confirmation-trigger.yml")], "ausente");
  assert.deepEqual(r.environment.secrets, { DISCORD_BOT_TOKEN: false, DISCORD_CACHE_KEY: true });
  assert.deepEqual(r.environment.variables, { DISCORD_GUILD_ID: true, DISCORD_GIT_CHANNEL_ID: false });
  assert.deepEqual(r.botToken, { inEnv: true });
  assert.ok(!out.includes("bot-super-secreto") && !out.includes("ghp_proyecto"));
  assert.ok(calls.every((c) => c.args[0] === "repo" || c.args[0] === "api" || c.args[1] === "list"), "solo lecturas");
  assert.ok(calls.every((c) => c.env.GH_TOKEN === "ghp_proyecto" && !c.args.join(" ").includes("ghp_proyecto")));
});

test("detect falla con remoto que no es de GitHub y con órdenes desconocidas o aún no disponibles", async () => {
  const gl = project({ remote: "https://gitlab.com/a/b.git" });
  await assert.rejects(run(["detect", "--root", gl], { exec: fakeGh().exec }), /no es de GitHub/);
  await assert.rejects(run(["nada"], { exec: fakeGh().exec }), /Uso:/);
  await assert.rejects(run([], { exec: fakeGh().exec }), /Uso:/);
});

test("la acción de assets es la de .github", () => {
  const origen = new URL("../.github/actions/discord-pr-notifications/", import.meta.url);
  const copia = new URL("assets/discord-pr-notifications/", SKILL);
  const a = readdirSync(origen).sort();
  const b = readdirSync(copia).sort();
  assert.deepEqual(b, a);
  for (const f of a) assert.equal(readFileSync(new URL(f, copia), "utf8"), readFileSync(new URL(f, origen), "utf8"), f);
});

test("las plantillas de workflows conservan la superficie de seguridad", () => {
  const trigger = read("assets/workflows/discord-pr-trigger.yml");
  const confirm = read("assets/workflows/discord-pr-confirmation-trigger.yml");
  const publish = read("assets/workflows/discord-pr-publish.yml");
  const all = { trigger, confirm, publish };
  for (const [name, text] of Object.entries(all)) {
    for (const m of text.matchAll(/uses:\s*([^\s]+)/g)) {
      if (m[1].startsWith("./")) continue;
      assert.match(m[1], /@[0-9a-f]{40}$/, `${name}: ${m[1]} sin SHA completo`);
    }
    assert.doesNotMatch(text, /pull_request_target/, name);
    assert.match(text, /^permissions:|^\s+permissions:/m, name);
  }
  // Los disparadores no reciben secretos ni el entorno protegido.
  for (const t of [trigger, confirm]) {
    assert.doesNotMatch(t, /secrets\.|environment:|DISCORD_/);
  }
  assert.match(trigger, /branches: \["\{\{BASE_BRANCH\}\}"\]/);
  assert.match(trigger, /draft/);
  assert.match(trigger, /discord-pr-number/);
  // Solo el emisor recibe el token y el entorno, y no pasa required-check.
  assert.match(publish, /environment: discord-pr-notifications/);
  assert.match(publish, /secrets\.DISCORD_BOT_TOKEN/);
  assert.match(publish, /secrets\.DISCORD_CACHE_KEY/);
  assert.match(publish, /vars\.DISCORD_GUILD_ID/);
  assert.match(publish, /vars\.DISCORD_GIT_CHANNEL_ID/);
  assert.doesNotMatch(publish, /required-check/);
  assert.match(publish, /github\.ref == 'refs\/heads\/\{\{DEFAULT_BRANCH\}\}'/);
  assert.match(publish, /workflows: \["Discord: capture PR", "Discord: capture confirmation"\]/);
  assert.match(trigger, /name: "Discord: capture PR"/);
  assert.match(confirm, /name: "Discord: capture confirmation"/);
});

test("las plantillas solo traen los marcadores conocidos y render los rellena todos", () => {
  const known = new Set(["REPOSITORY", "BASE_BRANCH", "DEFAULT_BRANCH", "MINIMUM_REVIEWERS"]);
  for (const w of ["discord-pr-trigger.yml", "discord-pr-confirmation-trigger.yml", "discord-pr-publish.yml"]) {
    const text = read(`assets/workflows/${w}`);
    for (const m of text.matchAll(/\{\{([A-Z_]+)\}\}/g)) assert.ok(known.has(m[1]), `${w}: ${m[0]}`);
    const out = render(text, { REPOSITORY: "acme/app", BASE_BRANCH: "staging", DEFAULT_BRANCH: "main", MINIMUM_REVIEWERS: 2 });
    assert.doesNotMatch(out, /\{\{[A-Z_]+\}\}/, w);
    assert.doesNotMatch(out, /venturars/, w);
    assert.equal(fileState(out), "igual");
  }
});

// --- apply ---

const BOT = "bot-token-MUY-secreto-0123";
const GUILD = "1111111111111";
const CHANNEL = "2222222222222";
const fixedRandom = (n) => Buffer.alloc(n, 7);
const KEY = fixedRandom(32).toString("base64");
const ENV_PATH = "repos/acme/app/environments/discord-pr-notifications";
const WF = join(".github", "workflows");
const ACT = join(".github", "actions", "discord-pr-notifications");

// gh doble con estado: ramas, entorno, políticas, secretos y variables. Registra cada llamada.
function sim({ branches = ["main", "staging"], environment = false, policies = [], secrets = [], variables = {}, putError = null } = {}) {
  const st = { branches: new Set(branches), environment, policies: [...policies], secrets: new Set(secrets), variables: new Map(Object.entries(variables)) };
  const calls = [];
  const fail = (message) => Object.assign(new SetupDiscordError(message, 4), { stderr: message });
  const exec = async (args, opts = {}) => {
    calls.push({ args, input: opts.input, env: opts.env });
    const [a, b] = args;
    const joined = args.join(" ");
    if (a === "repo" && b === "view") return JSON.stringify({ nameWithOwner: "acme/app", defaultBranchRef: { name: "main" } });
    if (a === "api") {
      const branch = /^repos\/acme\/app\/branches\/(.+)$/.exec(b);
      if (branch) {
        if (st.branches.has(decodeURIComponent(branch[1]))) return "";
        throw fail("HTTP 404: Not Found");
      }
      if (b === "-X") {
        const method = args[2];
        const path = args[3];
        if (method === "PUT" && path === ENV_PATH) {
          if (putError) throw fail(putError);
          st.environment = { deployment_branch_policy: JSON.parse(opts.input).deployment_branch_policy };
          return "";
        }
        if (method === "POST" && path === `${ENV_PATH}/deployment-branch-policies`) {
          st.policies.push(JSON.parse(opts.input).name);
          return "";
        }
      }
      if (b === ENV_PATH) {
        if (!st.environment) throw fail("HTTP 404: Not Found");
        return JSON.stringify(st.environment === true ? { deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } } : st.environment);
      }
      if (b === `${ENV_PATH}/deployment-branch-policies`) return JSON.stringify({ branch_policies: st.policies.map((name) => ({ name })) });
    }
    if (a === "secret" && b === "list") return JSON.stringify([...st.secrets].map((name) => ({ name })));
    if (a === "secret" && b === "set") return void st.secrets.add(args[2]) ?? "";
    if (a === "variable" && b === "list") return JSON.stringify([...st.variables].map(([name, value]) => ({ name, value })));
    if (a === "variable" && b === "set") return void st.variables.set(args[2], opts.input) ?? "";
    throw new Error(`llamada inesperada: ${joined}`);
  };
  const writes = () => calls.filter((c) => (c.args[0] === "api" && c.args[1] === "-X") || c.args[1] === "set");
  return { exec, calls, st, writes };
}

const defaultEnv = `GITHUB_TOKEN=ghp_proyecto\nDISCORD_BOT_TOKEN=${BOT}\n`;
const ids = ["--guild-id", GUILD, "--channel-id", CHANNEL];
const apply = async (root, g, extra = []) => JSON.parse(await run(["apply", "--root", root, ...ids, ...extra], { exec: g.exec, random: fixedRandom }));
const walk = (root) => readdirSync(root, { recursive: true }).filter((f) => !f.startsWith(".git")).sort();
const byPath = (r) => Object.fromEntries(r.files.map((f) => [f.path, f.result]));
const idx = (calls, pred) => calls.findIndex(pred);

test("apply en un proyecto limpio", async () => {
  const root = project({ env: defaultEnv });
  const g = sim();
  const r = await apply(root, g);
  assert.equal(r.repository, "acme/app");
  assert.equal(r.defaultBranch, "main");
  assert.equal(r.baseBranch, "staging");
  assert.equal(r.minimumReviewers, 1);
  assert.equal(r.environment, "creado");
  assert.deepEqual(r.secrets, { DISCORD_BOT_TOKEN: "creado", DISCORD_CACHE_KEY: "creado" });
  assert.deepEqual(r.variables, { DISCORD_GUILD_ID: "creado", DISCORD_GIT_CHANNEL_ID: "creado" });
  assert.deepEqual(r.warnings, []);
  assert.equal(r.files.length, managedFiles().length);
  assert.ok(r.files.every((f) => f.result === "creado"));
  // Ficheros escritos con la marca, valores sustituidos y sin marcadores.
  for (const { rel } of managedFiles()) assert.ok(readFileSync(join(root, rel), "utf8").length > 0, rel);
  for (const w of ["discord-pr-trigger.yml", "discord-pr-confirmation-trigger.yml", "discord-pr-publish.yml"]) {
    const text = readFileSync(join(root, WF, w), "utf8");
    assert.equal(fileState(text), "igual", w);
    assert.doesNotMatch(text, /\{\{[A-Z_]+\}\}/, w);
  }
  const publish = readFileSync(join(root, WF, "discord-pr-publish.yml"), "utf8");
  assert.match(publish, /expected-repository: acme\/app\n/);
  assert.match(publish, /base-branch: "staging"\n/);
  assert.match(publish, /minimum-reviewers: 1\n/);
  assert.match(publish, /github\.ref == 'refs\/heads\/main'/);
  assert.match(readFileSync(join(root, WF, "discord-pr-trigger.yml"), "utf8"), /branches: \["staging"\]/);
  // La acción es la copia de assets, sin marca (el .mjs y el yml llevan la suya).
  assert.ok(readdirSync(join(root, ACT)).includes("action.yml"));
  // Estado final en GitHub.
  assert.deepEqual(g.st.environment.deployment_branch_policy, { protected_branches: false, custom_branch_policies: true });
  assert.deepEqual(g.st.policies, ["main"]);
  assert.deepEqual([...g.st.secrets].sort(), ["DISCORD_BOT_TOKEN", "DISCORD_CACHE_KEY"]);
  assert.equal(g.st.variables.get("DISCORD_GUILD_ID"), GUILD);
  assert.equal(g.st.variables.get("DISCORD_GIT_CHANNEL_ID"), CHANNEL);
});

test("apply: orden de las llamadas a gh, entorno antes que variables y secretos", async () => {
  const root = project({ env: defaultEnv });
  const g = sim();
  await apply(root, g);
  const put = idx(g.calls, (c) => c.args[2] === "PUT");
  const post = idx(g.calls, (c) => c.args[2] === "POST");
  const vars = g.calls.map((c, i) => (c.args[0] === "variable" && c.args[1] === "set" ? i : -1)).filter((i) => i >= 0);
  const secs = g.calls.map((c, i) => (c.args[0] === "secret" && c.args[1] === "set" ? i : -1)).filter((i) => i >= 0);
  assert.equal(g.calls[0].args[0], "repo");
  assert.ok(put > 0 && post > put, "PUT del entorno y después la política de rama");
  assert.equal(vars.length, 2);
  assert.equal(secs.length, 2);
  assert.ok(vars.every((i) => i > post) && secs.every((i) => i > post), "secretos y variables tras el entorno");
  assert.ok(g.calls.slice(0, put).every((c) => !c.args.includes("set") && c.args[1] !== "-X"), "antes del PUT solo hay lecturas");
  // Las lecturas previas ocurren antes de cualquier escritura.
  assert.ok(idx(g.calls, (c) => c.args[0] === "secret" && c.args[1] === "list") < put);
  assert.ok(g.calls.every((c) => c.env.GH_TOKEN === "ghp_proyecto"));
  assert.deepEqual(g.calls[put].args, ["api", "-X", "PUT", ENV_PATH, "--input", "-"]);
});

test("apply repetido es idempotente", async () => {
  const root = project({ env: defaultEnv });
  const g = sim();
  await apply(root, g);
  const antes = walk(root).map((f) => f);
  const contenido = Object.fromEntries(managedFiles().map(({ rel }) => [rel, readFileSync(join(root, rel), "utf8")]));
  g.calls.length = 0;
  const r = await apply(root, g);
  assert.equal(r.environment, "igual");
  assert.ok(r.files.every((f) => f.result === "igual"), JSON.stringify(r.files));
  assert.deepEqual(r.variables, { DISCORD_GUILD_ID: "igual", DISCORD_GIT_CHANNEL_ID: "igual" });
  // El token se vuelve a fijar porque gh no devuelve su valor; la clave de caché no se rota.
  assert.deepEqual(r.secrets, { DISCORD_BOT_TOKEN: "actualizado", DISCORD_CACHE_KEY: "igual" });
  assert.deepEqual(walk(root), antes);
  for (const [rel, text] of Object.entries(contenido)) assert.equal(readFileSync(join(root, rel), "utf8"), text, rel);
  // Solo escribe el token del bot.
  const escrituras = g.writes();
  assert.equal(escrituras.length, 1);
  assert.deepEqual(escrituras[0].args.slice(0, 3), ["secret", "set", "DISCORD_BOT_TOKEN"]);
});

test("un workflow editado se conserva", async () => {
  const root = project({ env: defaultEnv });
  const g = sim();
  await apply(root, g);
  const editado = join(root, WF, "discord-pr-publish.yml");
  writeFileSync(editado, "# mío, sin marca\nname: x\n");
  const sinMarca = join(root, WF, "discord-pr-trigger.yml");
  const original = readFileSync(sinMarca, "utf8");
  const roto = original.replace('branches: ["staging"]', 'branches: ["dev"]');
  assert.notEqual(roto, original, "la edición cambia el fichero");
  writeFileSync(sinMarca, roto);
  const r = await apply(root, g);
  const res = byPath(r);
  assert.equal(res[join(WF, "discord-pr-publish.yml")], "conservado");
  assert.equal(res[join(WF, "discord-pr-trigger.yml")], "conservado");
  assert.equal(res[join(WF, "discord-pr-confirmation-trigger.yml")], "igual");
  assert.equal(readFileSync(editado, "utf8"), "# mío, sin marca\nname: x\n");
  assert.equal(readFileSync(sinMarca, "utf8"), roto);
  assert.equal(r.warnings.length, 2);
  assert.ok(r.warnings.some((w) => w.includes("discord-pr-publish.yml")));
});

test("apply actualiza un fichero propio cuando cambian los valores", async () => {
  const root = project({ env: defaultEnv });
  const g = sim();
  await apply(root, g);
  const r = await apply(root, g, ["--base", "main", "--minimum-reviewers", "2"]);
  const res = byPath(r);
  assert.equal(res[join(WF, "discord-pr-trigger.yml")], "actualizado");
  assert.equal(res[join(WF, "discord-pr-publish.yml")], "actualizado");
  assert.equal(res[join(WF, "discord-pr-confirmation-trigger.yml")], "igual");
  assert.match(readFileSync(join(root, WF, "discord-pr-publish.yml"), "utf8"), /minimum-reviewers: 2\n/);
  assert.equal(r.baseBranch, "main");
  assert.equal(r.minimumReviewers, 2);
});

test("las plantillas escriben la rama base entre comillas", async () => {
  // Cada marcador de la rama base va entre comillas.
  const marcados = [];
  for (const w of ["discord-pr-trigger.yml", "discord-pr-confirmation-trigger.yml", "discord-pr-publish.yml"]) {
    for (const m of read(`assets/workflows/${w}`).matchAll(/(.?)\{\{BASE_BRANCH\}\}(.?)/g)) {
      assert.deepEqual([m[1], m[2]], ['"', '"'], w);
      marcados.push(w);
    }
  }
  assert.deepEqual(marcados, ["discord-pr-trigger.yml", "discord-pr-publish.yml"]);
  // La predeterminada no es un valor YAML suelto: va dentro de una expresión, en un bloque de texto.
  const plantilla = read("assets/workflows/discord-pr-publish.yml");
  assert.equal(plantilla.match(/\{\{DEFAULT_BRANCH\}\}/g).length, 1);
  assert.match(plantilla, /\n    if: >-\n      github\.ref == 'refs\/heads\/\{\{DEFAULT_BRANCH\}\}' &&\n/);

  // CB-19: nombres que YAML leería como número, booleano o nulo sin las comillas.
  for (const base of ["3.10", "true", "null"]) {
    const root = project({ env: defaultEnv });
    const result = await apply(root, sim({ branches: ["main", base] }), ["--base", base]);
    assert.strictEqual(result.baseBranch, base);
    const trigger = readFileSync(join(root, WF, "discord-pr-trigger.yml"), "utf8");
    const publish = readFileSync(join(root, WF, "discord-pr-publish.yml"), "utf8");
    // Entre comillas dobles YAML lee texto; con los caracteres de una rama válida, igual que JSON.
    assert.deepEqual(JSON.parse(trigger.match(/^    branches: (.+)$/m)[1]), [base], base);
    assert.strictEqual(JSON.parse(publish.match(/^          base-branch: (.+)$/m)[1]), base, base);
    assert.equal(fileState(trigger), "igual", base);
    assert.equal(fileState(publish), "igual", base);
  }
});

test("sin token para antes de escribir", async () => {
  for (const env of [undefined, "OTRA=1\n"]) {
    const root = project({ env });
    const g = sim();
    const antes = walk(root);
    await assert.rejects(run(["apply", "--root", root, ...ids], { exec: g.exec }), (e) => e instanceof SetupDiscordError && e.code === 4 && /GITHUB_TOKEN/.test(e.message) && /DISCORD-PR-NOTIFICATIONS/.test(e.message));
    assert.equal(g.calls.length, 0);
    assert.deepEqual(walk(root), antes);
  }
  // Falta DISCORD_BOT_TOKEN y el secreto no existe: error antes de escribir nada.
  const root = project({ env: "GITHUB_TOKEN=ghp_proyecto\n" });
  const g = sim();
  await assert.rejects(run(["apply", "--root", root, ...ids], { exec: g.exec }), (e) => e.code === 2 && /DISCORD_BOT_TOKEN/.test(e.message) && /No se ha escrito nada/.test(e.message));
  assert.equal(g.writes().length, 0);
  assert.deepEqual(walk(root), [".env"]);
});

test("el token solo llega a gh por la entrada estándar", async () => {
  const root = project({ env: defaultEnv });
  const g = sim();
  const out = await run(["apply", "--root", root, ...ids], { exec: g.exec, random: fixedRandom });
  const inputs = Object.fromEntries(g.calls.filter((c) => c.args[1] === "set").map((c) => [c.args[2], c.input]));
  assert.equal(inputs.DISCORD_BOT_TOKEN, BOT);
  assert.equal(inputs.DISCORD_GUILD_ID, GUILD);
  assert.equal(inputs.DISCORD_GIT_CHANNEL_ID, CHANNEL);
  assert.equal(inputs.DISCORD_CACHE_KEY, KEY);
  for (const c of g.calls) {
    const argv = c.args.join(" ");
    for (const secreto of [BOT, KEY, GUILD, CHANNEL, "ghp_proyecto"]) assert.ok(!argv.includes(secreto), `${secreto} en los argumentos: ${argv}`);
  }
  for (const secreto of [BOT, KEY, "ghp_proyecto"]) assert.ok(!out.includes(secreto), "valor en la salida");
  // Tampoco en los ficheros escritos.
  for (const { rel } of managedFiles()) {
    const text = readFileSync(join(root, rel), "utf8");
    assert.ok(!text.includes(BOT) && !text.includes(KEY), rel);
  }
});

test("DISCORD_CACHE_KEY son 32 bytes en base64 y no se rota si ya existe", async () => {
  const root = project({ env: defaultEnv });
  const g = sim();
  await run(["apply", "--root", root, ...ids], { exec: g.exec }); // random real
  const clave = g.calls.find((c) => c.args[2] === "DISCORD_CACHE_KEY" && c.args[1] === "set").input;
  assert.match(clave, /^[A-Za-z0-9+/]+={0,2}$/);
  assert.equal(Buffer.from(clave, "base64").length, 32);
  assert.equal(Buffer.from(clave, "base64").toString("base64"), clave);
  // Con la clave ya creada, no se vuelve a fijar.
  g.calls.length = 0;
  await run(["apply", "--root", root, ...ids], { exec: g.exec });
  assert.ok(!g.calls.some((c) => c.args[1] === "set" && c.args[2] === "DISCORD_CACHE_KEY"));
  const otro = sim({ environment: true, policies: ["main"], secrets: ["DISCORD_CACHE_KEY"] });
  const r = await apply(project({ env: defaultEnv }), otro);
  assert.equal(r.secrets.DISCORD_CACHE_KEY, "igual");
  assert.ok(!otro.calls.some((c) => c.args[2] === "DISCORD_CACHE_KEY" && c.args[1] === "set"));
});

test("DISCORD_BOT_TOKEN: conservado si falta del .env y el secreto existe", async () => {
  const root = project({ env: "GITHUB_TOKEN=ghp_proyecto\n" });
  const g = sim({ environment: true, policies: ["main"], secrets: ["DISCORD_BOT_TOKEN", "DISCORD_CACHE_KEY"] });
  const r = await apply(root, g);
  assert.equal(r.secrets.DISCORD_BOT_TOKEN, "conservado");
  assert.ok(!g.calls.some((c) => c.args[1] === "set" && c.args[2] === "DISCORD_BOT_TOKEN"));
});

test("apply con entorno no disponible (403 o 404) para con código 5 sin fijar nada", async () => {
  for (const error of ["HTTP 403: Forbidden", "HTTP 404: Not Found"]) {
    const root = project({ env: defaultEnv });
    const g = sim({ putError: error });
    await assert.rejects(run(["apply", "--root", root, ...ids], { exec: g.exec, random: fixedRandom }), (e) => {
      assert.ok(e instanceof SetupDiscordError);
      assert.equal(e.code, 5);
      assert.match(e.message, /No se ha fijado nada/);
      assert.match(e.message, /DISCORD-PR-NOTIFICATIONS/);
      assert.ok(!e.message.includes(BOT));
      return true;
    });
    assert.ok(!g.calls.some((c) => c.args[1] === "set"), "ningún secreto ni variable");
    assert.ok(!g.calls.some((c) => c.args[2] === "POST"));
    assert.equal(g.st.secrets.size + g.st.variables.size, 0);
    assert.deepEqual(walk(root), [".env"], "sin ficheros escritos");
  }
});

test("apply con otro error de gh en el entorno lo propaga sin el código 5", async () => {
  const root = project({ env: defaultEnv });
  const g = sim({ putError: "HTTP 500: Server Error" });
  await assert.rejects(run(["apply", "--root", root, ...ids], { exec: g.exec }), (e) => e.code !== 5 && /500/.test(e.message));
});

test("apply: --minimum-reviewers llega a la plantilla del emisor", async () => {
  const root = project({ env: defaultEnv });
  await apply(root, sim(), ["--minimum-reviewers", "3"]);
  assert.match(readFileSync(join(root, WF, "discord-pr-publish.yml"), "utf8"), /minimum-reviewers: 3\n/);
  await assert.rejects(run(["apply", "--root", root, ...ids, "--minimum-reviewers", "0"], { exec: sim().exec }), /1 o más/);
});

test("apply rechaza ramas base inválidas antes de escribir", async () => {
  for (const base of ["a b", "x: y", "../x", "a..b", "a//b", "-x", "x.lock", "x/", "x\ny", "a;b", "{{X}}"]) {
    const root = project({ env: defaultEnv });
    const g = sim({ branches: ["main", "staging", base] });
    await assert.rejects(run(["apply", "--root", root, ...ids, "--base", base], { exec: g.exec }), (e) => e.code === 2 && /no es válida/.test(e.message), JSON.stringify(base));
    assert.equal(g.writes().length, 0);
    assert.deepEqual(walk(root), [".env"]);
  }
});

test("apply rechaza una rama base que no existe en el remoto", async () => {
  const root = project({ env: defaultEnv });
  const g = sim();
  await assert.rejects(run(["apply", "--root", root, ...ids, "--base", "nueva"], { exec: g.exec }), (e) => e.code === 3 && /nueva no existe/.test(e.message));
  assert.equal(g.writes().length, 0);
});

test("rama base por defecto: staging si existe, si no la predeterminada", async () => {
  const con = await apply(project({ env: defaultEnv }), sim({ branches: ["main", "staging"] }));
  assert.equal(con.baseBranch, "staging");
  const sin = await apply(project({ env: defaultEnv }), sim({ branches: ["main"] }));
  assert.equal(sin.baseBranch, "main");
  const explicita = await apply(project({ env: defaultEnv }), sim({ branches: ["main", "staging", "dev"] }), ["--base", "dev"]);
  assert.equal(explicita.baseBranch, "dev");
});

test("apply sin --guild-id ni --channel-id conserva las variables que existen", async () => {
  const root = project({ env: defaultEnv });
  const g = sim({ environment: true, policies: ["main"], variables: { DISCORD_GUILD_ID: "999", DISCORD_GIT_CHANNEL_ID: "888" } });
  const r = JSON.parse(await run(["apply", "--root", root], { exec: g.exec, random: fixedRandom }));
  assert.deepEqual(r.variables, { DISCORD_GUILD_ID: "conservado", DISCORD_GIT_CHANNEL_ID: "conservado" });
  assert.ok(!g.calls.some((c) => c.args[0] === "variable" && c.args[1] === "set"));
  assert.equal(g.st.variables.get("DISCORD_GUILD_ID"), "999");
});

test("apply sin --guild-id ni --channel-id da error si la variable no existe", async () => {
  const root = project({ env: defaultEnv });
  const g = sim();
  await assert.rejects(run(["apply", "--root", root, "--channel-id", CHANNEL], { exec: g.exec }), (e) => e.code === 2 && /--guild-id/.test(e.message) && /No se ha escrito nada/.test(e.message));
  await assert.rejects(run(["apply", "--root", root, "--guild-id", GUILD], { exec: g.exec }), (e) => e.code === 2 && /--channel-id/.test(e.message));
  assert.equal(g.writes().length, 0);
  assert.deepEqual(walk(root), [".env"]);
  // Con una existente y la otra no, falla por la que falta.
  const g2 = sim({ environment: true, policies: ["main"], variables: { DISCORD_GUILD_ID: "1" } });
  await assert.rejects(run(["apply", "--root", root], { exec: g2.exec }), /--channel-id/);
});

test("apply con una variable de valor distinto la actualiza", async () => {
  const root = project({ env: defaultEnv });
  const g = sim({ environment: true, policies: ["main"], variables: { DISCORD_GUILD_ID: "1", DISCORD_GIT_CHANNEL_ID: CHANNEL } });
  const r = await apply(root, g);
  assert.deepEqual(r.variables, { DISCORD_GUILD_ID: "actualizado", DISCORD_GIT_CHANNEL_ID: "igual" });
  assert.equal(g.st.variables.get("DISCORD_GUILD_ID"), GUILD);
});

test("apply: la política de rama del entorno solo se añade si falta", async () => {
  const g = sim({ environment: true, policies: ["main"] });
  const r = await apply(project({ env: defaultEnv }), g);
  assert.equal(r.environment, "igual");
  assert.ok(!g.calls.some((c) => c.args[2] === "POST" || c.args[2] === "PUT"));
  const h = sim({ environment: true, policies: [] });
  assert.equal((await apply(project({ env: defaultEnv }), h)).environment, "actualizado");
  assert.deepEqual(h.st.policies, ["main"]);
  const parcial = sim({ environment: { deployment_branch_policy: null }, policies: ["main"] });
  assert.equal((await apply(project({ env: defaultEnv }), parcial)).environment, "actualizado");
});

// --- reset y errores ---

// Añade a sim el borrado de secretos, variables y entorno, y deja fallar llamadas concretas.
function simDel(opts = {}, { failOn = null } = {}) {
  const g = sim(opts);
  const base = g.exec;
  const exec = async (args, o = {}) => {
    if (failOn) {
      const err = failOn(args);
      if (err) {
        g.calls.push({ args, input: o.input, env: o.env });
        throw Object.assign(new SetupDiscordError(err, 4), { stderr: err });
      }
    }
    const [a, b] = args;
    if ((a === "secret" || a === "variable") && b === "delete") {
      g.calls.push({ args, input: o.input, env: o.env });
      (a === "secret" ? g.st.secrets : g.st.variables).delete(args[2]);
      return "";
    }
    if (a === "api" && b === "-X" && args[2] === "DELETE") {
      g.calls.push({ args, input: o.input, env: o.env });
      g.st.environment = false;
      return "";
    }
    return base(args, o);
  };
  g.exec = exec;
  g.deletes = () => g.calls.filter((c) => c.args[1] === "delete" || c.args[2] === "DELETE");
  return g;
}

const reset = async (root, g, extra = []) => JSON.parse(await run(["reset", "--root", root, ...extra], { exec: g.exec }));
const actionDir = (root) => join(root, ACT);
const exists = (path) => {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
};

test("reset quita lo no editado y deja el entorno sin --remove-environment", async () => {
  const root = project({ env: defaultEnv });
  const g = simDel();
  await apply(root, g);
  const editado = join(root, WF, "discord-pr-publish.yml");
  writeFileSync(editado, "# mío\nname: x\n");
  g.calls.length = 0;
  const r = await reset(root, g);
  const res = byPath(r);
  assert.equal(r.repository, "acme/app");
  assert.equal(res[join(WF, "discord-pr-publish.yml")], "conservado");
  assert.equal(res[join(WF, "discord-pr-trigger.yml")], "quitado");
  assert.equal(res[join(WF, "discord-pr-confirmation-trigger.yml")], "quitado");
  assert.ok(r.files.filter((f) => f.path.startsWith(ACT)).every((f) => f.result === "quitado"));
  assert.equal(readFileSync(editado, "utf8"), "# mío\nname: x\n");
  assert.ok(!exists(join(root, WF, "discord-pr-trigger.yml")));
  assert.throws(() => readdirSync(actionDir(root)), "la carpeta de la acción vacía se quita");
  assert.ok(r.warnings.some((w) => w.includes("discord-pr-publish.yml") && /editado|sin la marca/.test(w)));
  // El entorno, los secretos y las variables siguen: se listan como pendientes y se avisa.
  assert.equal(r.environment, null);
  assert.deepEqual(r.pending, {
    environment: "discord-pr-notifications",
    secrets: ["DISCORD_BOT_TOKEN", "DISCORD_CACHE_KEY"],
    variables: ["DISCORD_GUILD_ID", "DISCORD_GIT_CHANNEL_ID"],
  });
  assert.ok(r.warnings.some((w) => w.includes("--remove-environment")));
  assert.equal(g.deletes().length, 0);
  assert.equal(g.writes().length, 0);
  assert.equal(g.st.secrets.size, 2);
  assert.equal(g.st.variables.size, 2);
  assert.ok(g.st.environment);
});

test("reset conserva la carpeta de la acción si queda un fichero editado en ella", async () => {
  const root = project({ env: defaultEnv });
  const g = simDel();
  await apply(root, g);
  writeFileSync(join(root, ACT, "action.yml"), "name: mío\n");
  const r = await reset(root, g);
  assert.equal(byPath(r)[join(ACT, "action.yml")], "conservado");
  assert.equal(readFileSync(join(root, ACT, "action.yml"), "utf8"), "name: mío\n");
  assert.deepEqual(readdirSync(actionDir(root)), ["action.yml"]);
});

test("reset trata un fichero sin la marca como editado y lo conserva con aviso (CB-06)", async () => {
  const root = project({ env: defaultEnv });
  const g = simDel();
  await apply(root, g);
  const f = join(root, WF, "discord-pr-trigger.yml");
  const sinMarca = readFileSync(f, "utf8").split("\n").slice(1).join("\n");
  writeFileSync(f, sinMarca);
  const r = await reset(root, g);
  assert.equal(byPath(r)[join(WF, "discord-pr-trigger.yml")], "conservado");
  assert.equal(readFileSync(f, "utf8"), sinMarca);
  assert.ok(r.warnings.some((w) => w.includes("discord-pr-trigger.yml")));
});

test("reset sin ficheros de Discord da ausente en todos y no escribe", async () => {
  const root = project({ env: defaultEnv });
  const g = simDel();
  const antes = walk(root);
  const r = await reset(root, g);
  assert.ok(r.files.length === managedFiles().length && r.files.every((f) => f.result === "ausente"));
  assert.equal(r.pending.environment, null);
  assert.deepEqual(r.pending.secrets, []);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(walk(root), antes);
  assert.equal(g.writes().length + g.deletes().length, 0);
});

test("reset --remove-environment borra secretos, variables y entorno, y el entorno el último", async () => {
  const root = project({ env: defaultEnv });
  const g = simDel();
  await apply(root, g);
  g.calls.length = 0;
  const r = await reset(root, g, ["--remove-environment"]);
  assert.ok(r.files.every((f) => f.result === "quitado"));
  assert.equal(r.pending, null);
  assert.deepEqual(r.environment, {
    environment: "quitado",
    secrets: { DISCORD_BOT_TOKEN: "quitado", DISCORD_CACHE_KEY: "quitado" },
    variables: { DISCORD_GUILD_ID: "quitado", DISCORD_GIT_CHANNEL_ID: "quitado" },
  });
  const dels = g.deletes();
  assert.equal(dels.length, 5);
  assert.deepEqual(dels.at(-1).args, ["api", "-X", "DELETE", ENV_PATH]);
  assert.deepEqual(dels.slice(0, 2).map((c) => c.args.slice(0, 3)), [["secret", "delete", "DISCORD_BOT_TOKEN"], ["secret", "delete", "DISCORD_CACHE_KEY"]]);
  assert.equal(g.st.secrets.size + g.st.variables.size, 0);
  assert.equal(g.st.environment, false);
  assert.ok(g.calls.every((c) => c.env.GH_TOKEN === "ghp_proyecto"));
  assert.deepEqual(walk(root).filter((f) => f.includes("discord")), []);
});

test("reset --remove-environment marca ausente lo que no existe y no borra nada sin entorno", async () => {
  const parcial = simDel({ environment: true, policies: ["main"], secrets: ["DISCORD_CACHE_KEY"], variables: { DISCORD_GUILD_ID: "1" } });
  const r = await reset(project({ env: defaultEnv }), parcial, ["--remove-environment"]);
  assert.deepEqual(r.environment, {
    environment: "quitado",
    secrets: { DISCORD_BOT_TOKEN: "ausente", DISCORD_CACHE_KEY: "quitado" },
    variables: { DISCORD_GUILD_ID: "quitado", DISCORD_GIT_CHANNEL_ID: "ausente" },
  });
  assert.equal(parcial.deletes().length, 3);
  const sin = simDel();
  const r2 = await reset(project({ env: defaultEnv }), sin, ["--remove-environment"]);
  assert.equal(r2.environment.environment, "ausente");
  assert.equal(sin.deletes().length, 0);
});

test("reset --remove-environment sin GITHUB_TOKEN falla antes de quitar nada", async () => {
  for (const env of [undefined, "OTRA=1\n"]) {
    const root = project({ env });
    const g = simDel();
    // Ficheros de Discord presentes: deben seguir ahí.
    const f = join(root, WF, "discord-pr-trigger.yml");
    mkdirSync(join(root, WF), { recursive: true });
    writeFileSync(f, render("x: 1\n", {}));
    await assert.rejects(run(["reset", "--root", root, "--remove-environment"], { exec: g.exec }), (e) => e instanceof SetupDiscordError && e.code === 4 && /GITHUB_TOKEN/.test(e.message) && /No se ha quitado nada/.test(e.message) && /DISCORD-PR-NOTIFICATIONS/.test(e.message));
    assert.ok(exists(f), "el fichero sigue");
    assert.equal(g.calls.length, 0);
  }
});

test("reset --remove-environment con gh no instalado o roto falla antes de quitar nada", async () => {
  for (const [error, texto] of [[Object.assign(new SetupDiscordError("gh no está instalado.", 4), { missing: true }), /gh no está instalado/], [new SetupDiscordError("HTTP 500", 4), /gh no responde/]]) {
    const root = project({ env: defaultEnv });
    await apply(root, simDel());
    await assert.rejects(run(["reset", "--root", root, "--remove-environment"], { exec: async () => { throw error; } }), (e) => e.code === 4 && texto.test(e.message) && /No se ha quitado nada/.test(e.message));
    assert.ok(exists(join(root, WF, "discord-pr-trigger.yml")), "los ficheros siguen");
  }
});

test("reset sin --remove-environment y sin GITHUB_TOKEN quita los ficheros y avisa", async () => {
  const root = project({ env: defaultEnv });
  await apply(root, simDel());
  writeFileSync(join(root, ".env"), "OTRA=1\n");
  const g = simDel();
  const r = await reset(root, g);
  assert.ok(r.files.every((f) => f.result === "quitado"));
  assert.equal(r.pending, null);
  assert.ok(r.warnings.some((w) => /Sin GITHUB_TOKEN/.test(w)));
  assert.equal(g.calls.length, 0);
});

test("reset sin --remove-environment con gh que falla quita los ficheros y avisa", async () => {
  const root = project({ env: defaultEnv });
  await apply(root, simDel());
  const r = JSON.parse(await run(["reset", "--root", root], { exec: async () => { throw new SetupDiscordError("HTTP 500", 4); } }));
  assert.ok(r.files.every((f) => f.result === "quitado"));
  assert.equal(r.pending, null);
  assert.ok(r.warnings.some((w) => /No se pudo consultar el entorno/.test(w) && /500/.test(w)));
});

test("reset con 403: --remove-environment para sin quitar nada; sin ella quita los ficheros y avisa", async () => {
  const root = project({ env: defaultEnv });
  await apply(root, simDel());
  const forbidden = simDel({}, { failOn: (args) => (args[0] === "api" && /environments\//.test(args[1]) ? "HTTP 403: Must have admin rights to Repository." : null) });
  await assert.rejects(run(["reset", "--root", root, "--remove-environment"], { exec: forbidden.exec }), (e) => e.code === 4 && /permiso de administración/.test(e.message) && /DISCORD-PR-NOTIFICATIONS/.test(e.message) && /No se ha quitado nada/.test(e.message));
  assert.ok(exists(join(root, WF, "discord-pr-trigger.yml")));
  assert.equal(forbidden.deletes().length, 0);
  const r = JSON.parse(await run(["reset", "--root", root], { exec: forbidden.exec }));
  assert.ok(r.files.every((f) => f.result === "quitado"));
  assert.ok(r.warnings.some((w) => /permiso de administración/.test(w)));
});

test("reset --remove-environment con fallo a mitad lista lo hecho, lo pendiente y los ficheros", async () => {
  const root = project({ env: defaultEnv });
  const g = simDel({}, { failOn: (args) => (args[0] === "variable" && args[1] === "delete" && args[2] === "DISCORD_GIT_CHANNEL_ID" ? "HTTP 500: boom" : null) });
  await apply(root, g);
  await assert.rejects(run(["reset", "--root", root, "--remove-environment"], { exec: g.exec }), (e) => {
    assert.match(e.message, /boom/);
    assert.match(e.message, /Quedó hecho: DISCORD_BOT_TOKEN, DISCORD_CACHE_KEY, DISCORD_GUILD_ID/);
    assert.match(e.message, /No se hizo: DISCORD_GIT_CHANNEL_ID, entorno/);
    assert.match(e.message, /Repite apply para terminar/);
    assert.match(e.message, /Ficheros: .*discord-pr-trigger\.yml quitado/);
    return true;
  });
  assert.ok(g.st.environment, "el entorno no se borró");
  assert.ok(g.st.variables.has("DISCORD_GIT_CHANNEL_ID"));
});

test("reset no imprime valores de secretos ni el token", async () => {
  const root = project({ env: defaultEnv });
  const g = simDel();
  await apply(root, g);
  for (const extra of [[], ["--remove-environment"]]) {
    const out = await run(["reset", "--root", root, ...extra], { exec: g.exec });
    for (const v of [BOT, KEY, "ghp_proyecto"]) assert.ok(!out.includes(v));
    for (const c of g.calls) assert.ok(!c.args.join(" ").includes(BOT));
  }
});

test("reset con remoto que no es de GitHub o sin remoto falla sin tocar nada (CB-01)", async () => {
  for (const remote of ["https://gitlab.com/acme/app.git", null]) {
    const root = project({ remote, env: defaultEnv });
    const f = join(root, WF, "discord-pr-trigger.yml");
    mkdirSync(join(root, WF), { recursive: true });
    writeFileSync(f, render("x: 1\n", {}));
    const g = simDel();
    await assert.rejects(run(["reset", "--root", root], { exec: g.exec }), (e) => e.code === 3 && /no es de GitHub|No hay remoto/.test(e.message));
    assert.ok(exists(f));
    assert.equal(g.calls.length, 0);
  }
});

test("apply con remoto que no es de GitHub o sin remoto falla sin escribir (CB-01)", async () => {
  for (const remote of ["https://gitlab.com/acme/app.git", "https://bitbucket.org/acme/app.git", null]) {
    const root = project({ remote, env: defaultEnv });
    const g = sim();
    await assert.rejects(run(["apply", "--root", root, ...ids], { exec: g.exec }), (e) => e.code === 3 && /no es de GitHub|No hay remoto/.test(e.message));
    assert.equal(g.calls.length, 0);
    assert.deepEqual(walk(root), [".env"]);
  }
});

test("gh no instalado: apply para antes de escribir y detect lo informa (CB-02)", async () => {
  const missing = async () => { throw Object.assign(new SetupDiscordError("gh no está instalado.", 4), { missing: true }); };
  const root = project({ env: defaultEnv });
  await assert.rejects(run(["apply", "--root", root, ...ids], { exec: missing }), (e) => e.code === 4 && /gh no está instalado/.test(e.message) && /DISCORD-PR-NOTIFICATIONS/.test(e.message) && /No se ha escrito nada/.test(e.message));
  assert.deepEqual(walk(root), [".env"]);
  const d = JSON.parse(await run(["detect", "--root", root], { exec: missing }));
  assert.equal(d.gh.available, false);
  assert.match(d.gh.reason, /gh no está instalado/);
});

test("403 sin permiso de administración: detect lo informa y apply para sin escribir (CB-02)", async () => {
  const mensajes = ["HTTP 403: Must have admin rights to Repository.", "HTTP 403: Resource not accessible by personal access token"];
  const donde = [
    (a) => a[0] === "repo",
    (a) => a[0] === "api" && /\/branches\//.test(a[1]),
    (a) => a[0] === "api" && /\/environments\//.test(a[1]),
    (a) => a[0] === "secret" && a[1] === "list",
  ];
  for (const msg of mensajes) {
    for (const [i, pred] of donde.entries()) {
      const root = project({ env: defaultEnv });
      const g = simDel({ environment: true, policies: ["main"] }, { failOn: (a) => (pred(a) ? msg : null) });
      await assert.rejects(run(["apply", "--root", root, ...ids], { exec: g.exec }), (e) => {
        assert.equal(e.code, 4, `${i}`);
        assert.match(e.message, /permiso de administración/);
        assert.match(e.message, /DISCORD-PR-NOTIFICATIONS/);
        assert.ok(!e.message.includes(BOT) && !e.message.includes("ghp_proyecto"));
        return true;
      }, `${msg} en ${i}`);
      assert.equal(g.writes().length, 0, `${i}`);
      assert.deepEqual(walk(root), [".env"], `${i}`);
      const d = JSON.parse(await run(["detect", "--root", root], { exec: g.exec }));
      if (i !== 1) {
        assert.equal(d.gh.available, false, `${i}`);
        assert.match(d.gh.reason, /permiso de administración/, `${i}`);
      }
      assert.deepEqual(walk(root), [".env"], "detect no escribe");
    }
  }
});

test("apply con 403 al crear el entorno no deja nada fijado y remite a los pasos manuales", async () => {
  const root = project({ env: defaultEnv });
  const g = simDel({}, { failOn: (a) => (a[0] === "api" && a[2] === "PUT" ? "HTTP 403: Must have admin rights to Repository." : null) });
  await assert.rejects(run(["apply", "--root", root, ...ids], { exec: g.exec }), (e) => e.code === 5 && /permiso de administración/.test(e.message) && /No se ha fijado nada/.test(e.message));
  assert.equal(g.st.secrets.size + g.st.variables.size, 0);
  assert.deepEqual(walk(root), [".env"]);
});

test("apply con fallo a mitad lista lo hecho y lo pendiente, y repetir termina (CB-05)", async () => {
  const root = project({ env: defaultEnv });
  let fallar = true;
  const g = simDel({}, { failOn: (a) => (fallar && a[0] === "variable" && a[1] === "set" && a[2] === "DISCORD_GIT_CHANNEL_ID" ? "HTTP 500: boom" : null) });
  await assert.rejects(run(["apply", "--root", root, ...ids], { exec: g.exec, random: fixedRandom }), (e) => {
    assert.match(e.message, /boom/);
    assert.match(e.message, /Quedó hecho: entorno, ficheros, DISCORD_GUILD_ID\./);
    assert.match(e.message, /No se hizo: DISCORD_GIT_CHANNEL_ID, DISCORD_BOT_TOKEN, DISCORD_CACHE_KEY\./);
    assert.match(e.message, /Repite apply para terminar/);
    assert.ok(!e.message.includes(BOT) && !e.message.includes(KEY));
    return true;
  });
  // Lo hecho queda: ficheros, entorno y la primera variable; los secretos no.
  assert.ok(exists(join(root, WF, "discord-pr-trigger.yml")));
  assert.ok(g.st.environment);
  assert.equal(g.st.variables.get("DISCORD_GUILD_ID"), GUILD);
  assert.equal(g.st.secrets.size, 0);
  fallar = false;
  const r = await apply(root, g);
  assert.equal(r.environment, "igual");
  assert.ok(r.files.every((f) => f.result === "igual"));
  assert.deepEqual(r.variables, { DISCORD_GUILD_ID: "igual", DISCORD_GIT_CHANNEL_ID: "creado" });
  assert.deepEqual(r.secrets, { DISCORD_BOT_TOKEN: "creado", DISCORD_CACHE_KEY: "creado" });
});

test("apply con fallo en el primer paso devuelve el error sin lista de hechos", async () => {
  const root = project({ env: defaultEnv });
  const g = simDel({}, { failOn: (a) => (a[0] === "api" && a[2] === "PUT" ? "HTTP 500: Server Error" : null) });
  await assert.rejects(run(["apply", "--root", root, ...ids], { exec: g.exec }), (e) => !/Quedó hecho/.test(e.message) && /500/.test(e.message));
});

test("apply con fallo al fijar un secreto deja lo anterior hecho y no filtra el valor (CB-05)", async () => {
  const root = project({ env: defaultEnv });
  const g = simDel({}, { failOn: (a) => (a[0] === "secret" && a[1] === "set" && a[2] === "DISCORD_CACHE_KEY" ? "HTTP 500: boom" : null) });
  await assert.rejects(run(["apply", "--root", root, ...ids], { exec: g.exec, random: fixedRandom }), (e) => /Quedó hecho: .*DISCORD_BOT_TOKEN\./.test(e.message) && /No se hizo: DISCORD_CACHE_KEY\./.test(e.message) && !e.message.includes(BOT));
  assert.ok(g.st.secrets.has("DISCORD_BOT_TOKEN"));
});

test("apply con IDs no numéricos falla antes de llamar a gh ni escribir (CB-03)", async () => {
  for (const args of [["--guild-id", "abc", "--channel-id", CHANNEL], ["--guild-id", GUILD, "--channel-id", "12-3"]]) {
    const root = project({ env: defaultEnv });
    const g = sim();
    await assert.rejects(run(["apply", "--root", root, ...args], { exec: g.exec }), (e) => e.code === 2 && /numérico/.test(e.message));
    assert.equal(g.calls.length, 0);
    assert.deepEqual(walk(root), [".env"]);
  }
});

test("apply sin rama predeterminada en el remoto falla antes de escribir (CB-07)", async () => {
  const root = project({ env: defaultEnv });
  const g = sim();
  const exec = async (args, o) => (args[0] === "repo" ? JSON.stringify({ nameWithOwner: "acme/app", defaultBranchRef: null }) : g.exec(args, o));
  await assert.rejects(run(["apply", "--root", root, ...ids], { exec }), (e) => e.code === 3 && /rama predeterminada/.test(e.message));
  assert.equal(g.writes().length, 0);
  assert.deepEqual(walk(root), [".env"]);
});

test("apply con una rama predeterminada inválida falla antes de escribir (CB-07)", async () => {
  const root = project({ env: defaultEnv });
  const g = sim();
  const exec = async (args, o) => (args[0] === "repo" ? JSON.stringify({ nameWithOwner: "acme/app", defaultBranchRef: { name: "a b" } }) : g.exec(args, o));
  await assert.rejects(run(["apply", "--root", root, ...ids], { exec }), (e) => e.code === 2 && /no es válida/.test(e.message));
  assert.deepEqual(walk(root), [".env"]);
});

test("apply con un fichero sin la marca lo conserva con aviso y no lo toca (CB-06)", async () => {
  const root = project({ env: defaultEnv });
  const f = join(root, WF, "discord-pr-confirmation-trigger.yml");
  mkdirSync(join(root, WF), { recursive: true });
  writeFileSync(f, "name: propio\n");
  const r = await apply(root, sim());
  assert.equal(byPath(r)[join(WF, "discord-pr-confirmation-trigger.yml")], "conservado");
  assert.equal(readFileSync(f, "utf8"), "name: propio\n");
  assert.ok(r.warnings.some((w) => w.includes("discord-pr-confirmation-trigger.yml")));
});

// --- cwd y --root (RNF-07, CB-08, escenario 10) ---

test("cwd y --root", async () => {
  // Todas las llamadas a gh llevan el cwd del proyecto de --root, no el del proceso.
  for (const command of ["detect", "apply", "reset"]) {
    const root = project({ env: defaultEnv });
    const g = sim({ environment: true, policies: ["main"], variables: { DISCORD_GUILD_ID: "1", DISCORD_GIT_CHANNEL_ID: "2" } });
    const cwds = [];
    const exec = (args, opts = {}) => {
      cwds.push(opts.cwd);
      return g.exec(args, opts);
    };
    await run([command, "--root", root], { exec, random: fixedRandom });
    assert.ok(cwds.length > 0, command);
    assert.notEqual(root, process.cwd());
    assert.ok(cwds.every((c) => c === root), `${command}: ${cwds.join(", ")}`);
  }

  // makeGh y repoInfo pasan el cwd al exec.
  const seen = [];
  const gh = makeGh({ token: "t", root: "/proyecto", exec: async (args, opts) => (seen.push(opts.cwd), JSON.stringify({ nameWithOwner: "a/b", defaultBranchRef: { name: "main" } })) });
  await repoInfo(gh, "/otro");
  await gh(["secret", "list"]);
  assert.deepEqual(seen, ["/otro", "/proyecto"]);

  // --root sin valor, vacío o que parece otra opción es un error de uso antes de leer o escribir.
  for (const argv of [["--root"], ["--root", ""], ["--root", "--base"], ["--root", "--guild-id", GUILD]]) {
    for (const command of ["detect", "apply", "reset"]) {
      assert.throws(() => parseArgs([command, ...argv]), (e) => e instanceof SetupDiscordError && e.code === 2 && /--root necesita una ruta\./.test(e.message), `${command} ${argv.join(" ")}`);
      let called = 0;
      await assert.rejects(run([command, ...argv, ...ids], { exec: async () => void called++ }), (e) => e.code === 2 && e.message === "--root necesita una ruta.");
      assert.equal(called, 0);
    }
  }
  // Un proyecto con .env y ficheros no cambia.
  const root = project({ env: defaultEnv });
  await assert.rejects(run(["apply", "--root", "--base", "main"], { exec: async () => assert.fail("no debe llamar a gh") }), { code: 2 });
  assert.deepEqual(walk(root), [".env"]);
  assert.equal(parseArgs(["detect", "--root", "/ruta"]).root, "/ruta");
});

test("apply sin ids conserva o falla", async () => {
  // D-12: si la variable existe se conserva sin escribirla; si no, error que nombra la opción y no se escribe nada.
  const root = project({ env: defaultEnv });
  const con = sim({ environment: true, policies: ["main"], variables: { DISCORD_GUILD_ID: "999", DISCORD_GIT_CHANNEL_ID: "888" } });
  const r = JSON.parse(await run(["apply", "--root", root], { exec: con.exec, random: fixedRandom }));
  assert.deepEqual(r.variables, { DISCORD_GUILD_ID: "conservado", DISCORD_GIT_CHANNEL_ID: "conservado" });
  assert.ok(!con.calls.some((c) => c.args[0] === "variable" && c.args[1] === "set"));
  assert.equal(con.st.variables.get("DISCORD_GUILD_ID"), "999");
  assert.equal(con.st.variables.get("DISCORD_GIT_CHANNEL_ID"), "888");

  for (const [opcion, nombre, dado] of [["--guild-id", "DISCORD_GUILD_ID", ["--channel-id", CHANNEL]], ["--channel-id", "DISCORD_GIT_CHANNEL_ID", ["--guild-id", GUILD]]]) {
    const limpio = project({ env: defaultEnv });
    const sin = sim();
    await assert.rejects(run(["apply", "--root", limpio, ...dado], { exec: sin.exec, random: fixedRandom }), (e) => e.code === 2 && e.message.includes(opcion) && e.message.includes(nombre));
    assert.equal(sin.writes().length, 0);
    assert.deepEqual(walk(limpio), [".env"]);
  }
});

// --- verify (escenarios 11 a 13, CB-10 a CB-12) ---

// fetch doble: registra cada petición y responde según la ruta. Un valor Error se lanza como fallo de red.
function fakeFetch(routes) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const path = String(url).replace("https://discord.com/api/v10", "");
    const r = routes[path];
    if (r instanceof Error) throw r;
    if (!r) return { status: 404, json: async () => ({ message: "Unknown" }) };
    return { status: r.status, json: async () => r.body ?? {} };
  };
  return { fetchFn, calls };
}
const okRoutes = {
  "/users/@me": { status: 200, body: { id: "9", username: "bot" } },
  [`/guilds/${GUILD}`]: { status: 200, body: { id: GUILD } },
  [`/channels/${CHANNEL}`]: { status: 200, body: { id: CHANNEL, guild_id: GUILD } },
};
const verifyArgs = (root, extra = ["--guild-id", GUILD, "--channel-id", CHANNEL]) => ["verify", "--root", root, ...extra];
const noExec = async () => assert.fail("verify no debe llamar a gh");

test("verify con todo correcto", async () => {
  const root = project({ env: defaultEnv });
  const f = fakeFetch(okRoutes);
  const r = JSON.parse(await run(verifyArgs(root), { exec: noExec, fetchFn: f.fetchFn }));
  assert.equal(r.ok, true);
  for (const k of ["token", "servidor", "canal"]) assert.equal(r.checks[k].result, "correcto", k);
  assert.deepEqual(f.calls.map((c) => c.url), [
    "https://discord.com/api/v10/users/@me",
    `https://discord.com/api/v10/guilds/${GUILD}`,
    `https://discord.com/api/v10/channels/${CHANNEL}`,
  ]);
  assert.ok(f.calls.every((c) => (c.init.method ?? "GET") === "GET"));
});

test("verify con token inválido omite servidor y canal", async () => {
  const root = project({ env: defaultEnv });
  const f = fakeFetch({ "/users/@me": { status: 401, body: { message: "401: Unauthorized" } } });
  const r = JSON.parse(await run(verifyArgs(root), { exec: noExec, fetchFn: f.fetchFn }));
  assert.equal(r.ok, false);
  assert.equal(r.checks.token.result, "fallo");
  assert.equal(r.checks.token.status, 401);
  assert.equal(r.checks.servidor.result, "omitida");
  assert.equal(r.checks.canal.result, "omitida");
  assert.equal(f.calls.length, 1);
});

test("verify con bot fuera del servidor", async () => {
  const root = project({ env: defaultEnv });
  const f = fakeFetch({ ...okRoutes, [`/guilds/${GUILD}`]: { status: 403, body: { message: "Missing Access" } } });
  const r = JSON.parse(await run(verifyArgs(root), { exec: noExec, fetchFn: f.fetchFn }));
  assert.equal(r.ok, false);
  assert.equal(r.checks.token.result, "correcto");
  assert.equal(r.checks.servidor.result, "fallo");
  assert.equal(r.checks.servidor.status, 403);
  assert.match(r.checks.servidor.reason, /403/);
});

test("verify con canal invisible o inexistente", async () => {
  const root = project({ env: defaultEnv });
  for (const status of [403, 404]) {
    const f = fakeFetch({ ...okRoutes, [`/channels/${CHANNEL}`]: { status, body: { message: "x" } } });
    const r = JSON.parse(await run(verifyArgs(root), { exec: noExec, fetchFn: f.fetchFn }));
    assert.equal(r.ok, false);
    assert.equal(r.checks.servidor.result, "correcto");
    assert.equal(r.checks.canal.result, "fallo");
    assert.equal(r.checks.canal.status, status);
  }
});

test("verify canal de otro servidor", async () => {
  const root = project({ env: defaultEnv });
  const f = fakeFetch({ ...okRoutes, [`/channels/${CHANNEL}`]: { status: 200, body: { id: CHANNEL, guild_id: "5555555" } } });
  const r = JSON.parse(await run(verifyArgs(root), { exec: noExec, fetchFn: f.fetchFn }));
  assert.equal(r.ok, false);
  assert.equal(r.checks.servidor.result, "correcto");
  assert.equal(r.checks.canal.result, "fallo");
  assert.match(r.checks.canal.reason, /otro servidor/);
});

test("verify con 429 o red caída es fallo sin reintentos y distinto del token inválido", async () => {
  const root = project({ env: defaultEnv });
  const limit = fakeFetch({ "/users/@me": { status: 429, body: { message: "rate limited", retry_after: 1 } } });
  const a = JSON.parse(await run(verifyArgs(root), { exec: noExec, fetchFn: limit.fetchFn }));
  assert.equal(a.ok, false);
  assert.equal(a.checks.token.result, "fallo");
  assert.equal(a.checks.token.status, 429);
  assert.match(a.checks.token.reason, /429/);
  assert.doesNotMatch(a.checks.token.reason, /rechaz/i);
  assert.equal(limit.calls.length, 1);

  const guild429 = fakeFetch({ ...okRoutes, [`/guilds/${GUILD}`]: { status: 429, body: {} } });
  const g = JSON.parse(await run(verifyArgs(root), { exec: noExec, fetchFn: guild429.fetchFn }));
  assert.equal(g.checks.servidor.result, "fallo");
  assert.equal(g.checks.servidor.status, 429);
  assert.equal(guild429.calls.filter((c) => c.url.includes("/guilds/")).length, 1);

  const down = fakeFetch({ "/users/@me": new TypeError("fetch failed: getaddrinfo ENOTFOUND") });
  const b = JSON.parse(await run(verifyArgs(root), { exec: noExec, fetchFn: down.fetchFn }));
  assert.equal(b.ok, false);
  assert.equal(b.checks.token.result, "fallo");
  assert.equal(b.checks.token.status, null);
  assert.doesNotMatch(b.checks.token.reason, /ENOTFOUND|getaddrinfo/);
  assert.equal(down.calls.length, 1);
});

test("verify sin token, ids ausentes o no numéricos falla con código 2 sin llamar a la red", async () => {
  const sinFetch = () => assert.fail("no debe llamar a la red");
  const sinToken = project({ env: "GITHUB_TOKEN=ghp_proyecto\n" });
  await assert.rejects(run(verifyArgs(sinToken), { exec: noExec, fetchFn: sinFetch }), (e) => e instanceof SetupDiscordError && e.code === 2 && e.message.includes("DISCORD_BOT_TOKEN"));
  const sinEnv = project();
  await assert.rejects(run(verifyArgs(sinEnv), { exec: noExec, fetchFn: sinFetch }), (e) => e.code === 2 && e.message.includes("DISCORD_BOT_TOKEN"));

  const root = project({ env: defaultEnv });
  const casos = [
    [["--channel-id", CHANNEL], "--guild-id"],
    [["--guild-id", GUILD], "--channel-id"],
    [[], "--guild-id"],
    [["--guild-id", "abc", "--channel-id", CHANNEL], "--guild-id"],
    [["--guild-id", GUILD, "--channel-id", "12x"], "--channel-id"],
  ];
  for (const [extra, nombre] of casos) {
    await assert.rejects(run(verifyArgs(root, extra), { exec: noExec, fetchFn: sinFetch }), (e) => e instanceof SetupDiscordError && e.code === 2 && e.message.includes(nombre), extra.join(" "));
  }
});

test("verify no filtra el token", async () => {
  // El token solo va en la cabecera Authorization; nunca en URL, cuerpo, salida ni motivos.
  const root = project({ env: defaultEnv });
  const escenarios = [
    okRoutes,
    { "/users/@me": { status: 401, body: { message: `Bad token ${BOT}` } } },
    { ...okRoutes, [`/guilds/${GUILD}`]: { status: 403, body: { message: `echo ${BOT}` } } },
    { ...okRoutes, [`/channels/${CHANNEL}`]: { status: 404, body: { message: `echo ${BOT}` } } },
    { "/users/@me": new Error(`fallo con ${BOT}`) },
  ];
  for (const routes of escenarios) {
    const f = fakeFetch(routes);
    const out = await run(verifyArgs(root), { exec: noExec, fetchFn: f.fetchFn });
    assert.ok(!out.includes(BOT), "la salida no lleva el token");
    assert.ok(f.calls.length > 0);
    for (const c of f.calls) {
      assert.ok(!c.url.includes(BOT), "la URL no lleva el token");
      assert.equal(c.init.body, undefined, "sin cuerpo");
      assert.equal(c.init.headers.Authorization, `Bot ${BOT}`);
      const resto = { ...c.init, headers: { ...c.init.headers, Authorization: "" } };
      assert.ok(!JSON.stringify(resto).includes(BOT), "el token solo está en Authorization");
    }
  }
});

test("verify no escribe ficheros ni llama a gh", async () => {
  const root = project({ env: defaultEnv });
  const antes = walk(root);
  const envAntes = readFileSync(join(root, ".env"), "utf8");
  const f = fakeFetch(okRoutes);
  await run(verifyArgs(root), { exec: noExec, fetchFn: f.fetchFn });
  assert.deepEqual(walk(root), antes);
  assert.equal(readFileSync(join(root, ".env"), "utf8"), envAntes);
});

test("verify por la CLI sale con código 6 si una comprobación falla", () => {
  const root = project({ env: defaultEnv });
  const script = new URL("scripts/setup-discord-notifications.mjs", SKILL).pathname;
  // Sin red real: un fetch global roto por --import hace que el token falle sin salir del proceso.
  const hook = join(root, "nofetch.mjs");
  writeFileSync(hook, "globalThis.fetch = async () => { throw new Error('sin red'); };\n");
  let status = 0;
  let stdout = "";
  try {
    stdout = execFileSync(process.execPath, ["--import", hook, script, "verify", "--root", root, "--guild-id", GUILD, "--channel-id", CHANNEL], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    status = e.status;
    stdout = e.stdout;
  }
  assert.equal(status, 6);
  assert.equal(JSON.parse(stdout).ok, false);
  assert.ok(!stdout.includes(BOT));
});

// Escenario 14 y CB-13/CB-14: la guía del paso 0 de SKILL.md.
const skillMd = () => read("SKILL.md");
const flujo = (text) => text.slice(text.indexOf("#### Flujo"), text.indexOf("#### Motivos de fallo"));
const paso0 = (text) => {
  const f = flujo(text);
  return f.slice(f.indexOf("0. **"), f.indexOf("\n1. "));
};

test("SKILL.md: el paso 0 va antes de detect", () => {
  const f = flujo(skillMd());
  const cero = f.indexOf("0. **Guía del bot");
  const uno = f.indexOf("1. Lanza `detect`");
  assert.ok(cero >= 0 && uno > cero);
  assert.match(paso0(skillMd()), /Antes de `detect`/);
  assert.match(paso0(skillMd()), /Si los tiene, salta este paso/);
  assert.ok(!/antes de lanzarla, crea el bot/i.test(skillMd()));
});

test("SKILL.md: no pide activar ningún intent privilegiado", () => {
  const text = skillMd();
  for (const intent of [/Server Members Intent/i, /Message Content/i, /Presence/]) assert.ok(!intent.test(text), String(intent));
  assert.match(paso0(text), /Privileged Gateway Intents/);
  assert.match(paso0(text), /desactivados/);
  assert.match(paso0(text), /No pidas activar ninguno/);
});

test("SKILL.md: el enlace de invitación lleva scope=bot y permissions=3072, sin Mention Everyone", () => {
  const links = skillMd().match(/https:\/\/discord\.com\/oauth2\/authorize\?[^\s`)]+/g) ?? [];
  assert.ok(links.length >= 1);
  for (const link of links) {
    const url = new URL(link);
    assert.equal(url.searchParams.get("scope"), "bot");
    assert.equal(url.searchParams.get("permissions"), "3072");
    assert.ok(url.searchParams.has("client_id"));
    const bits = BigInt(url.searchParams.get("permissions"));
    assert.equal(bits & (1n << 17n), 0n, "Mention Everyone (1<<17) no debe estar");
    assert.equal(bits, (1n << 10n) | (1n << 11n), "solo View Channel y Send Messages");
  }
  assert.ok(!/Mention Everyone/i.test(skillMd()));
  assert.match(paso0(skillMd()), /ID de la aplicación/);
});

test("SKILL.md: la description menciona la guía y que verify consulta discord.com", () => {
  const description = skillMd().match(/^description: "(.*)"$/m)?.[1] ?? "";
  assert.match(description, /guía/i);
  assert.match(description, /verify/);
  assert.match(description, /discord\.com/);
});

test("SKILL.md: verify pide confirmación antes de lanzarse y apply no depende de él", () => {
  const text = skillMd();
  const f = flujo(text);
  const verify = f.slice(f.indexOf("5. Ofrece `verify`"), f.indexOf("\n6. "));
  assert.ok(verify.length > 0);
  assert.ok(verify.indexOf("pide confirmación") >= 0 && verify.indexOf("pide confirmación") < verify.indexOf("lanza `verify`"));
  assert.match(verify, /opcional/);
  assert.match(verify, /Si rechaza, sigue sin él/);
  assert.match(text, /\*\*`verify` solo con confirmación\*\*/);
  assert.match(text, /`apply` no depende de él/);
  const apply = f.slice(f.indexOf("6. Lanza `apply`"), f.indexOf("\n7. "));
  assert.ok(!/verify/.test(apply));
  assert.ok(f.indexOf("5. Ofrece `verify`") > f.indexOf("1. Lanza `detect`") && f.indexOf("5. Ofrece `verify`") < f.indexOf("6. Lanza `apply`"));
});

test("SKILL.md: el token no pasa por el chat y el aviso de .gitignore va antes de pedirlo (CB-14)", () => {
  const cero = paso0(skillMd());
  assert.match(cero, /sin pegarlo en el chat/);
  const gitignore = cero.indexOf(".gitignore");
  assert.ok(gitignore >= 0);
  assert.ok(gitignore < cero.indexOf("1. Entrar"), "el aviso va antes del primer paso de la guía");
  assert.ok(gitignore < cero.indexOf("DISCORD_BOT_TOKEN"));
  assert.match(skillMd(), /el token, nunca/);
  assert.match(skillMd(), /Si `\.env` no está en `\.gitignore`, avísalo antes de pedírselo/);
});

test("SKILL.md: un token perdido o mal copiado se regenera con Reset Token (CB-13)", () => {
  const text = skillMd();
  assert.match(paso0(text), /Reset Token/);
  assert.match(paso0(text), /una sola vez/);
  assert.match(paso0(text), /se perdió/);
  assert.match(paso0(text), /el anterior deja de valer/);
  assert.match(text, /\*\*`token` con `fallo` \(HTTP 401\)\*\*[^\n]*Reset Token/);
});

// Escenarios 15 y 22: lo que el agente dice en los recordatorios finales.
const pasos = (text) => flujo(text).split(/\n(?=\d+\. )/);
const paso = (text, inicio) => {
  const found = pasos(text).filter((p) => new RegExp(`^\\d+\\. ${inicio}`).test(p));
  assert.equal(found.length, 1, `un solo paso «${inicio}»`);
  return { texto: found[0], numero: Number(found[0].match(/^\d+/)[0]) };
};

test("SKILL.md: tras apply informa de DISCORD_USER_MAP y /discord-map", () => {
  const text = skillMd();
  const aviso = paso(text, "Informa en el chat sobre las menciones");
  assert.ok(aviso.numero > paso(text, "Lanza `apply`").numero, "el aviso va después de apply");
  assert.ok(aviso.numero > paso(text, "Recuerda que los workflows").numero, "va junto a los recordatorios finales");
  const t = aviso.texto;
  assert.match(t, /sin preguntar los valores de `DISCORD_USER_MAP` ni crear la variable/);

  // Cuándo la mención sale sola y qué pasa si los nombres difieren.
  assert.match(t, /nombre de usuario de Discord del revisor coincide con su login de GitHub/);
  assert.match(t, /coincidencia exacta y única, sin distinguir mayúsculas/);
  assert.match(t, /miembro del servidor/);
  assert.match(t, /Si difieren, sin mapa ni `\/discord-map` el aviso sale sin mencionarlo \(«sin mención de Discord»\) y no es un fallo/);

  // Mapa permanente: variable del entorno, forma, duración, precedencia y fallos.
  assert.match(t, /variable `DISCORD_USER_MAP` del entorno `discord-pr-notifications`/);
  assert.match(t, /Settings.*Environments/);
  assert.match(t, /No caduca y prevalece sobre `\/discord-map` y la caché/);
  const fallos = t.match(/Hacen fallar el aviso [^.]+\./)?.[0];
  assert.ok(fallos, "enumera lo que hace fallar el aviso");
  for (const fallo of [/JSON mal formado/, /login inválido,/, /login repetido con distinta capitalización/, /17 a 20 dígitos/, /revisor pedido que no esté en el servidor/]) assert.match(fallos, fallo);
  assert.match(t, /Dos claves idénticas en el JSON no dan error: gana la última/);
  const mapa = t.match(/`(\{"[^`]+\})`/)?.[1];
  assert.ok(mapa, "trae un ejemplo del JSON");
  const id = "123456789012345678";
  assert.deepEqual([...parseUserMap(mapa.replace("ID_DE_DISCORD", id))], [["login-de-github", id]]);
  assert.match(t, /cada ID entre comillas/);

  // Comentario: forma, quién, para quién, duración y visibilidad, contrastados con la acción.
  const comando = t.match(/`(\/discord-map LOGIN_GITHUB ID_DISCORD)`, sin más texto en el comentario/)?.[1];
  assert.ok(comando, "trae la forma del comentario");
  const body = comando.replace("LOGIN_GITHUB", "octocat").replace("ID_DISCORD", id);
  const now = Date.now();
  const pr = { user: { id: 1 } };
  const comment = (extra) => ({ body, user: { id: 2 }, author_association: "NONE", updated_at: new Date(now).toISOString(), ...extra });
  assert.match(t, /lo escribe el autor de la PR o alguien que GitHub marca como/);
  assert.ok(parseMappingComment(comment({ user: { id: 1 } }), pr, "acme/app", now), "autor de la PR");
  for (const association of ["OWNER", "MEMBER", "COLLABORATOR"]) {
    assert.ok(t.includes(`\`${association}\``), association);
    assert.ok(parseMappingComment(comment({ author_association: association }), pr, "acme/app", now), association);
  }
  assert.equal(parseMappingComment(comment({ author_association: "CONTRIBUTOR" }), pr, "acme/app", now), null);
  assert.equal(parseMappingComment(comment({ user: { id: 1 }, body: `${body} gracias` }), pr, "acme/app", now), null);
  assert.match(t, /para un revisor pedido y con el ID de un miembro del servidor/);
  assert.match(t, new RegExp(`Dura ${RELATION_LIFETIME_MS / 3_600_000} horas desde que se publica o se edita`));
  assert.match(t, /visible en la PR/);

  // De dónde sale el ID.
  assert.match(t, /modo desarrollador y «Copiar ID de usuario»/);
  assert.match(t, /El token del bot, nunca/);

  // La regla crítica se ajusta a D-08 y apunta al paso del aviso.
  const regla = text.split("\n").find((line) => line.startsWith("- **`DISCORD_USER_MAP`"));
  assert.ok(regla);
  assert.match(regla, /se explica, no se pregunta ni se crea/);
  assert.ok(regla.includes(`(paso ${aviso.numero})`), regla);
  assert.ok(!/No preguntes por `DISCORD_USER_MAP`/.test(text));
  // Antes del aviso, el flujo no pregunta por el mapa ni lo fija.
  for (const p of pasos(text).slice(0, aviso.numero)) assert.ok(!p.includes("DISCORD_USER_MAP"), p);
  assert.ok(!/variable set DISCORD_USER_MAP/.test(text));
});

test("apply no crea ni fija DISCORD_USER_MAP", async () => {
  const g = sim();
  await apply(project({ env: defaultEnv }), g);
  assert.ok(g.writes().length > 0);
  assert.ok(!g.calls.some((c) => c.args.includes("DISCORD_USER_MAP")));
});

test("SKILL.md: los workflows van también a una base distinta", async () => {
  const text = skillMd();
  const recordatorio = paso(text, "Recuerda que los workflows");
  assert.ok(recordatorio.numero > paso(text, "Lanza `apply`").numero);
  const t = recordatorio.texto;
  assert.match(t, /solo actúan cuando están en la rama predeterminada/);
  assert.match(t, /si la rama base no es la predeterminada.*la persona los lleve también a la base/);
  assert.match(t, /El commit y el merge son de la persona/);
  assert.match(t, /la skill no hace commit, push ni PR/);
  // Los campos que el recordatorio manda comparar salen en la salida de apply.
  const result = await apply(project({ env: defaultEnv }), sim({ branches: ["main", "release/1.0"] }), ["--base", "release/1.0"]);
  for (const [field, value] of [["baseBranch", "release/1.0"], ["defaultBranch", "main"]]) {
    assert.ok(t.includes(`\`${field}\``), field);
    assert.equal(result[field], value, field);
  }
});

test("SKILL.md: la referencia al paso de la prueba real apunta a ese paso", () => {
  const text = skillMd();
  const prueba = paso(text, "Resume la prueba");
  assert.ok(text.includes(`la prueba real del aviso (paso ${prueba.numero})`));
});
