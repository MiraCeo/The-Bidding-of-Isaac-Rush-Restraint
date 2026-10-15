import { padProfileTo } from './growth-capacity.test-helper';
import { describe, expect, it, vi } from 'vitest';
import { defaultRules } from '../../game/config';
import { createRuntimePlayer } from '../../game/runtime';
import { settleRuntimeRoom } from '../../game/room-engine';
import { readRoomNearMissEvidence } from '../../game/room-near-miss-evidence';
import type { GeneratedRoom, ItemId, PlayerTurn } from '../../game/item-types';
import {
  createGameSession,
  reduceGameSession,
  type GameSession,
} from '../game-session';
import { startSurvivalClient, reduceSurvivalClient } from '../survival-client';
import { longRunAction } from '../survival-long-run';
import {
  createPlayerProfile,
  readPlayerProfile,
  playerProfileKey,
  type PlayerProfile,
} from '../player-profile';
import { legacyAchievementCatalog, achievementCharacters } from './catalog';
import {
  appendAchievementEvent,
  readAchievementRegistry,
  projectAchievementRegistry,
  manuallyUnlockAchievementCharacters,
  compactAchievementProfile,
} from './registry';
import {
  beginClassicGrowth,
  observeClassicGrowth,
  beginSurvivalGrowth,
  applyGrowthContext,
  validateGrowthContext,
  bindGrowthEpoch,
} from './lifecycle';
import { decodeAchievementEvent } from './event-codec';
import {
  packAchievementRegistry,
  type PackedAchievementRegistry,
} from './ledger-codec';
import { sha256Hex } from '../../shared/sha256';
import { canonicalJson } from '../../shared/json-facts';
import {
  parseGameSave,
  serializeGameCheckpoint,
  serializeGameBackup,
  gameSaveKey,
} from '../game-save';
import {
  parseSurvivalCheckpoint,
  serializeSurvivalCheckpoint,
} from '../survival-persistence';
import {
  parsePlayerProfileBackup,
  serializePlayerProfileBackup,
} from '../player-profile-file';
import { saveClassicClient } from './client-persistence';
import { stringifyChecked } from '../file-json';
const now = new Date('2026-10-15T10:00:00Z');
const added = ['B05', 'B06', 'E06', 'E07', 'E08', 'F06'] as const;
function finalize(
  p: PlayerProfile,
  characterId: (typeof achievementCharacters)[number] = achievementCharacters[0],
  mode: 'classic' | 'survival' = 'classic',
  champion = false,
  id = `${mode}/${characterId}/${champion}`,
  at = now,
) {
  return appendAchievementEvent(
    p,
    {
      source: 'live',
      mode,
      root: sha256Hex('synthetic-complete-root/' + id),
      parent: null,
      authorityHash: sha256Hex('synthetic-complete/' + id),
      event: { stage: 'complete', facts: { mode, characterId, champion } },
    },
    at,
  );
}
function classic(expanded = true): GameSession {
  return beginClassicGrowth(
    reduceGameSession(createGameSession(42), {
      type: 'start_game',
      characterId: 'isaac',
    }),
    -1,
    expanded ? -1 : 34,
    34, // Freeze the original 0.5.3 catalog corpus; 0.5.6 has dedicated coverage.
  );
}
function step(s: GameSession) {
  return reduceGameSession(s, {
    type: 'submit_player_turn',
    turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
  });
}
function finish(s = classic()) {
  for (let i = 0; i < 15; i++)
    s = reduceGameSession(step(s), { type: 'advance_room' });
  return s;
}
const room: GeneratedRoom = {
  floorIndex: 0,
  roomIndex: 0,
  kind: 'normal',
  rewards: [
    { group: 'A', itemId: 'score_charm', hidden: false },
    { group: 'B', itemId: 'interest', hidden: false },
  ],
};
function nearMiss(
  options: {
    items?: ItemId[];
    ties?: number[];
    disruptor?: boolean;
    action?: 'bid' | 'disrupt' | 'withdraw';
    dual?: boolean;
    amount?: number;
  } = {},
) {
  const players = ['human', 'a', 'b', 'c'].map((id) =>
    createRuntimePlayer({ id, isHuman: id === 'human', money: 200, score: 0 }),
  );
  players[0]!.items = (options.items ?? []).map((itemId, i) => ({
    itemId,
    instanceId: `h-${i}`,
    acquiredOrder: i + 1,
  }));
  if (options.items?.includes('holy_mantle')) players[0]!.temporaryShields = 1;
  const human: PlayerTurn = {
    playerId: 'human',
    actions:
      options.action === 'withdraw'
        ? [{ type: 'withdraw' }]
        : [
            {
              type: options.action ?? 'bid',
              group: 'A',
              amount: options.amount ?? 40,
            },
            ...(options.dual
              ? [{ type: 'bid' as const, group: 'B' as const, amount: 1 }]
              : []),
          ],
  };
  const turns: PlayerTurn[] = [
    human,
    {
      playerId: 'a',
      actions: [
        {
          type: options.disruptor ? 'disrupt' : 'bid',
          group: 'A',
          amount: options.disruptor ? 20 : 60,
        },
      ],
    },
    { playerId: 'b', actions: [{ type: 'bid', group: 'A', amount: 40 }] },
    { playerId: 'c', actions: [{ type: 'bid', group: 'A', amount: 40 }] },
  ];
  const values = options.ties ?? [0.1, 0.2, 0.5, 0.9, 0.9, 0.1, 0.2, 0.3],
    roll = vi.fn(() => values.shift() ?? 0);
  const result = settleRuntimeRoom(room, players, turns, defaultRules, {
    next: roll,
  });
  return {
    result,
    evidence: readRoomNearMissEvidence(result.scoreBreakdowns)!,
    roll,
  };
}

