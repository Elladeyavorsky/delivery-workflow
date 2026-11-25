// Las dos copias de la acción y los nombres de rama base de RF-23, comunes a los tres ficheros que la validan.
export const ACTION_COPIES = [
  new URL('../../.github/actions/discord-pr-notifications/', import.meta.url),
  new URL('../../.apm/skills/setup-discord-notifications/assets/discord-pr-notifications/', import.meta.url),
];

export const VALID_BASE_BRANCHES = [
  'release/1.0', 'staging', 'main', 'a', '_next', 'v1.2.3', 'feature/avisos_v2-final',
  'a/b/c', 'hotfix-', 'release.locked', 'x.lock/y',
  // Nombres que YAML leería como otro tipo sin comillas (CB-19).
  '3.10', 'true', 'null',
];

export const INVALID_BASE_BRANCHES = [
  // Falta o está vacía.
  undefined, '',
  // Caracteres fuera de letras ASCII, dígitos, «_», «.», «-» y «/».
  ' ', 'a b', ' main', 'main ', 'main\n', '\nmain', 'a\nb', 'a\tb', 'a\r\nb', 'versión', 'a:b', 'a;b',
  'a\\b', 'a@b', 'a*', 'a~1', 'a^', 'a?', '$(id)', '{{BASE_BRANCH}}',
  // Principio no permitido.
  '/main', '.main', '-main',
  // «..» o «//».
  '..', '../x', 'a..b', 'a//b', 'release//1.0',
  // Final no permitido.
  'main/', 'release/', 'main.', 'main.lock', 'release/1.lock',
];
