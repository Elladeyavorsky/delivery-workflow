export function requiredCheckName(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(value)) {
    throw new Error('The required check name is invalid.');
  }
  return value;
}

// El check tiene que haber pasado en el SHA actual. Uno antiguo en verde no cuenta.
export async function requiredCheckPassed(repository, sha, name, token) {
  if (!name) return true;
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) return false;
  const url = `https://api.github.com/repos/${repository}/commits/${sha}/check-runs?check_name=${encodeURIComponent(name)}`;
  const response = await fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub could not read the ${name} check (HTTP ${response.status}).`);
  }
  const body = await response.json();
  if (!Array.isArray(body.check_runs)) {
    throw new Error(`GitHub could not read the ${name} check.`);
  }
  return body.check_runs.some((run) =>
    run.name === name && run.conclusion === 'success' && run.head_sha === sha);
}
