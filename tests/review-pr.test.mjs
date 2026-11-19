import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const template = read('.apm/skills/review-pr/assets/review.yml');
const skill = read('.apm/skills/review-pr/SKILL.md');
const readme = read('README.md');

// Sección del README desde su encabezado hasta el siguiente `## `.
function section(markdown, heading) {
  const start = markdown.indexOf(`\n## ${heading}\n`);
  assert.notEqual(start, -1, `falta la sección «${heading}»`);
  const rest = markdown.slice(start + 1);
  const next = rest.indexOf('\n## ', 1);
  return next === -1 ? rest : rest.slice(0, next);
}

test('la plantilla no corre en drafts', () => {
  assert.match(template, /^    if: .*github\.event\.pull_request\.draft == false/m);
});

test('la plantilla se salta las PR de un fork', () => {
  assert.match(template, /^    if: .*github\.event\.pull_request\.head\.repo\.full_name == github\.repository/m);
});

test('la plantilla cumple los límites', () => {
  // Disparador: pull_request con ready_for_review y opened.
  assert.match(template, /^on:\n  pull_request:\n    types: \[([^\]]+)\]/m);
  const types = template.match(/^    types: \[([^\]]+)\]/m)[1].split(',').map((t) => t.trim()).sort();
  assert.deepEqual(types, ['opened', 'ready_for_review']);
  assert.doesNotMatch(template, /pull_request_target/);

  // Secreto de Anthropic.
  assert.match(template, /anthropic_api_key: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/);

  // Permisos sin escritura de contenido.
  const permissions = template.match(/^permissions:\n((?: {2}.+\n)+)/m);
  assert.ok(permissions, 'falta el bloque permissions');
  assert.match(permissions[1], /^  contents: read$/m);
  assert.doesNotMatch(template, /contents: write/);

  // Cada uses: lleva versión fija.
  const uses = [...template.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
  assert.ok(uses.length > 0);
  for (const ref of uses) {
    assert.match(ref, /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@(?:v\d+(?:\.\d+){0,2}|[0-9a-f]{40})$/, `versión no fija: ${ref}`);
  }
});

test('la skill fija el formato del comentario', () => {
  assert.match(skill, /^---\nname: review-pr\n/);
  assert.match(skill, /^\s*## Revisión automática$/m);
  assert.match(skill, /primera línea es siempre `## Revisión automática`/);
  assert.match(skill, /✅ Sin puntos que bloqueen/);
  assert.match(skill, /❌ N puntos que bloquean/);
  assert.match(skill, /[Cc]omo máximo 3 sugerencias/);
  assert.match(skill, /La PR no enlaza ninguna issue/);
  assert.match(skill, /Closes #N/);
  assert.match(skill, /gh pr comment N[^\n]*--body-file/);
  assert.match(skill, /comentario nuevo/);
  assert.match(skill, /no uses `--edit-last`/);
  assert.match(skill, /no edites ni borres comentarios anteriores/);
});

test('el README documenta los tres pasos y el límite de forks', () => {
  const body = section(readme, 'Revisión automática de PR');
  const steps = body.match(/^\d+\. .+$/gm) ?? [];
  assert.equal(steps.length, 3);
  assert.match(steps[0], /review\.yml/);
  assert.match(steps[1], /ANTHROPIC_API_KEY/);
  assert.match(steps[2], /Claude GitHub App/);
  assert.match(body, /PR que llegan desde un fork no se revisan/);
});

test('el repositorio no instala review.yml', () => {
  assert.equal(existsSync(new URL('../.github/workflows/review.yml', import.meta.url)), false);
});
