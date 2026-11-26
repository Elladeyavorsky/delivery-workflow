// Merge requests en GitLab: creación, draft, asignación, revisión, check-status y caché de revisores.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { draftless, findQuickAction } from "../.apm/skills/check-status/scripts/gitlab.mjs";
import { run as issueSpec } from "../.apm/skills/issue-spec/scripts/issue-spec.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skills = join(root, ".apm/skills");
const FAKE = join(root, "tests/fixtures/fake-gitlab.mjs");
const GITLAB = join(skills, "manage-draft/scripts/gitlab.mjs");
const TOKEN = "glpat-secreto-de-prueba-0123456789";
const ADA = { id: 1, username: "ada", name: "Ada" };
const BOB = { id: 2, username: "bob.smith", name: "Bob" };
const CAM = { id: 3, username: "cam_r", name: null };
const OUT = { id: 4, username: "fuera", name: "Fuera" };

const mergeRequest = (extra = {}) => ({
  iid: 1, state: "opened", title: "Draft: Add notes", description: "Cambio.\n\nCloses #7", draft: true,
  source_branch: "7-feat-add-notes", target_branch: "staging", source_project_id: 1, target_project_id: 1,
  author: ADA, assignees: [], reviewers: [], discussions: [],
  web_url: "https://gitlab.com/grupo/sub/proyecto/-/merge_requests/1", ...extra,
});

const thread = (author, resolved = false, body = "Cambia esto") => ({
  notes: [{ author, body, system: false, resolvable: true, resolved, position: { new_path: "src/a.js", new_line: 3 } }],
});

function project(initial = {}, { env: envText = `GITLAB_TOKEN=${TOKEN}\n`, tools } = {}) {
  const work = mkdtempSync(join(tmpdir(), "gitlab-mr-"));
  const repo = join(work, "repo");
  const bin = join(work, "bin");
  execFileSync("git", ["init", "-q", "-b", "7-feat-add-notes", repo]);
  execFileSync("git", ["-C", repo, "remote", "add", "origin", "git@gitlab.com:grupo/sub/proyecto.git"]);
  writeFileSync(join(repo, ".gitignore"), ".env\n");
  if (envText !== null) writeFileSync(join(repo, ".env"), envText);
  mkdirSync(bin);
  writeFileSync(join(bin, "curl"), `#!/usr/bin/env bash\nexec "${process.execPath}" "${FAKE}" "$@"\n`);
  writeFileSync(join(bin, "gh"), `#!/usr/bin/env bash\necho "$*" >>"${join(work, "gh.log")}"\nexit 1\n`);
  chmodSync(join(bin, "curl"), 0o755);
  chmodSync(join(bin, "gh"), 0o755);
  const store = join(work, "state.json");
  writeFileSync(store, JSON.stringify({
    token: TOKEN, project: "grupo/sub/proyecto", me: ADA, users: [ADA, BOB, CAM, OUT], members: { 1: 40, 2: 30, 3: 20 },
    labels: [], issues: {}, mergeRequests: {}, calls: [], ...initial,
  }));
  let path = `${bin}${delimiter}${process.env.PATH}`;
  if (tools) {
    // Un PATH con solo estas herramientas, para probar que falta alguna.
    const only = join(work, "only");
    mkdirSync(only);
    for (const tool of tools) {
      const real = tool === "node" ? process.execPath : execFileSync("bash", ["-c", `command -v ${tool}`], { encoding: "utf8" }).trim();
      symlinkSync(real, join(only, tool));
    }
    path = only;
  }
  const env = { ...process.env, PATH: path, FAKE_GITLAB: store };
  for (const name of ["GIT_WORKFLOW_FORGE", "GIT_WORKFLOW_FORGE_URL", "GIT_WORKFLOW_BASE"]) delete env[name];
  const exec = (command, args) => {
    const result = spawnSync(command, args, { cwd: repo, env, encoding: "utf8" });
    assert.ok(!`${result.stdout}${result.stderr}`.includes(TOKEN), "el token salió por la terminal");
    return result;
  };
  const script = (path_, ...args) => exec(path_.endsWith(".sh") ? "bash" : "node", [join(skills, path_), ...args]);
  return {
    repo,
    state: () => JSON.parse(readFileSync(store, "utf8")),
    gitlab: (...args) => exec("node", [GITLAB, ...args]),
    script,
    spec: (...args) => script("issue-spec/scripts/issue-spec.mjs", ...args),
    status: () => script("check-status/scripts/check-status.sh"),
    open: (title = "Add notes", body = "Cambio.\n\nCloses #\n") => {
      writeFileSync(join(repo, "mr.md"), body);
      return script("manage-pr-base/scripts/manage-pr-base.sh", "7-feat-add-notes", title, "mr.md", "feat", "staging");
    },
    ghCalls: () => (existsSync(join(work, "gh.log")) ? readFileSync(join(work, "gh.log"), "utf8") : ""),
  };
}

