import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const action = readFileSync(new URL('../../.github/actions/discord-pr-notifications/action.yml', import.meta.url), 'utf8');
const reviewWorkflow = readFileSync(new URL('../../.github/workflows/pr-check-rules.yml', import.meta.url), 'utf8');
const confirmationTrigger = readFileSync(new URL('../../.github/workflows/discord-pr-confirmation-trigger.yml', import.meta.url), 'utf8');
const packagePublisher = readFileSync(new URL('../../.github/workflows/discord-pr-publish.yml', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../../docs/DISCORD-PR-NOTIFICATIONS.md', import.meta.url), 'utf8');
const managePrAgent = readFileSync(new URL('../../.apm/agents/manage-pr.agent.md', import.meta.url), 'utf8');

test('los agentes no incluyen el aviso optativo de Discord en la revisión', () => {
  assert.doesNotMatch(managePrAgent, /discord-reviewers|discord-map|Discord:/);
});

test('la acción declara todos los inputs y solo ejecuta módulos del paquete', () => {
  assert.match(action, /using: composite/);
  for (const input of ['github-token', 'bot-token', 'cache-key', 'guild-id', 'channel-id',
    'user-map', 'expected-repository', 'base-branch', 'minimum-reviewers', 'required-check',
    'trigger-run-id', 'pr-number', 'trusted-branch']) {
    assert.match(action, new RegExp(`^  ${input}:`, 'm'));
  }
  assert.match(action, /run-id: \$\{\{ inputs\.trigger-run-id \}\}/);
  assert.match(action, /node "\$GITHUB_ACTION_PATH\/verify-event\.mjs"/);
  assert.match(action, /node "\$GITHUB_ACTION_PATH\/verify-direct\.mjs"/);
  assert.match(action, /if: \$\{\{ inputs\.trigger-run-id != '' \}\}/);
  assert.match(action, /steps\.download\.outcome == 'success'/);
  assert.match(action, /continue-on-error: true/);
  assert.match(action, /MINIMUM_REVIEWERS: \$\{\{ inputs\.minimum-reviewers \}\}/);
  assert.match(action, /REQUIRED_CHECK: \$\{\{ inputs\.required-check \}\}/);
  assert.match(action, /if: \$\{\{ inputs\.trigger-run-id == '' \}\}/);
  assert.match(action, /PR_NUMBER: \$\{\{ steps\.verify\.outputs\.pr_number \|\| steps\.verify-direct\.outputs\.pr_number \}\}/);
  assert.match(action, /node "\$GITHUB_ACTION_PATH\/state\.mjs" prepare/);
  assert.match(action, /node "\$GITHUB_ACTION_PATH\/notify\.mjs"/);
  assert.match(action, /DISCORD_USER_MAP: \$\{\{ inputs\.user-map \}\}/);
  assert.match(action, /steps\.verify\.outputs\.eligible == 'true'/);
  assert.match(action, /steps\.verify-direct\.outputs\.eligible == 'true'/);
  assert.match(action, /if: always\(\) && steps\.prepare\.outcome == 'success'/);
  assert.match(action, /retention-days: 2/);
  assert.doesNotMatch(action, /actions\/checkout|pull_request_target/);
  // Los IDs reales y los secretos no deben estar en el paquete.
  assert.doesNotMatch(action + reviewWorkflow + confirmationTrigger + packagePublisher + docs, /\b[0-9]{17,20}\b/);
});

test('el disparador de confirmación solo transporta el número de una PR comentada', () => {
  assert.match(confirmationTrigger, /issue_comment:\s*\n\s*types: \[created, edited\]/);
  assert.match(confirmationTrigger, /github\.event\.issue\.pull_request/);
  assert.match(confirmationTrigger, /\/discord-map /);
  assert.match(confirmationTrigger, /permissions: \{\}/);
  assert.match(confirmationTrigger, /PR_NUMBER: \$\{\{ github\.event\.issue\.number \}\}/);
  assert.doesNotMatch(confirmationTrigger, /actions\/checkout|secrets\.|pull_request_target/);
});

test('PR: check rules entrega el número de PR a Discord solo cuando la base es staging', () => {
  assert.match(reviewWorkflow, /name: discord-pr-number/);
  assert.match(reviewWorkflow, /if: github\.base_ref == 'staging'/);
  assert.match(reviewWorkflow, /PR_NUMBER: \$\{\{ github\.event\.pull_request\.number \}\}/);
  assert.match(reviewWorkflow, /retention-days: 1/);
  assert.doesNotMatch(reviewWorkflow, /secrets\.|pull_request_target/);
});

test('delivery-workflow publica desde su staging con la acción local confiable', () => {
  assert.match(packagePublisher, /workflow_run:\s*\n\s*workflows: \["PR: check rules", "Discord: capture confirmation"\]/);
  assert.match(packagePublisher, /minimum-reviewers: 1/);
  assert.match(packagePublisher, /required-check: check-rules/);
  assert.match(packagePublisher, /steps\.gate\.outputs\.proceed == 'true'/);
  assert.match(packagePublisher, /github\.ref == 'refs\/heads\/staging'/);
  assert.match(packagePublisher, /workflow_run\.conclusion == 'success'/);
  assert.match(packagePublisher, /workflow_run\.event == 'pull_request'/);
  assert.match(packagePublisher, /workflow_run\.event == 'issue_comment'/);
  assert.match(packagePublisher, /workflow_run\.repository\.full_name == github\.repository/);
  assert.match(packagePublisher, /environment: discord-pr-notifications/);
  assert.match(packagePublisher, /group: discord-pr-relations/);
  assert.match(packagePublisher, /queue: max/);
  assert.match(packagePublisher, /cancel-in-progress: false/);
  for (const permission of ['actions: read', 'contents: read', 'issues: read', 'pull-requests: write']) {
    assert.ok(packagePublisher.includes(permission));
  }
  assert.doesNotMatch(packagePublisher, /^\s+issues: write$/m);
  assert.doesNotMatch(packagePublisher, /^\s+pull-requests: read$/m);
  assert.match(packagePublisher, /uses: actions\/checkout@[a-f0-9]{40}/);
  assert.match(packagePublisher, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(packagePublisher, /persist-credentials: false/);
  assert.match(packagePublisher, /uses: \.\/\.github\/actions\/discord-pr-notifications/);
  assert.match(packagePublisher, /expected-repository: venturars\/delivery-workflow/);
  assert.match(packagePublisher, /base-branch: staging/);
  assert.match(packagePublisher, /trigger-run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/);
  assert.match(packagePublisher, /user-map: \$\{\{ vars\.DISCORD_USER_MAP \}\}/);
  assert.doesNotMatch(packagePublisher, /head_sha|pull_request_target/);
});

test('el emisor recibe secretos y token de GitHub del entorno protegido', () => {
  for (const workflow of [packagePublisher]) {
    assert.match(workflow, /github-token: \$\{\{ github\.token \}\}/);
    assert.match(workflow, /bot-token: \$\{\{ secrets\.DISCORD_BOT_TOKEN \}\}/);
    assert.match(workflow, /cache-key: \$\{\{ secrets\.DISCORD_CACHE_KEY \}\}/);
    assert.match(workflow, /guild-id: \$\{\{ vars\.DISCORD_GUILD_ID \}\}/);
    assert.match(workflow, /channel-id: \$\{\{ vars\.DISCORD_GIT_CHANNEL_ID \}\}/);
  }
  assert.match(packagePublisher, /expected-repository: venturars\/delivery-workflow/);
});
