import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateBranch } from '../../.apm/skills/setup-discord-notifications/scripts/setup-discord-notifications.mjs';
import { ACTION_COPIES, INVALID_BASE_BRANCHES, VALID_BASE_BRANCHES } from './base-branches.mjs';

const verifierPath = fileURLToPath(new URL('../../.github/actions/discord-pr-notifications/verify-event.mjs', import.meta.url));
const repository = 'owner/repository';
const prNumber = 42;
const verifierCopies = ACTION_COPIES.map((directory) => fileURLToPath(new URL('verify-event.mjs', directory)));
const FOREIGN_RUN = 'The completed run does not belong to this repository and trigger.';
const ELIGIBLE = 'eligible=true\npr_number=42\n';

// Los nombres se leen de los ficheros: un workflow renombrado sin actualizar el verificador rompe los tests.
const repoRoot = new URL('../../', import.meta.url);
const templates = '.apm/skills/setup-discord-notifications/assets/workflows/';
const ownWorkflows = '.github/workflows/';
const readRepo = (path) => readFileSync(new URL(path, repoRoot), 'utf8');
function workflowName(path) {
  const match = readRepo(path).match(/^name:[ \t]*(["']?)(.+?)\1[ \t]*$/m);
  assert.ok(match, `${path} no declara name`);
  return match[2];
}
const installations = [
  {
    label: 'plantillas',
    prTrigger: `${templates}discord-pr-trigger.yml`,
    confirmationTrigger: `${templates}discord-pr-confirmation-trigger.yml`,
    publisher: `${templates}discord-pr-publish.yml`,
  },
  {
    label: 'este repositorio',
    prTrigger: `${ownWorkflows}pr-check-rules.yml`,
    confirmationTrigger: `${ownWorkflows}discord-pr-confirmation-trigger.yml`,
    publisher: `${ownWorkflows}discord-pr-publish.yml`,
  },
];

function validEvent() {
  return {
    repository: { full_name: repository, default_branch: 'main' },
    workflow_run: {
      id: 987,
      name: 'review',
      repository: { full_name: repository },
      event: 'pull_request',
      conclusion: 'success',
      pull_requests: [{ number: prNumber }],
      head_repository: { full_name: repository },
      head_branch: 'feature',
      head_sha: 'head-commit',
    },
  };
}

function validPullRequest() {
  return {
    number: prNumber,
    base: { repo: { full_name: repository }, ref: 'staging' },
    head: { repo: { full_name: repository }, ref: 'feature', sha: 'head-commit' },
    state: 'open',
    draft: false,
    requested_reviewers: [
      { id: 10, login: 'first-reviewer' },
      { id: 20, login: 'second-reviewer' },
    ],
  };
}

// El proceso hijo simula GitHub y comprueba que solo una PR verificada llega a GITHUB_OUTPUT.
function runVerifier({ event = validEvent(), pullRequest = validPullRequest(), artifact = '42', httpStatus = 200,
  envOverrides = {}, verifier = verifierPath } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'discord-pr-verify-'));
  const eventPath = join(directory, 'event.json');
  const numberPath = join(directory, 'pr-number');
  const outputPath = join(directory, 'output');
  const fetchLogPath = join(directory, 'fetch-log');
  writeFileSync(fetchLogPath, '', 'utf8');
  writeFileSync(eventPath, JSON.stringify(event), 'utf8');
  writeFileSync(numberPath, artifact, 'utf8');
  writeFileSync(outputPath, '', 'utf8');

  const fetchStub = `import { appendFileSync } from 'node:fs';
  globalThis.fetch = async (url, options) => {
    appendFileSync(process.env.TEST_FETCH_LOG, url + String.fromCharCode(10));
    if (options.headers.authorization !== 'Bearer test-token') {
      throw new Error('Unexpected GitHub API request.');
    }
    if (url === 'https://api.github.com/repos/owner/repository/pulls/42') {
      return {
        ok: ${httpStatus === 200},
        status: ${httpStatus},
        json: async () => JSON.parse(process.env.TEST_PULL_REQUEST),
      };
    }
    if (url.startsWith('https://api.github.com/repos/owner/repository/commits/') && url.includes('/check-runs?')) {
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(process.env.TEST_CHECK_RUNS || '{"check_runs":[]}'),
      };
    }
    throw new Error('Unexpected GitHub API request.');
  };`;
  const importUrl = `data:text/javascript,${encodeURIComponent(fetchStub)}`;

  const env = {
    ...process.env,
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: repository,
    EXPECTED_REPOSITORY: repository,
    PR_BASE_BRANCH: 'staging',
    TRIGGER_RUN_ID: '987',
    GITHUB_TOKEN: 'test-token',
    GITHUB_OUTPUT: outputPath,
    PR_NUMBER_FILE: numberPath,
    TEST_PULL_REQUEST: JSON.stringify(pullRequest),
    TEST_FETCH_LOG: fetchLogPath,
    ...envOverrides,
  };
  // Un valor undefined en envOverrides quita la variable.
  for (const [name, value] of Object.entries(env)) if (value === undefined) delete env[name];

  try {
    const result = spawnSync(process.execPath, ['--import', importUrl, verifier], { encoding: 'utf8', env });
    if (result.error) throw result.error;
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      output: readFileSync(outputPath, 'utf8'),
      requests: readFileSync(fetchLogPath, 'utf8').split('\n').filter(Boolean),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('acepta una PR abierta y lista con dos revisores distintos', () => {
  const result = runVerifier();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'eligible=true\npr_number=42\n');
});

test('rechaza números de artefacto que no sean un único entero decimal corto', () => {
  for (const artifact of ['0', '42\n', '42;echo x', '-42', '12345678901']) {
    const result = runVerifier({ artifact });
    assert.equal(result.status, 1, artifact);
    assert.equal(result.output, '', artifact);
  }
});

test('rechaza una ejecución ajena, fallida o de otro evento', () => {
  for (const change of [
    (event) => { event.repository.full_name = 'other/repository'; },
    (event) => { event.workflow_run.repository.full_name = 'other/repository'; },
    (event) => { event.workflow_run.conclusion = 'failure'; },
    (event) => { event.workflow_run.event = 'push'; },
    (event) => { event.workflow_run.id = 123; },
  ]) {
    const event = validEvent();
    change(event);
    const result = runVerifier({ event });
    assert.equal(result.status, 1);
    assert.equal(result.output, '');
  }
});

test('rechaza repositorio, ejecución o token mal configurados sin exponer el secreto', () => {
  for (const envOverrides of [
    { EXPECTED_REPOSITORY: 'other/repository' },
    { TRIGGER_RUN_ID: '123' },
    { GITHUB_TOKEN: '' },
  ]) {
    const result = runVerifier({ envOverrides });
    assert.equal(result.status, 1);
    assert.equal(result.output, '');
    assert.doesNotMatch(result.stderr, /test-token/);
  }
});

test('omite una PR cerrada antes de consultar Discord', () => {
  const pullRequest = validPullRequest();
  pullRequest.state = 'closed';
  const result = runVerifier({ pullRequest });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'eligible=false\n');
});

test('omite una PR en borrador sin fallar el workflow', () => {
  const pullRequest = validPullRequest();
  pullRequest.draft = true;
  const result = runVerifier({ pullRequest });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'eligible=false\n');
});

