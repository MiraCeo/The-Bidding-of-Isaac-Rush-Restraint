import { beforeAll, expect, it } from 'vitest';
import {
  createPlayerProfile,
  readPlayerProfile,
  recordCompletedMatch,
  playerProfileKey,
} from './player-profile';
import {
  recordSurvivalCompletedMatch,
  survivalCompletionKey,
} from './survival-profile';
import {
  completionReceiptLimit,
  completionRegistryModule,
  readCompletionRegistry,
  registerCompletion,
  sumCounters,
  historyCounters,
  legacyCompletionAlias,
} from './completion-registry';
import {
  classicCompletionKey,
  normalizedSurvivalCompletionKey,
  oldSurvivalCompletionKey,
} from './completion-identity';
import {
  completionRecordFixture,
  classicCompletionFixture,
  survivalCompletionFixture,
} from './completion-registry.test-helper';
import { replayLibraryKey, newLibraryDocument } from './replay-library';
import {
  serializePlayerProfileBackup,
  parsePlayerProfileBackup,
  restorePlayerProfileBackup,
} from './player-profile-file';
import { profileFileFixture } from './player-profile-file.test-helper';
import { packDataFile } from './compressed-file';
import { readModeDataFile } from './mode-data';
import { persistGameSession, loadPlayerProfile } from './game-save';
import { canonicalJson } from '../shared/json-facts';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readPlayerProfileBackup } from './player-profile-file';
import { unpackDataFile } from './compressed-file';
import { serializeGameCheckpoint } from './game-save';
import { serializeReplay } from './game-replay';
import {
  serializeSurvivalCheckpoint,
  serializeSurvivalReplay,
} from './survival-persistence';
import { playLongRun } from './survival-long-run';
import { replayFactsIdentity } from './replay-facts-codec';
import { sha256Hex } from '../shared/sha256';
import { createGameSession, reduceGameSession } from './game-session';
let classic: ReturnType<typeof classicCompletionFixture>,
  survival: ReturnType<typeof survivalCompletionFixture>;
beforeAll(() => {
  classic = classicCompletionFixture();
  survival = survivalCompletionFixture();
});
const total = (profile: ReturnType<typeof createPlayerProfile>) =>
  sumCounters(Object.values(readCompletionRegistry(profile)?.groups ?? {}));