describe('real near-miss observation without changing market facts or RNG', () => {
  it('captures both achievements for one tied bid using the original two rankings, not nominal-price inference', () => {
    const { result, evidence, roll } = nearMiss();
    expect(evidence).toEqual([
      { group: 'A', cooperationLost: true, nextHighPrice: true },
    ]);
    expect(result.awards.some((a) => a.playerId === 'human')).toBe(false);
    expect(roll).toHaveBeenCalledTimes(8);
    expect(Object.keys(result)).not.toContain('nearMiss');
    expect(
      readRoomNearMissEvidence(structuredClone(result).scoreBreakdowns),
    ).toBeUndefined();
    const tie = nearMiss({ ties: [0.9, 0.2, 0.1, 0.3, 0.9, 0.1, 0.2, 0.3] });
    expect(tie.evidence).toEqual([
      { group: 'A', cooperationLost: true, nextHighPrice: false },
    ]);
  });
  it('uses market-equivalent prices including 20/20 rather than nominal bids', () => {
    const r = nearMiss({ items: ['twenty_twenty'], amount: 35 });
    expect(
      r.result.resolvedActions.find((a) => a.playerId === 'human')!
        .marketEquivalent,
    ).toBe(43.75);
    expect(r.evidence).toEqual([
      { group: 'A', cooperationLost: true, nextHighPrice: true },
    ]);
  });
  it('includes a disruptor occupying the preceding high-price slot, with no replacement winner', () => {
    const { result, evidence } = nearMiss({ disruptor: true });
    expect(result.highPricePlacements[0]).toMatchObject({
      playerId: 'a',
      actionType: 'disrupt',
    });
    expect(evidence).toEqual([
      { group: 'A', cooperationLost: true, nextHighPrice: true },
    ]);
  });
  it('excludes lucky-foot qualification and qualification destroyed by the tail or More Options', () => {
    expect(nearMiss({ items: ['lucky_foot'] }).evidence).toEqual([]);
    const tail = nearMiss({
      items: ['guppys_tail'],
      amount: 80,
      ties: Array(20).fill(0),
    });
    expect(tail.result.entitlements.some((e) => e.playerId === 'human')).toBe(
      true,
    );
    expect(tail.result.awards.some((e) => e.playerId === 'human')).toBe(false);
    expect(tail.evidence).toEqual([]);
    const more = nearMiss({
      items: ['more_options'],
      amount: 80,
      dual: true,
      ties: Array(20).fill(0),
    });
    expect(
      more.result.events.some(
        (e) => e.effectItemId === 'more_options' && e.type === 'destroy',
      ),
    ).toBe(true);
    expect(more.evidence).toEqual([]);
  });
  it('allows another group to award while this group loses, and shield refunds do not undo the market loss', () => {
    const dual = nearMiss({ items: ['more_options'], dual: true });
    expect(
      dual.result.awards.some((a) => a.playerId === 'human' && a.group === 'B'),
    ).toBe(true);
    expect(
      dual.evidence.some(
        (e) => e.group === 'A' && e.cooperationLost && e.nextHighPrice,
      ),
    ).toBe(true);
    const shield = nearMiss({ items: ['holy_mantle'] });
    expect(
      shield.result.events.some(
        (e) => e.type === 'refund' && e.playerId === 'human',
      ),
    ).toBe(true);
    expect(shield.evidence[0]).toMatchObject({
      cooperationLost: true,
      nextHighPrice: true,
    });
  });
  it.each(['disrupt', 'withdraw'] as const)(
    'does not treat %s or mere lack of an award as a normal-bid near miss',
    (action) => {
      expect(nearMiss({ action }).evidence).toEqual([]);
    },
  );
});

