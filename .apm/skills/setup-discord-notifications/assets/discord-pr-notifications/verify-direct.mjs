import { appendFileSync, readFileSync } from 'node:fs';
import { hasDistinctReviewers, minimumReviewers } from './reviewers.mjs';
import { requiredCheckName, requiredCheckPassed } from './required-check.mjs';

function readPrNumber(value) {
  if (!/^[1-9][0-9]{0,9}$/.test(value ?? '')) {
    throw new Error('The event does not contain a valid PR number.');
  }
  return Number(value);
}

function verifyTrigger(event, name, repository, baseBranch, trustedBranch, number) {
  if (event.repository?.full_name !== repository ||
      event.repository?.default_branch !== trustedBranch ||
      process.env.GITHUB_REF !== `refs/heads/${trustedBranch}`) {
    throw new Error('The event does not belong to the trusted repository branch.');
  }

  if (name === 'pull_request_target') {
    const allowedActions = ['opened', 'review_requested', 'ready_for_review'];
    const pr = event.pull_request;
    if (!allowedActions.includes(event.action) || pr?.number !== number ||
        pr.base?.repo?.full_name !== repository || pr.base?.ref !== baseBranch) {
      throw new Error('The PR event does not target the expected repository and base.');
    }
    return;
  }

  if (name === 'issue_comment' &&
      ['created', 'edited'].includes(event.action) &&
      event.issue?.pull_request && event.issue.number === number &&
      event.comment?.body?.startsWith('/discord-map ')) return;

  throw new Error('The event is not a supported PR notification trigger.');
}

async function readPullRequest(repository, number, token) {
  const response = await fetch(`https://api.github.com/repos/${repository}/pulls/${number}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub could not read PR #${number} (HTTP ${response.status}).`);
  return response.json();
}

function isEligible(pr, repository, baseBranch, number, minimum) {
  if (pr.number !== number || pr.base?.repo?.full_name !== repository) {
    throw new Error(`PR #${number} does not target the expected repository and base.`);
  }
  if (pr.base?.ref !== baseBranch) return false;
  // Un evento tardío puede encontrar la PR cerrada o en borrador: se omite sin publicar.
  if (pr.state === 'closed' || pr.draft === true) return false;
  if (pr.state !== 'open' || pr.draft !== false) {
    throw new Error(`PR #${number} has an invalid state.`);
  }
  const reviewers = pr.requested_reviewers;
  if (!Array.isArray(reviewers)) {
    throw new Error(`PR #${number} does not have distinct requested reviewers.`);
  }
  if (reviewers.length < minimum) return false;
  if (!hasDistinctReviewers(reviewers, minimum)) {
    throw new Error(`PR #${number} does not have distinct requested reviewers.`);
  }
  return true;
}

async function main() {
  const repository = process.env.EXPECTED_REPOSITORY;
  const baseBranch = process.env.PR_BASE_BRANCH;
  const trustedBranch = process.env.TRUSTED_BRANCH;
  const token = process.env.GITHUB_TOKEN;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') ||
      // La misma regla que validateBranch de la skill: admite «/» y la base solo se compara como texto.
      !/^(?!.*(?:\.\.|\/\/|\.lock$))[A-Za-z0-9_](?:[A-Za-z0-9_.\/-]*[A-Za-z0-9_-])?$/.test(baseBranch ?? '') ||
      !/^[A-Za-z0-9_.-]+$/.test(trustedBranch ?? '') ||
      process.env.GITHUB_REPOSITORY !== repository || !token ||
      !process.env.GITHUB_EVENT_PATH || !process.env.GITHUB_OUTPUT) {
    throw new Error('Direct notification configuration is incomplete.');
  }

  const minimum = minimumReviewers(process.env.MINIMUM_REVIEWERS);
  const checkName = requiredCheckName(process.env.REQUIRED_CHECK);
  const number = readPrNumber(process.env.PR_NUMBER);
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  verifyTrigger(event, process.env.GITHUB_EVENT_NAME, repository, baseBranch, trustedBranch, number);
  const pr = await readPullRequest(repository, number, token);
  let eligible = isEligible(pr, repository, baseBranch, number, minimum);
  if (eligible && !await requiredCheckPassed(repository, pr.head?.sha, checkName, token)) {
    eligible = false;
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `eligible=${eligible}\n` +
    (eligible ? `pr_number=${number}\n` : ''), 'utf8');
  console.log(eligible ? `PR #${number} verified for notification.` : `PR #${number} is not ready for notification; skipped.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
