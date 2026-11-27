// Issues en GitLab: manage-issue.sh, los comandos de gitlab.mjs e issue-spec contra un GitLab falso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findSecret, hashTop, parseBody } from "../.apm/skills/issue-spec/scripts/issue-spec.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skills = join(root, ".apm/skills");
const FAKE = join(root, "tests/fixtures/fake-gitlab.mjs");
const GITLAB = join(skills, "close-issue/scripts/gitlab.mjs");
const SPEC = join(skills, "issue-spec/scripts/issue-spec.mjs");
const TOKEN = "glpat-secreto-de-prueba-0123456789";
const ME = { id: 1, username: "ada" };
const TOP = "## Qué hay que hacer\n\nAlgo.\n\n## Cómo probarlo\n\n1. Mirar.";
const BODY = `${TOP}\n\n## Spec\n\n> Estado: **Borrador** · Creada: 2026-11-07 · Aprobada: —\n\n## Tasks\n\n- [ ] **TASK-01:** Uno\n`;

const issue = (extra = {}) => ({
  iid: 1, state: "opened", description: BODY, author: { id: 2 }, assignees: [], labels: [], notes: [],
  web_url: "https://gitlab.com/grupo/sub/proyecto/-/issues/1", ...extra,
});

// Un repositorio de GitLab en un subgrupo, con curl falso y un gh que anota si alguien lo llama.
function project(initial = {}, { env: envText = `GITLAB_TOKEN=${TOKEN}\n` } = {}) {
  const work = mkdtempSync(join(tmpdir(), "gitlab-issues-"));
  const repo = join(work, "repo");
  const bin = join(work, "bin");
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "remote", "add", "origin", "git@gitlab.com:grupo/sub/proyecto.git"]);
  writeFileSync(join(repo, ".gitignore"), ".env\n");
  if (envText !== null) writeFileSync(join(repo, ".env"), envText);
  execFileSync("mkdir", ["-p", bin]);
  writeFileSync(join(bin, "curl"), `#!/usr/bin/env bash\nexec node "${FAKE}" "$@"\n`);
  writeFileSync(join(bin, "gh"), `#!/usr/bin/env bash\necho "$*" >>"${join(work, "gh.log")}"\nexit 1\n`);
  chmodSync(join(bin, "curl"), 0o755);
  chmodSync(join(bin, "gh"), 0o755);
  const store = join(work, "state.json");
  writeFileSync(store, JSON.stringify({
    token: TOKEN, project: "grupo/sub/proyecto", me: ME, labels: [], issues: {}, members: {}, calls: [], ...initial,
  }));
  const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, FAKE_GITLAB: store };
  delete env.GIT_WORKFLOW_FORGE;
  delete env.GIT_WORKFLOW_FORGE_URL;
  const exec = (command, args) => {
    const result = spawnSync(command, args, { cwd: repo, env, encoding: "utf8" });
    // Escenario 9: el token no sale por la terminal, también cuando algo falla.
    assert.ok(!`${result.stdout}${result.stderr}`.includes(TOKEN));
    return result;
  };
  return {
    repo,
    state: () => JSON.parse(readFileSync(store, "utf8")),
    gitlab: (...args) => exec("node", [GITLAB, ...args]),
    spec: (...args) => exec("node", [SPEC, ...args]),
    manageIssue: (title = "Add notes", type = "feat") => {
      writeFileSync(join(repo, "body.md"), "cuerpo\n");
      return exec("bash", [join(skills, "manage-issue/scripts/manage-issue.sh"), title, "body.md", type]);
    },
    file: (name, text) => {
      writeFileSync(join(repo, name), text);
      return name;
    },
    ghCalls: () => spawnSync("cat", [join(work, "gh.log")], { encoding: "utf8" }).stdout,
  };
}

const writes = (state) => state.calls.filter((call) => call.method !== "GET");

test("manage-issue crea la etiqueta y la issue asignada, y escribe su URL", () => {
  const gl = project();
  const result = gl.manageIssue();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "Etiqueta feat: creada.\nhttps://gitlab.com/grupo/sub/proyecto/-/issues/1\n");
  const { labels, issues, calls } = gl.state();
  assert.deepEqual(labels, [{ name: "feat", color: "#a2eeef", description: "Nueva funcionalidad" }]);
  assert.deepEqual([issues[1].title, issues[1].description, issues[1].labels, issues[1].assignees], ["Add notes", "cuerpo\n", ["feat"], [{ id: 1 }]]);
  assert.ok(!JSON.stringify(calls.map((call) => call.args)).includes(TOKEN));
  assert.equal(gl.ghCalls(), "");
});

