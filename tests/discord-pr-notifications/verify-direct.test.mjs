import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const verifierPath = fileURLToPath(new URL('../../.github/actions/discord-pr-notifications/verify-direct.mjs', import.meta.url));
const repository = 'owner/repository';

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
  number = '42', httpStatus = 200, envOverrides = {} } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'discord-pr-direct-'));
  const eventPath = join(directory, 'event.json');
  const outputPath = join(directory, 'output');
  writeFileSync(eventPath, JSON.stringify(event), 'utf8');
  writeFileSync(outputPath, '', 'utf8');
  const fetchStub = `globalThis.fetch = async (url, options) => {
    if (url !== 'https://api.github.com/repos/owner/repository/pulls/42' ||
        options.headers.authorization !== 'Bearer test-token') {
      throw new Error('Unexpected GitHub API request.');
    }
    return {
      ok: ${httpStatus === 200},
      status: ${httpStatus},
      json: async () => JSON.parse(process.env.TEST_PULL_REQUEST),
    };
  };`;
  const importUrl = `data:text/javascript,${encodeURIComponent(fetchStub)}`;
  try {
    const result = spawnSync(process.execPath, ['--import', importUrl, verifierPath], {
      encoding: 'utf8',
      env: {
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
        ...envOverrides,
      },
    });
    if (result.error) throw result.error;
    return { status: result.status, output: readFileSync(outputPath, 'utf8'), stderr: result.stderr };
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
