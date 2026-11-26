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

test('set escribe la autodependencia cuando el release la quitó', () => {
  const dir = mkdtempSync(join(tmpdir(), 'self-release-set-'));
  const file = join(dir, 'apm.yml');
  writeFileSync(file, withoutSelf);

  const inserted = run(['set', '--file', file, repo, 'v1.1.5']);
  assert.equal(inserted.status, 0);
  assert.equal(inserted.stdout, 'inserted\n');
  assert.equal(readFileSync(file, 'utf8'), `name: delivery-workflow
version: "1.1.2"
dependencies:
  apm:
    - venturars/delivery-workflow#v1.1.5
  mcp:
    - name: eur-lex
      registry: false
`);

  const updated = run(['set', '--file', file, repo, 'v1.1.6']);
  assert.equal(updated.status, 0);
  assert.equal(updated.stdout, 'updated\n');
  assert.match(readFileSync(file, 'utf8'), /venturars\/delivery-workflow#v1\.1\.6/);
  assert.match(readFileSync(file, 'utf8'), /^ {2}mcp:$/m);

  const same = run(['set', '--file', file, repo, 'v1.1.6']);
  assert.equal(same.status, 0);
  assert.equal(same.stdout, 'unchanged\n');
});

test('set conserva el comentario y rechaza ref, ausencia y duplicado sin escribir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'self-release-set-guard-'));
  const commented = join(dir, 'commented.yml');
  writeFileSync(commented, `dependencies:
  apm:
    - "venturars/delivery-workflow#v1.1.2" # pin
  mcp:
    - name: eur-lex
`);
  const commentedResult = run(['set', '--file', commented, repo, 'v1.1.5']);
  assert.equal(commentedResult.status, 0);
  assert.equal(commentedResult.stdout, 'updated\n');
  assert.equal(
    readFileSync(commented, 'utf8'),
    `dependencies:
  apm:
    - "venturars/delivery-workflow#v1.1.5" # pin
  mcp:
    - name: eur-lex
`,
  );

  const invalid = join(dir, 'invalid.yml');
  writeFileSync(invalid, withoutSelf);
  const beforeInvalid = readFileSync(invalid, 'utf8');
  const rejected = run(['set', '--file', invalid, repo, 'staging']);
  assert.notEqual(rejected.status, 0);
  assert.equal(readFileSync(invalid, 'utf8'), beforeInvalid);

  const missing = join(dir, 'missing.yml');
  writeFileSync(missing, 'name: delivery-workflow\n');
  const beforeMissing = readFileSync(missing, 'utf8');
  const noDependencies = run(['set', '--file', missing, repo, 'v1.1.5']);
  assert.notEqual(noDependencies.status, 0);
  assert.match(noDependencies.stderr, /no contiene dependencies/);
  assert.equal(readFileSync(missing, 'utf8'), beforeMissing);

  const duplicate = join(dir, 'duplicate.yml');
  writeFileSync(duplicate, `dependencies:
  apm:
    - venturars/delivery-workflow#v1.1.2
    - venturars/delivery-workflow#v1.1.4
`);
  const beforeDuplicate = readFileSync(duplicate, 'utf8');
  const ambiguous = run(['set', '--file', duplicate, repo, 'v1.1.5']);
  assert.notEqual(ambiguous.status, 0);
  assert.equal(readFileSync(duplicate, 'utf8'), beforeDuplicate);
});

test('latest elige la release estable más alta sin mirar el manifiesto', () => {
  const releases = JSON.stringify([
    { tag_name: 'v1.2.3', draft: false, prerelease: false },
    { tag_name: 'v1.3.0', draft: false, prerelease: false },
    { tag_name: 'v1.4.0', draft: false, prerelease: false },
  ]);
  const newest = run(['latest'], releases);
  assert.equal(newest.status, 0);
  assert.equal(newest.stdout, 'v1.4.0\n');

  const onlySelfPinned = JSON.stringify([
    { tag_name: 'v1.4.0', draft: false, prerelease: false },
    { tag_name: 'v1.3.0', draft: false, prerelease: false },
    { tag_name: 'v1.2.3', draft: false, prerelease: false },
  ]);
  const stillNewest = run(['latest'], onlySelfPinned);
  assert.equal(stillNewest.status, 0);
  assert.equal(stillNewest.stdout, 'v1.4.0\n');
});

