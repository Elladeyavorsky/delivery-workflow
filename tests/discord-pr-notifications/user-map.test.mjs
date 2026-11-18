import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUserMap } from '../../.github/actions/discord-pr-notifications/user-map.mjs';

const discordId = '123456789012345678';

test('acepta un mapa opcional y normaliza los logins de GitHub', () => {
  assert.equal(parseUserMap(undefined).size, 0);
  assert.equal(parseUserMap('  ').size, 0);
  assert.equal(parseUserMap(`{"Elladeyavorsky":"${discordId}"}`).get('elladeyavorsky'), discordId);
});

test('rechaza JSON roto, formato incorrecto, IDs inválidos y logins repetidos', () => {
  for (const value of [
    '{', '[]', 'null', '"text"', '5',
    '{"Ella":"123"}', '{"Ella":123456789012345678}',
    `{"invalid_login":"${discordId}"}`,
    `{"Ella":"${discordId}","ella":"223456789012345678"}`,
  ]) {
    assert.throws(() => parseUserMap(value), /user-map/);
  }
});
