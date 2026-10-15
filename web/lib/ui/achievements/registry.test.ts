import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  calculateTurnScore,
  readLiveScoreBeforeClear,
} from '../../game/item-scoring';
import { defaultRules } from '../../game/config';
import { createRuntimePlayer } from '../../game/runtime';
import { resolveTurnActions } from '../../game/turns';
import type { ItemId } from '../../game/item-types';
import { createGameSession, reduceGameSession } from '../game-session';
import { canonicalJson } from '../../shared/json-facts';
import { sha256Hex } from '../../shared/sha256';
import {
  createPlayerProfile,
  readPlayerProfile,
  playerProfileKey,
  type PlayerProfile,
} from '../player-profile';
import {
  activateAchievementRegistry,
  appendAchievementEvent,
  readAchievementRegistry,
  projectAchievementRegistry,
  manuallyUnlockAchievementCharacters,
  achievementRegistryModule,
  achievementReceiptLimit,
  validateAchievementRegistry,
  type AchievementSubmission,
  type AchievementRegistry,
} from './registry';
import {
  decodeAchievementEvent,
  encodeAchievementEvent,
  type AchievementEvent,
} from './event-codec';
import { extractAchievementRoomFacts } from './facts';
import {
  persistAchievementProfile,
  achievementProfileLockName,
  type AchievementWriteCoordinator,
} from './persistence';
import {
  serializePlayerProfileBackup,
  parsePlayerProfileBackup,
  restorePlayerProfileBackup,
} from '../player-profile-file';
import { packDataFile, unpackDataFile } from '../compressed-file';
import { serializeGameBackup, parseGameSave } from '../game-save';
import { classicCompletionFixture } from '../completion-registry.test-helper';

const now = new Date('2026-10-15T01:00:00.000Z');
function event(
  position = 0,
  bid = 1,
  bits = 0,
  high = 0,
  hidden = 0,
  score: number | null = 0,
): AchievementEvent {
  return decodeAchievementEvent({
    stage: 'room',
    position,
    values: [bid, bits, high, hidden, score],
  });
}
function submission(
  id = '0',
  facts = event(),
  parent: string | null = null,
  mode: 'classic' | 'survival' = 'classic',
): AchievementSubmission {
  return {
    source: 'live',
    root: sha256Hex('synthetic-root'),
    authorityHash: sha256Hex(`synthetic-verified-${id}`),
    parent,
    mode,
    event: facts,
  };
}
function last(profile: PlayerProfile) {
  return readAchievementRegistry(profile)!.receipts.at(-1)!.key;
}
function append(
  profile: PlayerProfile,
  id: string,
  facts = event(),
  parent: string | null = null,
  mode: 'classic' | 'survival' = 'classic',
) {
  return appendAchievementEvent(
    profile,
    submission(id, facts, parent, mode),
    now,
  );
}
function liveScoring(items: ItemId[], amount: number | null = 1, target = 30) {
  const p = createRuntimePlayer({
    id: 'human',
    isHuman: true,
    money: 100,
    score: 0,
  });
  p.items = items.map((itemId, i) => ({
    itemId,
    instanceId: `test-${i}`,
    acquiredOrder: i + 1,
  }));
  const actions = resolveTurnActions(
    p,
    {
      playerId: 'human',
      actions:
        amount === null
          ? [{ type: 'withdraw' }]
          : [{ type: 'bid', group: 'A', amount }],
    },
    defaultRules,
  );
  const random = { next: vi.fn(() => 0) };
  const score = calculateTurnScore(
    p,
    actions,
    target,
    30,
    0,
    'boss',
    defaultRules,
    random,
  );
  return { p, score, random };
}
function serialCoordinator(): AchievementWriteCoordinator {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    exclusive: (name, work) => {
      expect(name).toBe(achievementProfileLockName);
      const result = tail.then(work);
      tail = result.catch(() => {});
      return result;
    },
  };
}
function memory(source: string | null = null) {
  let raw = source;
  const writes: string[] = [];
  return {
    getItem: (key: string) => {
      expect(key).toBe(playerProfileKey);
      return raw;
    },
    setItem: (key: string, value: string) => {
      expect(key).toBe(playerProfileKey);
      raw = value;
      writes.push(value);
    },
    raw: () => raw,
    writes,
  };
}

