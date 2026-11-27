// Camino de GitLab: detección del forge, lectura del .env y llamadas a la API, con un curl falso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkForge, connect, createClient, envValue, parseHeaders, parseRemote, readToken, resolveForge,
} from "../.apm/skills/check-status/scripts/gitlab.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(root, ".apm/skills/check-status/scripts/gitlab.mjs");
const SKILLS = [
  "assign-author", "assign-reviewers", "check-status", "close-issue", "edit-pull-request", "github-cache",
  "issue-spec", "link-pr-to-issue", "manage-draft", "manage-issue", "manage-pr-base", "ready-pull-request",
];
const TOKEN = "glpat-secreto-de-prueba-0123456789";
const URL_BASE = "https://gitlab.com";

function repo(origin, envText) {
  const folder = mkdtempSync(join(tmpdir(), "gitlab-test-"));
  execFileSync("git", ["init", "-q", folder]);
  if (origin) execFileSync("git", ["-C", folder, "remote", "add", "origin", origin]);
  writeFileSync(join(folder, ".gitignore"), ".env\n");
  if (envText !== undefined) writeFileSync(join(folder, ".env"), envText);
  return folder;
}

const forgeOf = async (folder, env = {}) => (await resolveForge({ cwd: folder, env })).forge;

// Un curl en memoria: anota argumentos y stdin, y escribe la respuesta en los ficheros que piden los argumentos.
function fakeCurl(responses) {
  const calls = [];
  const run = async (args, input) => {
    const option = (name) => args[args.indexOf(name) + 1];
    const data = args.indexOf("--data-binary");
    calls.push({ args, input, url: option("--url"), method: option("--request"), body: data < 0 ? undefined : JSON.parse(readFileSync(args[data + 1].slice(1), "utf8")) });
    const response = responses.shift();
    assert.ok(response, "petición de más");
    if (response.error) throw response.error;
    const headers = Object.entries(response.headers ?? {}).map(([name, value]) => `${name}: ${value}`);
    writeFileSync(option("--dump-header"), [`HTTP/2 ${response.status ?? 200}`, ...headers, "", ""].join("\r\n"));
    writeFileSync(option("--output"), response.raw ?? JSON.stringify(response.data ?? null));
    return String(response.status ?? 200);
  };
  return { calls, run };
}

const client = (responses, project = "grupo/proyecto") => {
  const curl = fakeCurl(responses);
  return { ...createClient({ url: URL_BASE, project, token: TOKEN }, { run: curl.run }), calls: curl.calls };
};

test("las 12 skills llevan la misma copia de gitlab.mjs", () => {
  const original = readFileSync(SCRIPT, "utf8");
  const withGh = readdirSync(join(root, ".apm/skills")).filter((skill) => existsSync(join(root, ".apm/skills", skill, "scripts/gh.sh")));
  assert.deepEqual(withGh.sort(), SKILLS, "cada skill con gh.sh lleva también gitlab.mjs");
  for (const skill of SKILLS) {
    assert.equal(readFileSync(join(root, ".apm/skills", skill, "scripts/gitlab.mjs"), "utf8"), original, skill);
  }
});

test("detectar el forge por el host de origin", async () => {
  assert.equal(await forgeOf(repo("git@github.com:owner/repo.git")), "github");
  assert.equal(await forgeOf(repo("https://gitlab.com/grupo/proyecto.git")), "gitlab");
  assert.equal(await forgeOf(repo("git@codigo.empresa.com:grupo/proyecto.git")), "github");
  assert.equal(await forgeOf(repo("git@codigo.empresa.com:grupo/proyecto.git"), { GIT_WORKFLOW_FORGE: "gitlab" }), "gitlab");
  assert.equal(await forgeOf(repo("/tmp/origin.git")), "github");
  assert.equal(await forgeOf(repo(null)), "github");
});

test("GIT_WORKFLOW_FORGE se lee del .env y el entorno manda", async () => {
  const folder = repo("git@codigo.empresa.com:grupo/proyecto.git", "export GIT_WORKFLOW_FORGE='GitLab' # el nuestro\n");
  assert.equal(await forgeOf(folder), "gitlab");
  assert.equal(await forgeOf(folder, { GIT_WORKFLOW_FORGE: "github" }), "github");
});

