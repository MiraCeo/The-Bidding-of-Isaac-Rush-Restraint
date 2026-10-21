import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalAuthorityJson } from './authority-json';
import { canonicalJson } from '../../shared/json-facts';
import { sha256Hex } from '../../shared/sha256';
import { createGameSession, reduceGameSession } from '../game-session';
/** Independent pre-optimization implementation, retained as an exact oracle. */
function previous(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(previous);
  if (!value || typeof value !== 'object') return value;
  const o = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(o).map(([key, v]) => [
      key,
      o.itemId === 'moms_knife' &&
      o.kind === 'additive_score' &&
      key === 'amount' &&
      typeof v === 'number'
        ? Number(v.toFixed(8))
        : previous(v),
    ]),
  );
}
it('preserves exact prior authority JSON and SHA256 for nested, escaped and bounded-key-cache inputs', () => {
  const fixtures: unknown[] = [
    null,
    true,
    false,
    0,
    -0,
    1e-9,
    1e25,
    '以撒🎲\u0000"\\\ud800',
    [],
    {},
    Object.assign(Array<number>(3), { 0: 1, 2: 3 }),
    { z: undefined, a: [undefined, null] },
    { itemId: 'moms_knife', kind: 'additive_score', amount: 1.1234567890123 },
    { itemId: 'moms_knife', kind: 'other', amount: 1.1234567890123 },
    { itemId: 'score_charm', kind: 'additive_score', amount: 1.1234567890123 },
    Object.fromEntries(
      Array.from({ length: 400 }, (_, i) => [
        'key"' + i,
        { nested: i, score: i / 7 },
      ]),
    ),
  ];
  for (let n = 0; n < 100; n++)
    fixtures.push({
      floor: n % 7,
      room: n % 5,
      build: 'test',
      players: Array.from({ length: 20 }, (_, i) => ({
        id: 'p' + i,
        money: (n + 1) * i,
        score: i / (n + 1),
        items: [
          {
            itemId: 'moms_knife',
            kind: 'additive_score',
            amount: n / ((i + 1) * 3),
          },
        ],
      })),
    });
  for (const value of fixtures) {
    const before = canonicalJson(previous(value)),
      after = canonicalAuthorityJson(value);
    expect(after).toBe(before);
    expect(sha256Hex(after)).toBe(
      createHash('sha256').update(before).digest('hex'),
    );
  }
});
it('retains nonfinite rejection, exact unrelated numbers, no input mutation and no stale object reuse', () => {
  for (const value of [
    NaN,
    Infinity,
    -Infinity,
    { a: [NaN] },
    { itemId: 'moms_knife', kind: 'additive_score', amount: Infinity },
  ]) {
    expect(() => canonicalJson(previous(value))).toThrow();
    expect(() => canonicalAuthorityJson(value)).toThrow();
  }
  const value = {
    itemId: 'moms_knife',
    kind: 'additive_score',
    amount: 1.123456789,
    score: 1.123456789,
  };
  const before = JSON.stringify(value),
    first = canonicalAuthorityJson(value);
  expect(JSON.stringify(value)).toBe(before);
  expect(first).toContain('"score":1.123456789');
  value.score = 2;
  expect(canonicalAuthorityJson(value)).not.toBe(first);
});
it('keeps authority bytes and hashes identical on actual settled room prefixes', () => {
  let s = reduceGameSession(createGameSession(42), {
    type: 'start_game',
    characterId: 'lost',
  });
  const rooms: unknown[] = [];
  for (let i = 0; i < 3; i++) {
    s = reduceGameSession(s, {
      type: 'submit_player_turn',
      turn: {
        playerId: 'human',
        actions: [{ type: 'bid', group: 'A', amount: 1 }],
      },
    });
    if (s.game.phase === 'character_selection' || !s.game.roomSettlement)
      throw Error('No settled room');
    rooms.push(s.game.roomSettlement);
    const expected = canonicalJson(previous(rooms)),
      actual = canonicalAuthorityJson(rooms);
    expect(actual).toBe(expected);
    expect(sha256Hex(actual)).toBe(sha256Hex(expected));
    s = reduceGameSession(s, { type: 'advance_room' });
  }
});