describe('six new awards and immutable legacy identities', () => {
  it('shares one character bitset, counts survival elimination completions, and does not award for manual access', () => {
    let p = manuallyUnlockAchievementCharacters(createPlayerProfile(now), now);
    expect(projectAchievementRegistry(p)!.progress.E08).toBe(0);
    for (const [i, c] of achievementCharacters.entries()) {
      p = finalize(
        p,
        c,
        i % 2 ? 'survival' : 'classic',
        false,
        'role/' + c,
        new Date(now.getTime() + i),
      );
      expect(projectAchievementRegistry(p)!.progress.E08).toBe(i + 1);
      const again = finalize(p, c, 'classic', false, 'other-world/' + c);
      expect(projectAchievementRegistry(again)!.progress.E08).toBe(i + 1);
    }
    expect(projectAchievementRegistry(p)!.achievedAt.E08).toBe(
      new Date(now.getTime() + 4).toISOString(),
    );
    expect(projectAchievementRegistry(p)!.achievedAt.E06).toBeDefined();
    expect(projectAchievementRegistry(p)!.achievedAt.F06).toBeUndefined();
    const completed = finalize(p, 'isaac', 'survival', true, 'champion');
    expect(projectAchievementRegistry(completed)!.achievedAt.F06).toBeDefined();
    expect(finalize(completed, 'isaac', 'survival', true, 'champion')).toBe(
      completed,
    );
  });
  it('requires explicit classic first-place or survival champion facts, not a generic survival finish', () => {
    const p = finalize(createPlayerProfile(now), 'isaac', 'classic', true);
    expect(projectAchievementRegistry(p)!.achievedAt).toMatchObject({
      E06: now.toISOString(),
      E07: now.toISOString(),
    });
    expect(projectAchievementRegistry(p)!.achievedAt.F06).toBeUndefined();
    const s = finalize(createPlayerProfile(now), 'lost', 'survival', false);
    expect(projectAchievementRegistry(s)!.achievedAt.E06).toBeUndefined();
    expect(projectAchievementRegistry(s)!.achievedAt.F06).toBeUndefined();
    expect(projectAchievementRegistry(s)!.progress.E08).toBe(1);
  });
  it('captures classic tied first as a win even when the human is not first in the ranking array', () => {
    let before = classic();
    for (let i = 0; i < 15; i++) {
      before = step(before);
      if (i < 14) before = reduceGameSession(before, { type: 'advance_room' });
    }
    const end = reduceGameSession(before, { type: 'advance_room' });
    if (end.game.phase !== 'game_result')
      throw Error('expected terminal fixture');
    const ranking = end.game.finalRanking
      .map((r, i) => ({
        ...r,
        finalScore: r.playerId === 'human' || i === 0 ? 100 : 90,
      }))
      .sort(
        (a, b) =>
          Number(a.playerId === 'human') - Number(b.playerId === 'human'),
      );
    expect(ranking[0]!.playerId).not.toBe('human');
    const tied = { ...end, game: { ...end.game, finalRanking: ranking } };
    const captured = observeClassicGrowth(before, tied, before.growth!);
    expect(captured.units.at(-1)!.values).toEqual([0, 1]);
    const higher = {
      ...tied,
      game: {
        ...tied.game,
        finalRanking: ranking.map((r, i) =>
          i === 0 ? { ...r, finalScore: 101 } : r,
        ),
      },
    };
    expect(
      observeClassicGrowth(before, higher, before.growth!).units.at(-1)!.values,
    ).toEqual([0, 0]);
  });
  it('retains every schema1/2 key, time, condition and permission when writing schema3; old history is not searched', () => {
    const old = applyGrowthContext(
      createPlayerProfile(now),
      finish(classic(false)).growth!,
      now,
    ).profile;
    old.history = [];
    const before = canonicalJson(old),
      oldView = projectAchievementRegistry(old)!,
      oldReceipts = readAchievementRegistry(old)!.receipts;
    for (const id of added) expect(oldView.progress[id]).toBe(0);
    expect(
      (old.progression.modules.achievementRegistryV1 as { version: number })
        .version,
    ).toBe(1); // 30 legacy units can be explicitly compacted below.
    const compact = compactAchievementProfile(old),
      next = finalize(compact, 'isaac', 'classic', true);
    const wire = next.progression.modules
      .achievementRegistryV1 as unknown as PackedAchievementRegistry;
    expect(wire.version).toBe(3);
    expect(wire.catalogVersion).toBe(2);
    expect(
      readAchievementRegistry(next)!.receipts.slice(0, oldReceipts.length),
    ).toEqual(oldReceipts);
    const view = projectAchievementRegistry(next)!;
    for (const a of legacyAchievementCatalog) {
      expect(view.progress[a.id]).toBe(oldView.progress[a.id]);
      expect(view.achievedAt[a.id]).toBe(oldView.achievedAt[a.id]);
    }
    expect(view.characterUnlocks).toEqual(oldView.characterUnlocks);
    expect(canonicalJson(old)).toBe(before);
    expect(readPlayerProfile(next)).toEqual(next);
    expect(
      parsePlayerProfileBackup(serializePlayerProfileBackup(next)).profile,
    ).toEqual(next);
  });
  it('does not enrich a legacy duplicate or reset its time; expanded duplicates still reject conflicting causes', () => {
    const base = {
      source: 'live' as const,
      mode: 'classic' as const,
      root: sha256Hex('same-old-room'),
      authorityHash: sha256Hex('same-old-authority'),
      parent: null,
    };
    const oldEvent = decodeAchievementEvent({
      stage: 'room',
      position: 0,
      values: [1, 0, 0, 0, 0],
    });
    const newEvent = decodeAchievementEvent({
      stage: 'room',
      position: 0,
      values: [1, 0, 0, 0, 0, 3],
    });
    const old = appendAchievementEvent(
        createPlayerProfile(now),
        { ...base, event: oldEvent },
        now,
      ),
      before = canonicalJson(old);
    expect(
      appendAchievementEvent(
        old,
        { ...base, event: newEvent },
        new Date(now.getTime() + 1),
      ),
    ).toBe(old);
    expect(projectAchievementRegistry(old)!.progress.B05).toBe(0);
    expect(projectAchievementRegistry(old)!.progress.B06).toBe(0);
    expect(canonicalJson(old)).toBe(before);
    const expanded = appendAchievementEvent(
      createPlayerProfile(now),
      { ...base, event: newEvent },
      now,
    );
    expect(appendAchievementEvent(expanded, { ...base, event: oldEvent })).toBe(
      expanded,
    );
    expect(() =>
      appendAchievementEvent(expanded, {
        ...base,
        event: decodeAchievementEvent({
          stage: 'room',
          position: 0,
          values: [1, 0, 0, 0, 0, 0],
        }),
      }),
    ).toThrow('冲突');
  });
  it('maps room cause flags independently and excludes non-live submissions', () => {
    const event = decodeAchievementEvent({
      stage: 'room',
      position: 0,
      values: [1, 0, 0, 0, 0, 3],
    });
    const submission = {
      source: 'live' as const,
      mode: 'classic' as const,
      root: sha256Hex('room'),
      authorityHash: sha256Hex('room-proof'),
      parent: null,
      event,
    };
    const p = appendAchievementEvent(createPlayerProfile(now), submission, now);
    expect(projectAchievementRegistry(p)!.achievedAt).toMatchObject({
      B05: now.toISOString(),
      B06: now.toISOString(),
    });
    for (const source of ['read-only', 'historical', 'tutorial'] as const)
      expect(appendAchievementEvent(p, { ...submission, source })).toBe(p);
  });
  it('keeps schema3 bounded by the unchanged whole-profile byte budget and rejects contradictory room facts', () => {
    const p = padProfileTo(finalize(createPlayerProfile(now)), 1024 * 1024),
      before = canonicalJson(p);
    expect(readPlayerProfile(p)).toEqual(p);
    expect(() => finalize(p, 'lost', 'classic', false, 'over-budget')).toThrow(
      '容量',
    );
    expect(canonicalJson(p)).toBe(before);
    expect(() =>
      decodeAchievementEvent({
        stage: 'room',
        position: 0,
        values: [0, 0, 0, 0, 0, 3],
      }),
    ).toThrow();
  });
  it('rejects mixed versions, invalid completion positions and tampered expanded encodings without resetting', () => {
    const p = finalize(createPlayerProfile(now)),
      r = readAchievementRegistry(p)!;
    const wire = p.progression.modules
      .achievementRegistryV1 as unknown as PackedAchievementRegistry;
    for (const patch of [
      { version: 4 },
      { version: 3, catalogVersion: 1 },
      { version: 2, catalogVersion: 2 },
    ]) {
      const bad = structuredClone(p);
      Object.assign(bad.progression.modules.achievementRegistryV1!, patch);
      expect(() => readPlayerProfile(bad)).toThrow();
    }
    const fake = structuredClone(r);
    fake.receipts[0]!.values[0] = 5;
    const bad = structuredClone(p);
    bad.progression.modules.achievementRegistryV1 = packAchievementRegistry(
      fake,
    ) as never;
    expect(() => readPlayerProfile(bad)).toThrow();
    expect(wire.version).toBe(3);
  });
});