test("la dirección y el proyecto salen de origin, con subgrupos", async () => {
  const of = async (origin, env) => {
    const found = await resolveForge({ cwd: repo(origin), env: { GIT_WORKFLOW_FORGE: "gitlab", ...env } });
    return [found.url, found.project];
  };
  assert.deepEqual(await of("git@gitlab.com:grupo/sub/proyecto.git"), ["https://gitlab.com", "grupo/sub/proyecto"]);
  assert.deepEqual(await of("ssh://git@codigo.empresa.com:2222/grupo/proyecto.git"), ["https://codigo.empresa.com", "grupo/proyecto"]);
  assert.deepEqual(await of("https://codigo.empresa.com:8443/grupo/proyecto"), ["https://codigo.empresa.com:8443", "grupo/proyecto"]);
  assert.deepEqual(await of("http://codigo.empresa.com/grupo/proyecto.git"), ["https://codigo.empresa.com", "grupo/proyecto"]);
  assert.deepEqual(await of("git@ssh.empresa.com:grupo/proyecto.git", { GIT_WORKFLOW_FORGE_URL: "https://empresa.com/gitlab/" }), ["https://empresa.com/gitlab", "grupo/proyecto"]);
  assert.deepEqual(await of("https://empresa.com/gitlab/grupo/proyecto.git", { GIT_WORKFLOW_FORGE_URL: "https://empresa.com/gitlab" }), ["https://empresa.com/gitlab", "grupo/proyecto"]);
});

test("un origin sin grupo o ausente no sirve para GitLab", async () => {
  const env = { GIT_WORKFLOW_FORGE: "gitlab" };
  await assert.rejects(resolveForge({ cwd: repo("git@gitlab.com:proyecto.git"), env }), /grupo\/proyecto/);
  await assert.rejects(resolveForge({ cwd: repo(null), env }), /origin/);
});

test("parseRemote no toma una ruta local por un host", () => {
  assert.equal(parseRemote("/srv/git/repo.git"), null);
  assert.equal(parseRemote("file:///srv/git/repo.git"), null);
  assert.equal(parseRemote("C:\\repos\\proyecto"), null);
});

test("un forge o una dirección que no valen fallan antes de leer el token", async () => {
  const folder = repo("git@gitlab.com:grupo/proyecto.git");
  await assert.rejects(connect({ cwd: folder, env: { GIT_WORKFLOW_FORGE: "bitbucket" } }), /github o gitlab/);
  for (const value of ["http://gitlab.com", "gitlab.com", "https://ada:clave@gitlab.com", "https://gitlab.com/?a=1"]) {
    await assert.rejects(connect({ cwd: folder, env: { GIT_WORKFLOW_FORGE_URL: value } }), /GIT_WORKFLOW_FORGE_URL/, value);
  }
});

test("un host propio sin forge ni GITHUB_TOKEN nombra GIT_WORKFLOW_FORGE=gitlab", async () => {
  const origin = "git@codigo.empresa.com:grupo/proyecto.git";
  await assert.rejects(checkForge({ cwd: repo(origin, ""), env: {} }), /GIT_WORKFLOW_FORGE=gitlab/);
  await assert.rejects(checkForge({ cwd: repo(origin), env: {} }), /GIT_WORKFLOW_FORGE=gitlab/);
  assert.equal((await checkForge({ cwd: repo(origin, "GITHUB_TOKEN=abc\n"), env: {} })).forge, "github");
  assert.equal((await checkForge({ cwd: repo(origin), env: { GIT_WORKFLOW_FORGE: "github" } })).forge, "github");
  assert.equal((await checkForge({ cwd: repo("git@github.com:owner/repo.git"), env: {} })).forge, "github");
});

test("el .env se lee como en gh.sh", () => {
  const value = (text) => envValue(text, "GITLAB_TOKEN");
  assert.equal(value("GITLAB_TOKEN=abc"), "abc");
  assert.equal(value("  export GITLAB_TOKEN = \"abc\"\r\n"), "abc");
  assert.equal(value("GITLAB_TOKEN=abc # personal"), "abc");
  assert.equal(value("GITLAB_TOKEN='abc' # personal"), "abc");
  assert.equal(value("GITLAB_TOKEN=viejo\nGITLAB_TOKEN=nuevo\n"), "nuevo");
  assert.equal(value("# GITLAB_TOKEN=abc\nOTRO_GITLAB_TOKEN=abc"), null);
});