describe('exact live score evidence without changing state/file hashes', () => {
  it('captures positive four-place pre-clear score with no enumerable field or extra RNG', () => {
    const { score, random } = liveScoring(['d6', 'eternal_d6']);
    expect(score.score).toBe(0);
    expect(score.cleared).toBe(true);
    expect(readLiveScoreBeforeClear(score)).toBeGreaterThan(0);
    expect(Object.keys(score).sort()).toEqual([
      'actions',
      'cleared',
      'multiplier',
      'score',
      'triggers',
    ]);
    expect(readLiveScoreBeforeClear(structuredClone(score))).toBeUndefined();
    expect(random.next).toHaveBeenCalledTimes(2);
  });
  it('does not mistake positive raw float rounding to zero for E01', () => {
    expect(
      readLiveScoreBeforeClear(liveScoring(['eternal_d6'], 1, 2000).score),
    ).toBe(0);
    expect(
      readLiveScoreBeforeClear(liveScoring(['eternal_d6'], null).score),
    ).toBe(0);
  });
  it('captures a positive unrounded total even if the persisted action subtotals round to zero', () => {
    const { score } = liveScoring(
      ['eternal_d6', ...Array<ItemId>(20).fill('moms_heart')],
      1,
      250,
    );
    expect(score.actions[0]!.subtotal).toBe(0);
    expect(readLiveScoreBeforeClear(score)).toBeGreaterThan(0);
    const noClear = liveScoring(
      ['eternal_d6', ...Array<ItemId>(20).fill('moms_heart')],
      1,
      250,
    ).score;
    expect(readLiveScoreBeforeClear(noClear)).toBe(
      readLiveScoreBeforeClear(score),
    );
  });
  it('reads live human state before replay copies, while copied records do not fabricate evidence', () => {
    let session = reduceGameSession(createGameSession(42), {
      type: 'start_game',
      characterId: 'lost',
    });
    session = reduceGameSession(session, {
      type: 'submit_player_turn',
      turn: {
        playerId: 'human',
        actions: [{ type: 'bid', group: 'A', amount: 30 }],
      },
    });
    if (session.game.phase === 'character_selection')
      throw Error('missing live state');
    const record = session.game.roomSettlement!;
    expect(extractAchievementRoomFacts(record)!.scoreBeforeClear).toBeDefined();
    expect(
      extractAchievementRoomFacts(structuredClone(record))!.scoreBeforeClear,
    ).toBeUndefined();
    expect(
      extractAchievementRoomFacts(session.replay!.rooms[0]!.settlement)!
        .scoreBeforeClear,
    ).toBeUndefined();
  });
});