test('select y latest difieren cuando las releases nuevas traen autodependencia', () => {
  const dir = mkdtempSync(join(tmpdir(), 'self-release-latest-vs-select-'));
  writeFileSync(join(dir, 'v1.4.0.yml'), manifest);
  writeFileSync(join(dir, 'v1.3.0.yml'), manifest);
  writeFileSync(join(dir, 'v1.2.3.yml'), withoutSelf);
  const releases = JSON.stringify([
    { tag_name: 'v1.2.3', draft: false, prerelease: false },
    { tag_name: 'v1.3.0', draft: false, prerelease: false },
    { tag_name: 'v1.4.0', draft: false, prerelease: false },
  ]);
  const newest = run(['latest'], releases);
  assert.equal(newest.stdout, 'v1.4.0\n');
  const installable = run(['select', '--manifests', dir, repo], releases);
  assert.equal(installable.stdout, 'v1.2.3\n');
});

test('nested lee el pin del manifiesto de la release', () => {
  const dir = mkdtempSync(join(tmpdir(), 'self-release-nested-'));
  writeFileSync(join(dir, 'v1.4.1.yml'), manifest);
  writeFileSync(join(dir, 'v1.2.3.yml'), withoutSelf);

  const nested = run(['nested', '--manifests', dir, repo, 'v1.4.1']);
  assert.equal(nested.status, 0);
  assert.equal(nested.stdout, 'venturars/delivery-workflow#v1.1.2\n');

  const none = run(['nested', '--manifests', dir, repo, 'v1.2.3']);
  assert.equal(none.status, 0);
  assert.equal(none.stdout, '');

  const invalid = run(['nested', '--manifests', dir, repo, 'staging']);
  assert.notEqual(invalid.status, 0);
});

test('pin lee la entrada actual y el workflow no actualiza si ya coincide', () => {
  const dir = mkdtempSync(join(tmpdir(), 'self-release-pin-'));
  const file = join(dir, 'apm.yml');
  writeFileSync(file, manifest);
  const pin = run(['pin', '--file', file, repo]);
  assert.equal(pin.status, 0);
  assert.equal(pin.stdout, 'venturars/delivery-workflow#v1.1.2\n');

  const workflow = readFileSync(new URL('../.github/workflows/update-apm-dependency.yml', import.meta.url), 'utf8');
  assert.match(workflow, /self-release\.py pin "\$DEPENDENCY_REPO"/);
  assert.match(workflow, /self-release\.py align "\$DEPENDENCY_REPO"/);
  assert.match(workflow, /Este paquete no se autodepende/);
  assert.doesNotMatch(workflow, /self-release\.py set /);
  assert.doesNotMatch(workflow, /self-release\.py latest/);
  assert.doesNotMatch(workflow, /self-release\.py select "\$DEPENDENCY_REPO"/);
  assert.doesNotMatch(workflow, /apm update /);
});

test('el release quita la autodependencia y etiqueta ese commit, no main', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/release-create-version.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /self-release\.py align --check "\$REPO"/);
  assert.match(workflow, /self-release\.py align "\$REPO"/);
  assert.match(workflow, /git tag "\$NEXT" "\$TARGET"/);
  assert.match(workflow, /git push origin "refs\/tags\/\$NEXT"/);
  assert.match(workflow, /steps\.align\.outputs\.sha/);
  assert.doesNotMatch(workflow, /git push origin "HEAD:/);
  assert.doesNotMatch(workflow, /--target "\$GITHUB_SHA"/);
});