test('omite una PR cuya base no es staging', () => {
  const pullRequest = validPullRequest();
  pullRequest.base.ref = 'main';
  const result = runVerifier({ pullRequest });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'eligible=false\n');
});

test('rechaza una PR dirigida a otro repositorio o con estado inválido', () => {
  for (const change of [
    (pr) => { delete pr.draft; },
    (pr) => { pr.base.repo.full_name = 'other/repository'; },
    (pr) => { pr.number = 99; },
  ]) {
    const pullRequest = validPullRequest();
    change(pullRequest);
    const result = runVerifier({ pullRequest });
    assert.equal(result.status, 1);
    assert.equal(result.output, '');
  }
});

test('omite las PR con menos de dos revisores', () => {
  for (const reviewers of [[], [{ id: 10, login: 'first-reviewer' }]]) {
    const pullRequest = validPullRequest();
    pullRequest.requested_reviewers = reviewers;
    const result = runVerifier({ pullRequest });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, 'eligible=false\n');
  }
});

test('en este repositorio un revisor pedido basta y cero sigue sin aviso', () => {
  const one = validPullRequest();
  one.requested_reviewers = [{ id: 10, login: 'first-reviewer' }];
  const accepted = runVerifier({ pullRequest: one, envOverrides: { MINIMUM_REVIEWERS: '1' } });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(accepted.output, 'eligible=true\npr_number=42\n');

  const none = validPullRequest();
  none.requested_reviewers = [];
  const skipped = runVerifier({ pullRequest: none, envOverrides: { MINIMUM_REVIEWERS: '1' } });
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.equal(skipped.output, 'eligible=false\n');
});

