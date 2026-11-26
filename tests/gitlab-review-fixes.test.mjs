// Casos que salieron de la revisión de código del camino de GitLab.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findQuickAction } from "../.apm/skills/check-status/scripts/gitlab.mjs";
import { runCache } from "../.apm/skills/github-cache/scripts/github-cache.mjs";
import { hashTop } from "../.apm/skills/issue-spec/scripts/issue-spec.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FAKE = join(root, "tests/fixtures/fake-gitlab.mjs");
const TOKEN = "glpat-secreto-de-prueba-0123456789";
const ADA = { id: 1, username: "ada", name: "Ada" };
const BOB = { id: 2, username: "bob", name: "Bob" };
const CAM = { id: 3, username: "cam", name: "Cam" };

// Un repositorio con las skills copiadas, un curl que hace de GitLab y un gh que anota sus llamadas.
function project(state = {}, { origin = "git@gitlab.com:grupo/proyecto.git", env: envText = `GITLAB_TOKEN=${TOKEN}\n`, node = true } = {}) {
  const work = mkdtempSync(join(tmpdir(), "gitlab-fix-"));
  const repo = join(work, "repo");
  const bin = join(work, "bin");
  execFileSync("git", ["init", "-q", "-b", "7-feat-add-notes", repo]);
  execFileSync("git", ["-C", repo, "remote", "add", "origin", origin]);
  writeFileSync(join(repo, ".gitignore"), ".env\n");
  writeFileSync(join(repo, ".env"), envText);
  mkdirSync(bin);
  writeFileSync(join(bin, "curl"), `#!/usr/bin/env bash\nexec "${process.execPath}" "${FAKE}" "$@"\n`);
  writeFileSync(join(bin, "gh"), `#!/bin/bash\necho "$*" >>"${join(work, "gh.log")}"\nexit 1\n`);
  chmodSync(join(bin, "curl"), 0o755);
  chmodSync(join(bin, "gh"), 0o755);
  const store = join(work, "state.json");
  writeFileSync(store, JSON.stringify({
    token: TOKEN, project: "grupo/proyecto", me: ADA, users: [ADA, BOB, CAM], members: { 1: 40, 2: 30, 3: 30 },
    labels: [], issues: {}, mergeRequests: {}, calls: [], ...state,
  }));
  let path = `${bin}${delimiter}${process.env.PATH}`;
  if (!node) {
    for (const tool of ["bash", "git", "grep", "sed", "tail", "mktemp", "cat", "rm", "dirname"]) {
      const real = execFileSync("/bin/sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).trim();
      symlinkSync(real, join(bin, tool));
    }
    path = bin;
  }
  const env = { ...process.env, PATH: path, FAKE_GITLAB: store };
  for (const name of ["GIT_WORKFLOW_FORGE", "GIT_WORKFLOW_FORGE_URL", "GIT_WORKFLOW_BASE"]) delete env[name];
  const skills = join(work, "skills");
  cpSync(join(root, ".apm/skills"), skills, { recursive: true });
  const exec = (command, args, extra = {}) => spawnSync(command, args, { cwd: repo, env: { ...env, ...extra }, encoding: "utf8" });
  writeFileSync(join(repo, "body.md"), "cuerpo\n");
  return {
    work, repo, skills,
    run: (script, args = [], extra) => exec(script.endsWith(".sh") ? "bash" : "node", [resolve(skills, script), ...args], extra),
    state: () => JSON.parse(readFileSync(store, "utf8")),
    ghCalls: () => (existsSync(join(work, "gh.log")) ? readFileSync(join(work, "gh.log"), "utf8") : ""),
  };
}

const ISSUE = ["Add notes", "body.md", "feat"];
const PR = ["7-feat-add-notes", "Add notes", "body.md", "feat", "staging"];

test("solo cuenta un comando de GitLab fuera de código y de comentarios", () => {
  for (const text of [
    "## Problema\n\n/login devuelve 500", "<!--\n/close\n-->", "<!-- nota --> /close", "/etc", "/etc/hosts",
    "```\n/close\n```", "```js\n/close\n```", "  ```\n  x\n  ```", "~~~\n```\n/close\n~~~",
  ]) {
    assert.equal(findQuickAction(text), null, JSON.stringify(text));
  }
  for (const [text, command] of [["/CLOSE", "/CLOSE"], ["texto\n/weight 3", "/weight"], ["/shrug", "/shrug"]]) {
    assert.equal(findQuickAction(text), command, text);
  }
});

test("ni las comillas invertidas ni un comentario esconden un comando", () => {
  for (const text of [
    "```npm test``` falla\n/close\n",
    "<!--\n```\n-->\n\n/close\n",
    "<!--\n~~~\n-->\n/close",
    "<!--\n/close",
    "- paso\n\n  ```\n  x\n/close",
    "  ```\nx\n```\n/close",
    "```\nx\n```\n/close",
  ]) {
    assert.equal(findQuickAction(text), "/close", JSON.stringify(text));
  }
});

test("una línea como /login en la issue no impide escribir en ella", () => {
  const top = "## Problema\n\n/login devuelve 500";
  const description = `${top}\n\n## Tasks\n\n- [ ] **TASK-01:** Uno\n`;
  const gl = project({ issues: { 1: { iid: 1, state: "opened", description, author: { id: 1 }, assignees: [], notes: [] } } });
  const result = gl.run("issue-spec/scripts/issue-spec.mjs", ["tick", "1", "TASK-01", "--expect-top", hashTop(top)]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(gl.state().issues[1].description, /- \[x\] \*\*TASK-01/);
});

test("por un enlace simbólico, los scripts siguen reconociendo GitLab", () => {
  const gl = project();
  const link = join(gl.work, "enlace");
  symlinkSync(gl.skills, link);
  for (const script of ["manage-issue/scripts/gitlab.mjs", "issue-spec/scripts/gitlab.mjs"]) {
    assert.equal(gl.run(join(link, script), ["forge"]).stdout, "gitlab\n", script);
  }
  const issue = gl.run(join(link, "manage-issue/scripts/manage-issue.sh"), ISSUE);
  assert.equal(issue.status, 0, issue.stderr);
  assert.match(issue.stdout, /\/-\/issues\/1$/m);
  assert.equal(gl.run(join(link, "issue-spec/scripts/issue-spec.mjs"), ["read", "1"]).stdout, "cuerpo\n\n");
  assert.match(gl.run(join(link, "github-cache/scripts/github-cache.mjs"), ["directory", "grupo/proyecto"]).stdout, /"ada"/);
  assert.equal(gl.ghCalls(), "");
});

test("si la consulta del forge no responde nada, no se usa GitHub", () => {
  const gl = project();
  for (const skill of ["manage-issue", "manage-pr-base", "check-status"]) {
    writeFileSync(join(gl.skills, skill, "scripts/gitlab.mjs"), "");
  }
  assert.match(gl.run("manage-issue/scripts/manage-issue.sh", ISSUE).stderr, /No se pudo saber si el forge/);
  assert.match(gl.run("manage-pr-base/scripts/manage-pr-base.sh", PR).stderr, /No se pudo saber si el forge/);
  const status = gl.run("check-status/scripts/check-status.sh");
  assert.match(status.stdout, /^Forge: no se pudo comprobar\./m);
  assert.doesNotMatch(status.stdout, /GitHub/);
  assert.equal(gl.ghCalls(), "");
});

test("la caché admite los usuarios de GitLab y salta los que no puede leer", async () => {
  const folder = mkdtempSync(join(tmpdir(), "gitlab-cache-"));
  const names = ["ada", "john-", ".john", "raro.", "con espacio"];
  const request = async () => ({ status: 200, headers: {}, body: names.map((username) => ({ username })) });
  const options = { root: folder, host: "gitlab.com", account: "ada", forge: "gitlab", request, warn: () => {} };
  const result = await runCache(["directory", "grupo/proyecto"], options);
  assert.deepEqual(result.collaborators.map((user) => user.login), ["ada", "john-", ".john"]);
  assert.equal((await runCache(["alias", "set", "grupo/proyecto", "John", "john-"], options)).login, "john-");
  await assert.rejects(runCache(["directory", "owner/repo"], { ...options, host: "github.com", forge: "github", request: async () => ({ status: 200, headers: {}, body: [{ login: "mal-" }] }) }), /Directorio de GitHub inválido/);
});

test("con un ajuste de GitLab mal escrito, check-status no pide nada de GitHub", () => {
  const gl = project({}, { env: "GIT_WORKFLOW_FORGE=gitlab\nGIT_WORKFLOW_FORGE_URL=http://host\n" });
  const result = gl.run("check-status/scripts/check-status.sh");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Forge: GIT_WORKFLOW_FORGE_URL/m);
  assert.doesNotMatch(result.stdout, /GitHub|Pull request/);
  assert.match(result.stdout, /^Node:/m);
  assert.equal(gl.ghCalls(), "");
});

test("en un host propio sin token, check-status avisa y sigue como en GitHub", () => {
  const gl = project({}, { origin: "git@git.empresa.com:grupo/proyecto.git", env: "" });
  const result = gl.run("check-status/scripts/check-status.sh");
  assert.match(result.stdout, /^Forge: .*GIT_WORKFLOW_FORGE=gitlab/m);
  assert.match(result.stdout, /^Token de GitHub:/m);
});

test("sin Node, un GitLab propio declarado no se trata como GitHub", () => {
  const origin = "git@git.empresa.com:grupo/proyecto.git";
  for (const [envText, extra] of [["GITHUB_TOKEN=a\nexport GIT_WORKFLOW_FORGE='GitLab' # propio\n", {}], ["GITHUB_TOKEN=a\n", { GIT_WORKFLOW_FORGE: "gitlab" }]]) {
    const gl = project({}, { origin, env: envText, node: false });
    for (const [script, args] of [["manage-issue/scripts/manage-issue.sh", ISSUE], ["manage-pr-base/scripts/manage-pr-base.sh", PR]]) {
      const result = gl.run(script, args, extra);
      assert.equal(result.status, 1, script);
      assert.match(result.stderr, /Hace falta Node 20/, `${script}: ${result.stderr}`);
    }
    const status = gl.run("check-status/scripts/check-status.sh", [], extra);
    assert.match(status.stdout, /^Forge: GitLab\..*sin Node/m, status.stderr);
    assert.equal(gl.ghCalls(), "");
  }
});

test("sin Node, declarar GitHub manda sobre un origin en gitlab.com", () => {
  const gl = project({}, { env: "GITHUB_TOKEN=a\nGIT_WORKFLOW_FORGE=github\n", node: false });
  const result = gl.run("manage-issue/scripts/manage-issue.sh", ISSUE);
  assert.doesNotMatch(result.stderr, /Hace falta Node/);
  assert.match(gl.ghCalls(), /label list/);
});

const mergeRequest = (reviewers = []) => ({ 1: { iid: 1, state: "opened", title: "Add", draft: false, author: ADA, assignees: [], reviewers, discussions: [] } });
const askReview = (gl, ...names) => gl.run("assign-reviewers/scripts/gitlab.mjs", ["mr", "request-review", "1", ...names]);

test("un usuario que no existe no impide pedir revisión a los demás", () => {
  const gl = project({ mergeRequests: mergeRequest() });
  const result = askReview(gl, "bob", "errata");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Revisión pedida: bob\./);
  assert.match(result.stderr, /Sin pedir: errata \(No existe el usuario/);
  assert.deepEqual(gl.state().mergeRequests[1].reviewers.map((user) => user.id), [2]);
});

test("si falla volver a pedirla, dice a quién sí se pidió", () => {
  const gl = project({ denyRereview: true, mergeRequests: mergeRequest([{ ...CAM, state: "REVIEWED" }]) });
  const result = askReview(gl, "bob", "cam");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Revisión pedida: bob\./);
  assert.match(result.stderr, /Sin pedir: cam \(no se pudo volver a pedir: .*403/);
});

test("si GitLab no deja añadir revisores, nadie cuenta como pedido", () => {
  const gl = project({ denyEdit: true, mergeRequests: mergeRequest() });
  const result = askReview(gl, "bob");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Sin pedir: bob \(.*403/);
  assert.doesNotMatch(result.stderr, /Revisión pedida/);
});
