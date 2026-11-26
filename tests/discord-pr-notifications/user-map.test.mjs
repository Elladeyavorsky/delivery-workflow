import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUserMap } from '../../.github/actions/discord-pr-notifications/user-map.mjs';

const discordId = '123456789012345678';
const otherDiscordId = '223456789012345678';

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

test('un login repetido con distinta capitalización hace fallar el mapa', () => {
  for (const [first, second] of [['Ella', 'ella'], ['ella', 'ELLA']]) {
    for (const secondId of [discordId, otherDiscordId]) {
      assert.throws(() => parseUserMap(`{"${first}":"${discordId}","${second}":"${secondId}"}`),
        /user-map contains the same GitHub login more than once/);
    }
  }
});

test('con dos claves idénticas en el JSON no hay error y gana la última', () => {
  for (const [first, last] of [[discordId, otherDiscordId], [otherDiscordId, discordId]]) {
    const userMap = parseUserMap(`{"ella":"${first}","ella":"${last}"}`);
    assert.deepEqual([...userMap], [['ella', last]]);
  }
});