const register = (
  p: ReturnType<typeof createPlayerProfile>,
  i: number,
  mode: 'classic' | 'survival' = 'classic',
) => registerCompletion(p, completionRecordFixture(i, mode), [], false);
it('keeps old history readable and does not create or backfill statistics during a read', () => {
  const p = profileFileFixture(),
    source = canonicalJson(p);
  expect(readCompletionRegistry(p)).toBeNull();
  expect(readPlayerProfile(p)).toEqual(p);
  expect(sumCounters(Object.values(historyCounters(p))).completed).toBe(3);
  expect(canonicalJson(p)).toBe(source);
});
it('registers only complete authority and uses the competition rank and four-decimal score', () => {
  const next = recordCompletedMatch(
    createPlayerProfile(),
    classic.replay!,
    'old-locator',
  );
  const c = total(next),
    human = classic.replay!.final!.ranking.find((r) => r.playerId === 'human')!;
  expect(c.completed).toBe(1);
  expect(c.rankSum).toBe(
    1 +
      classic.replay!.final!.ranking.filter(
        (r) => r.finalScore > human.finalScore,
      ).length,
  );
  expect(c.scoreSumUnits).toBe(Math.round(human.finalScore * 10000));
  expect(next.history[0]!.key).toBe(classicCompletionKey(classic.replay!));
  const partial = { ...classic.replay!, final: null };
  expect(recordCompletedMatch(next, partial, 'partial')).toBe(next);
});
it('keeps survival ordinal status, frozen score, inherited-point exclusion and champion facts', async () => {
  const key = await survivalCompletionKey(survival),
    next = recordSurvivalCompletedMatch(createPlayerProfile(), survival, key);
  const c = total(next),
    human = survival.final!.ranking.find((r) => r.playerId === 'human')!;
  expect(c.completed).toBe(1);
  expect(c.eliminated).toBe(1);
  expect(c.survived).toBe(0);
  expect(c.champions).toBe(Number(human.isChampion));
  expect(c.rankSum).toBe(human.rank);
  expect(c.scoreSumUnits).toBe(Math.round(human.finalScore * 10000));
  expect(c.eliminationFloors[human.eliminationFloorIndex!]).toBe(1);
  expect(readPlayerProfile(next)).toEqual(next);
});
it('retains receipts and accumulated totals after more than 200 history rows', () => {
  let p = createPlayerProfile();
  for (let i = 0; i < 240; i++) p = register(p, i);
  expect(p.history).toHaveLength(200);
  expect(p.history[0]!.replayId).toBe('fixture-classic-40');
  expect(total(p).completed).toBe(240);
  const registry = readCompletionRegistry(p)!;
  expect(Object.keys(registry.receipts)).toHaveLength(240);
  expect(register(p, 0)).toBe(p);
  expect(total(p).completed).toBe(240);
  expect(readPlayerProfile(p)).toEqual(p);
});
it('preserves every existing progression field and extension, without awards or unlocks', () => {
  const p = profileFileFixture();
  p.progression.characterUnlocks.test = {
    unlockedAt: p.createdAt,
    conditionId: 'existing-only',
  };
  p.progression.achievements.test = { achievedAt: null, progress: 3 };
  const before = structuredClone(p);
  const next = register(p, 99);
  const { [completionRegistryModule]: _registry, ...modules } =
    next.progression.modules;
  expect(modules).toEqual(before.progression.modules);
  expect(next.progression.statistics).toEqual(before.progression.statistics);
  expect(next.progression.achievements).toEqual(
    before.progression.achievements,
  );
  expect(next.progression.characterUnlocks).toEqual(
    before.progression.characterUnlocks,
  );
  expect(p).toEqual(before);
  expect(total(next).completed).toBe(1);
  expect(readCompletionRegistry(next)!.baselineHistoryCount).toBe(3);
});
it('bridges known old keys as baseline, not as newly earned lifetime totals', () => {
  const old = profileFileFixture(),
    row = completionRecordFixture(5);
  old.history = [{ ...row, key: 'legacy-old-key' }];
  const next = registerCompletion(
    old,
    row,
    ['legacy-old-key'],
    false,
    'restored',
  );
  expect(total(next).completed).toBe(0);
  expect(next.history).toEqual(old.history);
  expect(readCompletionRegistry(next)!.receipts[row.key]).toBe(false);
  expect(registerCompletion(next, row, ['other-key'], false)).toBe(next);
  expect(readCompletionRegistry(next)!.legacyKeys).toContain(
    legacyCompletionAlias('classic', 'legacy-old-key'),
  );
});
it('protects ambiguous old restored summaries without merging distinct receipt identities; new live branches still count', () => {
  const row = completionRecordFixture(1),
    old = createPlayerProfile();
  old.history = [{ ...row, key: 'opaque-old-hash' }];
  const restored = registerCompletion(
    old,
    row,
    ['different-runtime-hash'],
    false,
    'restored',
  );
  expect(total(restored).completed).toBe(0);
  expect(restored.history).toEqual(old.history);
  const branch = { ...row, key: completionRecordFixture(2).key };
  const live = registerCompletion(
    restored,
    branch,
    ['another-key'],
    false,
    'live',
  );
  expect(total(live).completed).toBe(1);
  expect(Object.keys(readCompletionRegistry(live)!.receipts)).toHaveLength(2);
});
it('preserves library1 classic keys, shares survival identities and deduplicates only knife explanation tails', async () => {
  expect(`classic/${sha256Hex(replayFactsIdentity(classic.replay!))}`).toBe(
    await replayLibraryKey(
      newLibraryDocument({ mode: 'classic', replay: classic.replay! }),
    ),
  );
  const classicCopy = structuredClone(classic.replay!);
  const classicTrigger = classicCopy.rooms
    .flatMap((r) =>
      Object.values(r.settlement.scoreBreakdowns).flatMap((b) => b.triggers),
    )
    .find((t) => t.itemId === 'moms_knife' && t.kind === 'additive_score')!;
  classicTrigger.amount! += 1e-13;
  expect(classicCompletionKey(classicCopy)).toBe(
    classicCompletionKey(classic.replay!),
  );
  const classicProfile = recordCompletedMatch(
    createPlayerProfile(),
    classic.replay!,
    'original',
  );
  expect(recordCompletedMatch(classicProfile, classicCopy, 'rebuilt')).toBe(
    classicProfile,
  );
  classicTrigger.amount! += 0.00001;
  expect(classicCompletionKey(classicCopy)).not.toBe(
    classicCompletionKey(classic.replay!),
  );
  const key = await survivalCompletionKey(survival);
  expect(key).toBe(
    await replayLibraryKey(
      newLibraryDocument({ mode: 'survival', replay: survival }),
    ),
  );
  const copy = structuredClone(survival);
  const trigger = copy.rooms
    .flatMap((r) => Object.values(r.scoreBreakdowns).flatMap((b) => b.triggers))
    .find((t) => t.itemId === 'moms_knife' && t.kind === 'additive_score')!;
  trigger.amount! += 1e-13;
  expect(normalizedSurvivalCompletionKey(copy)).toBe(key);
  const p = recordSurvivalCompletedMatch(createPlayerProfile(), survival, key);
  expect(
    recordSurvivalCompletedMatch(p, copy, await survivalCompletionKey(copy)),
  ).toBe(p);
  trigger.amount! += 0.00001;
  expect(normalizedSurvivalCompletionKey(copy)).not.toBe(key);
  expect(oldSurvivalCompletionKey(copy)).not.toBe(
    oldSurvivalCompletionKey(survival),
  );
});
it('keeps real same-seed quotation branches separate', () => {
  const branch = classicCompletionFixture(42, true);
  expect(branch.replay!.id).toBe(classic.replay!.id);
  expect(classicCompletionKey(branch.replay!)).not.toBe(
    classicCompletionKey(classic.replay!),
  );
  let p = recordCompletedMatch(
    createPlayerProfile(),
    classic.replay!,
    'legacy',
  );
  p = recordCompletedMatch(p, branch.replay!, 'branch');
  expect(total(p).completed).toBe(2);
});
it('does not label a rank1 all-eliminated result as a survival champion', () => {
  const row = {
    ...completionRecordFixture(1, 'survival'),
    rank: 1,
    status: 'eliminated' as const,
    eliminationFloorIndex: 2,
  };
  const p = registerCompletion(createPlayerProfile(), row, [], false);
  expect(total(p).champions).toBe(0);
  expect(total(p).eliminationFloors[2]).toBe(1);
});
it('groups by mode, role and difficulty without assigning missing old difficulty to highest', () => {
  let p = registerCompletion(
    createPlayerProfile(),
    {
      ...completionRecordFixture(1, 'survival'),
      characterId: 'lost',
      aiDifficulty: undefined,
    },
    [],
    false,
  );
  p = registerCompletion(
    p,
    { ...completionRecordFixture(2, 'survival'), aiDifficulty: 'easy' },
    [],
    false,
  );
  p = register(p, 3, 'classic');
  expect(Object.keys(readCompletionRegistry(p)!.groups).sort()).toEqual([
    'classic/isaac',
    'survival/isaac/easy',
    'survival/lost/ungraded',
  ]);
});
it('rejects corrupted/future counters, receipts, histogram, sizes and inconsistent mode totals', () => {
  const p = register(createPlayerProfile(), 0, 'survival');
  const mutations = [
    (r: Record<string, unknown>) => {
      r.version = 2;
    },
    (r: Record<string, unknown>) => {
      r.receipts = {};
    },
    (r: Record<string, unknown>) => {
      r.legacyKeys = ['invalid'];
    },
    (r: Record<string, unknown>) => {
      r.baselineHistoryCount = 201;
    },
    (r: Record<string, unknown>) => {
      r.groups = { invalid: {} };
    },
    (r: Record<string, unknown>) => {
      Object.values(
        r.groups as Record<string, Record<string, unknown>>,
      )[0]!.scoreSumUnits = Infinity;
    },
    (r: Record<string, unknown>) => {
      Object.values(
        r.groups as Record<string, Record<string, unknown>>,
      )[0]!.eliminationFloors = [1, 0, 0, 0, 0, 0, 0];
    },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(p);
    mutate(
      copy.progression.modules[completionRegistryModule] as Record<
        string,
        unknown
      >,
    );
    expect(() => readPlayerProfile(copy)).toThrow();
  }
});
it('refuses to evict old receipts at the limit and leaves the candidate input unchanged', () => {
  const p = register(createPlayerProfile(), 0),
    r = readCompletionRegistry(p)!;
  for (let i = 1; i < completionReceiptLimit; i++)
    r.receipts[completionRecordFixture(i).key] = false;
  expect(readPlayerProfile(p)).toEqual(p);
  const before = canonicalJson(p);
  expect(() => register(p, completionReceiptLimit + 1)).toThrow('8192');
  expect(canonicalJson(p)).toBe(before);
  expect(register(p, 0)).toBe(p);
});
it('roundtrips receipts/aggregates through standalone and compressed backups without addition', async () => {
  let p = createPlayerProfile();
  for (let i = 0; i < 220; i++)
    p = register(p, i, i % 2 ? 'survival' : 'classic');
  const source = serializePlayerProfileBackup(p);
  const doc = parsePlayerProfileBackup(source);
  expect(doc.profile).toEqual(p);
  const storage = new Map([
      [playerProfileKey, JSON.stringify(register(createPlayerProfile(), 999))],
    ]),
    old = storage.get(playerProfileKey)!;
  restorePlayerProfileBackup(
    {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value);
      },
    },
    doc.profile,
    old,
  );
  const restored = readPlayerProfile(
    JSON.parse(storage.get(playerProfileKey)!),
  );
  expect(total(restored).completed).toBe(220);
  expect(register(restored, 0)).toBe(restored);
  const packed = await packDataFile(source);
  await expect(readModeDataFile(packed.source, 'profile.json')).rejects.toThrow(
    '读取玩家档案文件',
  );
});
it('keeps cumulative data unchanged when the actual profile write fails, then registers once on retry', () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (key === playerProfileKey) throw Error('quota');
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  expect(persistGameSession(storage, classic)).toBe(false);
  expect(data.has(playerProfileKey)).toBe(false);
  storage.setItem = (key, value) => {
    data.set(key, value);
  };
  expect(persistGameSession(storage, classic)).toBe(true);
  expect(total(loadPlayerProfile(storage).profile).completed).toBe(1);
  expect(persistGameSession(storage, classic)).toBe(true);
  expect(total(loadPlayerProfile(storage).profile).completed).toBe(1);
});
it('reports unavailable and malformed profile stores instead of pretending their statistics are zero', () => {
  expect(loadPlayerProfile(null).message).toContain('不可读取');
  expect(loadPlayerProfile({ getItem: () => '' }).message).not.toBe('');
});
it('preserves real terminal and over-200 cumulative profiles as raw/compressed/restored roundtrip fixtures', async () => {
  const root = resolve('work/statistics-roundtrip');
  await mkdir(root, { recursive: true });
  const now = new Date('2026-10-14T03:00:00Z');
  let actual = recordCompletedMatch(
    createPlayerProfile(now),
    classic.replay!,
    'fixture-classic',
    now,
  );
  actual = recordSurvivalCompletedMatch(
    actual,
    survival,
    await survivalCompletionKey(survival),
    now,
  );
  let large = createPlayerProfile(now);
  for (let i = 0; i < 240; i++)
    large = registerCompletion(
      large,
      completionRecordFixture(i, i % 2 ? 'survival' : 'classic'),
      [],
      false,
      'live',
      now,
    );
  const cases = [];
  for (const [name, profile] of Object.entries({
    actual2: actual,
    cumulative240: large,
  })) {
    const original = serializePlayerProfileBackup(
        profile,
        'statistics-roundtrip',
        now,
      ),
      packed = await packDataFile(original),
      restored = (await unpackDataFile(packed.source)).source;
    expect(restored).toBe(original);
    const recovered = (await readPlayerProfileBackup(packed.source)).profile;
    expect(recovered).toEqual(profile);
    const duplicate =
      name === 'actual2'
        ? recordCompletedMatch(
            recovered,
            classic.replay!,
            'different-runtime-locator',
            now,
            'restored',
          )
        : registerCompletion(
            recovered,
            completionRecordFixture(0),
            [],
            false,
            'restored',
            now,
          );
    expect(duplicate).toBe(recovered);
    for (const [kind, source] of Object.entries({
      original,
      compressed: packed.source,
      restored,
    }))
      await writeFile(resolve(root, `${name}.${kind}.json`), source);
    cases.push({
      name,
      source:
        name === 'actual2'
          ? 'two deterministic complete game simulations'
          : '240 synthetic completion records',
      retainedHistory: profile.history.length,
      cumulativeCompleted: total(profile).completed,
      receipts: Object.keys(readCompletionRegistry(profile)!.receipts).length,
      originalBytes: packed.originalBytes,
      fileBytes: packed.fileBytes,
      compressed: packed.compressed,
      originalSha256: createHash('sha256').update(original).digest('hex'),
      restoredSha256: createHash('sha256').update(restored).digest('hex'),
      sourceExact: true,
      profileExact: true,
      repeatedCompletionCounted: false,
    });
  }
  await writeFile(
    resolve(root, 'classic-final.checkpoint.json'),
    serializeGameCheckpoint(classic),
  );
  await writeFile(
    resolve(root, 'classic-start.checkpoint.json'),
    serializeGameCheckpoint(
      reduceGameSession(createGameSession(42), {
        type: 'start_game',
        characterId: 'isaac',
      }),
    ),
  );
  await writeFile(
    resolve(root, 'classic-final.replay.json'),
    serializeReplay(classic.replay!, 'statistics-roundtrip'),
  );
  await writeFile(
    resolve(root, 'survival-final.checkpoint.json'),
    serializeSurvivalCheckpoint(playLongRun(3, 'isaac', 'highest').game),
  );
  await writeFile(
    resolve(root, 'survival-final.replay.json'),
    serializeSurvivalReplay(survival, 'statistics-roundtrip'),
  );
  await writeFile(
    resolve(root, 'report.json'),
    JSON.stringify({ cases }, null, 2),
  );
});