describe('prospective activation, exact continuation and atomic terminal saving', () => {
  it('loads a legacy transcript without expanding old units, then counts only the newly completed phase', () => {
    const s = step(classic(false));
    const old = structuredClone(s);
    delete old.growth!.expansionFrom;
    delete old.growth!.milestonesFrom;
    const before = canonicalJson(old),
      loaded = parseGameSave(serializeGameCheckpoint(old)).session;
    expect(loaded.growth!.expansionFrom).toBeUndefined();
    expect(loaded.growth!.units[1]!.values).toHaveLength(5);
    const next = step(reduceGameSession(loaded, { type: 'advance_room' }));
    expect(next.growth!.expansionFrom).toBe(1);
    expect(next.growth!.units[1]!.values).toHaveLength(5);
    expect(next.growth!.units.at(-1)!.values).toHaveLength(8);
    expect(canonicalJson(old)).toBe(before);
    expect(parseGameSave(serializeGameCheckpoint(next)).session.growth).toEqual(
      next.growth,
    );
    const tampered = JSON.parse(serializeGameCheckpoint(next));
    tampered.growth.expansionFrom = -1;
    expect(() => parseGameSave(stringifyChecked(tampered))).toThrow();
  });
  it('rebuilds new near-miss bits from actual settlement order instead of trusting a re-signed checkpoint', () => {
    const s = reduceGameSession(classic(), {
      type: 'submit_player_turn',
      turn: {
        playerId: 'human',
        actions: [{ type: 'bid', group: 'A', amount: 1 }],
      },
    });
    const doc = JSON.parse(serializeGameCheckpoint(s)),
      unit = doc.growth.units.at(-1);
    unit.values[5] = unit.values[5] === 0 ? 1 : 0;
    expect(() => parseGameSave(stringifyChecked(doc))).toThrow();
  });
  it('does not backfill a legacy terminal or imported pending prefix, but a new classic terminal is awarded once', () => {
    const legacy = finish(classic(false));
    delete legacy.growth!.expansionFrom;
    delete legacy.growth!.milestonesFrom;
    const loaded = parseGameSave(serializeGameCheckpoint(legacy)).session;
    const old = applyGrowthContext(
      createPlayerProfile(now),
      loaded.growth!,
      now,
    );
    for (const id of added)
      expect(projectAchievementRegistry(old.profile)!.progress[id]).toBe(0);
    const live = finish();
    const ignored = bindGrowthEpoch(live.growth!, null, { imported: true });
    const imported = applyGrowthContext(createPlayerProfile(now), ignored, now);
    expect(projectAchievementRegistry(imported.profile)).toBeNull();
    const result = applyGrowthContext(
      createPlayerProfile(now),
      live.growth!,
      now,
    );
    expect(projectAchievementRegistry(result.profile)!.progress.E06).toBe(1);
    expect(result.context.acknowledged).toBe(31);
    expect(
      applyGrowthContext(result.profile, result.context, now).profile,
    ).toBe(result.profile);
    expect(
      parseGameSave(
        serializeGameBackup(
          { ...live, growth: result.context },
          result.profile,
        ),
      ).profile,
    ).toEqual(result.profile);
    const bad = structuredClone(live.growth!);
    delete bad.expansionFrom;
    expect(() => validateGrowthContext(bad, 'classic')).toThrow();
  }, 20000);
  it('records a survival personal completion even after elimination and verifies the expanded command transcript', () => {
    let s = beginSurvivalGrowth(startSurvivalClient('lost', 3, 'highest'));
    while (s.game.phase !== 'competition_complete')
      s = reduceSurvivalClient(s, longRunAction(s.game));
    expect(s.game.humanEliminatedAt).not.toBeNull();
    expect(s.growth!.units.at(-1)!.stage).toBe('complete');
    const parsed = parseSurvivalCheckpoint(
      serializeSurvivalCheckpoint(s.game, s.draft, now, s.growth),
    );
    expect(parsed.growth).toEqual(s.growth);
    const p = applyGrowthContext(
      createPlayerProfile(now),
      s.growth!,
      now,
    ).profile;
    expect(projectAchievementRegistry(p)!.progress.E08).toBe(1);
    expect(projectAchievementRegistry(p)!.achievedAt.F06).toBeUndefined();
  }, 20000);
  it('rolls back a failed terminal commit, keeps pending facts, and retries without duplicate characters or alerts', async () => {
    const s = finish(),
      values = new Map<string, string>();
    let failed = true,
      writes = 0;
    const storage = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (k === playerProfileKey && failed) {
          failed = false;
          throw Error('quota');
        }
        values.set(k, v);
        if (k === playerProfileKey) writes++;
      },
      removeItem: (k: string) => {
        values.delete(k);
      },
    };
    const coordinator = { exclusive: async <T>(_n: string, f: () => T) => f() };
    const pending = await saveClassicClient(storage, s, {
      expectedSource: null,
      coordinator,
    });
    expect(pending.message).toBeTruthy();
    expect(pending.session.growth!.acknowledged).toBe(0);
    expect(storage.getItem(playerProfileKey)).toBeNull();
    const saved = await saveClassicClient(storage, pending.session, {
      expectedSource: storage.getItem(gameSaveKey),
      coordinator,
    });
    expect(saved.message).toBe('');
    expect(saved.newlyAchieved).toContain('E06');
    const raw = storage.getItem(playerProfileKey)!;
    expect(projectAchievementRegistry(JSON.parse(raw))!.progress.E08).toBe(1);
    const again = await saveClassicClient(storage, saved.session, {
      expectedSource: storage.getItem(gameSaveKey),
      coordinator,
    });
    expect(again.newlyAchieved).toEqual([]);
    expect(storage.getItem(playerProfileKey)).toBe(raw);
    expect(writes).toBe(1);
  }, 20000);
});