describe('strict compact factual ledger, activation and branches', () => {
  it.each([0, 1, 2, 3, 4, 5, 6])(
    'roundtrips bid outcomes code=%s and all flags without growing the replay protocol',
    (code) => {
      const e = event(14, code, 2 ** 18 - 1, 2, 2, 0.0001);
      expect(decodeAchievementEvent(encodeAchievementEvent(e))).toEqual(e);
    },
  );
  it('activates explicitly and idempotently, retaining legacy/unknown data without granting old achievements', () => {
    const p = createPlayerProfile(now);
    p.progression.achievements.A02 = {
      progress: 100,
      achievedAt: now.toISOString(),
    };
    p.progression.characterUnlocks.lost = {
      unlockedAt: now.toISOString(),
      conditionId: 'old-placeholder',
    };
    p.progression.modules.external = { keep: true };
    const before = canonicalJson(p);
    expect(readAchievementRegistry(readPlayerProfile(p))).toBeNull();
    const active = activateAchievementRegistry(p, now);
    expect(
      activateAchievementRegistry(active, new Date('2026-10-16T00:00:00.000Z')),
    ).toBe(active);
    expect(projectAchievementRegistry(active)!.characterUnlocks).toHaveProperty(
      'isaac',
    );
    expect(
      projectAchievementRegistry(active)!.characterUnlocks,
    ).not.toHaveProperty('lost');
    expect(projectAchievementRegistry(active)!.achievedAt).toEqual({});
    expect(active.progression.achievements).toEqual(p.progression.achievements);
    expect(active.progression.characterUnlocks).toEqual(
      p.progression.characterUnlocks,
    );
    expect(active.progression.modules.external).toEqual({ keep: true });
    expect(canonicalJson(p)).toBe(before);
  });
  it.each(['historical', 'read-only', 'tutorial'] as const)(
    'does not initialize or issue rewards from %s',
    (source) => {
      const p = createPlayerProfile(now);
      expect(appendAchievementEvent(p, { ...submission(), source }, now)).toBe(
        p,
      );
    },
  );
  it('deduplicates unchanged full-authority units, rejects conflicting metrics and does not mutate input', () => {
    const p = createPlayerProfile(now),
      before = canonicalJson(p);
    const next = append(p, '0');
    expect(projectAchievementRegistry(next)!.counters.failedBids).toBe(1);
    expect(projectAchievementRegistry(next)!.achievedAt.A01).toBe(
      now.toISOString(),
    );
    expect(append(next, '0')).toBe(next);
    expect(() => append(next, '0', event(0, 2))).toThrow('证据发生冲突');
    expect(canonicalJson(p)).toBe(before);
  });
  it('keeps shared prefixes once and uses parent branch streaks, rather than all lifetime failures as streak', () => {
    let p = createPlayerProfile(now);
    for (let i = 0; i < 4; i++)
      p = append(p, String(i), event(i), i ? last(p) : null);
    const parent = last(p),
      shared = p;
    p = append(p, 'mixed', event(4, 4), parent);
    expect(projectAchievementRegistry(p)!.achievedAt.A03).toBeUndefined();
    p = append(p, 'branch-failure', event(4), parent);
    expect(projectAchievementRegistry(p)!.achievedAt.A03).toBeDefined();
    expect(projectAchievementRegistry(p)!.counters.failedBids).toBe(6);
    expect(append(p, '0')).toBe(p);
    expect(readAchievementRegistry(shared)!.receipts).toHaveLength(4);
  });
  it('shares cumulative progress across formal modes but resets single-match state at a new root', () => {
    let p = createPlayerProfile(now);
    for (let i = 0; i < 10; i++)
      p = appendAchievementEvent(
        p,
        {
          ...submission(String(i), event()),
          root: sha256Hex(`synthetic-different-root-${i}`),
          mode: i % 2 ? 'classic' : 'survival',
        },
        now,
      );
    const view = projectAchievementRegistry(p)!;
    expect(view.counters.failedBids).toBe(10);
    expect(view.achievedAt.A02).toBeDefined();
    expect(view.achievedAt.A03).toBeUndefined();
    expect(view.characterUnlocks).not.toHaveProperty('lost');
  });
  it('requires exact E01 evidence, persists it losslessly and allows C07 in the same room', () => {
    const p = createPlayerProfile(now);
    expect(() => append(p, 'missing', event(0, 2, 2 ** 9, 0, 0, null))).toThrow(
      '模块',
    );
    const zero = append(p, 'zero', event(0, 2, 2 ** 9 + 2 ** 10, 0, 0, 0));
    expect(projectAchievementRegistry(zero)!.achievedAt).toHaveProperty('C07');
    expect(projectAchievementRegistry(zero)!.achievedAt).not.toHaveProperty(
      'E01',
    );
    const positive = append(p, 'positive', event(0, 2, 2 ** 9, 0, 0, 0.0001));
    expect(readAchievementRegistry(positive)!.receipts[0]!.values[4]).toBe(
      0.0001,
    );
    expect(projectAchievementRegistry(positive)!.achievedAt.E01).toBeDefined();
  });
  it('makes all-in/entry/hidden/BOSS events permanent without requiring a final match', () => {
    let p = append(
      createPlayerProfile(now),
      'room',
      event(0, 2, 2 ** 14 + 2 ** 16, 1, 2),
    );
    p = append(
      p,
      'entry',
      {
        stage: 'entry',
        facts: {
          floorIndex: 0,
          roomIndex: 1,
          stolenMoney: 1,
          interestMoney: 1000,
        },
      },
      last(p),
    );
    const v = projectAchievementRegistry(p)!;
    expect(v.counters).toEqual({
      failedBids: 0,
      highestAwards: 1,
      interestMoney: 1000,
      hiddenCopies: 2,
    });
    for (const id of ['D01', 'D03', 'D06', 'E03'])
      expect(v.achievedAt).toHaveProperty(id);
  });
  it('keeps first unlock timestamps and manual authorization independent of achievements and receipts', () => {
    const p = append(createPlayerProfile(now), 'options', event(0, 2, 2 ** 15));
    const before = projectAchievementRegistry(p)!;
    const next = manuallyUnlockAchievementCharacters(
      p,
      new Date('2026-10-16T00:00:00.000Z'),
    );
    const after = projectAchievementRegistry(next)!;
    expect(after.achievedAt).toEqual(before.achievedAt);
    expect(after.counters).toEqual(before.counters);
    expect(readAchievementRegistry(next)!.receipts).toEqual(
      readAchievementRegistry(p)!.receipts,
    );
    expect(Object.keys(after.characterUnlocks)).toHaveLength(5);
    expect(after.characterUnlocks.jacob_esau).toEqual(
      before.characterUnlocks.jacob_esau,
    );
    expect(manuallyUnlockAchievementCharacters(next, now)).toBe(next);
  });
  it('rejects malformed/unknown modules, fields, flags, parents, order and duplicate receipts without empty migration', () => {
    const p = append(createPlayerProfile(now), '0');
    const mutate = (fn: (r: AchievementRegistry) => void) => {
      const clone = structuredClone(p),
        r = readAchievementRegistry(clone)!;
      fn(r);
      clone.progression.modules[achievementRegistryModule] = r as never;
      expect(() => readPlayerProfile(clone)).toThrow();
      expect(() => activateAchievementRegistry(clone, now)).toThrow();
    };
    mutate((r) => {
      (r as unknown as { version: number }).version = 2;
    });
    mutate((r) => {
      (r as unknown as Record<string, unknown>).extra = true;
    });
    mutate((r) => {
      r.receipts[0]!.values[1] = 2 ** 18;
    });
    mutate((r) => {
      r.receipts.push(structuredClone(r.receipts[0]!));
    });
    mutate((r) => {
      r.receipts[0]!.at = 'invalid';
    });
    expect(() => append(p, 'backwards', event(0), last(p))).toThrow();
    expect(() =>
      append(p, 'parent', event(1), sha256Hex('missing-parent')),
    ).toThrow();
    expect(() =>
      appendAchievementEvent(
        p,
        {
          ...submission('foreign', event(1), last(p)),
          root: sha256Hex('other-root'),
        },
        now,
      ),
    ).toThrow();
    expect(() =>
      append(p, 'floor', {
        stage: 'floor',
        facts: {
          floorIndex: 0,
          humanParticipated: true,
          humanSurvived: true,
          humanEliminated: false,
          lowestSurvivor: true,
        },
      }),
    ).toThrow();
  });
  it('keeps legacy validation bounds and migrates independent roots without eviction', () => {
    const p = append(createPlayerProfile(now), '0'),
      base = readAchievementRegistry(p)!;
    const template = base.receipts[0]!;
    const r: AchievementRegistry = {
      ...base,
      receipts: Array.from({ length: achievementReceiptLimit }, (_, i) => {
        const row = {
          ...template,
          root: sha256Hex(`synthetic-capacity-${i}`),
          authorityHash: sha256Hex(`synthetic-authority-${i}`),
        };
        row.key = sha256Hex(
          canonicalJson([
            row.mode,
            row.root,
            row.parent,
            row.authorityHash,
            row.stage,
            row.position,
          ]),
        );
        return row;
      }),
    };
    const scanStarted = performance.now();
    expect(validateAchievementRegistry(r).receipts).toHaveLength(
      achievementReceiptLimit,
    );
    const scanMs = performance.now() - scanStarted;
    const bounded = {
      ...p,
      progression: {
        ...p.progression,
        modules: {
          ...p.progression.modules,
          [achievementRegistryModule]: r as never,
        },
      },
    };
    const before = canonicalJson(bounded);
    expect(
      readAchievementRegistry(append(bounded, 'over-limit'))!.receipts,
    ).toHaveLength(achievementReceiptLimit + 1);
    expect(() =>
      validateAchievementRegistry({ ...r, receipts: [...r.receipts, {}] }),
    ).toThrow('容量');
    expect(canonicalJson(bounded)).toBe(before);
    expect(new TextEncoder().encode(before).length).toBeLessThan(1024 * 1024);
    const directory = new URL(
      '../../../work/v050-achievements-p0-2/',
      import.meta.url,
    );
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      new URL('capacity.json', directory),
      JSON.stringify(
        {
          provenance:
            'Synthetic independent receipt roots; NOT 2048 played matches or a worst-case full profile',
          receipts: r.receipts.length,
          moduleBytes: new TextEncoder().encode(canonicalJson(r)).length,
          profileBytes: new TextEncoder().encode(before).length,
          scanMs,
          historyRows: bounded.history.length,
          originalCompletionModulePresent: false,
        },
        null,
        2,
      ),
    );
  }, 20000);
});