test("manage-issue reutiliza la etiqueta sin distinguir mayúsculas", () => {
  const gl = project({ labels: [{ name: "feature-x" }, { name: "Feat" }] });
  const result = gl.manageIssue();
  assert.match(result.stdout, /Etiqueta feat: ya existe\./);
  assert.deepEqual(gl.state().issues[1].labels, ["Feat"]);
  assert.equal(gl.state().labels.length, 2);
});

test("sin permiso para crear la etiqueta, la issue sale sin ella y lo dice", () => {
  const gl = project({ denyLabel: true });
  const result = gl.manageIssue();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /no se pudo crear con esta cuenta/);
  assert.deepEqual(gl.state().issues[1].labels, []);
});

test("manage-issue comprueba el título antes de llamar a GitLab", () => {
  const gl = project();
  assert.equal(gl.manageIssue("docs: add notes").status, 1);
  assert.deepEqual(gl.state().calls, []);
});

test("sin token, manage-issue sale con 3 y no llama a GitLab", () => {
  const gl = project({}, { env: null });
  const result = gl.manageIssue();
  assert.equal(result.status, 3);
  assert.match(result.stderr, /GITLAB_TOKEN/);
  assert.deepEqual(gl.state().calls, []);
});

test("con el token rechazado no se escribe nada", () => {
  const gl = project({ token: "otro" });
  const result = gl.manageIssue();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /rechaza el token/);
  assert.equal(gl.state().calls.length, 1);
});

test("label ensure conserva los códigos de ensure-label.sh", () => {
  assert.equal(project().gitlab("label", "ensure", "knowledge").stdout, "Etiqueta knowledge: creada.\n");
  assert.equal(project({ denyLabel: true }).gitlab("label", "ensure", "fix").status, 2);
  assert.equal(project().gitlab("label", "ensure", "feta").status, 1);
});

test("close-issue cierra y reabre, y dice que GitLab no guarda el motivo", () => {
  const gl = project({ issues: { 1: issue() } });
  assert.equal(gl.gitlab("issue", "state", "1").stdout, "OPEN\n");
  const closed = gl.gitlab("issue", "close", "1", "not planned");
  assert.equal(closed.stdout, "Issue #1: CLOSED. GitLab no guarda el motivo de cierre.\n", closed.stderr);
  assert.equal(gl.state().issues[1].state, "closed");
  assert.equal(gl.gitlab("issue", "reopen", "1").stdout, "Issue #1: OPEN.\n");
  assert.equal(gl.gitlab("issue", "close", "1", "otro").status, 1);
  assert.equal(gl.gitlab("issue", "close", "uno").status, 1);
});

test("assign-me añade la cuenta sin quitar a nadie", () => {
  const gl = project({ issues: { 1: issue({ assignees: [{ id: 5 }] }) } });
  assert.equal(gl.gitlab("issue", "assign-me", "1").stdout, "Issue #1: asignada a ada.\n");
  assert.deepEqual(gl.state().issues[1].assignees, [{ id: 5 }, { id: 1 }]);
  const before = writes(gl.state()).length;
  assert.equal(gl.gitlab("issue", "assign-me", "1").status, 0);
  assert.equal(writes(gl.state()).length, before);
});

test("con una sola persona asignada, assign-me restaura y la deja pendiente", () => {
  const gl = project({ singleAssignee: true, issues: { 1: issue({ assignees: [{ id: 5 }] }) } });
  const result = gl.gitlab("issue", "assign-me", "1");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /pendiente/);
  assert.deepEqual(gl.state().issues[1].assignees, [{ id: 5 }]);
});

test("issue-spec escribe, marca y cambia el estado conservando la parte de arriba", () => {
  const gl = project({ issues: { 1: issue() } });
  const top = gl.spec("top-hash", "1").stdout.trim();
  assert.equal(top, hashTop(TOP));
  const plan = gl.file("plan.md", "## Plan\n\nPasos.");
  for (const args of [["write", "1", "--expect-top", top, "--plan", plan], ["tick", "1", "TASK-01", "--expect-top", top], ["state", "1", "Implementada", "--expect-top", top]]) {
    const result = gl.spec(...args);
    assert.equal(result.status, 0, result.stderr);
  }
  const parsed = parseBody(gl.state().issues[1].description);
  assert.equal(parsed.top, TOP);
  assert.equal(parsed.sections.plan, "Pasos.");
  assert.match(parsed.sections.tasks, /- \[x\] \*\*TASK-01:\*\*/);
  assert.match(parsed.sections.spec, /Estado: \*\*Implementada/);
  assert.equal(gl.spec("read", "1", "--section", "plan").stdout, "Pasos.\n");
  assert.equal(gl.ghCalls(), "");
});