const writes = (state) => state.calls.filter((call) => call.method !== "GET" && !call.body?.query?.startsWith("query"));

test("manage-pr-base abre el merge request en draft, asignado y etiquetado, y no lo repite", () => {
  const gl = project();
  const first = gl.open();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, "Etiqueta feat: creada.\nhttps://gitlab.com/grupo/sub/proyecto/-/merge_requests/1\nBase: staging\n");
  const item = gl.state().mergeRequests[1];
  assert.deepEqual([item.title, item.draft, item.source_branch, item.target_branch, item.labels, item.assignees],
    ["Draft: Add notes", true, "7-feat-add-notes", "staging", ["feat"], [{ id: 1 }]]);
  const before = writes(gl.state()).length;
  const second = gl.open("docs: otro título");
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /ya existía: https:\/\/gitlab\.com\/.*\/merge_requests\/1\nNo se ha tocado/);
  assert.equal(writes(gl.state()).length, before);
  assert.equal(gl.ghCalls(), "");
});

test("un merge request de un fork con la misma rama no cuenta", () => {
  const gl = project({ mergeRequests: { 1: mergeRequest({ source_project_id: 9 }) } });
  assert.match(gl.open().stdout, /merge_requests\/2/);
});

test("manage-pr-base comprueba título y cuerpo antes de crear", () => {
  const gl = project();
  assert.equal(gl.open("docs: add notes").status, 1);
  assert.match(gl.open("Add notes", "Como pide la issue #7.").stderr, /no nombra la issue/);
  const command = gl.open("Add notes", "Texto\n/merge\n");
  assert.equal(command.status, 1);
  assert.match(command.stderr, /«\/merge» como un comando/);
  assert.deepEqual(writes(gl.state()), []);
});

test("cambiar el título conserva el draft y salir del draft quita el prefijo", () => {
  const gl = project({ mergeRequests: { 1: mergeRequest() } });
  assert.equal(gl.gitlab("mr", "edit", "1", "--title", "Add more notes").status, 0);
  assert.equal(gl.state().mergeRequests[1].title, "Draft: Add more notes");
  const view = JSON.parse(gl.gitlab("mr", "view", "!1").stdout);
  assert.deepEqual([view.title, view.isDraft, view.number, view.reviewDecision], ["Add more notes", true, 1, "—"]);
  assert.equal(gl.gitlab("mr", "ready", "1").stdout, "Merge request #1: ahora listo para revisión.\n");
  assert.equal(gl.state().mergeRequests[1].title, "Add more notes");
  assert.equal(gl.gitlab("mr", "ready", "1").stdout, "Merge request #1: ya listo para revisión.\n");
  gl.gitlab("mr", "edit", "1", "--title", "Draft: Add other notes");
  assert.equal(gl.state().mergeRequests[1].title, "Add other notes");
  const url = "https://gitlab.com/grupo/sub/proyecto/-/merge_requests/1";
  assert.equal(gl.gitlab("mr", "draft", url).status, 0);
  assert.equal(gl.state().mergeRequests[1].draft, true);
});

test("todos los prefijos de draft se quitan", () => {
  for (const title of ["Draft: Add", "[Draft] Add", "(draft) Add", "DRAFT: [Draft] Add"]) assert.equal(draftless(title), "Add", title);
  assert.equal(draftless("Drafting notes"), "Drafting notes");
});

test("el cuerpo se edita desde un fichero y un comando de GitLab lo bloquea", () => {
  const gl = project({ mergeRequests: { 1: mergeRequest() } });
  writeFileSync(join(gl.repo, "body.md"), "Nuevo\n\nCloses #7\n");
  assert.equal(gl.gitlab("mr", "edit", "1", "--body-file", "body.md").status, 0);
  assert.equal(gl.state().mergeRequests[1].description, "Nuevo\n\nCloses #7\n");
  writeFileSync(join(gl.repo, "body.md"), "/close\n");
  assert.equal(gl.gitlab("mr", "edit", "1", "--body-file", "body.md").status, 1);
  assert.equal(gl.state().mergeRequests[1].description, "Nuevo\n\nCloses #7\n");
});

