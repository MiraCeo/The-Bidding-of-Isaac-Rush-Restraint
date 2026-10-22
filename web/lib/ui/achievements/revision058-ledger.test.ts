import { describe, it, expect } from 'vitest';
import { createPlayerProfile } from '../player-profile';
import {
  projectAchievementRegistry as view,
  readAchievementRegistry,
  validateAchievementRegistry,
  manuallyUnlockAchievementCharacters,
} from './registry';
import {
  encodeAchievementEvent,
  decodeAchievementEvent,
  sameAchievementEventFacts,
  type EncodedAchievementEvent,
} from './event-codec';
import { packAchievementRegistry } from './ledger-codec';
import {
  appendCf as append,
  cfRoom as room,
  cfEntry as entry,
  cfFloor as floor,
  cfLast as last,
  cfNow as now,
} from './revision058.test-helper';
import {
  beginClassicGrowth,
  beginSurvivalGrowth,
  applyGrowthContext,
  validateGrowthContext,
} from './lifecycle';
import { createGameSession, reduceGameSession } from '../game-session';
import { parseGameSave, serializeGameCheckpoint } from '../game-save';
import { startSurvivalClient, reduceSurvivalClient } from '../survival-client';
import { longRunAction } from '../survival-long-run';
import {
  parseSurvivalCheckpoint,
  serializeSurvivalCheckpoint,
} from '../survival-persistence';

