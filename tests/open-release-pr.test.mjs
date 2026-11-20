import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/open-release-pr.yml', import.meta.url), 'utf8');

test('gh recibe el repositorio sin clonar el árbol', () => {
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /GH_REPO: \$\{\{ github\.repository \}\}/);
  assert.match(workflow, /gh pr list --base main --head staging --state open/);
  assert.match(workflow, /gh pr create \\\n\s+--base main \\\n\s+--head staging/);
  assert.doesNotMatch(workflow, /actions\/checkout/);
});
