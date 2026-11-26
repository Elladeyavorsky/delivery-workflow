import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ACTION_COPIES, INVALID_BASE_BRANCHES, VALID_BASE_BRANCHES } from './base-branches.mjs';

const verifierPath = fileURLToPath(new URL('../../.github/actions/discord-pr-notifications/verify-direct.mjs', import.meta.url));
const repository = 'owner/repository';
const verifierCopies = ACTION_COPIES.map((directory) => fileURLToPath(new URL('verify-direct.mjs', directory)));

function validPr() {
  return {
    number: 42,
    state: 'open',
    draft: false,
    base: { repo: { full_name: repository }, ref: 'staging' },
    requested_reviewers: [
      { id: 10, login: 'first-reviewer' },
      { id: 20, login: 'second-reviewer' },
    ],
  };
}

function validEvent() {
  return {
    repository: { full_name: repository, default_branch: 'main' },
    action: 'opened',
    pull_request: {
      number: 42,
      base: { repo: { full_name: repository }, ref: 'staging' },
    },
  };
}

// El proceso hijo simula GitHub y comprueba que el evento directo no ejecute código de la PR.
function runVerifier({ event = validEvent(), pr = validPr(), name = 'pull_request_target',
  number = '42', httpStatus = 200, envOverrides = {}, verifier = verifierPath } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'discord-pr-direct-'));
  const eventPath = join(directory, 'event.json');
  const outputPath = join(directory, 'output');
  const fetchLogPath = join(directory, 'fetch-log');
  writeFileSync(fetchLogPath, '', 'utf8');
  writeFileSync(eventPath, JSON.stringify(event), 'utf8');
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
    GITHUB_EVENT_NAME: name,
    GITHUB_REF: 'refs/heads/main',
    GITHUB_REPOSITORY: repository,
    GITHUB_TOKEN: 'test-token',
    GITHUB_OUTPUT: outputPath,
    EXPECTED_REPOSITORY: repository,
    PR_BASE_BRANCH: 'staging',
    TRUSTED_BRANCH: 'main',
    PR_NUMBER: number,
    TEST_PULL_REQUEST: JSON.stringify(pr),
    TEST_FETCH_LOG: fetchLogPath,
    ...envOverrides,
  };
  // Un valor undefined en envOverrides quita la variable.
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
  try {
    const result = spawnSync(process.execPath, ['--import', importUrl, verifier], { encoding: 'utf8', env });
    if (result.error) throw result.error;
    return {
      status: result.status,
      output: readFileSync(outputPath, 'utf8'),
      stderr: result.stderr,
      requests: readFileSync(fetchLogPath, 'utf8').split('\n').filter(Boolean),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('admite una PR hacia staging desde el workflow confiable de main', () => {
  const result = runVerifier();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'eligible=true\npr_number=42\n');
});

test('admite un comentario de asociación de una PR', () => {
  const event = validEvent();
  event.action = 'created';
  delete event.pull_request;
  event.issue = { number: 42, pull_request: { url: 'https://api.github.com/repos/owner/repository/pulls/42' } };
  event.comment = { body: '/discord-map first-reviewer 123456789012345678' };
  const result = runVerifier({ event, name: 'issue_comment' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'eligible=true\npr_number=42\n');
});

test('un revisor basta cuando el mínimo es uno y el check pedido tiene que estar en verde', () => {
  const pr = validPr();
  pr.requested_reviewers = [{ id: 10, login: 'first-reviewer' }];
  const accepted = runVerifier({ pr, envOverrides: { MINIMUM_REVIEWERS: '1' } });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(accepted.output, 'eligible=true\npr_number=42\n');

  pr.requested_reviewers = [];
  const skipped = runVerifier({ pr, envOverrides: { MINIMUM_REVIEWERS: '1' } });
  assert.equal(skipped.output, 'eligible=false\n');

  const sha = 'b'.repeat(40);
  const ready = validPr();
  ready.head = { sha };
  const missing = runVerifier({ pr: ready, envOverrides: { REQUIRED_CHECK: 'review' } });
  assert.equal(missing.output, 'eligible=false\n');
  const passed = runVerifier({
    pr: ready,
    envOverrides: {
      REQUIRED_CHECK: 'review',
      TEST_CHECK_RUNS: JSON.stringify({ check_runs: [{ name: 'review', conclusion: 'success', head_sha: sha }] }),
    },
  });
  assert.equal(passed.output, 'eligible=true\npr_number=42\n');
});

test('omite PR cerradas, borradores y PR con menos de dos revisores', () => {
  for (const change of [
    (pr) => { pr.state = 'closed'; },
    (pr) => { pr.draft = true; },
    (pr) => { pr.requested_reviewers = []; },
    (pr) => { pr.requested_reviewers.pop(); },
  ]) {
    const pr = validPr();
    change(pr);
    const result = runVerifier({ pr });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, 'eligible=false\n');
  }
});

test('rechaza eventos ajenos, ramas no confiables y números alterados', () => {
  const changes = [
    { envOverrides: { GITHUB_REF: 'refs/heads/staging' } },
    { envOverrides: { TRUSTED_BRANCH: 'staging' } },
    { envOverrides: { GITHUB_REPOSITORY: 'other/repository' } },
    { envOverrides: { PR_NUMBER: '42;echo leaked' } },
    { name: 'pull_request' },
  ];
  for (const options of changes) {
    const result = runVerifier(options);
    assert.equal(result.status, 1);
    assert.equal(result.output, '');
    assert.doesNotMatch(result.stderr, /test-token/);
  }
});

test('rechaza evento de PR hacia otra base o con acción no permitida', () => {
  for (const change of [
    (event) => { event.action = 'closed'; },
    (event) => { event.pull_request.base.ref = 'main'; },
    (event) => { event.pull_request.number = 99; },
    (event) => { event.repository.full_name = 'other/repository'; },
  ]) {
    const event = validEvent();
    change(event);
    const result = runVerifier({ event });
    assert.equal(result.status, 1);
    assert.equal(result.output, '');
  }
});

test('rechaza comentarios que no sean una asociación en una PR', () => {
  for (const change of [
    (event) => { event.comment.body = 'unrelated comment'; },
    (event) => { delete event.issue.pull_request; },
    (event) => { event.issue.number = 99; },
  ]) {
    const event = validEvent();
    event.action = 'created';
    delete event.pull_request;
    event.issue = { number: 42, pull_request: {} };
    event.comment = { body: '/discord-map first-reviewer 123456789012345678' };
    change(event);
    const result = runVerifier({ event, name: 'issue_comment' });
    assert.equal(result.status, 1);
    assert.equal(result.output, '');
  }
});

test('rechaza un estado de PR inválido o un fallo de GitHub sin publicar', () => {
  const pr = validPr();
  delete pr.draft;
  assert.equal(runVerifier({ pr }).status, 1);
  const result = runVerifier({ httpStatus: 503 });
  assert.equal(result.status, 1);
  assert.equal(result.output, '');
  assert.match(result.stderr, /HTTP 503/);
});

function commentEvent() {
  const event = validEvent();
  event.action = 'created';
  delete event.pull_request;
  event.issue = { number: 42, pull_request: {} };
  event.comment = { body: '/discord-map first-reviewer 123456789012345678' };
  return event;
}

test('admite una rama base con barra', () => {
  for (const verifier of verifierCopies) {
    for (const base of VALID_BASE_BRANCHES) {
      const pr = validPr();
      pr.base.ref = base;
      const event = validEvent();
      event.pull_request.base.ref = base;
      for (const options of [{ event }, { event: commentEvent(), name: 'issue_comment' }]) {
        const result = runVerifier({ ...options, pr, verifier, envOverrides: { PR_BASE_BRANCH: base } });
        assert.equal(result.status, 0, `${base}: ${result.stderr}`);
        assert.equal(result.output, 'eligible=true\npr_number=42\n', base);
      }
    }
  }
});

test('con una rama base con barra, una PR hacia otra base no se publica', () => {
  const envOverrides = { PR_BASE_BRANCH: 'release/1.0' };
  for (const verifier of verifierCopies) {
    for (const ref of ['release', 'release/1.1', 'staging']) {
      const pr = validPr();
      pr.base.ref = ref;
      // El comentario no trae la base: la PR leída de GitHub se omite.
      const skipped = runVerifier({ event: commentEvent(), name: 'issue_comment', pr, verifier, envOverrides });
      assert.equal(skipped.status, 0, skipped.stderr);
      assert.equal(skipped.output, 'eligible=false\n', ref);
      // El evento de PR hacia otra base se rechaza antes de leer la PR.
      const event = validEvent();
      event.pull_request.base.ref = ref;
      const rejected = runVerifier({ event, pr, verifier, envOverrides });
      assert.equal(rejected.status, 1, ref);
      assert.match(rejected.stderr, /does not target the expected repository and base/);
      assert.equal(rejected.output, '');
      assert.deepEqual(rejected.requests, []);
    }
  }
});

test('rechaza una rama base no válida', () => {
  for (const verifier of verifierCopies) {
    for (const base of INVALID_BASE_BRANCHES) {
      const label = JSON.stringify(base) ?? 'ausente';
      const pr = validPr();
      pr.base.ref = base;
      const event = validEvent();
      event.pull_request.base.ref = base;
      const result = runVerifier({ event, pr, verifier, envOverrides: { PR_BASE_BRANCH: base } });
      assert.equal(result.status, 1, label);
      assert.equal(result.stderr.trim(), 'Direct notification configuration is incomplete.', label);
      assert.equal(result.output, '', label);
      assert.deepEqual(result.requests, [], label);
    }
  }
});

test('trusted-branch sigue sin admitir la barra', () => {
  for (const verifier of verifierCopies) {
    const event = validEvent();
    event.repository.default_branch = 'release/1.0';
    const result = runVerifier({ event, verifier,
      envOverrides: { TRUSTED_BRANCH: 'release/1.0', GITHUB_REF: 'refs/heads/release/1.0' } });
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim(), 'Direct notification configuration is incomplete.');
    assert.deepEqual(result.requests, []);
  }
});