test('exige el check review en verde sobre el SHA actual', () => {
  const sha = 'a'.repeat(40);
  const pullRequest = validPullRequest();
  pullRequest.head.sha = sha;
  const event = validEvent();
  event.workflow_run.head_sha = sha;
  const envOverrides = { REQUIRED_CHECK: 'review' };
  const missing = runVerifier({ event, pullRequest, envOverrides });
  assert.equal(missing.status, 0, missing.stderr);
  assert.equal(missing.output, 'eligible=false\n');

  const passed = runVerifier({
    event,
    pullRequest,
    envOverrides: {
      ...envOverrides,
      TEST_CHECK_RUNS: JSON.stringify({ check_runs: [{ name: 'review', conclusion: 'success', head_sha: sha }] }),
    },
  });
  assert.equal(passed.status, 0, passed.stderr);
  assert.equal(passed.output, 'eligible=true\npr_number=42\n');

  const failed = runVerifier({
    event,
    pullRequest,
    envOverrides: {
      ...envOverrides,
      TEST_CHECK_RUNS: JSON.stringify({ check_runs: [{ name: 'review', conclusion: 'failure', head_sha: sha }] }),
    },
  });
  assert.equal(failed.output, 'eligible=false\n');
});

test('admite tres o más revisores solicitados y distintos', () => {
  const pullRequest = validPullRequest();
  pullRequest.requested_reviewers.push({ id: 30, login: 'third-reviewer' });
  const result = runVerifier({ pullRequest });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'eligible=true\npr_number=42\n');
});

test('rechaza revisores duplicados en cualquier posición', () => {
  for (const reviewers of [
    [{ id: 10, login: 'first-reviewer' }, { id: 10, login: 'second-reviewer' }],
    [{ id: 10, login: 'first-reviewer' }, { id: 20, login: 'first-reviewer' }],
    [{ id: 10, login: 'first-reviewer' }, { id: 20, login: 'second-reviewer' }, { id: 10, login: 'third-reviewer' }],
  ]) {
    const pullRequest = validPullRequest();
    pullRequest.requested_reviewers = reviewers;
    const result = runVerifier({ pullRequest });
    assert.equal(result.status, 1, JSON.stringify(reviewers));
    assert.equal(result.output, '');
  }
});

test('vincula la PR al run por asociación o por rama, repositorio y commit', () => {
  const unrelatedEvent = validEvent();
  unrelatedEvent.workflow_run.pull_requests = [{ number: 99 }];
  assert.equal(runVerifier({ event: unrelatedEvent }).output, '');

  const fallbackEvent = validEvent();
  fallbackEvent.workflow_run.pull_requests = [];
  assert.equal(runVerifier({ event: fallbackEvent }).output, 'eligible=true\npr_number=42\n');

  fallbackEvent.workflow_run.head_sha = 'unrelated-commit';
  assert.equal(runVerifier({ event: fallbackEvent }).output, '');
});

