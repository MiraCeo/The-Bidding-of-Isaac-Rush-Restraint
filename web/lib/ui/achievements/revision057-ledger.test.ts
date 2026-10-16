import { describe, it, expect } from 'vitest';
import { createPlayerProfile, type PlayerProfile } from '../player-profile';
import {
  appendAchievementEvent,
  projectAchievementRegistry,
  readAchievementRegistry,
  manuallyUnlockAchievementCharacters,
  validateAchievementRegistry,
} from './registry';
import {
  decodeAchievementEvent,
  encodeAchievementEvent,
  type EncodedAchievementEvent,
} from './event-codec';
import { sha256Hex } from '../../shared/sha256';
import {
  beginClassicGrowth,
  beginSurvivalGrowth,
  applyGrowthContext,
} from './lifecycle';
import { createGameSession, reduceGameSession } from '../game-session';
import { parseGameSave, serializeGameCheckpoint } from '../game-save';
import { startSurvivalClient, reduceSurvivalClient } from '../survival-client';
import {
  parseSurvivalCheckpoint,
  serializeSurvivalCheckpoint,
} from '../survival-persistence';
import { longRunAction } from '../survival-long-run';
import { packAchievementRegistry } from './ledger-codec';

const oldAt = new Date('2026-10-15T00:00:00.000Z'),
  now = new Date('2026-10-16T02:00:00.000Z');
let serial = 0;
function append(
  p: PlayerProfile,
  e: EncodedAchievementEvent,
  o: {
    root?: string;
    parent?: string | null;
    mode?: 'classic' | 'survival';
    at?: Date;
    authority?: string;
  } = {},
) {
  return appendAchievementEvent(
    p,
    {
      source: 'live',
      mode: o.mode ?? 'classic',
      root: sha256Hex(o.root ?? 'root' + serial),
      parent: o.parent ?? null,
      authorityHash: sha256Hex(o.authority ?? 'authority' + serial++),
      event: decodeAchievementEvent(e),
    },
    o.at ?? now,
  );
}
const last = (p: PlayerProfile) =>
  readAchievementRegistry(p)!.receipts.at(-1)!.key;
