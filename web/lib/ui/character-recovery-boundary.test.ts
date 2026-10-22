import { expect, it } from 'vitest';
import { beginClassicGrowth } from './achievements/lifecycle';
import { createGameSession, reduceGameSession } from './game-session';
import {
  serializeGameCheckpoint,
  parseGameSave,
  loadAutoSave,
  gameSaveKey,
} from './game-save';
import { stringifyChecked } from './file-json';

function source() {
  let session = beginClassicGrowth(
    reduceGameSession(createGameSession(42), {
      type: 'start_game',
      characterId: 'isaac',
    }),
  );
  session = reduceGameSession(session, {
    type: 'submit_player_turn',
    turn: {
      playerId: 'human',
      actions: [{ type: 'bid', group: 'A', amount: 1 }],
    },
  });
  return serializeGameCheckpoint(session);
}
it('roundtrips a current authoritative checkpoint with new evidence without showing the recovery error', () => {
  const raw = source();
  const parsed = parseGameSave(raw);
  expect(
    parsed.session.growth!.units.some(
      (unit) => unit.stage === 'room' && unit.values.length === 19,
    ),
  ).toBe(true);
  const result = loadAutoSave({
    getItem: (key) => (key === gameSaveKey ? raw : null),
  });
  expect(result.session).not.toBeNull();
  expect(result.message).toContain('已恢复');
});
it('reproduces the same protective message for a pre-capital proof without altering the old checkpoint', () => {
  const { checksum: _checksum, ...payload } = JSON.parse(source());
  for (const unit of payload.growth.units)
    if (unit.stage === 'room') unit.values = unit.values.slice(0, 17);
  const raw = stringifyChecked(payload);
  const storage = new Map([
    [gameSaveKey, raw],
    ['profile-sentinel', 'keep'],
  ]);
  const before = [...storage];
  const result = loadAutoSave({ getItem: (key) => storage.get(key) ?? null });
  expect(result.session).toBeNull();
  expect(result.message).toBe(
    '自动存档未读取：对局成长上下文不一致，原对局与档案保留。',
  );
  expect([...storage]).toEqual(before);
});
