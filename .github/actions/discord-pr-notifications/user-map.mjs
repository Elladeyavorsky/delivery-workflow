const GITHUB_LOGIN = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
const DISCORD_ID = /^\d{17,20}$/;

// El mapa fijo se valida completo antes de consultar la PR o publicar en Discord.
export function parseUserMap(value) {
  if (value === undefined || value === null || value === '') return new Map();
  if (typeof value !== 'string') {
    throw new Error('user-map must be a JSON object of GitHub logins and Discord IDs.');
  }
  if (value.trim() === '') return new Map();

  let entries;
  try {
    const parsed = JSON.parse(value);
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('not an object');
    }
    entries = Object.entries(parsed);
  } catch {
    throw new Error('user-map must be a JSON object of GitHub logins and Discord IDs.');
  }

  const userMap = new Map();
  for (const [login, discordId] of entries) {
    if (!GITHUB_LOGIN.test(login)) {
      throw new Error(`user-map has an invalid GitHub login: ${login}.`);
    }
    if (typeof discordId !== 'string' || !DISCORD_ID.test(discordId)) {
      throw new Error(`user-map has an invalid Discord ID for ${login}.`);
    }
    const key = login.toLowerCase();
    if (userMap.has(key)) {
      throw new Error(`user-map contains the same GitHub login more than once: ${login}.`);
    }
    userMap.set(key, discordId);
  }
  return userMap;
}