describe('coordinated single-key profile writes and existing backup boundaries', () => {
  it('does not commit a late candidate after cancellation while waiting for a write slot', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locks: AchievementWriteCoordinator = {
      exclusive: async (_name, work) => {
        await gate;
        return work();
      },
    };
    const s = memory(),
      abort = new AbortController();
    const pending = persistAchievementProfile(
      s,
      (p) => append(p, 'cancelled'),
      locks,
      abort.signal,
    );
    abort.abort();
    release();
    await expect(pending).rejects.toThrow('取消');
    expect(s.raw()).toBeNull();
    expect(s.writes).toEqual([]);
  });
  it('reads the current profile at commit time and preserves unrelated data changed before the slot opens', async () => {
    const old = createPlayerProfile(now),
      newer = append(old, 'other');
    newer.progression.modules.external = { value: 'preserve' };
    const s = memory(JSON.stringify(old));
    const locks: AchievementWriteCoordinator = {
      exclusive: async (_name, work) => {
        s.setItem(playerProfileKey, JSON.stringify(newer));
        return work();
      },
    };
    await persistAchievementProfile(s, (p) => append(p, 'new'), locks);
    const profile = readPlayerProfile(JSON.parse(s.raw()!));
    expect(projectAchievementRegistry(profile)!.counters.failedBids).toBe(2);
    expect(profile.progression.modules.external).toEqual({ value: 'preserve' });
  });
  it('serializes two writers, commits the whole module once per event and treats repeats as no-write', async () => {
    const s = memory(),
      locks = serialCoordinator();
    await Promise.all(
      ['first', 'second'].map((id) =>
        persistAchievementProfile(s, (p) => append(p, id), locks),
      ),
    );
    expect(
      projectAchievementRegistry(readPlayerProfile(JSON.parse(s.raw()!)))!
        .counters.failedBids,
    ).toBe(2);
    expect(s.writes).toHaveLength(2);
    const repeat = await persistAchievementProfile(
      s,
      (p) => append(p, 'first'),
      locks,
    );
    expect(repeat.changed).toBe(false);
    expect(s.writes).toHaveLength(2);
  });
  it('does not write or activate on unavailable coordination, quota failure or corrupt source; retry counts once', async () => {
    const s = memory(),
      locks = serialCoordinator();
    await expect(
      persistAchievementProfile(s, (p) => append(p, '0'), null),
    ).rejects.toThrow('协调');
    await expect(
      persistAchievementProfile(
        {
          ...s,
          setItem: () => {
            throw Error('quota');
          },
        },
        (p) => append(p, '0'),
        locks,
      ),
    ).rejects.toThrow('quota');
    expect(s.raw()).toBeNull();
    expect(s.writes).toHaveLength(0);
    await persistAchievementProfile(s, (p) => append(p, '0'), locks);
    await persistAchievementProfile(s, (p) => append(p, '0'), locks);
    expect(s.writes).toHaveLength(1);
    const corrupt = memory('corrupt');
    await expect(
      persistAchievementProfile(corrupt, (p) => append(p, '0'), locks),
    ).rejects.toThrow();
    expect(corrupt.raw()).toBe('corrupt');
    expect(corrupt.writes).toHaveLength(0);
  });
  it('roundtrips raw/compressed independent profiles including exact evidence, and explicitly restores earlier snapshots', async () => {
    const prior = activateAchievementRegistry(createPlayerProfile(now), now);
    const earned = manuallyUnlockAchievementCharacters(
      append(prior, 'E01', event(0, 2, 2 ** 9, 0, 0, 0.0001)),
      now,
    );
    const source = serializePlayerProfileBackup(
      earned,
      'growth-roundtrip',
      now,
    );
    const packed = await packDataFile(source);
    const restored = parsePlayerProfileBackup(
      (await unpackDataFile(packed.source)).source,
    ).profile;
    expect(restored).toEqual(earned);
    expect(projectAchievementRegistry(restored)).toEqual(
      projectAchievementRegistry(earned),
    );
    expect(append(restored, 'E01', event(0, 2, 2 ** 9, 0, 0, 0.0001))).toBe(
      restored,
    );
    const s = memory(JSON.stringify(earned));
    restorePlayerProfileBackup(s, prior, s.raw());
    expect(
      projectAchievementRegistry(readPlayerProfile(JSON.parse(s.raw()!)))!
        .achievedAt,
    ).toEqual({});
    expect(
      Object.keys(
        projectAchievementRegistry(readPlayerProfile(JSON.parse(s.raw()!)))!
          .characterUnlocks,
      ),
    ).toEqual(['isaac']);
    const old = createPlayerProfile(now);
    restorePlayerProfileBackup(s, old, s.raw());
    expect(
      readAchievementRegistry(readPlayerProfile(JSON.parse(s.raw()!))),
    ).toBeNull();
  });
  it('retains the ledger in a paired classic v5 backup without running progression while parsing', () => {
    const profile = append(
      createPlayerProfile(now),
      'positive',
      event(0, 2, 2 ** 9, 0, 0, 0.0001),
    );
    const source = serializeGameBackup(
      classicCompletionFixture(),
      profile,
      now,
    );
    const before = canonicalJson(profile);
    const restored = parseGameSave(source);
    expect(restored.version).toBe(5);
    expect(restored.profile).toEqual(profile);
    expect(canonicalJson(profile)).toBe(before);
    expect(projectAchievementRegistry(restored.profile!)!.achievedAt).toEqual(
      projectAchievementRegistry(profile)!.achievedAt,
    );
  });
  it('continues surviving same-match state across ledger roundtrip, but historical layers never supply F05 evidence', () => {
    const f0: AchievementEvent = {
      stage: 'floor',
      facts: {
        floorIndex: 0,
        humanParticipated: true,
        humanSurvived: false,
        humanEliminated: true,
        lowestSurvivor: false,
      },
    };
    const terminal: AchievementEvent = {
      stage: 'final',
      facts: {
        humanSurvived: false,
        highestDifficulty: false,
        lastEliminationFloor: 0,
        humanEliminationFloor: 0,
      },
    };
    let profile = append(
      createPlayerProfile(now),
      'floor',
      f0,
      null,
      'survival',
    );
    profile = parsePlayerProfileBackup(
      serializePlayerProfileBackup(profile, 'floor-growth', now),
    ).profile;
    profile = append(profile, 'terminal', terminal, last(profile), 'survival');
    expect(projectAchievementRegistry(profile)!.achievedAt).toHaveProperty(
      'F01',
    );
    expect(projectAchievementRegistry(profile)!.achievedAt).toHaveProperty(
      'F05',
    );
    const old = appendAchievementEvent(
      createPlayerProfile(now),
      { ...submission('old', f0, null, 'survival'), source: 'historical' },
      now,
    );
    const newTerminal = append(
      old,
      'only-terminal',
      terminal,
      null,
      'survival',
    );
    expect(
      projectAchievementRegistry(newTerminal)!.achievedAt,
    ).not.toHaveProperty('F05');
  });
});