test('admite una confirmación desde el workflow confiable y omite la PR borrador', () => {
  const event = validEvent();
  event.workflow_run.name = 'Discord: capture confirmation';
  event.workflow_run.event = 'issue_comment';
  event.workflow_run.pull_requests = [];
  event.workflow_run.head_branch = 'main';
  event.workflow_run.head_repository.full_name = repository;
  assert.equal(runVerifier({ event }).output, 'eligible=true\npr_number=42\n');

  const draft = validPullRequest();
  draft.draft = true;
  const result = runVerifier({ event, pullRequest: draft });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'eligible=false\n');

  event.workflow_run.head_repository.full_name = 'other/repository';
  assert.equal(runVerifier({ event }).status, 1);
});

test('no entrega número si GitHub falla al leer la PR', () => {
  const result = runVerifier({ httpStatus: 503 });
  assert.equal(result.status, 1);
  assert.equal(result.output, '');
  assert.match(result.stderr, /HTTP 503/);
});

// Una ejecución del disparador de PR o del comentario, con los datos que trae cada uno.
function pullRequestRun(name) {
  const event = validEvent();
  event.workflow_run.name = name;
  return event;
}

function commentRun(name = 'Discord: capture confirmation', headBranch = 'main') {
  const event = validEvent();
  Object.assign(event.workflow_run, { name, event: 'issue_comment', pull_requests: [], head_branch: headBranch });
  return event;
}

function assertForeignRun(result, label) {
  assert.equal(result.status, 1, label);
  assert.equal(result.stderr.trim(), FOREIGN_RUN, label);
  assert.equal(result.output, '', label);
}

function assertEligible(result, label) {
  assert.equal(result.status, 0, `${label}: ${result.stderr}`);
  assert.equal(result.output, ELIGIBLE, label);
}

test('acepta los nombres reales de los disparadores de PR', () => {
  for (const installation of installations) {
    assert.match(readRepo(installation.prTrigger), /^  pull_request:/m, installation.prTrigger);
    const name = workflowName(installation.prTrigger);
    for (const verifier of verifierCopies) {
      const label = `${installation.label}: «${name}» en ${verifier}`;
      assertEligible(runVerifier({ event: pullRequestRun(name), verifier }), label);
      // Sin asociación en el evento, vale la coincidencia de repositorio, rama y commit.
      const unassociated = pullRequestRun(name);
      unassociated.workflow_run.pull_requests = [];
      assertEligible(runVerifier({ event: unassociated, verifier }), label);
    }
  }
  // «review» sigue admitido aunque ningún workflow de hoy se llame así (RF-19).
  for (const verifier of verifierCopies) {
    assertEligible(runVerifier({ event: pullRequestRun('review'), verifier }), `review en ${verifier}`);
  }
});

test('cada emisor escucha los nombres reales de sus dos disparadores', () => {
  for (const installation of installations) {
    assert.match(readRepo(installation.confirmationTrigger), /^  issue_comment:/m, installation.confirmationTrigger);
    const list = readRepo(installation.publisher).match(/^    workflows:[ \t]*(\[.*\])[ \t]*$/m);
    assert.ok(list, `${installation.publisher} sin lista workflows`);
    assert.deepEqual(JSON.parse(list[1]),
      [workflowName(installation.prTrigger), workflowName(installation.confirmationTrigger)], installation.label);
  }
});

test('el emisor de este repositorio comprueba el job del disparador con su nombre real', () => {
  const [, own] = installations;
  const publisher = readRepo(own.publisher);
  const condition = publisher.match(/\[ "\$RUN_NAME" != "([^"]+)" \]/);
  assert.ok(condition, 'el emisor no condiciona por RUN_NAME');
  assert.equal(condition[1], workflowName(own.prTrigger));
  const job = publisher.match(/select\(\.name == "([^"]+)"\)/);
  assert.ok(job, 'el emisor no selecciona el job del disparador');
  assert.ok(readRepo(own.prTrigger).includes(`\n  ${job[1]}:\n`), `el disparador no tiene el job ${job[1]}`);
  assert.match(publisher, new RegExp(`required-check: ${job[1]}$`, 'm'));
});

