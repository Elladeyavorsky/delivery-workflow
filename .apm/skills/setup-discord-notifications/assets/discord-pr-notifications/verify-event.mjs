import { appendFileSync, readFileSync, statSync } from 'node:fs';
import { hasDistinctReviewers, minimumReviewers } from './reviewers.mjs';
import { requiredCheckName, requiredCheckPassed } from './required-check.mjs';

// Los workflows de PR que pueden disparar el aviso: la plantilla, este paquete y el nombre «review».
const PR_TRIGGER_NAMES = ['Discord: capture PR', 'PR: check rules', 'review'];

function readPrNumber(filePath) {
  if (statSync(filePath).size > 10) {
    throw new Error('The event artifact is too large for a PR number.');
  }
  const value = readFileSync(filePath, 'utf8');
  if (!/^[1-9][0-9]{0,9}$/.test(value)) {
    throw new Error('The event artifact does not contain a valid PR number.');
  }
  return Number(value);
}

async function readPullRequest(repository, number, token) {
  const response = await fetch(`https://api.github.com/repos/${repository}/pulls/${number}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub could not read PR #${number} (HTTP ${response.status}).`);
  }
  return response.json();
}

function belongsToTriggerRun(run, pullRequest) {
  const associatedPullRequests = run.pull_requests ?? [];
  if (associatedPullRequests.length > 0) {
    return associatedPullRequests.some((item) => item.number === pullRequest.number);
  }

  // Algunos runs no incluyen pull_requests; se coteja entonces la rama y el commit.
  const sameHeadRepository = run.head_repository?.full_name === pullRequest.head?.repo?.full_name;
  const sameHeadBranch = run.head_branch === pullRequest.head?.ref;
  const sameCommit = run.head_sha === pullRequest.head?.sha ||
    run.head_sha === pullRequest.merge_commit_sha;
  return sameHeadRepository && sameHeadBranch && sameCommit;
}

function validatePullRequest(event, repository, baseBranch, runId, number, pullRequest, minimum) {
  const run = event.workflow_run;
  const pullRequestTrigger = run?.event === 'pull_request' && PR_TRIGGER_NAMES.includes(run.name);
  // El comentario corre en la rama predeterminada. Sin ese nombre en el evento no hay coincidencia posible.
  const defaultBranch = event.repository?.default_branch;
  const confirmationTrigger = run?.event === 'issue_comment' && run.name === 'Discord: capture confirmation' &&
    run.head_repository?.full_name === repository &&
    typeof defaultBranch === 'string' && defaultBranch !== '' && run.head_branch === defaultBranch;
  if (event.repository?.full_name !== repository ||
      run?.repository?.full_name !== repository ||
      String(run.id) !== runId ||
      !(pullRequestTrigger || confirmationTrigger) ||
      run.conclusion !== 'success') {
    throw new Error('The completed run does not belong to this repository and trigger.');
  }
  if (pullRequest.number !== number || pullRequest.base?.repo?.full_name !== repository) {
    throw new Error(`PR #${number} is not an open, ready PR targeting the expected base.`);
  }
  // Una release hacia main no se anuncia. No es un fallo del emisor.
  if (pullRequest.base?.ref !== baseBranch) return false;
  // El disparador puede terminar después del merge; una PR ya cerrada se omite sin usar secretos.
  if (pullRequest.state === 'closed') return false;
  if (pullRequest.state !== 'open') {
    throw new Error(`PR #${number} has an invalid state.`);
  }
  // Una PR en borrador aún no pide revisión: se omite en ambos disparadores.
  if (pullRequest.draft === true) return false;
  if (pullRequest.draft !== false) {
    throw new Error(`PR #${number} has an invalid draft state.`);
  }
  if (pullRequestTrigger && !belongsToTriggerRun(run, pullRequest)) {
    throw new Error(`PR #${number} does not match the completed trigger run.`);
  }

  const reviewers = pullRequest.requested_reviewers;
  if (!Array.isArray(reviewers)) {
    throw new Error(`PR #${number} does not have distinct requested reviewers.`);
  }
  // Por debajo del mínimo se omite. Un duplicado sí es un estado inválido.
  if (reviewers.length < minimum) return false;
  if (!hasDistinctReviewers(reviewers, minimum)) {
    throw new Error(`PR #${number} does not have distinct requested reviewers.`);
  }
  return true;
}

async function main() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const repository = process.env.EXPECTED_REPOSITORY;
  const baseBranch = process.env.PR_BASE_BRANCH;
  const runId = process.env.TRIGGER_RUN_ID;
  const token = process.env.GITHUB_TOKEN;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') ||
      process.env.GITHUB_REPOSITORY !== repository ||
      // La misma regla que validateBranch de la skill: admite «/» y la base solo se compara como texto.
      !/^(?!.*(?:\.\.|\/\/|\.lock$))[A-Za-z0-9_](?:[A-Za-z0-9_.\/-]*[A-Za-z0-9_-])?$/.test(baseBranch ?? '') ||
      !/^[1-9][0-9]*$/.test(runId ?? '') || !token ||
      !process.env.GITHUB_EVENT_PATH || !process.env.PR_NUMBER_FILE || !process.env.GITHUB_OUTPUT) {
    throw new Error('Notification verification configuration is incomplete.');
  }

  const minimum = minimumReviewers(process.env.MINIMUM_REVIEWERS);
  const checkName = requiredCheckName(process.env.REQUIRED_CHECK);
  const number = readPrNumber(process.env.PR_NUMBER_FILE);
  const pullRequest = await readPullRequest(repository, number, token);
  let eligible = validatePullRequest(event, repository, baseBranch, runId, number, pullRequest, minimum);
  if (eligible && !await requiredCheckPassed(repository, pullRequest.head?.sha, checkName, token)) {
    eligible = false;
  }

  // Las rondas siguientes usan este número solo después de la consulta y validación.
  appendFileSync(process.env.GITHUB_OUTPUT, `eligible=${eligible}\n` +
    (eligible ? `pr_number=${number}\n` : ''), 'utf8');
  console.log(eligible ? `PR #${number} verified for notification.` : `PR #${number} is not ready for notification; skipped.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