test("el token exige un .env ignorado y un valor limpio", async () => {
  assert.equal(await readToken(repo(null, `GITLAB_TOKEN=${TOKEN}\n`)), TOKEN);
  await assert.rejects(readToken(repo(null)), /Falta el fichero \.env/);
  for (const text of ["", "GITLAB_TOKEN=\n", "GITLAB_TOKEN=con espacios\n", "GITLAB_TOKEN=a\\b\n", "GITLAB_TOKEN=a\"b\n"]) {
    await assert.rejects(readToken(repo(null, text)), /GITLAB_TOKEN válido/, JSON.stringify(text));
  }
  const exposed = repo(null, `GITLAB_TOKEN=${TOKEN}\n`);
  writeFileSync(join(exposed, ".gitignore"), "\n");
  await assert.rejects(readToken(exposed), /\.gitignore/);
});

test("en un worktree vale el .env de la copia principal", async () => {
  const main = repo(null, `GITLAB_TOKEN=${TOKEN}\n`);
  execFileSync("git", ["-C", main, "add", ".gitignore"]);
  execFileSync("git", ["-C", main, "-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-q", "-m", "init"]);
  const tree = join(mkdtempSync(join(tmpdir(), "gitlab-tree-")), "rama");
  execFileSync("git", ["-C", main, "worktree", "add", "-q", tree]);
  assert.equal(await readToken(tree), TOKEN);
});

test("el token del entorno no se usa y GitHub no lee GITLAB_TOKEN", async () => {
  const gitlab = repo("git@gitlab.com:grupo/proyecto.git");
  await assert.rejects(connect({ cwd: gitlab, env: { GITLAB_TOKEN: TOKEN } }), /Falta el fichero \.env/);
  const github = repo("git@github.com:owner/repo.git", `GITLAB_TOKEN=${TOKEN}\n`);
  await assert.rejects(connect({ cwd: github, env: {} }), /GitHub/);
});

test("cada petición va por HTTPS, con el token solo en stdin y sin seguir redirecciones", async () => {
  const api = client([{ data: { ok: true } }], "grupo/sub/proyecto");
  await api.request("POST", api.scoped("issues"), { query: { a: "x y" }, body: { title: "T" } });
  const [call] = api.calls;
  assert.equal(call.url, "https://gitlab.com/api/v4/projects/grupo%2Fsub%2Fproyecto/issues?a=x+y");
  assert.equal(call.method, "POST");
  assert.deepEqual(call.body, { title: "T" });
  assert.equal(call.args[0], "-q");
  assert.equal(call.args[call.args.indexOf("--proto") + 1], "=https");
  assert.ok(!call.args.includes("--location") && !call.args.includes("-L"));
  assert.ok(!call.args.join(" ").includes(TOKEN));
  assert.equal(call.input, `header = "PRIVATE-TOKEN: ${TOKEN}"\n`);
});

test("los ficheros temporales desaparecen, también si la petición falla", async () => {
  const api = client([{ status: 500, data: { message: "fallo" } }]);
  await assert.rejects(api.request("PUT", "user", { body: { a: 1 } }), /HTTP 500\. fallo/);
  const [call] = api.calls;
  assert.ok(!existsSync(dirname(call.args[call.args.indexOf("--output") + 1])));
});

test("GitLab rechaza el token o falta el permiso: se dice y no se repite", async () => {
  const cases = [
    [{ status: 401, data: { message: "401 Unauthorized" } }, /rechaza el token/],
    [{ status: 403, data: { error: "insufficient_scope" } }, /permiso api/],
    [{ status: 403, data: { message: "403 Forbidden" } }, /no permite esta acción/],
    [{ status: 404, data: { message: "404 Not Found" } }, /404/],
    [{ status: 302, raw: "" }, /redirige/],
  ];
  for (const [response, expected] of cases) {
    const api = client([response]);
    await assert.rejects(api.request("POST", "user", { body: {} }), (error) => expected.test(error.message) && error.status === response.status);
    assert.equal(api.calls.length, 1);
  }
});