const start: EncodedAchievementEvent = {
  stage: 'entry',
  position: 0,
  values: [0, 0, 1, 1],
};
function room(
  position = 0,
  options: {
    code?: number;
    mask?: number;
    highest?: number;
    miss?: number;
    milestone?: number;
    counts?: number[];
    flags?: number;
    score?: number | null;
    old?: boolean;
  } = {},
): EncodedAchievementEvent {
  const {
    code = 1,
    mask = 0,
    highest = 0,
    miss = 0,
    milestone = 0,
    counts = [0, 0, 0, 0, 0],
    flags = 0,
    score = null,
    old = false,
  } = options;
  return {
    stage: 'room',
    position,
    values: [
      code,
      mask,
      highest,
      0,
      score,
      miss,
      milestone,
      0,
      ...(old ? [] : [...counts, flags]),
    ],
  };
}
const complete = (
  rank: number,
  mode: 'classic' | 'survival' = 'classic',
  character = 0,
): EncodedAchievementEvent => ({
  stage: 'complete',
  position: mode === 'classic' ? 0 : 1,
  values: [character, Number(rank === 1), 1, rank],
});
describe('catalog4 verified totals and retirement', () => {
  it('inherits true failed-bid counts and same-run peaks, preserves old middle-stage time and confirms new stages only on a novel fact', () => {
    let p = createPlayerProfile(oldAt);
    for (let i = 0; i < 10; i++)
      p = append(
        p,
        { stage: 'room', position: i, values: [1, 0, 0, 0, null] },
        { root: 'old-run', parent: i ? last(p) : null, at: oldAt },
      );
    const before = JSON.stringify(p),
      view = projectAchievementRegistry(p)!;
    expect(view.progress.A06).toBe(10);
    expect(view.achievedAt.A06).toBeUndefined();
    expect(view.achievedAt.A07).toBeUndefined();
    expect(view.achievedAt.A03).toBe(oldAt.toISOString());
    expect(view.progress.A10).toBe(0);
    expect(view.achievedAt.A02).toBeUndefined();
    expect(view.legacyAchievements.A02).toBe(oldAt.toISOString());
    expect(JSON.stringify(p)).toBe(before);
    p = append(p, start);
    const after = projectAchievementRegistry(p)!;
    expect(after.achievedAt.A06).toBe(now.toISOString());
    expect(after.achievedAt.A07).toBe(now.toISOString());
    expect(after.achievedAt.A03).toBe(oldAt.toISOString());
    expect(
      (p.progression.modules.achievementRegistryV1 as { version: number })
        .version,
    ).toBe(5);
  });
  it('does not reinterpret old cooperation or near-miss booleans as group multiplicities', () => {
    let p = createPlayerProfile(oldAt);
    for (let i = 0; i < 20; i++)
      p = append(
        p,
        { stage: 'room', position: 0, values: [2, 1, 0, 0, null, 0] },
        { at: oldAt },
      );
    for (let i = 0; i < 20; i++)
      p = append(
        p,
        { stage: 'room', position: 0, values: [1, 0, 0, 0, null, 3] },
        { at: oldAt },
      );
    expect(projectAchievementRegistry(p)!.achievedAt.B01).toBe(
      oldAt.toISOString(),
    );
    expect(projectAchievementRegistry(p)!.progress.B01).toBe(0);
    p = append(p, start);
    expect(projectAchievementRegistry(p)!.progress.B14).toBe(0);
    expect(projectAchievementRegistry(p)!.achievedAt.B14).toBeUndefined();
    expect(projectAchievementRegistry(p)!.progress.B18).toBe(0);
  });
  it('counts two distinct missed groups in one authority unit once, and rejects conflicting duplicate causes', () => {
    let p = createPlayerProfile();
    const e = room(0, { code: 3, miss: 3, counts: [0, 2, 2, 0, 0] });
    p = append(p, e, { root: 'dual', authority: 'same' });
    expect(projectAchievementRegistry(p)!.progress.B18).toBe(2);
    expect(projectAchievementRegistry(p)!.progress.B20).toBe(2);
    expect(append(p, e, { root: 'dual', authority: 'same' })).toBe(p);
    expect(() =>
      append(p, room(0, { code: 3, miss: 3, counts: [0, 1, 2, 0, 0] }), {
        root: 'dual',
        authority: 'same',
      }),
    ).toThrow('冲突');
    for (let i = 0; i < 2; i++) p = append(p, e);
    expect(projectAchievementRegistry(p)!.progress.B18).toBe(6);
    expect(projectAchievementRegistry(p)!.achievedAt.B18).toBe(
      now.toISOString(),
    );
  });
  it('inherits precise stolen amounts and full-bid award counts rather than a first-effect boolean', () => {
    let p = append(
      createPlayerProfile(oldAt),
      { stage: 'entry', position: 0, values: [5100, 0] },
      { at: oldAt },
    );
    for (let i = 0; i < 10; i++)
      p = append(
        p,
        room(0, {
          code: 2,
          mask: 2 ** 14,
          highest: 1,
          milestone: 16,
          old: true,
        }),
        { at: oldAt },
      );
    const old = projectAchievementRegistry(p)!;
    expect(old.progress.D16).toBe(5100);
    expect(old.progress.D14).toBe(10);
    expect(old.achievedAt.D16).toBeUndefined();
    p = append(p, start);
    const view = projectAchievementRegistry(p)!;
    expect(view.achievedAt.D16).toBe(now.toISOString());
    expect(view.achievedAt.D14).toBe(now.toISOString());
    expect(view.achievedAt.D09).toBe(oldAt.toISOString());
  });
  it('counts recovery matches once per root including forks, never across matches or before the failure', () => {
    let p = createPlayerProfile(oldAt);
    for (let i = 0; i < 5; i++) {
      const root = 'recovered' + i;
      p = append(p, room(0, { old: true }), { root, at: oldAt });
      const parent = last(p);
      p = append(p, room(1, { code: 2, highest: 1, old: true }), {
        root,
        parent,
        at: oldAt,
      });
      p = append(p, room(2, { code: 2, highest: 1, old: true }), {
        root,
        parent,
        at: oldAt,
      });
    }
    expect(projectAchievementRegistry(p)!.progress.A13).toBe(5);
    expect(projectAchievementRegistry(p)!.achievedAt.A13).toBeUndefined();
    expect(projectAchievementRegistry(p)!.legacyAchievements.A04).toBe(
      oldAt.toISOString(),
    );
    p = append(p, start);
    expect(projectAchievementRegistry(p)!.achievedAt.A13).toBe(
      now.toISOString(),
    );
    const q = append(
      append(createPlayerProfile(), room(0)),
      room(1, { code: 2, highest: 1 }),
    );
    expect(projectAchievementRegistry(q)!.progress.A13).toBe(0);
  });
  it('requires a new formal final rank strictly after fifth, shares modes, and deduplicates the entire match identity', () => {
    let p = createPlayerProfile();
    p = append(p, complete(5), { root: 'top5' });
    expect(projectAchievementRegistry(p)!.progress.A10).toBe(0);
    for (let i = 0; i < 5; i++)
      p = append(p, complete(6, i % 2 ? 'survival' : 'classic'), {
        root: 'loss' + i,
        mode: i % 2 ? 'survival' : 'classic',
      });
    expect(projectAchievementRegistry(p)!.progress.A10).toBe(5);
    expect(projectAchievementRegistry(p)!.achievedAt.A10).toBe(
      now.toISOString(),
    );
    p = append(p, complete(20), { root: 'loss0' });
    expect(projectAchievementRegistry(p)!.progress.A10).toBe(5);
    p = append(p, complete(6), { root: 'top5' });
    expect(projectAchievementRegistry(p)!.progress.A10).toBe(5);
  });
  it('does not add a missing old rank when the old authority unit is retried with new metadata', () => {
    let p = append(
      createPlayerProfile(oldAt),
      { stage: 'complete', position: 0, values: [0, 0] },
      { root: 'old', authority: 'finished', at: oldAt },
    );
    const prior = p;
    p = append(p, complete(6), { root: 'old', authority: 'finished' });
    expect(p).toBe(prior);
    expect(readAchievementRegistry(p)!.revisions).toBeUndefined();
    p = append(p, complete(6), { root: 'old', authority: 'new-branch' });
    expect(projectAchievementRegistry(p)!.progress.A10).toBe(0);
  });
  it('keeps an already unlocked Lost role, but does not give a new profile the retired bid-failure permission', () => {
    let old = createPlayerProfile(oldAt);
    for (let i = 0; i < 10; i++)
      old = append(
        old,
        { stage: 'room', position: 0, values: [1, 2 ** 9, 0, 0, 10] },
        { at: oldAt },
      );
    expect(
      projectAchievementRegistry(old)!.characterUnlocks.lost,
    ).toMatchObject({
      conditionId: 'legacy:E01+A02',
      unlockedAt: oldAt.toISOString(),
    });
    old = append(old, start);
    expect(
      projectAchievementRegistry(old)!.characterUnlocks.lost,
    ).toBeDefined();
    expect(projectAchievementRegistry(old)!.progress.A10).toBe(0);
    let fresh = append(createPlayerProfile(), start);
    for (let i = 0; i < 10; i++)
      fresh = append(fresh, room(0, { mask: 2 ** 9, score: 10 }));
    expect(
      projectAchievementRegistry(fresh)!.characterUnlocks.lost,
    ).toBeUndefined();
    for (let i = 0; i < 5; i++) fresh = append(fresh, complete(6));
    expect(
      projectAchievementRegistry(fresh)!.characterUnlocks.lost,
    ).toMatchObject({ conditionId: 'E01+A10' });
  });
  it('manual authorization does not activate or advance any new achievement', () => {
    const p = manuallyUnlockAchievementCharacters(createPlayerProfile(), now),
      view = projectAchievementRegistry(p)!;
    expect(Object.keys(view.characterUnlocks)).toHaveLength(5);
    expect(view.achievedAt).toEqual({});
    expect(view.progress.A10).toBe(0);
    expect(readAchievementRegistry(p)!.revisions).toBeUndefined();
  });
  it('allows both hidden vacancy achievements on the same fact and records Lost mantle without requiring another unlock', () => {
    const vacant = append(
      createPlayerProfile(),
      room(0, { code: 0, flags: 3 }),
    );
    const p = append(vacant, room(0, { code: 2, highest: 1, flags: 4 })),
      view = projectAchievementRegistry(p)!;
    expect(view.achievedAt.B12).toBe(now.toISOString());
    expect(view.achievedAt.B13).toBe(now.toISOString());
    expect(view.achievedAt.E16).toBe(now.toISOString());
    expect(view.characterUnlocks.lost).toBeUndefined();
  });
  it('strictly validates new cause bounds, milestone prefixes, final ranks and v5 activation metadata', () => {
    for (const e of [
      room(0, { flags: 2 }),
      room(0, { counts: [3, 0, 0, 0, 0] }),
      room(0, { counts: [1, 0, 0, 0, 0] }),
      complete(0),
      complete(21),
    ])
      expect(() => decodeAchievementEvent(e)).toThrow();
    let p = append(createPlayerProfile(), start);
    p = append(p, room(0, { flags: 3 }));
    const wire = p.progression.modules.achievementRegistryV1;
    expect(wire).toMatchObject({
      version: 5,
      catalogVersion: 4,
      revisions: { from: 0, at: now.toISOString() },
    });
    for (const tweak of [
      (w: Record<string, unknown>) => (w.version = 4),
      (w: Record<string, unknown>) =>
        (w.revisions = { from: 1, at: oldAt.toISOString() }),
      (w: Record<string, unknown>) =>
        (w.revisions = { from: 999, at: now.toISOString() }),
    ]) {
      const w = structuredClone(wire) as Record<string, unknown>;
      tweak(w);
      expect(() => validateAchievementRegistry(w)).toThrow();
    }
    const normalized = readAchievementRegistry(p)!;
    expect(
      validateAchievementRegistry(packAchievementRegistry(normalized)),
    ).toEqual(normalized);
    for (const r of normalized.receipts)
      expect(encodeAchievementEvent(decodeAchievementEvent(r))).toMatchObject({
        stage: r.stage,
        position: r.position,
        values: r.values,
      });
  });
});