test('la confirmación real de las plantillas y de este repositorio publica', () => {
  for (const installation of installations) {
    const name = workflowName(installation.confirmationTrigger);
    for (const verifier of verifierCopies) {
      assertEligible(runVerifier({ event: commentRun(name), verifier }), `${installation.label}: «${name}»`);
    }
  }
});

test('la confirmación se compara con la rama predeterminada', () => {
  for (const verifier of verifierCopies) {
    assertEligible(runVerifier({ event: commentRun(), verifier }), `main en ${verifier}`);
    // La base (staging) no es la predeterminada (main): ni la base ni otra rama valen (CB-16).
    for (const headBranch of ['staging', 'feature', 'refs/heads/main', 'Main', 'main ', '', null, undefined]) {
      // Se asigna aquí: un undefined como argumento tomaría el valor por defecto de commentRun.
      const event = commentRun();
      event.workflow_run.head_branch = headBranch;
      assertForeignRun(runVerifier({ event, verifier }), String(headBranch));
    }
    // Con otra rama predeterminada, cuenta esa y no «main».
    const renamed = commentRun(undefined, 'trunk/stable');
    renamed.repository.default_branch = 'trunk/stable';
    assertEligible(runVerifier({ event: renamed, verifier }), 'trunk/stable');
    renamed.workflow_run.head_branch = 'main';
    assertForeignRun(runVerifier({ event: renamed, verifier }), 'main sin ser predeterminada');
    // La PR sigue teniendo que ir a la rama base.
    const toDefault = validPullRequest();
    toDefault.base.ref = 'main';
    const skipped = runVerifier({ event: commentRun(), pullRequest: toDefault, verifier });
    assert.equal(skipped.status, 0, skipped.stderr);
    assert.equal(skipped.output, 'eligible=false\n');
  }
});

test('rechaza un disparador con otro nombre, evento o repositorio', () => {
  const accepted = new Set([...installations.map((item) => workflowName(item.prTrigger)), 'review']);
  // Todos los demás workflows reales, incluidos los emisores y las confirmaciones, se rechazan.
  const otherNames = [ownWorkflows, templates]
    .flatMap((folder) => readdirSync(new URL(folder, repoRoot)).map((file) => workflowName(`${folder}${file}`)))
    .filter((name) => !accepted.has(name));
  assert.ok(otherNames.includes('Discord: capture confirmation'));
  const prNames = [...accepted];

  for (const verifier of verifierCopies) {
    for (const name of [...new Set(otherNames), 'Review', 'review ', 'Discord: capture pr', 'Discord: capture PR ',
      'PR: check rules (copy)', 'capture PR', '', null, undefined]) {
      assertForeignRun(runVerifier({ event: pullRequestRun(name), verifier }), `pull_request «${name}»`);
    }
    // Un nombre válido con el evento que no le corresponde (CB-15).
    for (const name of prNames) {
      assertForeignRun(runVerifier({ event: commentRun(name), verifier }), `issue_comment «${name}»`);
      for (const eventName of ['pull_request_target', 'push', 'workflow_dispatch']) {
        const event = pullRequestRun(name);
        event.workflow_run.event = eventName;
        assertForeignRun(runVerifier({ event, verifier }), `${eventName} «${name}»`);
      }
    }
    // Otro repositorio o una ejecución fallida, con cualquiera de los dos disparadores.
    for (const build of [...prNames.map((name) => () => pullRequestRun(name)), () => commentRun()]) {
      for (const change of [
        (event) => { event.repository.full_name = 'other/repository'; },
        (event) => { event.workflow_run.repository.full_name = 'other/repository'; },
        (event) => { delete event.workflow_run.repository; },
        (event) => { event.workflow_run.conclusion = 'failure'; },
        (event) => { event.workflow_run.id = 123; },
      ]) {
        const event = build();
        change(event);
        assertForeignRun(runVerifier({ event, verifier }), `${event.workflow_run.name}: ${change}`);
      }
    }
    // El comentario exige además que la ejecución venga de este repositorio.
    for (const headRepository of [{ full_name: 'other/repository' }, {}, null, undefined]) {
      const event = commentRun();
      event.workflow_run.head_repository = headRepository;
      assertForeignRun(runVerifier({ event, verifier }), `head_repository ${JSON.stringify(headRepository)}`);
    }
    // El disparador de PR sigue atado a la PR de la ejecución.
    for (const name of prNames) {
      for (const change of [
        (run) => { run.pull_requests = [{ number: 99 }]; },
        (run) => { run.pull_requests = []; run.head_repository.full_name = 'other/repository'; },
        (run) => { run.pull_requests = []; run.head_branch = 'unrelated'; },
        (run) => { run.pull_requests = []; run.head_sha = 'unrelated'; },
      ]) {
        const event = pullRequestRun(name);
        change(event.workflow_run);
        const result = runVerifier({ event, verifier });
        assert.equal(result.status, 1, `${name}: ${change}`);
        assert.match(result.stderr, /does not match the completed trigger run/);
        assert.equal(result.output, '');
      }
    }
  }
});

