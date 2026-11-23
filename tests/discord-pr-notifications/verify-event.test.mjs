import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const verifierPath = fileURLToPath(new URL('../../.github/actions/discord-pr-notifications/verify-event.mjs', import.meta.url));
const repository = 'owner/repository';
const prNumber = 42;

function validEvent() {
  return {
    repository: { full_name: repository },
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
function runVerifier({ event = validEvent(), pullRequest = validPullRequest(), artifact = '42', httpStatus = 200, envOverrides = {} } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'discord-pr-verify-'));
  const eventPath = join(directory, 'event.json');
  const numberPath = join(directory, 'pr-number');
  const outputPath = join(directory, 'output');
  writeFileSync(eventPath, JSON.stringify(event), 'utf8');
  writeFileSync(numberPath, artifact, 'utf8');
  writeFileSync(outputPath, '', 'utf8');

  const fetchStub = `globalThis.fetch = async (url, options) => {
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

  try {
    const result = spawnSync(process.execPath, ['--import', importUrl, verifierPath], {
      encoding: 'utf8',
      env: {
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
        ...envOverrides,
      },
    });
    if (result.error) throw result.error;
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      output: readFileSync(outputPath, 'utf8'),
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
  event.workflow_run.head_branch = 'staging';
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