describe('real lifecycle and recovery of revision facts', () => {
  function classic(legacy = false) {
    return beginClassicGrowth(
      reduceGameSession(createGameSession(42), {
        type: 'start_game',
        characterId: 'isaac',
      }),
      -1,
      -1,
      -1,
      legacy ? 34 : -1,
    );
  }
  it('captures v5 stages and restores a fresh classic prefix exactly', () => {
    let s = classic();
    expect(s.growth!.units[0]!.values).toHaveLength(5);
    s = reduceGameSession(s, {
      type: 'submit_player_turn',
      turn: {
        playerId: 'human',
        actions: [{ type: 'bid', group: 'A', amount: 10 }],
      },
    });
    expect(s.growthIssue).toBeUndefined();
    expect(s.growth!.units.at(-1)!.values).toHaveLength(17);
    const loaded = parseGameSave(serializeGameCheckpoint(s)).session;
    expect(loaded.growth).toEqual(s.growth);
  });
  it('does not add revision fields to an old checkpoint, but starts at its next genuinely new authority stage', () => {
    let old = classic(true);
    delete old.growth!.revisionsFrom;
    delete old.growth!.cfFrom;
    const prior = structuredClone(old.growth),
      loaded = parseGameSave(serializeGameCheckpoint(old)).session;
    expect(loaded.growth).toEqual(prior);
    expect(loaded.growth!.revisionsFrom).toBeUndefined();
    old = reduceGameSession(loaded, {
      type: 'submit_player_turn',
      turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
    });
    expect(old.growthIssue).toBeUndefined();
    expect(old.growth!.revisionsFrom).toBe(0);
    expect(old.growth!.units[0]!.values).toHaveLength(3);
    expect(old.growth!.units[1]!.values).toHaveLength(17);
  });
  it('records the actual classic terminal ranking and never counts an imported pending prefix twice', () => {
    let s = classic();
    for (let i = 0; i < 15; i++) {
      s = reduceGameSession(s, {
        type: 'submit_player_turn',
        turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
      });
      s = reduceGameSession(s, { type: 'advance_room' });
    }
    expect(s.growthIssue).toBeUndefined();
    const c = decodeAchievementEvent(s.growth!.units.at(-1)!);
    expect(c.stage).toBe('complete');
    if (c.stage !== 'complete') throw Error('Missing complete');
    if (s.game.phase !== 'game_result') throw Error('Missing terminal');
    expect(c.facts.finalRank).toBe(
      s.game.finalRanking.findIndex((r) => r.playerId === 'human') + 1,
    );
    const result = applyGrowthContext(createPlayerProfile(), s.growth!, now);
    expect(projectAchievementRegistry(result.profile)!.progress.A10).toBe(
      Number(c.facts.finalRank! > 5),
    );
    expect(applyGrowthContext(result.profile, s.growth!, now).profile).toBe(
      result.profile,
    );
  });
  it('captures the official survival rank only after full completion, including eliminated humans, and restores all new stage shapes', () => {
    let s = beginSurvivalGrowth(startSurvivalClient('isaac', 42, 'standard'));
    expect(
      parseSurvivalCheckpoint(
        serializeSurvivalCheckpoint(s.game, s.draft, now, s.growth),
      ).growth,
    ).toEqual(s.growth);
    let commands = 0;
    while (s.game.phase !== 'competition_complete') {
      if (++commands > 80) throw Error('Loop bound');
      s = reduceSurvivalClient(s, longRunAction(s.game));
      if (s.growthIssue) throw Error(s.growthIssue);
    }
    const c = decodeAchievementEvent(s.growth!.units.at(-1)!);
    expect(c.stage).toBe('complete');
    if (c.stage !== 'complete') throw Error('Missing complete');
    expect(c.facts.finalRank).toBe(
      s.game.finalRanking.find((r) => r.playerId === 'human')!.rank,
    );
    expect(
      parseSurvivalCheckpoint(
        serializeSurvivalCheckpoint(s.game, s.draft, now, s.growth),
      ).growth,
    ).toEqual(s.growth);
  });
});
