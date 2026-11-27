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

test("cuenta toda línea que empieza por un comando de GitLab, y solo esas", () => {
  for (const text of [
    "## Problema\n\n/login devuelve 500", "/etc", "/etc/hosts", "/usr/bin/env", "/delivery-workflow", " /close",
    "```\n /close\n```", "> /close", "usa `/close`", "texto /close", "/close: no es un comando",
  ]) {
    assert.equal(findQuickAction(text), null, JSON.stringify(text));
  }
  for (const [text, command] of [["/CLOSE", "/CLOSE"], ["texto\n/weight 3", "/weight"], ["/shrug", "/shrug"], ["/assign @ada\r\n", "/assign"]]) {
    assert.equal(findQuickAction(text), command, text);
  }
});

test("ningún formato esconde un comando", () => {
  for (const text of [
    "```\n/close\n```", "~~~\n/close\n~~~", "<!--\n/close\n-->", "```npm test``` falla\n/close\n",
    "<!--\n```\n-->\n\n/close\n", "- a\n  ```\n  x\nfin\n\n```\ny\n```\n\n/close", "- a\n\n  <!--\nfin\n\n/close\n-->",
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
      assert.match(result.stderr, /Hace falta Node 24/, `${script}: ${result.stderr}`);
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

const gitlab = (gl, ...args) => gl.run("manage-draft/scripts/gitlab.mjs", args);

test("una dirección de merge request de otro proyecto se rechaza sin tocar nada", () => {
  const gl = project({ mergeRequests: mergeRequest() });
  for (const address of [
    "https://gitlab.com/otro/lib/-/merge_requests/1",
    "https://otro.example.com/grupo/proyecto/-/merge_requests/1",
    "https://gitlab.com/otro/grupo/proyecto/-/merge_requests/1",
  ]) {
    for (const args of [["edit", address, "--title", "X"], ["view", address], ["draft", address], ["ready", address], ["assign-me", address], ["request-review", address, "bob"]]) {
      const result = gitlab(gl, "mr", ...args);
      assert.equal(result.status, 1, `${args[0]} ${address}`);
      assert.match(result.stderr, /no es de un merge request de grupo\/proyecto/);
    }
  }
  assert.deepEqual(gl.state().calls, []);
  const own = gitlab(gl, "mr", "edit", "https://GitLab.com/Grupo/Proyecto/-/merge_requests/1/", "--title", "Add notes");
  assert.equal(own.status, 0, own.stderr);
});

test("con una aprobación pendiente, el merge request no está aprobado", () => {
  const decision = (extra) => {
    const gl = project({ mergeRequests: { 1: { ...mergeRequest()[1], approvedBy: ["bob"], ...extra } } });
    return JSON.parse(gitlab(gl, "mr", "view", "1").stdout).reviewDecision;
  };
  assert.equal(decision({ approvalsLeft: 1 }), "—");
  assert.equal(decision({ approvalsLeft: 0 }), "APPROVED");
  assert.equal(decision({}), "APPROVED");
});

test("el SSH de gitlab.com por el puerto 443 es GitLab", () => {
  const gl = project({}, { origin: "ssh://git@altssh.gitlab.com:443/grupo/proyecto.git" });
  assert.equal(gitlab(gl, "forge").stdout, "gitlab\n");
  assert.match(gl.run("check-status/scripts/check-status.sh").stdout, /^Forge: GitLab \(gitlab\.com\)$/m);
});

test("sin Node, solo el host gitlab.com cuenta como GitLab", () => {
  const looks = (origin) => {
    const gl = project({}, { origin, env: "GITHUB_TOKEN=a\n", node: false });
    return /Hace falta Node 24/.test(gl.run("manage-issue/scripts/manage-issue.sh", ISSUE).stderr);
  };
  for (const origin of ["git@gitlab.com:g/p.git", "https://gitlab.com/g/p.git", "https://ada@gitlab.com/g/p", "ssh://git@altssh.gitlab.com:443/g/p.git", "gitlab.com:g/p.git"]) {
    assert.equal(looks(origin), true, origin);
  }
  for (const origin of ["git@gitlab.company.com:g/p.git", "git@github.com:me/gitlab.com-tools.git", "https://github.com/gitlab.com/p.git", "git@notgitlab.com:g/p.git"]) {
    assert.equal(looks(origin), false, origin);
  }
});

test("los tres scripts detectan GitLab sin Node de la misma forma", () => {
  const helper = (name) => readFileSync(join(root, ".apm/skills", name), "utf8").match(/^looks_like_gitlab\(\) \{[\s\S]*?^\}/m)[0];
  const original = helper("check-status/scripts/check-status.sh");
  assert.equal(helper("manage-issue/scripts/manage-issue.sh"), original);
  assert.equal(helper("manage-pr-base/scripts/manage-pr-base.sh"), original);
});

test("una asignación que GitLab no aplica no culpa a quien no existe", () => {
  const gl = project({ ignoreAssignees: true, mergeRequests: mergeRequest() });
  const result = gitlab(gl, "mr", "assign-me", "1");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /GitLab no asignó a ada, quizá porque la cuenta no tiene permiso/);
  assert.doesNotMatch(result.stderr, /sin quitar|una sola persona/);
});

test("en un fork se avisa de que no se admite", () => {
  const forked = project({ forkedFrom: "original/proyecto" });
  const status = forked.run("check-status/scripts/check-status.sh");
  assert.match(status.stdout, /^Aviso: este proyecto es un fork de original\/proyecto\. El flujo no admite forks/m);
  assert.match(status.stdout, /^Pull request: ninguna abierta en esta rama$/m);
  const created = forked.run("manage-pr-base/scripts/manage-pr-base.sh", PR);
  assert.equal(created.status, 0, created.stderr);
  assert.match(created.stderr, /no admite forks/);
  assert.doesNotMatch(project().run("check-status/scripts/check-status.sh").stdout, /fork/);
});

const LIST = "## Qué hay\n\n```\n/status\n/merge\n```\n\nFin.";
const savedIssue = (description, notes = []) => ({ 1: { iid: 1, state: "opened", description, author: { id: 1 }, assignees: [], notes } });
const spec = (gl, ...args) => gl.run("issue-spec/scripts/issue-spec.mjs", args);

test("una línea con un comando ya guardada en la parte de arriba no impide escribir", () => {
  const description = `${LIST}\n\n## Spec\n\n> Estado: **Borrador** · x\n\n## Tasks\n\n- [ ] **TASK-01:** Uno\n`;
  const gl = project({ issues: savedIssue(description) });
  const top = hashTop(LIST);
  writeFileSync(join(gl.repo, "plan.md"), "Pasos.");
  for (const args of [["write", "1", "--plan", "plan.md"], ["tick", "1", "TASK-01"], ["state", "1", "Implementada"]]) {
    const result = spec(gl, ...args, "--expect-top", top);
    assert.equal(result.status, 0, result.stderr);
  }
  assert.ok(gl.state().issues[1].description.startsWith(LIST));
  writeFileSync(join(gl.repo, "plan.md"), "```\n/close\n```");
  const added = spec(gl, "write", "1", "--plan", "plan.md", "--expect-top", top);
  assert.equal(added.status, 1);
  assert.match(added.stderr, /«\/close»/);
});

test("solo se libra la línea que no ha cambiado ni lo que tiene delante", () => {
  const saved = "intro\n```\n/close\n```\nfin";
  assert.equal(findQuickAction(`${saved}\n\nmás`, saved), null);
  assert.equal(findQuickAction(`\n\n${saved}`, saved), null);
  for (const text of ["intro\n/close\n```\nfin", "otra\n```\n/close\n```\nfin", "intro\n```\n/close\notra", `${saved}\n/close`, "/close"]) {
    assert.equal(findQuickAction(text, saved), "/close", text);
  }
  assert.equal(findQuickAction("a\n/close\n---", "a\n/close\n==="), "/close");
});

test("el cuerpo de un merge request y un comentario conservan sus líneas ya guardadas", () => {
  const revision = "<!-- Revisión 1 -->\n\n```\n/merge\n```\n\n## Tasks\n\n- [ ] **TASK-01:** Uno";
  const gl = project({
    issues: savedIssue("x", [{ id: 1, body: revision, system: false }]),
    mergeRequests: { 1: { ...mergeRequest()[1], description: "```\n/status\n```\n\nCambio." } },
  });
  const tick = spec(gl, "tick", "1", "TASK-01", "--revision", "--expect-top", hashTop("<!-- Revisión 1 -->\n\n```\n/merge\n```"));
  assert.equal(tick.status, 0, tick.stderr);
  writeFileSync(join(gl.repo, "mr.md"), "```\n/status\n```\n\nOtro cambio.\n\nCloses #1\n");
  const edit = gitlab(gl, "mr", "edit", "1", "--body-file", "mr.md");
  assert.equal(edit.status, 0, edit.stderr);
  writeFileSync(join(gl.repo, "mr.md"), "```\n/status\n```\n\n/close\n");
  assert.equal(gitlab(gl, "mr", "edit", "1", "--body-file", "mr.md").status, 1);
});

const note = (author, body, extra = {}) => ({ notes: [{ author, body, system: false, resolvable: false, ...extra }] });
const openThread = (author) => note(author, "Cambia esta línea", { resolvable: true, resolved: false, position: { new_path: "a.js", new_line: 1 } });
const reviewed = (state, discussions) => project({
  ...state,
  mergeRequests: { 1: { ...mergeRequest(state.reviewers ?? [])[1], description: "Closes #1", discussions } },
});

test("reviews incluye los comentarios generales de quien abre un hilo", () => {
  const gl = reviewed({}, [openThread(BOB), note(BOB, "Añade tests del error"), note(CAM, "Bonito"), note(ADA, "Gracias")]);
  const result = spec(gl, "reviews", "1");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /## bob \(CHANGES_REQUESTED\)\nAñade tests del error/);
  assert.doesNotMatch(result.stdout, /Bonito|Gracias/);
});

test("sin estado de revisión, reviews incluye los comentarios generales de los demás", () => {
  const gl = reviewed({ noReviewState: true }, [openThread(BOB), note(CAM, "Falta el caso vacío"), note(ADA, "Gracias"), note(BOB, "sistema", { system: true })]);
  const result = spec(gl, "reviews", "1");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /## cam \(COMMENTED\)\nFalta el caso vacío/);
  assert.doesNotMatch(result.stdout, /Gracias|sistema/);
});

test("cerrar o reabrir falla si GitLab no cambia el estado", () => {
  for (const [action, state, expected] of [["close", "opened", "OPEN"], ["reopen", "closed", "CLOSED"]]) {
    const gl = project({ ignoreState: true, issues: { 1: { ...savedIssue("x")[1], state } } });
    const result = gitlab(gl, "issue", action, "1");
    assert.equal(result.status, 1, action);
    assert.match(result.stderr, new RegExp(`sigue en ${expected}`));
    assert.equal(result.stdout, "");
  }
});

test("reviews fecha cada comentario general", () => {
  const dated = (body, day) => note(BOB, body, { created_at: `2026-11-${day}T10:00:00.000Z` });
  const gl = reviewed({ reviewers: [{ ...BOB, state: "REQUESTED_CHANGES" }] }, [dated("Renombra X", "01"), dated("Añade tests", "20")]);
  const result = spec(gl, "reviews", "1");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2026-11-01: Renombra X[\s\S]*2026-11-20: Añade tests/);
});

test("fuera de un repositorio, manage-issue sale con 3 como antes, también con GitLab declarado", () => {
  const folder = mkdtempSync(join(tmpdir(), "sin-repo-"));
  writeFileSync(join(folder, "body.md"), "cuerpo\n");
  for (const extra of [{}, { GIT_WORKFLOW_FORGE: "gitlab" }]) {
    const env = { ...process.env, GIT_CEILING_DIRECTORIES: dirname(folder), ...extra };
    const script = join(root, ".apm/skills/manage-issue/scripts/manage-issue.sh");
    const result = spawnSync("bash", [script, ...ISSUE], { cwd: folder, env, encoding: "utf8" });
    assert.equal(result.status, 3, result.stderr);
    assert.equal(result.stderr, "No es un repositorio git.\n");
  }
});
