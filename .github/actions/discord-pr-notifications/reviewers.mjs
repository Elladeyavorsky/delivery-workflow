// El verificador y el emisor aplican la misma regla a todos los revisores solicitados.
export function minimumReviewers(value) {
  if (value === undefined || value === null || value === '') return 2;
  const text = String(value);
  if (!/^[1-9][0-9]*$/.test(text)) {
    throw new Error('The minimum reviewer count is invalid.');
  }
  const minimum = Number(text);
  if (!Number.isSafeInteger(minimum) || minimum < 1) {
    throw new Error('The minimum reviewer count is invalid.');
  }
  return minimum;
}

export function hasDistinctReviewers(reviewers, minimum = 2) {
  if (!Number.isSafeInteger(minimum) || minimum < 1) return false;
  if (!Array.isArray(reviewers) || reviewers.length < minimum) return false;
  const ids = new Set();
  const logins = new Set();
  for (const reviewer of reviewers) {
    if (!reviewer?.login || !Number.isSafeInteger(reviewer.id) || reviewer.id < 1 ||
        ids.has(reviewer.id) || logins.has(reviewer.login)) return false;
    ids.add(reviewer.id);
    logins.add(reviewer.login);
  }
  return true;
}