test("si la parte de arriba cambió, issue-spec sale con 3 en GitLab", () => {
  const gl = project({ issues: { 1: issue() } });
  const result = gl.spec("tick", "1", "TASK-01", "--expect-top", "otra");
  assert.equal(result.status, 3);
  assert.deepEqual(writes(gl.state()), []);
});

test("can-edit: autor, asignado y rol Planner o superior", () => {
  const can = (initial) => project(initial).spec("can-edit", "1").stdout.trim();
  assert.equal(can({ issues: { 1: issue({ author: { id: 1 } }) } }), "yes");
  assert.equal(can({ issues: { 1: issue({ assignees: [{ id: 1 }] }) } }), "yes");
  assert.equal(can({ issues: { 1: issue() }, members: { 1: 15 } }), "yes");
  assert.equal(can({ issues: { 1: issue() }, members: { 1: 10 } }), "no");
  assert.equal(can({ issues: { 1: issue() } }), "no");
});

test("sin permiso para editar sale con 6; sin el permiso api, con 1", () => {
  const edit = (initial) => {
    const gl = project({ issues: { 1: issue() }, ...initial });
    return gl.spec("tick", "1", "TASK-01", "--expect-top", hashTop(TOP));
  };
  assert.equal(edit({ denyEdit: true }).status, 6);
  const scope = edit({ noScope: true });
  assert.equal(scope.status, 1);
  assert.match(scope.stderr, /permiso api/);
});

test("sin token, issue-spec sale con 1 y no con 3", () => {
  const result = project({}, { env: null }).spec("read", "1");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /GITLAB_TOKEN/);
});

test("revisiones: lee todas las páginas, ignora los comentarios de sistema y edita el último", () => {
  const notes = [
    { id: 1, body: "<!-- Revisión 1 -->\n\nvieja", system: false },
    { id: 2, body: "hola", system: false },
    { id: 3, body: "<!-- Revisión 7 -->", system: true },
    { id: 4, body: `<!-- Revisión 2 -->\n\n## Tasks\n\n- [ ] **TASK-01:** Uno`, system: false },
  ];
  const gl = project({ pageSize: 1, issues: { 1: issue({ notes }) } });
  const hash = gl.spec("top-hash", "1", "--revision").stdout.trim();
  assert.equal(hash, hashTop("<!-- Revisión 2 -->"));
  assert.equal(gl.spec("tick", "1", "TASK-01", "--revision", "--expect-top", hash).status, 0);
  assert.match(gl.state().issues[1].notes[3].body, /- \[x\] \*\*TASK-01/);
  const published = gl.spec("revision", "1", gl.file("revision.md", "## Spec\n\nNueva."));
  assert.match(published.stdout, /revisión 3 publicada/);
  assert.match(gl.state().issues[1].notes.at(-1).body, /^<!-- Revisión 3 -->/);
  assert.equal(gl.spec("comment", "1", gl.file("ronda.md", "Ronda 1")).status, 0);
  assert.equal(gl.state().issues[1].notes.at(-1).body, "Ronda 1");
});

test("--repo cambia el proyecto de GitLab", () => {
  const gl = project({ project: "otro/proyecto", issues: { 1: issue() } });
  assert.equal(gl.spec("read", "1").status, 1);
  assert.equal(gl.spec("read", "1", "--repo", "otro/proyecto").status, 0);
});

test("el límite de GitLab es mayor en la issue y en el comentario", () => {
  const gl = project({ issues: { 1: issue() } });
  const top = hashTop(TOP);
  const write = (length) => gl.spec("write", "1", "--expect-top", top, "--plan", gl.file("plan.md", "x".repeat(length)));
  assert.equal(write(70000).status, 0);
  assert.equal(write(1048576).status, 5);
  assert.equal(gl.spec("comment", "1", gl.file("largo.md", "x".repeat(1000001))).status, 5);
});

test("un token de GitLab en el texto bloquea la escritura", () => {
  assert.equal(findSecret(`usa ${TOKEN}`), "token de GitLab");
  const gl = project({ issues: { 1: issue() } });
  const result = gl.spec("write", "1", "--expect-top", hashTop(TOP), "--plan", gl.file("plan.md", `token ${TOKEN}`));
  assert.equal(result.status, 4);
  assert.deepEqual(writes(gl.state()), []);
});

