import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = 'feat|fix|docs|refactor|test|chore|knowledge';
const BRANCH_NAME = new RegExp(
  `^[1-9][0-9]*-(${TYPES})-[a-z0-9]+(?:-[a-z0-9]+)*$`,
);
const COMMIT_SUBJECT = new RegExp(
  `^(${TYPES})(?:\\([A-Za-z0-9._/-]+\\))?(!)?: \\S(?:.*\\S)?$`,
);
const TITLE_SCRIPT = fileURLToPath(new URL(
  '../../.apm/skills/manage-pr-base/scripts/check-title.sh',
  import.meta.url,
));
const SELF_RELEASE = fileURLToPath(new URL('./self-release.py', import.meta.url));
const SELF_PIN_ERROR = 'apm.yml no lista este paquete en dependencies.apm.';

export function reviewPullRequest(facts) {
  const errors = [];
  const release = facts.base === 'main' && facts.head === 'staging';
  if (facts.base !== 'staging' && !release) {
    errors.push('La base tiene que ser staging.');
  }

  if (facts.base === 'staging') {
    if (!BRANCH_NAME.test(facts.head ?? '')) {
      errors.push('La rama tiene que ser número-tipo-descripcion.');
    }
    const titleError = checkTitle(facts.title ?? '');
    if (titleError) errors.push(titleError);
    if (!/^Closes #[1-9][0-9]*$/m.test(facts.body ?? '')) {
      errors.push('El cuerpo tiene que incluir una línea Closes #N.');
    }
    if (!facts.fork && !String(facts.assignee ?? '').trim()) {
      errors.push('La pull request tiene que tener una persona asignada.');
    }
    if ((facts.versionBefore ?? null) !== (facts.versionAfter ?? null)) {
      errors.push('version en apm.yml no cambia en una pull request hacia staging.');
    }
    if (String(facts.selfPin ?? '').trim()) {
      errors.push(SELF_PIN_ERROR);
    }
  }

  const commits = facts.commits ?? [];
  if (commits.length === 0) {
    errors.push('La pull request no tiene commits.');
  }
  for (const commit of commits) {
    const commitError = checkCommit(commit);
    if (commitError) errors.push(commitError);
  }

  for (const filePath of facts.paths ?? []) {
    if (filePath === '.env' || filePath.endsWith('/.env')) {
      errors.push(`El diff no puede añadir ni modificar ${filePath}.`);
    }
  }

  if (facts.mergeable === false) {
    errors.push('La pull request tiene conflictos con la rama base.');
  } else if (facts.mergeable !== true) {
    errors.push('GitHub aún no ha calculado los conflictos.');
  }

  return errors;
}

export async function readMergeable(fetchPull, attempts = 12, wait = delay) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await fetchPull();
    if (value === true || value === false) return value;
    if (attempt < attempts - 1) await wait();
  }
  return null;
}

function checkTitle(title) {
  const result = spawnSync('bash', [TITLE_SCRIPT, title], { encoding: 'utf8' });
  if (result.status === 0) return null;
  return (result.stderr || result.stdout || 'El título no vale.').trim();
}

function checkCommit(commit) {
  const subject = commit.subject ?? '';
  const description = subject.includes(': ') ? subject.slice(subject.indexOf(': ') + 2) : '';
  const breaking = /!:/.test(subject);
  if (subject !== subject.trim() || description.endsWith('.') || /[^\x20-\x7e]/.test(subject) || !COMMIT_SUBJECT.test(subject) || !/^[a-z]/.test(description)) {
    return `El commit no es un Conventional Commit: ${subject}`;
  }
  if (breaking && !String(commit.body ?? '').includes('BREAKING CHANGE:')) {
    return `El commit ${subject} necesita BREAKING CHANGE: en el cuerpo.`;
  }
  return null;
}

function delay() {
  return new Promise((resolve) => {
    setTimeout(resolve, 5000);
  });
}

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error((result.stderr || `git ${args.join(' ')}`).trim());
  }
  return result.stdout;
}

function versionAt(sha) {
  const result = spawnSync('git', ['show', `${sha}:apm.yml`], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const match = result.stdout.match(/^version:\s*["']?([0-9]+\.[0-9]+\.[0-9]+)["']?\s*$/m);
  return match ? match[1] : null;
}

function selfPinAt(sha, repo) {
  if (!repo) return '';
  const shown = spawnSync('git', ['show', `${sha}:apm.yml`], { encoding: 'utf8' });
  if (shown.status !== 0) return '';
  const dir = mkdtempSync(path.join(tmpdir(), 'review-pr-'));
  const file = path.join(dir, 'apm.yml');
  try {
    writeFileSync(file, shown.stdout);
    const pin = spawnSync('python3', [SELF_RELEASE, 'pin', repo, '--file', file], {
      encoding: 'utf8',
    });
    if (pin.status !== 0) {
      throw new Error((pin.stderr || pin.error?.message || 'self-release.py pin').trim());
    }
    return pin.stdout.trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function commitsBetween(baseSha, headSha) {
  const raw = git(['log', '--reverse', '--format=%s%x1e%b%x1d', `${baseSha}..${headSha}`]);
  return raw.split('\x1d').filter((record) => record.trim()).map((record) => {
    const [subject, body = ''] = record.split('\x1e');
    return { subject: subject.trim(), body: body.trim() };
  });
}

async function factsFromGit() {
  const baseSha = process.env.BASE_SHA;
  const headSha = process.env.HEAD_SHA;
  for (const sha of [baseSha, headSha]) {
    if (spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`]).status !== 0) {
      git(['fetch', '--no-tags', 'origin', sha]);
    }
  }
  const paths = git(['diff', '--name-only', '--diff-filter=ACMR', baseSha, headSha])
    .split('\n')
    .filter(Boolean);
  const mergeable = await readMergeable(async () => {
    const response = await fetch(
      `https://api.github.com/repos/${process.env.REPO}/pulls/${process.env.PR_NUMBER}`,
      {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${process.env.GH_TOKEN}`,
          'x-github-api-version': '2022-11-28',
        },
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub no pudo leer la pull request (HTTP ${response.status}).`);
    }
    const pullRequest = await response.json();
    return pullRequest.mergeable;
  });
  return {
    base: process.env.BASE_REF,
    head: process.env.HEAD_REF,
    title: process.env.PR_TITLE ?? '',
    body: process.env.PR_BODY ?? '',
    assignee: process.env.PR_ASSIGNEE ?? '',
    fork: process.env.PR_FROM_FORK === 'true',
    mergeable,
    paths,
    versionBefore: versionAt(baseSha),
    versionAfter: versionAt(headSha),
    selfPin: selfPinAt(headSha, process.env.REPO),
    commits: commitsBetween(baseSha, headSha),
  };
}

function runningAsScript() {
  return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (runningAsScript()) {
  const facts = process.argv[2]
    ? JSON.parse(readFileSync(process.argv[2], 'utf8'))
    : await factsFromGit();
  const errors = reviewPullRequest(facts);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
}