test("assign-me en un merge request añade sin quitar", () => {
  const gl = project({ mergeRequests: { 1: mergeRequest() } });
  assert.equal(gl.gitlab("mr", "assign-me", "1").stdout, "Merge request #1: asignado a ada.\n");
  const single = project({ singleAssignee: true, mergeRequests: { 1: mergeRequest({ assignees: [BOB] }) } });
  assert.equal(single.gitlab("mr", "assign-me", "1").status, 1);
  assert.deepEqual(single.state().mergeRequests[1].assignees, [{ id: 2 }]);
});

test("check-status en GitLab: forge, token, cuenta y cambios pedidos por un hilo ajeno", () => {
  const gl = project({ pageSize: 1, mergeRequests: { 1: mergeRequest({ discussions: [thread(ADA), thread(BOB)], approvedBy: ["cam_r"] }) } });
  const result = gl.status();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Forge: GitLab \(gitlab\.com\)$/m);
  assert.match(result.stdout, /^Token de GitLab: GITLAB_TOKEN en \.env$/m);
  assert.match(result.stdout, /^GitLab: cuenta ada$/m);
  assert.match(result.stdout, /^Pull request: #1 CHANGES_REQUESTED issue #7$/m);
  assert.doesNotMatch(result.stdout, /GitHub/);
  assert.equal(gl.ghCalls(), "");
});

test("con los hilos resueltos y una aprobación, la decisión es APPROVED", () => {
  const line = (extra) => project({ mergeRequests: { 1: mergeRequest(extra) } }).status().stdout.match(/^Pull request: .*$/m)[0];
  assert.equal(line({ discussions: [thread(BOB, true), thread(ADA)], approvedBy: ["cam_r"] }), "Pull request: #1 APPROVED issue #7");
  assert.equal(line({ discussions: [thread(BOB, true)] }), "Pull request: #1 — issue #7");
  assert.equal(line({ reviewers: [{ ...BOB, state: "REQUESTED_CHANGES" }], approvedBy: ["cam_r"] }), "Pull request: #1 CHANGES_REQUESTED issue #7");
});

test("sin estado de revisión en la API, la decisión sale de hilos y aprobaciones", () => {
  const gl = project({ noReviewState: true, mergeRequests: { 1: mergeRequest({ reviewers: [BOB], approvedBy: ["bob.smith"] }) } });
  assert.match(gl.status().stdout, /#1 APPROVED/);
  const notes = gl.spec("reviews", "7");
  assert.equal(notes.status, 0, notes.stderr);
  assert.match(notes.stdout, /Esta instancia no dice quién pidió cambios/);
});

test("check-status sin merge request, sin token y con el token rechazado", () => {
  assert.match(project().status().stdout, /^Pull request: ninguna abierta en esta rama$/m);
  const missing = project({}, { env: null }).status();
  assert.equal(missing.status, 0, missing.stderr);
  assert.match(missing.stdout, /^Token de GitLab: Falta el fichero \.env.*GITLAB_TOKEN/m);
  const rejected = project({ token: "otro" }).status();
  assert.equal(rejected.status, 0, rejected.stderr);
  assert.match(rejected.stdout, /^GitLab: GitLab rechaza el token/m);
  assert.match(rejected.stdout, /^Pull request: no se pudo consultar\./m);
});

const TOOLS = ["bash", "git", "grep", "mktemp", "cat", "rm", "dirname"];

test("check-status dice que falta curl y termina", () => {
  const result = project({}, { tools: [...TOOLS, "node"] }).status();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^GitLab: curl no está instalado/m);
});

test("check-status dice que falta Node y termina", () => {
  const result = project({}, { tools: TOOLS }).status();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Forge: GitLab\. No se puede comprobar.*sin Node/m);
  assert.match(result.stdout, /^Node: no instalado/m);
});

