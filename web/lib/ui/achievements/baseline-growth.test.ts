import { it, expect } from 'vitest';
import {
  createPlayerProfile,
  playerProfileKey,
  readPlayerProfile,
} from '../player-profile';
import {
  achievementBaselineModule,
  hasCurrentAchievementBaseline,
} from './baseline';
import {
  beginClassicGrowth,
  beginSurvivalGrowth,
  applyGrowthContext,
  resetLegacyGrowthContext,
  validateGrowthProfilePair,
  validateGrowthContext,
} from './lifecycle';
import { createGameSession, reduceGameSession } from '../game-session';
import { startSurvivalClient, reduceSurvivalClient } from '../survival-client';
import {
  serializeGameCheckpoint,
  serializeGameBackup,
  parseGameSave,
  gameSaveKey,
} from '../game-save';
import {
  serializeSurvivalCheckpoint,
  parseSurvivalCheckpoint,
} from '../survival-persistence';
import {
  serializeSurvivalBackup,
  parseSurvivalBackup,
} from '../survival-backup';
import {
  restoreClassicCoordinated,
  restoreSurvivalCoordinated,
} from '../profile-operations';
import {
  saveClassicClient,
  saveSurvivalClient,
  mergeSavedGrowth,
} from './client-persistence';
import {
  prepareAchievementBaseline,
  readAchievementRegistry,
  projectAchievementRegistry,
} from './registry';
import { longRunAction } from '../survival-long-run';
import { stringifyChecked } from '../file-json';
import {
  baselineNow as now,
  oldAchievementProfile,
} from './baseline.test-helper';
const coordinator = {
  exclusive: async <T>(_name: string, work: () => T) => work(),
};
function store(p = oldAchievementProfile()) {
  const data = new Map<string, string>([
    [playerProfileKey, JSON.stringify(p)],
    ['settings', 'keep'],
    ['library', 'keep'],
  ]);
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}
function classic() {
  return reduceGameSession(
    beginClassicGrowth(
      reduceGameSession(createGameSession(42), {
        type: 'start_game',
        characterId: 'isaac',
      }),
    ),
    {
      type: 'submit_player_turn',
      turn: {
        playerId: 'human',
        actions: [{ type: 'bid', group: 'A', amount: 1 }],
      },
    },
  );
}
function legacyClassic() {
  const s = classic(),
    applied = applyGrowthContext(createPlayerProfile(now), s.growth!, now),
    p = structuredClone(applied.profile);
  delete p.progression.modules[achievementBaselineModule];
  const doc = JSON.parse(
    serializeGameBackup(
      { ...s, growth: applied.context },
      applied.profile,
      now,
    ),
  );
  delete doc.profile.progression.modules[achievementBaselineModule];
  delete doc.growth.baseline;
  const loaded = parseGameSave(stringifyChecked(doc));
  return { session: loaded.session, profile: p, source: stringifyChecked(doc) };
}
it('strictly reads genuine old paired facts, then removes the entire obsolete prefix without replaying awards', () => {
  const old = legacyClassic(),
    before = JSON.stringify(old),
    c = old.session.growth!;
  expect(c.baseline).toBeUndefined();
  expect(c.acknowledged).toBeGreaterThan(0);
  expect(() => validateGrowthProfilePair(old.profile, c)).not.toThrow();
  const applied = applyGrowthContext(old.profile, c, now);
  expect(hasCurrentAchievementBaseline(applied.profile)).toBe(true);
  expect(readAchievementRegistry(applied.profile)!.receipts).toEqual([]);
  expect(applied.context).toMatchObject({
    baseline: 1,
    excludedThrough: 1,
    units: [],
    acknowledged: 0,
  });
  expect(projectAchievementRegistry(applied.profile)!.achievedAt).toEqual({});
  expect(JSON.stringify(old)).toBe(before);
  const current = { ...old.session, growth: applied.context };
  expect(
    parseGameSave(serializeGameCheckpoint(current)).session.growth,
  ).toEqual(applied.context);
});
it('clears old pending units on the first new live phase and counts only subsequent formal stages', () => {
  const old = legacyClassic();
  let s = reduceGameSession(old.session, { type: 'advance_room' });
  expect(s.growthIssue).toBeUndefined();
  expect(s.growth!.baseline).toBe(1);
  expect(s.growth!.excludedThrough).toBe(1);
  expect(s.growth!.units).toHaveLength(1);
  expect(s.growth!.units[0]!.stage).toBe('entry');
  s = reduceGameSession(s, {
    type: 'submit_player_turn',
    turn: {
      playerId: 'human',
      actions: [{ type: 'bid', group: 'A', amount: 1 }],
    },
  });
  const applied = applyGrowthContext(old.profile, s.growth!, now);
  expect(readAchievementRegistry(applied.profile)!.receipts).toHaveLength(2);
  expect(applyGrowthContext(applied.profile, s.growth!, now).profile).toBe(
    applied.profile,
  );
  expect(
    parseGameSave(
      serializeGameBackup({ ...s, growth: applied.context }, applied.profile),
    ).session.growth,
  ).toEqual(applied.context);
});
it('exports/loads old checkpoints and full backups with achievement-only old units removed but game/replay facts intact', () => {
  const old = legacyClassic(),
    game = JSON.stringify(old.session.game),
    turns = JSON.stringify(old.session.turns),
    replay = JSON.stringify(old.session.replay);
  const checkpoint = parseGameSave(serializeGameCheckpoint(old.session));
  expect(checkpoint.session.growth!.units).toEqual([]);
  expect(checkpoint.session.game).toEqual(old.session.game);
  const backup = parseGameSave(serializeGameBackup(old.session, old.profile));
  expect(backup.session.growth!.baseline).toBe(1);
  expect(backup.session.growth!.units).toEqual([]);
  expect(readAchievementRegistry(backup.profile!)!.receipts).toEqual([]);
  expect(JSON.stringify(old.session.game)).toBe(game);
  expect(JSON.stringify(old.session.turns)).toBe(turns);
  expect(JSON.stringify(old.session.replay)).toBe(replay);
});
it('atomically restores an old classic backup as a cleared profile and current exclusion checkpoint, not old achievement evidence', async () => {
  const old = legacyClassic(),
    s = store(),
    expected = s.getItem(playerProfileKey);
  const result = await restoreClassicCoordinated(
    s,
    old.session,
    old.profile,
    expected,
    { coordinator },
  );
  const profile = readPlayerProfile(JSON.parse(s.getItem(playerProfileKey)!));
  expect(hasCurrentAchievementBaseline(profile)).toBe(true);
  expect(readAchievementRegistry(profile)!.receipts).toEqual([]);
  expect(parseGameSave(result.source).session.growth!.units).toEqual([]);
  expect(s.getItem('settings')).toBe('keep');
  expect(s.getItem('library')).toBe('keep');
  const bad = structuredClone(old.profile);
  bad.progression.modules.achievementRegistryV1 = {
    version: 1,
    catalogVersion: 1,
    activatedAt: now.toISOString(),
    manualUnlockAllAt: null,
    receipts: [],
  };
  await expect(
    restoreClassicCoordinated(
      s,
      old.session,
      bad,
      s.getItem(playerProfileKey),
      { coordinator },
    ),
  ).rejects.toThrow('不一致');
});
it('rolls back every paired-restore key on cleanup quota failure, then retries without old achievement refill', async () => {
  const old = legacyClassic(),
    s = store();
  s.setItem(gameSaveKey, 'original-checkpoint');
  const before = [...s.data.entries()].sort(([a], [b]) => a.localeCompare(b));
  let fail = true;
  const guarded = {
    ...s,
    setItem: (key: string, value: string) => {
      if (key === playerProfileKey && fail) {
        fail = false;
        throw Error('quota');
      }
      s.setItem(key, value);
    },
  };
  await expect(
    restoreClassicCoordinated(
      guarded,
      old.session,
      old.profile,
      s.getItem(playerProfileKey),
      { coordinator },
    ),
  ).rejects.toThrow('原存储');
  expect([...s.data.entries()].sort(([a], [b]) => a.localeCompare(b))).toEqual(
    before,
  );
  await restoreClassicCoordinated(
    guarded,
    old.session,
    old.profile,
    s.getItem(playerProfileKey),
    { coordinator },
  );
  expect(
    readAchievementRegistry(
      readPlayerProfile(JSON.parse(s.getItem(playerProfileKey)!)),
    )!.receipts,
  ).toEqual([]);
});
it('a queued old classic save cannot refill old receipts and a new-baseline save continues to inherit correctly', async () => {
  const old = legacyClassic(),
    s = store(old.profile);
  s.setItem(gameSaveKey, old.source);
  const saved = await saveClassicClient(s, old.session, {
    coordinator,
    expectedSource: old.source,
  });
  expect(saved.newlyAchieved).toEqual([]);
  expect(saved.session.growth!.units).toEqual([]);
  expect(readAchievementRegistry(saved.profile!)!.receipts).toEqual([]);
  expect(
    mergeSavedGrowth(
      old.session.growth!,
      old.session.growth!,
      saved.session.growth!,
    ),
  ).toEqual(saved.session.growth);
  let next = reduceGameSession(saved.session, { type: 'advance_room' });
  next = reduceGameSession(next, {
    type: 'submit_player_turn',
    turn: {
      playerId: 'human',
      actions: [{ type: 'bid', group: 'A', amount: 1 }],
    },
  });
  const fresh = await saveClassicClient(s, next, {
    coordinator,
    expectedSource: saved.source,
  });
  const n = readAchievementRegistry(fresh.profile!)!.receipts.length;
  expect(n).toBeGreaterThan(0);
  const repeat = await saveClassicClient(s, fresh.session, {
    coordinator,
    expectedSource: fresh.source,
  });
  expect(readAchievementRegistry(repeat.profile!)!.receipts).toHaveLength(n);
});
it('keeps baseline validation strict and preserves acknowledged-history checks for post-cleanup data', () => {
  const s = classic();
  expect(() =>
    validateGrowthContext({ ...s.growth, baseline: 2 }, 'classic'),
  ).toThrow();
  const applied = applyGrowthContext(createPlayerProfile(now), s.growth!, now);
  expect(() =>
    validateGrowthProfilePair(createPlayerProfile(now), applied.context),
  ).toThrow('不一致');
  const prefix = resetLegacyGrowthContext({
    ...s.growth!,
    baseline: undefined,
  });
  expect(prefix.units).toEqual([]);
  expect(resetLegacyGrowthContext(prefix)).toBe(prefix);
  expect(prepareAchievementBaseline(applied.profile)).toBe(applied.profile);
});
it('cleans old survival pending/terminal facts, preserves AI-only completion and admits no frozen human achievements twice', async () => {
  let s = beginSurvivalGrowth(startSurvivalClient('lost', 3, 'highest'));
  while (s.game.phase !== 'competition_complete')
    s = reduceSurvivalClient(s, longRunAction(s.game));
  const applied = applyGrowthContext(createPlayerProfile(now), s.growth!, now),
    p = applied.profile;
  const raw = JSON.parse(
    serializeSurvivalBackup(s.game, s.draft, p, now, applied.context),
  );
  delete raw.profile.progression.modules[achievementBaselineModule];
  delete raw.checkpoint.growth.baseline;
  raw.checkpoint = JSON.parse(stringifyChecked(raw.checkpoint));
  const old = parseSurvivalBackup(stringifyChecked(raw));
  const storeValue = store(old.profile);
  const restored = await restoreSurvivalCoordinated(
    storeValue,
    old.checkpoint,
    old.profile,
    storeValue.getItem(playerProfileKey),
    { coordinator },
  );
  const checkpoint = parseSurvivalCheckpoint(restored.source);
  expect(checkpoint.game).toEqual(old.checkpoint.game);
  expect(checkpoint.growth!.units).toEqual([]);
  expect(checkpoint.growth!.excludedThrough).toBe(78);
  const saved = await saveSurvivalClient(
    storeValue,
    {
      game: checkpoint.game,
      draft: checkpoint.draft ?? null,
      growth: checkpoint.growth,
    },
    { coordinator, expectedSource: restored.source, origin: 'restored' },
  );
  expect(saved.newlyAchieved).toEqual([]);
  expect(readAchievementRegistry(saved.profile!)!.receipts).toEqual([]);
  expect(projectAchievementRegistry(saved.profile!)!.achievedAt).toEqual({});
  expect(
    parseSurvivalCheckpoint(
      serializeSurvivalCheckpoint(
        checkpoint.game,
        checkpoint.draft,
        now,
        checkpoint.growth,
      ),
    ).growth,
  ).toEqual(checkpoint.growth);
});