describe('C-F real counters and current thresholds', () => {
  it.each([
    {
      ids: ['C02', 'C12', 'C13'],
      targets: [1, 10, 20],
      event: () => room(0, { code: 1, mask: 16, counts: [0, 1, 0] }),
      step: 1,
    },
    {
      ids: ['D04', 'D17', 'D18'],
      targets: [1, 10, 30],
      event: () => room(0, { mask: 4096 }),
      step: 1,
    },
    {
      ids: ['D05', 'D19', 'D20'],
      targets: [1, 5, 10],
      event: () => room(0, { code: 2, mask: 8192, counts: [0, 0, 1] }),
      step: 1,
    },
    {
      ids: ['D10', 'D21', 'D22'],
      targets: [100, 1000, 5000],
      event: () => room(0, { code: 2, mask: 2048, savings: 100 }),
      step: 100,
    },
    {
      ids: ['E05', 'E17', 'E18'],
      targets: [3, 10, 30],
      event: () => room(0, { copies: 1 }),
      step: 1,
    },
    {
      ids: ['E15', 'E19', 'E20'],
      targets: [1, 5, 10],
      event: () => room(0, { code: 5, flags: 32 }),
      step: 1,
    },
  ] as const)(
    'keeps all three thresholds exact for $ids',
    ({ ids, targets, event, step }) => {
      let p = createPlayerProfile(now);
      for (let value = step; value <= targets[2]; value += step) {
        p = append(p, event());
        const state = view(p)!;
        ids.forEach((id, i) => {
          expect(state.progress[id]).toBe(value);
          expect(!!state.achievedAt[id]).toBe(value >= targets[i]!);
        });
      }
    },
  );
  it('counts A-B groups and refunded actions separately while every authority unit is booked once', () => {
    let p = createPlayerProfile(now);
    const twoVacancies = room(0, { mask: 8, counts: [2, 0, 0] });
    p = append(p, twoVacancies, { root: 'vacant', authority: 'vacant' });
    expect(view(p)!.progress.C01).toBe(2);
    expect(
      append(p, twoVacancies, { root: 'vacant', authority: 'vacant' }),
    ).toBe(p);
    expect(() =>
      append(p, room(0, { mask: 8, counts: [1, 0, 0] }), {
        root: 'vacant',
        authority: 'vacant',
      }),
    ).toThrow(/冲突/);
    p = append(p, room(0, { code: 3, mask: 16, counts: [0, 2, 0] }));
    p = append(p, room(0, { code: 6, mask: 8192, counts: [0, 0, 2] }));
    expect(view(p)!.progress.C02).toBe(2);
    expect(view(p)!.progress.D05).toBe(2);
    for (let i = 0; i < 9; i++)
      p = append(p, room(0, { mask: 8, counts: [2, 0, 0] }));
    expect(view(p)!.progress.C11).toBe(20);
    expect(view(p)!.achievedAt.C11).toBe(now.toISOString());
  });
  it('requires six doubled rooms for bronze and eighteen/sixty-six for silver/gold, not score or event copies', () => {
    let p = createPlayerProfile(now);
    for (let i = 1; i <= 66; i++) {
      p = append(p, room(0, { mask: 256 }));
      const v = view(p)!;
      expect(v.progress.C06).toBe(i);
      expect(!!v.achievedAt.C06).toBe(i >= 6);
      expect(!!v.achievedAt.C14).toBe(i >= 18);
      expect(!!v.achievedAt.C15).toBe(i >= 66);
    }
  });
  it('counts poor-charm/asymmetric rooms, true Steam amounts and hidden reward copies using their own units', () => {
    let p = createPlayerProfile(now);
    for (let i = 0; i < 10; i++)
      p = append(
        p,
        room(0, {
          code: 6,
          mask: 4096 + 2048,
          flags: 32,
          savings: 100,
          copies: 3,
        }),
      );
    const v = view(p)!;
    expect(v.progress.D04).toBe(10);
    expect(v.progress.E15).toBe(10);
    expect(v.progress.D10).toBe(1000);
    expect(v.progress.E05).toBe(30);
    for (const id of ['D17', 'D21', 'E20', 'E18'] as const)
      expect(v.achievedAt[id]).toBe(now.toISOString());
    expect(v.characterUnlocks.eden).toBeDefined();
    expect(v.achievedAt.D22).toBeUndefined();
  });
  it('requires two different rooms on the same branch for redeemed-and-delivered rewards', () => {
    const redeemed = (pos: number) => room(pos, { mask: 32, flags: 4 });
    let p = append(createPlayerProfile(now), redeemed(0), { root: 'r' });
    const parent = last(p);
    expect(view(p)!.progress.C08).toBe(1);
    expect(view(p)!.achievedAt.C08).toBeUndefined();
    // A different root and a sibling with the same parent do not contribute to r's run.
    p = append(p, redeemed(1), { root: 'other' });
    expect(view(p)!.progress.C08).toBe(1);
    p = append(p, room(1, { mask: 32 }), { root: 'r', parent });
    const noDelivery = last(p);
    expect(view(p)!.progress.C08).toBe(1);
    p = append(p, redeemed(2), { root: 'r', parent: noDelivery });
    expect(view(p)!.progress.C08).toBe(2);
    expect(view(p)!.achievedAt.C08).toBe(now.toISOString());
    let split = append(createPlayerProfile(now), room(0), { root: 'fork' });
    const fork = last(split);
    split = append(split, redeemed(1), { root: 'fork', parent: fork });
    split = append(split, redeemed(2), { root: 'fork', parent: fork });
    expect(view(split)!.progress.C08).toBe(1);
  });
  it('counts lowest-survivor layers across matches, but first-floor prefixes only along a complete same-match chain', () => {
    let p = createPlayerProfile(now);
    for (let i = 0; i < 5; i++)
      p = append(
        p,
        { ...floor(i, 11), values: [...floor(i, 11).values, 2] },
        {
          mode: 'survival',
          root: 'five',
          parent: i ? last(p) : null,
        },
      );
    expect(view(p)!.progress.F03).toBe(5);
    expect(view(p)!.progress.F04).toBe(5);
    for (const id of ['F13', 'F15', 'F04', 'F16'] as const)
      expect(view(p)!.achievedAt[id]).toBeDefined();
    let missing = append(createPlayerProfile(now), floor(1, 11), {
      mode: 'survival',
      root: 'middle',
    });
    missing = append(missing, floor(2, 11), {
      mode: 'survival',
      root: 'middle',
      parent: last(missing),
    });
    expect(view(missing)!.progress.F03).toBe(2);
    expect(view(missing)!.progress.F04).toBe(0);
    let split = append(createPlayerProfile(now), floor(0), {
      mode: 'survival',
      root: 'split',
    });
    const parent = last(split);
    split = append(split, floor(1), {
      mode: 'survival',
      root: 'split',
      parent,
    });
    split = append(split, floor(2), {
      mode: 'survival',
      root: 'split',
      parent,
    });
    expect(view(split)!.progress.F04).toBe(2);
    expect(view(split)!.achievedAt.F04).toBeUndefined();
    let early = append(createPlayerProfile(now), floor(0), {
      mode: 'survival',
      root: 'early',
    });
    early = append(
      early,
      { stage: 'final', position: 0, values: [1, 0, null, 1, 1, 1] },
      { mode: 'survival', root: 'early', parent: last(early) },
    );
    expect(view(early)!.progress.F04).toBe(1);
    expect(view(early)!.achievedAt.F16).toBeUndefined();
  });
  it('retains reliable factual inheritance without treating old group booleans as exact counts or auto-cleaning data', () => {
    let p = createPlayerProfile(now);
    for (let i = 0; i < 6; i++)
      p = append(p, room(0, { old: true, mask: 256 + 8 }));
    const before = JSON.stringify(p);
    expect(view(p)!.progress.C06).toBe(6);
    expect(view(p)!.progress.C01).toBe(0);
    expect(view(p)!.achievedAt.C06).toBeUndefined();
    expect(JSON.stringify(p)).toBe(before);
    expect(
      (p.progression.modules.achievementRegistryV1 as { version: number })
        .version,
    ).toBe(5);
    p = append(p, entry);
    expect(view(p)!.achievedAt.C06).toBeDefined();
    const original = readAchievementRegistry(p)!;
    expect(original.receipts).toHaveLength(7);
    expect(
      validateAchievementRegistry(packAchievementRegistry(original)),
    ).toEqual(original);
    p = append(p, room(0, { mask: 256 }));
    expect(view(p)!.progress.C06).toBe(7);
    expect(readAchievementRegistry(p)!.receipts.slice(0, 7)).toEqual(
      original.receipts,
    );
  });
  it('preserves unchanged E05 permission and does not infer new C08 completion from its old once-only grant', () => {
    let p = append(
      createPlayerProfile(now),
      room(0, { copies: 3, mask: 32, flags: 4, old: true }),
    );
    expect(view(p)!.characterUnlocks.eden).toBeDefined();
    expect(view(p)!.progress.C08).toBe(1);
    expect(view(p)!.achievedAt.C08).toBeUndefined();
    p = append(p, entry);
    expect(view(p)!.characterUnlocks.eden).toBeDefined();
    expect(view(p)!.achievedAt.C08).toBeUndefined();
  });
  it('does not activate new catalog, clean records or grant badges on manual authorization or read-only sources', () => {
    const p = createPlayerProfile(now),
      e = room(0, { mask: 256 });
    for (const source of ['read-only', 'historical', 'tutorial'] as const)
      expect(append(p, e, { source })).toBe(p);
    const manual = manuallyUnlockAchievementCharacters(p, now);
    expect(Object.keys(view(manual)!.achievedAt)).toHaveLength(0);
    expect(readAchievementRegistry(manual)!.cf).toBeUndefined();
  });
});
describe('schema6 exact wire and cause validation', () => {
  it('round-trips every new stage, checks complete prefixes, canonical versions and catalog activation', () => {
    let p = append(createPlayerProfile(now), entry, { root: 'wire' });
    p = append(p, room(0, { code: 3, mask: 16, counts: [0, 2, 0] }), {
      root: 'wire',
      parent: last(p),
    });
    p = append(
      p,
      { stage: 'complete', position: 0, values: [0, 0, 1, 6, 1] },
      { root: 'wire', parent: last(p) },
    );
    const wire = p.progression.modules.achievementRegistryV1 as {
      version: number;
      catalogVersion: number;
    };
    expect(wire).toMatchObject({ version: 7, catalogVersion: 6 });
    const normalized = readAchievementRegistry(p)!;
    expect(
      validateAchievementRegistry(packAchievementRegistry(normalized)),
    ).toEqual(normalized);
    for (const r of normalized.receipts)
      expect(encodeAchievementEvent(decodeAchievementEvent(r)).values).toEqual(
        r.values,
      );
    for (const changed of [
      { ...wire, version: 5 },
      { ...wire, catalogVersion: 4 },
      { ...wire, cf: { from: 99, at: now.toISOString() } },
      { ...wire, cf: { from: 0, at: '2026-10-15T00:00:00.000Z' } },
    ])
      expect(() => validateAchievementRegistry(changed)).toThrow();
    for (const e of [
      floor(0),
      {
        stage: 'final',
        position: 0,
        values: [1, 0, null, 1, 1, 1],
      } as EncodedAchievementEvent,
    ])
      expect(encodeAchievementEvent(decodeAchievementEvent(e))).toEqual(e);
  });
  it('rejects mismatched group counts, zero/negative/out-of-range values, missing version markers and altered duplicate causes', () => {
    for (const e of [
      room(0, { counts: [1, 0, 0] }),
      room(0, { code: 1, mask: 16, counts: [0, 2, 0] }),
      room(0, { code: 1, mask: 8192, counts: [0, 0, 1] }),
      room(0, { mask: 8, counts: [3, 0, 0] }),
      {
        stage: 'entry',
        position: 0,
        values: [0, 0, 1, 0, 1],
      } as EncodedAchievementEvent,
    ])
      expect(() => decodeAchievementEvent(e)).toThrow();
    const decoded = decodeAchievementEvent(room(0));
    if (decoded.stage !== 'room') throw Error('missing room');
    for (const field of [
      'revisionCounts',
      'revisionFlags',
      'milestoneFlags',
      'saleSavings',
      'missedCooperation',
      'missedHighPrice',
    ] as const) {
      const invalid = structuredClone(decoded);
      delete invalid.facts[field];
      expect(() => encodeAchievementEvent(invalid)).toThrow();
    }
    const old = room(0, { old: true }),
      fresh = room(0);
    expect(sameAchievementEventFacts(old, fresh)).toBe(true);
    expect(
      sameAchievementEventFacts(
        room(0, { mask: 8, counts: [1, 0, 0] }),
        room(0, { mask: 8, counts: [2, 0, 0] }),
      ),
    ).toBe(false);
  });
});
describe('live C-F capture and verified save restore', () => {
  const classic = () =>
    beginClassicGrowth(
      reduceGameSession(createGameSession(42), {
        type: 'start_game',
        characterId: 'isaac',
      }),
    );
  it('captures full facts, restores without adding receipts, and books a completed classic only once', () => {
    let s = classic();
    expect(s.growth!.units[0]!.values).toHaveLength(5);
    for (let i = 0; i < 15; i++) {
      s = reduceGameSession(s, {
        type: 'submit_player_turn',
        turn: {
          playerId: 'human',
          actions: [{ type: 'bid', group: 'A', amount: 1 }],
        },
      });
      expect(s.growthIssue).toBeUndefined();
      expect(s.growth!.units.at(-1)!.values).toHaveLength(19);
      if (i === 0)
        expect(
          parseGameSave(serializeGameCheckpoint(s)).session.growth,
        ).toEqual(s.growth);
      s = reduceGameSession(s, { type: 'advance_room' });
    }
    expect(s.game.phase).toBe('game_result');
    expect(s.growth!.units.at(-1)!.values).toHaveLength(5);
    const loaded = parseGameSave(serializeGameCheckpoint(s)).session;
    expect(loaded.growth).toEqual(s.growth);
    const a = applyGrowthContext(createPlayerProfile(now), loaded.growth!, now);
    expect(a).not.toHaveProperty('issue');
    expect(applyGrowthContext(a.profile, loaded.growth!, now).profile).toBe(
      a.profile,
    );
  });
  it('does not enrich an older checkpoint; starts the next genuinely new authority phase', () => {
    let old = beginClassicGrowth(
      reduceGameSession(createGameSession(42), {
        type: 'start_game',
        characterId: 'isaac',
      }),
      -1,
      -1,
      -1,
      -1,
      34,
    );
    delete old.growth!.cfFrom;
    const before = structuredClone(old.growth);
    const restored = parseGameSave(serializeGameCheckpoint(old)).session;
    expect(restored.growth).toEqual(before);
    old = reduceGameSession(restored, {
      type: 'submit_player_turn',
      turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
    });
    expect(old.growthIssue).toBeUndefined();
    expect(old.growth!.cfFrom).toBe(0);
    expect(old.growth!.units.map((u) => u.values.length)).toEqual([4, 19]);
    expect(() =>
      validateGrowthContext({ ...old.growth, cfFrom: -2 }, 'classic'),
    ).toThrow();
  });
  it('preserves full survival stages and terminal frozen human facts through restore', () => {
    let s = beginSurvivalGrowth(startSurvivalClient('lost', 3, 'highest'));
    let steps = 0;
    while (s.game.phase !== 'competition_complete') {
      if (++steps > 160) throw Error('not terminal');
      s = reduceSurvivalClient(s, longRunAction(s.game));
      if (s.growthIssue) throw Error(s.growthIssue);
    }
    const restored = parseSurvivalCheckpoint(
      serializeSurvivalCheckpoint(s.game, s.draft, now, s.growth),
    );
    expect(restored.growth).toEqual(s.growth);
    for (const u of s.growth!.units)
      expect(u.values).toHaveLength(
        u.stage === 'room'
          ? 19
          : u.stage === 'floor'
            ? 5
            : u.stage === 'final'
              ? 6
              : 5,
      );
    const a = applyGrowthContext(createPlayerProfile(now), s.growth!, now);
    expect(applyGrowthContext(a.profile, restored.growth!, now).profile).toBe(
      a.profile,
    );
  });
});