test("issue-spec reviews resume la revisión del merge request que cierra la issue", () => {
  const summary = { notes: [{ author: BOB, body: "Faltan tests", system: false, resolvable: false }] };
  const gl = project({ mergeRequests: { 1: mergeRequest({ reviewers: [{ ...BOB, state: "REQUESTED_CHANGES" }], discussions: [summary, thread(CAM), thread(CAM, true, "Resuelto")] }) } });
  const result = gl.spec("reviews", "7");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Decisión: CHANGES_REQUESTED/);
  assert.match(result.stdout, /## bob\.smith \(CHANGES_REQUESTED\)\nFaltan tests/);
  assert.match(result.stdout, /- cam_r src\/a\.js:3: Cambia esto/);
  assert.doesNotMatch(result.stdout, /Resuelto/);
  assert.match(result.stdout, /Piden cambios: bob\.smith, cam_r/);
  assert.equal(gl.spec("reviews", "8").status, 1);
});

test("con run inyectado, reviews sigue el camino de GitHub", async () => {
  await assert.rejects(issueSpec(["reviews", "1"], { run: async () => "[]" }), /pull request abierta/);
});

test("pedir revisión añade sin quitar y excluye al autor", () => {
  const gl = project({ mergeRequests: { 1: mergeRequest({ reviewers: [{ ...CAM, state: "UNREVIEWED" }] }) } });
  const result = gl.gitlab("mr", "request-review", "1", "bob.smith", "Bob.Smith", "ada");
  assert.equal(result.stdout, "Revisión pedida: bob.smith.\n", result.stderr);
  assert.deepEqual(gl.state().mergeRequests[1].reviewers.map((user) => user.id), [3, 2]);
});

test("vuelve a pedir revisión a quien ya revisó", () => {
  const gl = project({ mergeRequests: { 1: mergeRequest({ reviewers: [{ ...BOB, state: "REQUESTED_CHANGES" }] }) } });
  const result = gl.gitlab("mr", "request-review", "1", "bob.smith");
  assert.equal(result.stdout, "Revisión pedida: bob.smith.\n", result.stderr);
  assert.equal(gl.state().mergeRequests[1].reviewers[0].state, "UNREVIEWED");
});

test("con un solo revisor, dice cuál queda pedido y cuál no", () => {
  const gl = project({ singleReviewer: true, mergeRequests: { 1: mergeRequest() } });
  const result = gl.gitlab("mr", "request-review", "1", "bob.smith", "cam_r");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Revisión pedida: bob\.smith\./);
  assert.match(result.stderr, /Sin pedir: cam_r \(no figura como revisor/);
});

test("no da por pedida una revisión que GitLab ignora ni a quien no es miembro", () => {
  const ignored = project({ ignoreReviewers: true, mergeRequests: { 1: mergeRequest() } });
  assert.match(ignored.gitlab("mr", "request-review", "1", "bob.smith").stderr, /Sin pedir: bob\.smith/);
  const outsider = project({ mergeRequests: { 1: mergeRequest() } }).gitlab("mr", "request-review", "1", "fuera");
  assert.equal(outsider.status, 1);
  assert.match(outsider.stderr, /no es miembro/);
});

test("member check confirma el acceso", () => {
  const gl = project();
  assert.equal(gl.gitlab("member", "check", "bob.smith").status, 0);
  assert.equal(gl.gitlab("member", "check", "fuera").status, 1);
  assert.equal(gl.gitlab("member", "check", "nadie").status, 1);
});

test("la caché de revisores en GitLab lee todas las páginas y guarda solo usuario y nombre", () => {
  const gl = project({ pageSize: 2, etag: '"v1"' });
  const cache = (...args) => gl.script("github-cache/scripts/github-cache.mjs", ...args);
  const first = cache("directory", "grupo/sub/proyecto");
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(JSON.parse(first.stdout).collaborators.map((user) => user.login), ["ada", "bob.smith", "cam_r"]);
  const profile = cache("profile", "grupo/sub/proyecto", "bob.smith");
  assert.deepEqual(JSON.parse(profile.stdout).profile, { login: "bob.smith", name: "Bob" });
  assert.equal(cache("alias", "set", "grupo/sub/proyecto", "Bob", "bob.smith").status, 0);
  assert.equal(JSON.parse(cache("alias", "get", "grupo/sub/proyecto", "bob").stdout).reviewers[0].login, "bob.smith");
  const stored = readFileSync(join(gl.repo, ".git/.git-workflow-cache.json"), "utf8");
  assert.doesNotMatch(stored, /guardar\.example|access_level|"id"/);
  const refreshed = cache("directory", "grupo/sub/proyecto", "--refresh");
  assert.equal(refreshed.status, 0, refreshed.stderr);
  assert.equal(JSON.parse(refreshed.stdout).collaborators.length, 3);
  assert.equal(gl.ghCalls(), "");
});