test('rechaza la confirmación sin rama predeterminada', () => {
  for (const verifier of verifierCopies) {
    for (const defaultBranch of [undefined, null, '', 0, 1, false, true, ['main'], { name: 'main' }]) {
      // Sin head_branch, con el mismo valor que el campo inválido y con una rama normal.
      for (const headBranch of [undefined, defaultBranch, 'main', 'staging']) {
        const event = commentRun();
        event.repository.default_branch = defaultBranch;
        event.workflow_run.head_branch = headBranch;
        assertForeignRun(runVerifier({ event, verifier }),
          `default_branch ${JSON.stringify(defaultBranch)}, head_branch ${JSON.stringify(headBranch)}`);
      }
    }
    // El disparador de PR no depende de ese campo.
    for (const defaultBranch of [undefined, null, '']) {
      const event = pullRequestRun('PR: check rules');
      event.repository.default_branch = defaultBranch;
      assertEligible(runVerifier({ event, verifier }), `PR con default_branch ${JSON.stringify(defaultBranch)}`);
    }
  }
});

test('admite una rama base con barra', () => {
  for (const base of VALID_BASE_BRANCHES) {
    assert.equal(validateBranch(base), base);
    const pullRequest = validPullRequest();
    pullRequest.base.ref = base;
    for (const verifier of verifierCopies) {
      for (const event of [pullRequestRun('Discord: capture PR'), commentRun()]) {
        assertEligible(runVerifier({ event, pullRequest, verifier, envOverrides: { PR_BASE_BRANCH: base } }), base);
      }
    }
  }
  // La base se compara solo como texto: otra rama parecida se omite.
  for (const verifier of verifierCopies) {
    for (const ref of ['release', 'release/1', 'release/1.1', 'Release/1.0', 'refs/heads/release/1.0', 'staging']) {
      const pullRequest = validPullRequest();
      pullRequest.base.ref = ref;
      const result = runVerifier({ pullRequest, verifier, envOverrides: { PR_BASE_BRANCH: 'release/1.0' } });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.output, 'eligible=false\n', ref);
    }
  }
});

test('rechaza una rama base no válida', () => {
  for (const base of INVALID_BASE_BRANCHES) {
    const label = JSON.stringify(base) ?? 'ausente';
    assert.throws(() => validateBranch(base), /no es válida/, label);
    for (const verifier of verifierCopies) {
      const pullRequest = validPullRequest();
      pullRequest.base.ref = base;
      const result = runVerifier({ pullRequest, verifier, envOverrides: { PR_BASE_BRANCH: base } });
      assert.equal(result.status, 1, label);
      assert.equal(result.stderr.trim(), 'Notification verification configuration is incomplete.', label);
      assert.equal(result.output, '', label);
      assert.deepEqual(result.requests, [], label);
    }
  }
});
