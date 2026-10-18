import { expect, it } from 'vitest';
import { prepareLibraryReplay } from './replay-library';
import { saveClassicClient } from './achievements/client-persistence';
import { gameSaveKey } from './game-save';
import { playerProfileKey } from './player-profile';
import {
  classicAiPolicy,
  classicDifficulties,
} from '../game/classic-difficulty';
import { createGameSession, reduceGameSession } from './game-session';
import {
  parseGameSave,
  serializeGameCheckpoint,
  serializeGameBackup,
} from './game-save';
import { parseReplay, serializeReplay, verifyReplayLog } from './game-replay';
import {
  createPlayerProfile,
  recordCompletedMatch,
  readPlayerProfile,
} from './player-profile';
import { readCompletionRegistry } from './completion-registry';
import { classicCompletionKey } from './completion-identity';
import {
  beginClassicGrowth,
  applyGrowthContext,
} from './achievements/lifecycle';
import { readAchievementRegistry } from './achievements/registry';
import { canonicalJson } from '../shared/json-facts';
import { stringifyChecked } from './file-json';
it.each(classicDifficulties)(
  'reconstructs checkpoints/paired backup and keeps read-only replay/config/receipt identity at %s',
  async (difficulty) => {
    let s = beginClassicGrowth(
      reduceGameSession(createGameSession(42), {
        type: 'start_game',
        characterId: 'isaac',
        classicAi: { policy: classicAiPolicy, difficulty },
      }),
    );
    for (let i = 0; i < 15; i++) {
      s = reduceGameSession(s, {
        type: 'submit_player_turn',
        turn: {
          playerId: 'human',
          actions: [{ type: 'bid', group: 'A', amount: 1 }],
        },
      });
      const checkpoint = serializeGameCheckpoint(s),
        loaded = parseGameSave(checkpoint).session;
      expect(loaded.game).toEqual(s.game);
      expect(loaded.growth).toEqual(s.growth);
      s = reduceGameSession(loaded, { type: 'advance_room' });
    }
    expect(s.game.phase).toBe('game_result');
    const applied = applyGrowthContext(createPlayerProfile(), s.growth!);
    s = { ...s, growth: applied.context };
    expect(readAchievementRegistry(applied.profile)!.receipts).toHaveLength(31);
    expect(
      parseGameSave(serializeGameBackup(s, applied.profile)).profile,
    ).toEqual(applied.profile);
    const raw = serializeReplay(s.replay!, 'difficulty-test'),
      before = canonicalJson(s);
    expect(parseReplay(raw).replay).toEqual(s.replay);
    const prepared = await prepareLibraryReplay(raw);
    expect(prepared.entry.difficulty).toBe(difficulty);
    expect(prepared.entry.replayId).toBe(s.replay!.id);
    expect(verifyReplayLog(s.replay!)).toEqual(s.replay);
    expect(canonicalJson(s)).toBe(before);
    const p = recordCompletedMatch(
      applied.profile,
      s.replay!,
      'unused-legacy-key',
    );
    expect(p.history.at(-1)!.aiDifficulty).toBe(difficulty);
    expect(
      readCompletionRegistry(readPlayerProfile(p))!.groups[
        `classic/isaac/${difficulty}`
      ]!.completed,
    ).toBe(1);
    expect(recordCompletedMatch(p, s.replay!, 'unused-legacy-key')).toBe(p);
  },
  30000,
);
it('does not relabel or change old no-setting checkpoints/replays, and rejects new policy/difficulty tampering', () => {
  let legacy = reduceGameSession(createGameSession(42), {
    type: 'start_game',
    characterId: 'isaac',
  });
  legacy = reduceGameSession(legacy, {
    type: 'submit_player_turn',
    turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
  });
  const old = serializeGameCheckpoint(legacy),
    parsed = parseGameSave(old).session;
  expect(parsed.game).toEqual(legacy.game);
  expect(parsed.replay!.classicAi).toBeUndefined();
  expect(parsed.replay!.id).not.toContain('-CA1-');
  let next = reduceGameSession(createGameSession(42), {
    type: 'start_game',
    characterId: 'isaac',
    classicAi: { policy: classicAiPolicy, difficulty: 'easy' },
  });
  next = reduceGameSession(next, {
    type: 'submit_player_turn',
    turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
  });
  const doc = JSON.parse(serializeGameCheckpoint(next));
  doc.checkpoint.game.classicAi.difficulty = 'hard';
  expect(() => parseGameSave(stringifyChecked(doc))).toThrow();
  const future = JSON.parse(serializeReplay(next.replay!, 'test'));
  future.replay.classicAi.policy = 'classic-tiered-2';
  expect(() => parseReplay(stringifyChecked(future))).toThrow();
  expect(classicCompletionKey(parsed.replay!)).not.toBe(
    classicCompletionKey(next.replay!),
  );
});

it('saves the real easy-tier lifecycle and repeated terminal checkpoint exactly once', async () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
  const coordinator = {
    exclusive: async <T>(_name: string, work: () => T) => work(),
  };
  let s = beginClassicGrowth(
    reduceGameSession(createGameSession(91), {
      type: 'start_game',
      characterId: 'isaac',
      classicAi: { policy: classicAiPolicy, difficulty: 'easy' },
    }),
  );
  const save = async () => {
    const result = await saveClassicClient(storage, s, {
      expectedSource: storage.getItem(gameSaveKey),
      coordinator,
    });
    expect(result.message).toBe('');
    s = result.session;
    expect(s.growth!.acknowledged).toBe(s.growth!.units.length);
  };
  await save();
  for (let i = 0; i < 15; i++) {
    s = reduceGameSession(s, {
      type: 'submit_player_turn',
      turn: {
        playerId: 'human',
        actions: [{ type: 'bid', group: 'A', amount: 1 }],
      },
    });
    await save();
    s = parseGameSave(storage.getItem(gameSaveKey)!).session;
    s = reduceGameSession(s, { type: 'advance_room' });
    await save();
  }
  const raw = storage.getItem(playerProfileKey)!;
  const p = readPlayerProfile(JSON.parse(raw));
  expect(readAchievementRegistry(p)!.receipts).toHaveLength(31);
  expect(
    readCompletionRegistry(p)!.groups['classic/isaac/easy']!.completed,
  ).toBe(1);
  await save();
  await save();
  expect(storage.getItem(playerProfileKey)).toBe(raw);
}, 30000);
