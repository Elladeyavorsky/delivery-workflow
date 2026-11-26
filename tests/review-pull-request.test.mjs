import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readMergeable, reviewPullRequest } from '../.github/scripts/review-pull-request.mjs';

const workflow = readFileSync(new URL('../.github/workflows/pr-check-rules.yml', import.meta.url), 'utf8');

function validFacts(overrides = {}) {
  return {
    base: 'staging',
    head: '88-chore-rename-workflows',
    title: 'Rename workflows and review pull requests',
    body: '## Issue\n\nCloses #88\n',
    assignee: 'venturars',
    mergeable: true,
    paths: ['.github/workflows/pr-check-rules.yml'],
    versionBefore: '1.1.1',
    versionAfter: '1.1.1',
    commits: [
      { subject: 'chore: open #88', body: '' },
      { subject: 'chore: rename workflows and review pull requests', body: 'Refs #88' },
    ],
    ...overrides,
  };
}

test('acepta una pull request de trabajo que cumple las reglas', () => {
  assert.deepEqual(reviewPullRequest(validFacts()), []);
});

test('rechaza autodependencia hacia staging', () => {
  const errors = reviewPullRequest(validFacts({
    selfPin: 'venturars/delivery-workflow#v1.1.2',
    paths: ['.github/workflows/pr-check-rules.yml'],
  }));
  assert.deepEqual(errors, ['apm.yml no lista este paquete en dependencies.apm.']);
});

test('acepta sin autodependencia', () => {
  assert.deepEqual(reviewPullRequest(validFacts()), []);
  assert.deepEqual(reviewPullRequest(validFacts({ selfPin: '' })), []);
});

test('acepta la pull request de staging a main', () => {
  const errors = reviewPullRequest(validFacts({
    base: 'main',
    head: 'staging',
    title: 'chore: release staging',
    body: 'Sin issue.',
    assignee: '',
    versionBefore: '1.1.1',
    versionAfter: '1.2.0',
    commits: [{ subject: 'chore: release 1.1.1', body: '' }],
  }));
  assert.deepEqual(errors, []);
});

test('rechaza una pull request a main que no sale de staging', () => {
  const errors = reviewPullRequest(validFacts({ base: 'main', head: '88-chore-rename-workflows' }));
  assert.deepEqual(errors, ['La base tiene que ser staging.']);
});

test('nombra cada regla incumplida en una pull request a staging', () => {
  const errors = reviewPullRequest(validFacts({
    head: 'feature',
    title: 'hola',
    body: 'Sin enlace.',
    assignee: ' ',
    mergeable: false,
    paths: ['.env'],
    versionAfter: '9.9.9',
    commits: [{ subject: 'Update stuff', body: '' }],
  }));
  assert.ok(errors.some((error) => error.includes('número-tipo-descripcion')));
  assert.ok(errors.some((error) => error.includes('mayúscula')));
  assert.ok(errors.some((error) => error.includes('Closes #N')));
  assert.ok(errors.some((error) => error.includes('persona asignada')));
  assert.ok(errors.some((error) => error.includes('conflictos con la rama base')));
  assert.ok(errors.some((error) => error.includes('Conventional Commit')));
  assert.ok(errors.some((error) => error.includes('.env')));
  assert.ok(errors.some((error) => error.includes('version en apm.yml')));
});

test('no exige persona asignada si la pull request viene de un fork', () => {
  assert.deepEqual(reviewPullRequest(validFacts({ assignee: '', fork: true })), []);
});

test('exige persona asignada si la rama es del propio repositorio', () => {
  const errors = reviewPullRequest(validFacts({ assignee: '', fork: false }));
  assert.deepEqual(errors, ['La pull request tiene que tener una persona asignada.']);
});

test('el workflow pasa si la pull request viene de un fork', () => {
  assert.match(workflow, /PR_FROM_FORK: \$\{\{ github\.event\.pull_request\.head\.repo\.full_name != github\.repository \}\}/);
});

test('falla si los conflictos no están calculados', () => {
  const errors = reviewPullRequest(validFacts({ mergeable: null }));
  assert.deepEqual(errors, ['GitHub aún no ha calculado los conflictos.']);
});

test('un .env en un subdirectorio cuenta y un commit con ruptura exige el pie', () => {
  const envError = reviewPullRequest(validFacts({ paths: ['docs/.env'] }));
  assert.deepEqual(envError, ['El diff no puede añadir ni modificar docs/.env.']);

  const breaking = reviewPullRequest(validFacts({
    commits: [{ subject: 'feat!: drop the old flag', body: '' }],
  }));
  assert.deepEqual(breaking, ['El commit feat!: drop the old flag necesita BREAKING CHANGE: en el cuerpo.']);

  const accepted = reviewPullRequest(validFacts({
    commits: [{ subject: 'feat!: drop the old flag', body: 'BREAKING CHANGE: the flag is gone' }],
  }));
  assert.deepEqual(accepted, []);
});

test('reintenta el cálculo de conflictos hasta que GitHub responde', async () => {
  const values = [null, true];
  let waits = 0;
  const mergeable = await readMergeable(() => values.shift(), 3, async () => {
    waits += 1;
  });
  assert.equal(mergeable, true);
  assert.equal(waits, 1);
  assert.equal(await readMergeable(() => null, 2, async () => {}), null);
});

test('review corre los tests y la comprobación solo en staging, no en main', () => {
  assert.match(workflow, /^name: "PR: check rules"$/m);
  assert.match(workflow, /group: pr-check-rules-\$\{\{ github\.event\.pull_request\.number \}\}\n\s*cancel-in-progress: true/);
  assert.match(workflow, /^  check-rules:$/m);
  assert.match(workflow, /pull_request:\s*\n\s*branches: \[staging\]\n/);
  assert.match(workflow, /types: \[opened, synchronize, reopened, ready_for_review, review_requested\]/);
  assert.match(workflow, /name: discord-pr-number/);
  assert.match(workflow, /if: github\.base_ref == 'staging'/);
  assert.match(workflow, /if: github\.event\.pull_request\.draft == false/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /pull-requests: read/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.doesNotMatch(workflow, /node --test|scripts\.test\.sh/);
  assert.match(workflow, /node \.github\/scripts\/review-pull-request\.mjs/);
  assert.doesNotMatch(workflow, /pull_request_target|secrets\./);
});

test('Code: check ejecuta los tests de la pull request y resume el resultado en ci', () => {
  const codeCheck = readFileSync(new URL('../.github/workflows/code-check.yml', import.meta.url), 'utf8');
  assert.match(codeCheck, /^name: "Code: check"$/m);
  assert.match(codeCheck, /pull_request:\s*\n\s*branches: \[staging\]\n/);
  assert.match(codeCheck, /cancel-in-progress: true/);
  assert.match(codeCheck, /node --test tests\/\*\.mjs tests\/discord-pr-notifications\/\*\.test\.mjs/);
  assert.match(codeCheck, /bash tests\/scripts\.test\.sh/);
  assert.match(codeCheck, /^  ci:$/m);
  assert.doesNotMatch(codeCheck, /pull_request_target|secrets\./);
});