test("un mensaje de error nunca muestra el token", async () => {
  const echoed = client([{ status: 400, data: { message: `token ${TOKEN} no vale` } }]);
  await assert.rejects(echoed.request("GET", "user"), (error) => !error.message.includes(TOKEN) && error.message.includes("[token]"));
  const network = client([{ error: Object.assign(new Error("x"), { code: 7, stderr: `curl: (7) ${TOKEN}` }) }]);
  await assert.rejects(network.request("GET", "user"), (error) => !error.message.includes(TOKEN) && /conectar/.test(error.message));
  const graph = client([{ data: { errors: [{ message: TOKEN }] } }]);
  await assert.rejects(graph.graphql("query { x }"), (error) => !error.message.includes(TOKEN));
});

test("sin curl, el error lo dice", async () => {
  const api = client([{ error: Object.assign(new Error("spawn curl ENOENT"), { code: "ENOENT" }) }]);
  await assert.rejects(api.request("GET", "user"), /curl no está instalado/);
});

test("una respuesta correcta que no es JSON es un error", async () => {
  await assert.rejects(client([{ raw: "<html>" }]).request("GET", "user"), /JSON/);
});

test("paginate lee todas las páginas", async () => {
  const api = client([
    { data: [1, 2], headers: { "x-next-page": "2" } },
    { data: [3], headers: { "x-next-page": "" } },
  ]);
  assert.deepEqual(await api.paginate("things", { state: "opened" }), [1, 2, 3]);
  assert.deepEqual(api.calls.map((call) => call.url), [
    "https://gitlab.com/api/v4/things?state=opened&per_page=100&page=1",
    "https://gitlab.com/api/v4/things?state=opened&per_page=100&page=2",
  ]);
});

test("graphql va a /api/graphql y devuelve data", async () => {
  const api = client([{ data: { data: { ok: 1 } } }]);
  assert.deepEqual(await api.graphql("query($a:ID!) { x }", { a: "1" }), { ok: 1 });
  assert.equal(api.calls[0].url, "https://gitlab.com/api/graphql");
  assert.deepEqual(api.calls[0].body, { query: "query($a:ID!) { x }", variables: { a: "1" } });
});

test("de varios bloques de cabeceras vale el último", () => {
  const text = "HTTP/1.1 200 Connection established\r\n\r\nHTTP/2 200\r\nX-Next-Page: 3\r\n\r\n";
  assert.deepEqual(parseHeaders(text), { "x-next-page": "3" });
});

test("whoami desde la terminal usa el curl del PATH sin mostrar el token", () => {
  const folder = repo("git@gitlab.com:grupo/proyecto.git", `GITLAB_TOKEN=${TOKEN}\n`);
  const bin = mkdtempSync(join(tmpdir(), "gitlab-bin-"));
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "curl"), `#!/usr/bin/env bash
printf '%s\\n' "$@" >"$FAKE_CURL_ARGS"
cat >"$FAKE_CURL_STDIN"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) echo '{"id":1,"username":"ada"}' >"$2"; shift ;;
    --dump-header) printf 'HTTP/2 200\\r\\n\\r\\n' >"$2"; shift ;;
  esac
  shift
done
printf 200
`);
  chmodSync(join(bin, "curl"), 0o755);
  const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, FAKE_CURL_ARGS: join(bin, "args"), FAKE_CURL_STDIN: join(bin, "stdin") };
  delete env.GIT_WORKFLOW_FORGE;
  delete env.GIT_WORKFLOW_FORGE_URL;
  const run = (command) => spawnSync("node", [SCRIPT, command], { cwd: folder, env, encoding: "utf8" });
  const who = run("whoami");
  assert.equal(who.stdout, "ada\n", who.stderr);
  assert.ok(!`${who.stdout}${who.stderr}${readFileSync(join(bin, "args"), "utf8")}`.includes(TOKEN));
  assert.ok(readFileSync(join(bin, "stdin"), "utf8").includes(TOKEN));
  assert.equal(run("forge").stdout, "gitlab\n");
  assert.equal(run("otra").status, 1);
});
