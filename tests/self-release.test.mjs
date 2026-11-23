import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../.github/scripts/self-release.py', import.meta.url));
const repo = 'venturars/delivery-workflow';

const manifest = `name: delivery-workflow
version: "1.1.5"
dependencies:
  apm:
    - venturars/delivery-workflow#v1.1.2
  mcp:
    - name: eur-lex
      registry: false
`;

const withoutSelf = `name: delivery-workflow
version: "1.1.2"
dependencies:
  mcp:
    - name: eur-lex
      registry: false
`;

function run(args, input) {
  return spawnSync('python3', [script, ...args], {
    input,
    encoding: 'utf8',
  });
}

test('el commit de release quita la autodependencia y conserva mcp', () => {
  const dir = mkdtempSync(join(tmpdir(), 'self-release-'));
  const file = join(dir, 'apm.yml');
  writeFileSync(file, manifest);

  const check = run(['align', '--check', '--file', file, repo]);
  assert.equal(check.status, 0);
  assert.equal(check.stdout, 'changed\n');
  assert.equal(readFileSync(file, 'utf8'), manifest);

  const align = run(['align', '--file', file, repo]);
  assert.equal(align.status, 0);
  assert.equal(align.stdout, 'changed\n');
  const written = readFileSync(file, 'utf8');
  assert.match(written, /^version: "1\.1\.5"$/m);
  assert.doesNotMatch(written, /delivery-workflow#/);
  assert.doesNotMatch(written, /^ {2}apm:$/m);
  assert.match(written, /^ {2}mcp:$/m);
  assert.match(written, /name: eur-lex/);

  const again = run(['align', '--check', '--file', file, repo]);
  assert.equal(again.stdout, 'absent\n');
});

test('elige la release más alta que no depende de este repositorio', () => {
  const dir = mkdtempSync(join(tmpdir(), 'self-release-manifests-'));
  writeFileSync(join(dir, 'v1.1.4.yml'), manifest);
  writeFileSync(join(dir, 'v1.1.2.yml'), withoutSelf);
  writeFileSync(join(dir, 'v1.1.6.yml'), withoutSelf.replace('1.1.2', '1.1.6'));
  const releases = JSON.stringify([
    { tag_name: 'v1.1.2', draft: false, prerelease: false },
    { tag_name: 'v1.1.4', draft: false, prerelease: false },
    { tag_name: 'v1.1.6', draft: false, prerelease: false },
  ]);

  const selected = run(['select', '--manifests', dir, repo], releases);
  assert.equal(selected.status, 0);
  assert.equal(selected.stdout, 'v1.1.6\n');

  writeFileSync(join(dir, 'v1.1.6.yml'), manifest);
  const skipped = run(['select', '--manifests', dir, repo], releases);
  assert.equal(skipped.status, 0);
  assert.equal(skipped.stdout, 'v1.1.2\n');
  assert.match(skipped.stderr, /Se omite v1\.1\.6: apm\.yml depende de venturars\/delivery-workflow#v1\.1\.2/);
  assert.match(skipped.stderr, /Se omite v1\.1\.4/);
});

test('si todas las releases se dependen de sí mismas no elige ninguna', () => {
  const dir = mkdtempSync(join(tmpdir(), 'self-release-none-'));
  writeFileSync(join(dir, 'v1.1.4.yml'), manifest);
  const releases = JSON.stringify([
    { tag_name: 'v1.1.4', draft: false, prerelease: false },
  ]);
  const selected = run(['select', '--manifests', dir, repo], releases);
  assert.equal(selected.status, 0);
  assert.equal(selected.stdout, '');
  assert.match(selected.stderr, /Se omite v1\.1\.4/);
});

test('pin lee la entrada actual y el workflow no actualiza si ya coincide', () => {
  const dir = mkdtempSync(join(tmpdir(), 'self-release-pin-'));
  const file = join(dir, 'apm.yml');
  writeFileSync(file, manifest);
  const pin = run(['pin', '--file', file, repo]);
  assert.equal(pin.status, 0);
  assert.equal(pin.stdout, 'venturars/delivery-workflow#v1.1.2\n');

  const workflow = readFileSync(new URL('../.github/workflows/update-apm-dependency.yml', import.meta.url), 'utf8');
  assert.match(workflow, /self-release\.py select "\$DEPENDENCY_REPO"/);
  assert.match(workflow, /steps\.compatible\.outputs\.ref/);
  assert.match(workflow, /dependencies\.apm ya apunta a \$\{REF\}/);
  assert.doesNotMatch(workflow, /steps\.release\.outputs\.ref/);

  const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  assert.match(release, /self-release\.py align --check "\$REPOSITORIO"/);
  assert.match(release, /Quita \$\{REPOSITORIO\} de dependencies\.apm/);
});
