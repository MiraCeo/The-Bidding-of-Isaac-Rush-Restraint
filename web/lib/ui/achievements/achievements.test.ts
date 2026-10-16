import { describe, expect, it, vi } from 'vitest';
import {
  achievementCatalog,
  legacyAchievementCatalog,
  achievementCategories,
  characterAchievementRequirements,
  availableAchievementCharacters,
  type AchievementId,
} from './catalog';
import {
  extractAchievementEntryFacts,
  extractAchievementRoomFacts,
  extractAchievementFloorFacts,
  extractAchievementFinalFacts,
  type AchievementRoomFacts,
  type AchievementFloorFacts,
} from './facts';
import {
  evaluateAchievementRun,
  emptyAchievementCounters,
  type AchievementRunAnalysis,
} from './evaluation';
import { defaultRules } from '../../game/config';
import type {
  GeneratedRoom,
  ItemId,
  PlayerTurn,
  RuntimePlayerState,
} from '../../game/item-types';
import type { ClientRoomSettlementRecord } from '../../game/client-session';
import type { SurvivalFloorRecord } from '../../game/survival-session';
import { settleRuntimeRoom } from '../../game/room-engine';
import { preparePlayersForRoom } from '../../game/room-economy';
import { createRuntimePlayer } from '../../game/runtime';
import { canonicalJson } from '../../shared/json-facts';
import {
  classicCompletionFixture,
  survivalCompletionFixture,
} from '../completion-registry.test-helper';
import { serializeReplay, parseReplay } from '../game-replay';
import {
  serializeSurvivalReplay,
  parseSurvivalReplay,
} from '../survival-persistence';

function player(
  id = 'human',
  items: ItemId[] = [],
  money = 100,
): RuntimePlayerState {
  const p = createRuntimePlayer({
    id,
    money,
    score: 0,
    isHuman: id === 'human',
  });
  p.items = items.map((itemId, i) => ({
    instanceId: `${id}-${i}`,
    itemId,
    acquiredOrder: i + 1,
  }));
  return p;
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
function settled(
  players: RuntimePlayerState[],
  turns: PlayerTurn[],
  generated = room,
  roll = () => 0.5,
): ClientRoomSettlementRecord {
  return {
    room: generated,
    playersBefore: players,
    turns,
    ...settleRuntimeRoom(generated, players, turns, defaultRules, {
      next: roll,
    }),
  };
}
const bid = (
  playerId = 'human',
  amount = 30,
  group: 'A' | 'B' = 'A',
): PlayerTurn => ({ playerId, actions: [{ type: 'bid', group, amount }] });
const disrupt = (playerId = 'human', amount = 25): PlayerTurn => ({
  playerId,
  actions: [{ type: 'disrupt', group: 'A', amount }],
});
const withdraw = (playerId = 'human'): PlayerTurn => ({
  playerId,
  actions: [{ type: 'withdraw' }],
});
function emptyRoom(
  overrides: Partial<AchievementRoomFacts> = {},
): AchievementRoomFacts {
  return {
    floorIndex: 0,
    roomIndex: 0,
    bidSuccesses: [],
    cooperativeAward: false,
    highestAwardOpportunities: 0,
    optionsDestroyed: false,
    watchedVacancy: false,
    causedVacancy: false,
    shieldRefunded: false,
    transcendenceRedeemed: false,
    tailDestroyed: false,
    tailDuplicated: false,
    d6Doubled: false,
    eternalCleared: false,
    babylonCleared: false,
    saleSaved: false,
    poorCharmBoosted: false,
    luckyFootNecessaryAward: false,
    allInBid: false,
    optionsAwarded: false,
    bossAwarded: false,
    brimstoneAwarded: false,
    hiddenAwardCopies: 0,
    ...overrides,
  };
}
function analysis(rooms: AchievementRoomFacts[] = []): AchievementRunAnalysis {
  return {
    mode: 'classic',
    source: 'formal',
    entries: [],
    rooms: rooms.map((facts, i) => ({
      eligible: true,
      facts: { ...facts, floorIndex: Math.floor(i / 5), roomIndex: i % 5 },
    })),
    floors: [],
  };
}
function floor(
  floorIndex = 0,
  overrides: Partial<AchievementFloorFacts> = {},
): AchievementFloorFacts {
  return {
    floorIndex,
    humanParticipated: true,
    humanSurvived: true,
    humanEliminated: false,
    lowestSurvivor: false,
    ...overrides,
  };
}
function floorRecord(
  scores: number[],
  survivors: string[],
): SurvivalFloorRecord {
  const ids = ['human', 'ai-1', 'ai-2'];
  return {
    build: 'synthetic-rule-spec',
    floorIndex: 0,
    cutLine: 10,
    activePlayerIds: ids,
    scores: Object.fromEntries(
      ids.map((id, i) => [
        id,
        {
          roomScore: scores[i]!,
          remainingMoney: 0,
          exchangedScore: 0,
          previousSurvivalScore: 0,
          inheritedScore: 0,
          newScore: scores[i]!,
          survivalScore: scores[i]!,
        },
      ]),
    ),
    plan: {
      status: 'resolved',
      shouldFinish: true,
      survivorIds: survivors,
      eliminations: ids
        .filter((id) => !survivors.includes(id))
        .map((playerId) => ({ playerId, reason: 'lowest_score' })),
    },
    resolution: { reason: 'score_order', tieBreaks: [] },
  };
}

describe('0.5 product catalog and independent character permission', () => {
  it('retains the frozen original 30 and publishes the revised 107 with updated Lost prerequisites', () => {
    const ids = achievementCatalog.map((a) => a.id);
    expect(ids).toHaveLength(107);
    expect(legacyAchievementCatalog).toHaveLength(30);
    expect(new Set(ids).size).toBe(107);
    expect(
      achievementCategories.map(
        (c) => ids.filter((id) => id.startsWith(c.id)).length,
      ),
    ).toEqual([13, 24, 15, 22, 18, 15]);
    const prerequisites = new Set(
      Object.values(characterAchievementRequirements).flat(),
    );
    expect([...prerequisites].sort()).toEqual([
      'A10',
      'E01',
      'E02',
      'E03',
      'E04',
      'E05',
    ]);
    expect(achievementCatalog.find((a) => a.id === 'D05')!.name).toBe(
      '意外之喜 I',
    );
    for (const removed of [
      '不劳而获',
      '两全其美',
      '四两拨千斤',
      '绝地反击',
      '高枕无忧',
    ])
      expect(achievementCatalog.some((a) => a.name === removed)).toBe(false);
    expect(
      achievementCatalog.filter((a) => a.scope === 'survival').map((a) => a.id),
    ).toEqual([
      'F01',
      'F02',
      'F03',
      'F04',
      'F05',
      'F06',
      'F07',
      'F08',
      'F09',
      'F10',
      'F12',
      'F13',
      'F14',
      'F15',
      'F16',
    ]);
  });
  it('requires both conditions, defaults to Isaac and never mutates achievements on manual authorization', () => {
    const earned = new Set<AchievementId>(['E01', 'E03']);
    expect(availableAchievementCharacters(earned)).toEqual(['isaac']);
    const before = [...earned];
    expect(availableAchievementCharacters(earned, true)).toEqual([
      'isaac',
      'lost',
      'azazel',
      'eden',
      'jacob_esau',
    ]);
    expect([...earned]).toEqual(before);
    earned.add('A10');
    earned.add('E04');
    earned.add('E02');
    earned.add('E05');
    expect(availableAchievementCharacters(earned)).toHaveLength(5);
  });
});

describe('room and entry authority adapters (real settlement, no replay RNG)', () => {
  it('allows an actual one-item delivery with both high/cooperative qualifications', () => {
    const r = settled([player()], [bid()]);
    const before = canonicalJson(r);
    const f = extractAchievementRoomFacts(r)!;
    expect(f).toMatchObject({
      bidSuccesses: [true],
      cooperativeAward: true,
      highestAwardOpportunities: 1,
    });
    expect(r.awards).toHaveLength(1);
    expect(canonicalJson(r)).toBe(before);
  });
  it('treats refunded failure as failure and distinguishes bag refunds from shields', () => {
    const p = player('human', ['wooden_cross']);
    p.persistentShields = 1;
    const r = settled([p, player('ai-1')], [bid('human', 10), bid('ai-1', 50)]);
    expect(extractAchievementRoomFacts(r)).toMatchObject({
      bidSuccesses: [false],
      shieldRefunded: true,
    });
    const bag = settled([player()], [bid('human', 30)], {
      ...room,
      rewards: [
        { group: 'A', itemId: 'grab_bag', hidden: false },
        room.rewards[1],
      ],
    });
    expect(
      bag.events.some((e) => e.type === 'refund' && e.itemId === 'grab_bag'),
    ).toBe(true);
    expect(extractAchievementRoomFacts(bag)!.shieldRefunded).toBe(false);
  });
  it('keeps two successful market qualifications after More Options destroys one', () => {
    const r = settled(
      [player('human', ['more_options'])],
      [
        {
          playerId: 'human',
          actions: [
            { type: 'bid', group: 'B', amount: 25 },
            { type: 'bid', group: 'A', amount: 25 },
          ],
        },
      ],
    );
    expect(r.entitlements).toHaveLength(1);
    expect(extractAchievementRoomFacts(r)).toMatchObject({
      bidSuccesses: [true, true],
      optionsDestroyed: true,
      highestAwardOpportunities: 1,
    });
  });
  it.each([
    { roll: 0, copies: 0, destroyed: true, duplicated: false },
    { roll: 0.5, copies: 1, destroyed: false, duplicated: false },
    { roll: 0.9, copies: 2, destroyed: false, duplicated: true },
  ])(
    'distinguishes tail copies=$copies, opportunity count and hidden deliveries',
    ({ roll, copies, destroyed, duplicated }) => {
      const r = settled(
        [player('human', ['guppys_tail'])],
        [bid('human', 30, 'B')],
        {
          ...room,
          kind: 'treasure',
          rewards: [room.rewards[0], { ...room.rewards[1], hidden: true }],
        },
        () => roll,
      );
      expect(extractAchievementRoomFacts(r)).toMatchObject({
        bidSuccesses: [true],
        highestAwardOpportunities: copies ? 1 : 0,
        hiddenAwardCopies: copies,
        tailDestroyed: destroyed,
        tailDuplicated: duplicated,
      });
    },
  );
  it('matches vacancies per slot even when another slot redeems and the group delivers', () => {
    let i = 0;
    const rolls = [0, 0, 0, 0, 0, 0.9]; // two high ties, redemption, two cooperation ties, redemption
    const r = settled(
      [player('human', ['transcendence']), player('ai-1')],
      [disrupt('human', 50), bid('ai-1', 40)],
      room,
      () => rolls[i++] ?? 0.5,
    );
    expect(r.transcendenceRedemptions).toEqual([
      { playerId: 'human', group: 'A', slotType: 'highest' },
    ]);
    expect(r.awards).toHaveLength(1);
    expect(extractAchievementRoomFacts(r)).toMatchObject({
      causedVacancy: true,
      transcendenceRedeemed: true,
      bidSuccesses: [],
    });
  });
  it('awards the human spectator only for actual unredeemed environmental vacancy', () => {
    const vacant = settled(
      [player(), player('ai-1')],
      [withdraw(), disrupt('ai-1')],
      room,
      () => 0,
    );
    expect(extractAchievementRoomFacts(vacant)).toMatchObject({
      watchedVacancy: true,
      causedVacancy: false,
    });
    const redeemed = settled(
      [player(), player('ai-1', ['transcendence'])],
      [withdraw(), disrupt('ai-1')],
      room,
      () => 0,
    );
    expect(extractAchievementRoomFacts(redeemed)!.watchedVacancy).toBe(false);
  });
  it('requires Lucky Foot to be the necessary qualification and actual delivery', () => {
    const lucky = player('human', ['lucky_foot']);
    const r = settled(
      [player('ai-1'), lucky],
      [bid('ai-1', 40), bid('human', 20)],
    );
    expect(extractAchievementRoomFacts(r)).toMatchObject({
      luckyFootNecessaryAward: true,
      bidSuccesses: [true],
    });
    const redundant = settled([lucky], [bid()]);
    expect(
      extractAchievementRoomFacts(redundant)!.luckyFootNecessaryAward,
    ).toBe(false);
    const vanished = settled(
      [player('ai-1'), player('human', ['lucky_foot', 'guppys_tail'])],
      [bid('ai-1', 40), bid('human', 20)],
      room,
      () => 0,
    );
    expect(extractAchievementRoomFacts(vanished)!.luckyFootNecessaryAward).toBe(
      false,
    );
  });
  it('uses all-in nominal bid despite sale and does not infer from zero balance', () => {
    const r = settled([player('human', ['steam_sale'])], [bid('human', 100)]);
    expect(r.resolvedActions[0]!.actualCost).toBe(70);
    expect(extractAchievementRoomFacts(r)).toMatchObject({
      allInBid: true,
      saleSaved: true,
    });
    expect(
      extractAchievementRoomFacts(settled([player()], [withdraw()]))!.allInBid,
    ).toBe(false);
    expect(
      extractAchievementRoomFacts(settled([player()], [disrupt()]))!.allInBid,
    ).toBe(false);
    const rounded = settled(
      [player('human', ['steam_sale'])],
      [bid('human', 1)],
    );
    expect(extractAchievementRoomFacts(rounded)!.saleSaved).toBe(false);
  });
  it('uses poor-charm trigger per owned copy, not a final balance or amount 20 alone', () => {
    const boosted = settled(
      [player('human', ['poor_charm'])],
      [bid('human', 80)],
    );
    expect(extractAchievementRoomFacts(boosted)!.poorCharmBoosted).toBe(true);
    const ordinary = settled(
      [player('human', Array<ItemId>(4).fill('poor_charm'))],
      [bid('human', 10)],
    );
    expect(ordinary.scoreBreakdowns.human!.triggers[0]!.amount).toBe(20);
    expect(extractAchievementRoomFacts(ordinary)!.poorCharmBoosted).toBe(false);
    const boundary = settled(
      [player('human', ['poor_charm'])],
      [bid('human', 70)],
    );
    expect(extractAchievementRoomFacts(boundary)!.poorCharmBoosted).toBe(false);
  });
  it('keeps independent clear/double/additive causes even after clearing the room', () => {
    const r = settled(
      [player('human', ['d6', 'eternal_d6', 'whore_of_babylon', 'poor_charm'])],
      [bid('human', 10)],
      room,
      () => 0,
    );
    const f = extractAchievementRoomFacts(r)!;
    expect(r.scoreBreakdowns.human!.score).toBe(0);
    expect(f).toMatchObject({
      d6Doubled: true,
      eternalCleared: true,
      babylonCleared: true,
    });
    expect(f.scoreBeforeClear).toBeGreaterThan(0);
    expect(evaluateAchievementRun(analysis([f])).unresolvedEvidence).toEqual(
      [],
    );
    expect(evaluateAchievementRun(analysis([f])).achieved).toEqual(
      expect.arrayContaining(['C06', 'C07', 'E01']),
    );
    const historical = extractAchievementRoomFacts(structuredClone(r))!;
    expect(historical.scoreBeforeClear).toBeUndefined();
    expect(
      evaluateAchievementRun(analysis([historical])).unresolvedEvidence,
    ).toEqual(['E01']);
    expect(
      evaluateAchievementRun(analysis([historical])).achieved,
    ).not.toContain('E01');
  });
  it('does not call inventory ownership an acquisition and distinguishes boss room from boss pool', () => {
    const p = player('human', [
      'brimstone',
      'more_options',
      'more_options_question',
    ]);
    const noAward = settled([p], [withdraw()]);
    expect(extractAchievementRoomFacts(noAward)).toMatchObject({
      optionsAwarded: false,
      brimstoneAwarded: false,
    });
    const rewards: GeneratedRoom['rewards'] = [
      { group: 'A', itemId: 'brimstone', hidden: false },
      room.rewards[1],
    ];
    expect(
      extractAchievementRoomFacts(settled([p], [bid()], { ...room, rewards })),
    ).toMatchObject({ brimstoneAwarded: true, bossAwarded: false });
    expect(
      extractAchievementRoomFacts(
        settled([p], [bid()], { ...room, kind: 'boss', rewards }),
      )!.bossAwarded,
    ).toBe(true);
  });
  it('returns no human facts for an AI-only room', () => {
    expect(
      extractAchievementRoomFacts(
        settled([player('ai-1', ['d6'])], [bid('ai-1')], room, () => 0),
      ),
    ).toBeNull();
  });
  it('uses actual money reasons, ignores AI income and excludes role start/collar/refund', () => {
    const prepared = preparePlayersForRoom(
      [player('human', ['interest', 'money_bag']), player('ai-1')],
      0,
      0,
      defaultRules,
      { next: () => 0.5 },
    );
    const f = extractAchievementEntryFacts(prepared.events, 0, 0);
    expect(f).toMatchObject({ interestMoney: 16, stolenMoney: 5 });
    const isolated = extractAchievementEntryFacts(
      [
        {
          type: 'money',
          playerId: 'ai-1',
          itemId: 'interest',
          amount: 500,
          message: '合成AI收入',
        },
        {
          type: 'money',
          playerId: 'human',
          amount: 200,
          message: '合成角色特性',
        },
        {
          type: 'money',
          playerId: 'human',
          itemId: 'guppys_collar',
          amount: 25,
          message: '合成项圈',
        },
        {
          type: 'refund',
          playerId: 'human',
          itemId: 'interest',
          amount: 30,
          message: '非利息资金事件',
        },
      ],
      0,
      0,
    );
    expect(isolated).toMatchObject({ interestMoney: 0, stolenMoney: 0 });
  });
  it('uses exact supported evidence only, rejecting unknown entitlement causes or imprecise E01 evidence', () => {
    const r = settled([player()], [bid()]);
    r.entitlements[0]!.sources.push('unknown-future-cause');
    expect(() => extractAchievementRoomFacts(r)).toThrow('未知资格来源');
    expect(() =>
      extractAchievementRoomFacts(settled([player()], [bid()]), {
        scoreBeforeClear: 0.000001,
      }),
    ).toThrow('四位');
  });
});

describe('pure analysis of confirmed rules, not a persistence grant API', () => {
  it.each([
    ['B01', 'cooperativeAward'],
    ['B03', 'optionsDestroyed'],
    ['B04', 'watchedVacancy'],
    ['C01', 'causedVacancy'],
    ['C02', 'shieldRefunded'],
    ['C03', 'transcendenceRedeemed'],
    ['C04', 'tailDestroyed'],
    ['C05', 'tailDuplicated'],
    ['C06', 'd6Doubled'],
    ['D02', 'saleSaved'],
    ['D04', 'poorCharmBoosted'],
    ['D05', 'luckyFootNecessaryAward'],
    ['D06', 'allInBid'],
    ['E02', 'optionsAwarded'],
    ['E03', 'bossAwarded'],
    ['E04', 'brimstoneAwarded'],
  ] as const)('maps %s exclusively from its cause (%s)', (id, key) => {
    expect(evaluateAchievementRun(analysis()).achieved).not.toContain(id);
    expect(
      evaluateAchievementRun(analysis([emptyRoom({ [key]: true })])).achieved,
    ).toContain(id);
  });
  it('accumulates shared counters from an excluding-match baseline without mutating or double-evaluating it', () => {
    const input = analysis([
      emptyRoom({
        bidSuccesses: [false, false],
        highestAwardOpportunities: 1,
        hiddenAwardCopies: 2,
      }),
    ]);
    input.entries = [
      {
        eligible: true,
        facts: {
          floorIndex: 0,
          roomIndex: 0,
          stolenMoney: 5,
          interestMoney: 50,
        },
      },
    ];
    const baseline = {
      failedBids: 8,
      highestAwards: 9,
      interestMoney: 950,
      hiddenCopies: 1,
    };
    const before = canonicalJson({ input, baseline });
    const result = evaluateAchievementRun(input, baseline);
    expect(result.counters).toEqual({
      failedBids: 10,
      highestAwards: 10,
      interestMoney: 1000,
      hiddenCopies: 3,
    });
    expect(result.achieved).toEqual(
      expect.arrayContaining(['A01', 'A02', 'B02', 'D01', 'D03', 'E05']),
    );
    expect(evaluateAchievementRun(input, baseline)).toEqual(result);
    expect(
      evaluateAchievementRun({ ...input, mode: 'survival' }, baseline),
    ).toEqual(result);
    expect(canonicalJson({ input, baseline })).toBe(before);
  });
  it.each([
    [true, false],
    [false, true],
    [true, true],
  ])(
    'does not award A03 early on a mixed/successful room %j',
    (first, second) => {
      const rooms = Array.from({ length: 4 }, () =>
        emptyRoom({ bidSuccesses: [false] }),
      );
      rooms.push(emptyRoom({ bidSuccesses: [first!, second!] }));
      const result = evaluateAchievementRun(analysis(rooms));
      expect(result.progress.A03).toBe(4);
      expect(result.runState.consecutiveFailedBids).toBe(0);
      expect(result.achieved).not.toContain('A03');
    },
  );
  it('counts double failure as two and keeps streaks through withdraw/disrupt, but not across matches', () => {
    const rooms = Array.from({ length: 3 }, () =>
      emptyRoom({ bidSuccesses: [false] }),
    );
    rooms.push(
      emptyRoom(),
      emptyRoom({ causedVacancy: true }),
      emptyRoom({ bidSuccesses: [false, false] }),
    );
    expect(evaluateAchievementRun(analysis(rooms)).achieved).toContain('A03');
    expect(
      evaluateAchievementRun(analysis([emptyRoom({ bidSuccesses: [false] })]), {
        ...emptyAchievementCounters(),
        failedBids: 4,
      }).achieved,
    ).not.toContain('A03');
  });
  it('excludes old streak/clear/entry facts while preserving independent new bid or entry facts', () => {
    const input = analysis(
      Array.from({ length: 5 }, () => emptyRoom({ bidSuccesses: [false] })),
    );
    input.rooms = input.rooms.map((unit, i) => ({
      ...unit,
      eligible: i === 4,
      facts: {
        ...unit.facts,
        eternalCleared: i === 0,
        babylonCleared: i === 4,
      },
    }));
    input.entries = [
      {
        eligible: false,
        facts: {
          floorIndex: 0,
          roomIndex: 0,
          stolenMoney: 5,
          interestMoney: 1000,
        },
      },
      {
        eligible: true,
        facts: {
          floorIndex: 0,
          roomIndex: 1,
          stolenMoney: 5,
          interestMoney: 50,
        },
      },
    ];
    const r = evaluateAchievementRun(input);
    expect(r.counters).toMatchObject({ failedBids: 1, interestMoney: 50 });
    expect(r.progress.A03).toBe(1);
    expect(r.progress.C07).toBe(1);
    expect(r.achieved).toContain('D01');
    expect(r.unresolvedEvidence).toEqual([]); // Old E01 evidence is not requested.
  });
  it('allows entry achievements immediately without a submitted room or terminal match', () => {
    const input = analysis();
    input.entries = [
      {
        eligible: true,
        facts: {
          floorIndex: 0,
          roomIndex: 0,
          stolenMoney: 1,
          interestMoney: 1000,
        },
      },
    ];
    expect(evaluateAchievementRun(input).achieved).toEqual(['D01', 'D03']);
  });
  it.each(['read-only', 'tutorial'] as const)(
    'does not grant anything from %s even with eligible flags',
    (source) => {
      const input = analysis([
        emptyRoom({ bidSuccesses: [false], d6Doubled: true }),
      ]);
      input.source = source;
      const r = evaluateAchievementRun(input, {
        ...emptyAchievementCounters(),
        failedBids: 10,
      });
      expect(r.achieved).toEqual([]);
      expect(r.counters.failedBids).toBe(10);
      expect(r.unresolvedEvidence).toEqual([]);
    },
  );
  it.each([
    { score: 0, earned: false },
    { score: 0.0001, earned: true },
    { score: 120.1256, earned: true },
  ])(
    'requires a true clear and exact positive pre-clear evidence: $score',
    ({ score, earned }) => {
      const r = evaluateAchievementRun(
        analysis([
          emptyRoom({ eternalCleared: true, scoreBeforeClear: score }),
        ]),
      );
      expect(r.achieved.includes('E01')).toBe(earned);
      expect(r.unresolvedEvidence).toEqual([]);
      expect(
        evaluateAchievementRun(
          analysis([emptyRoom({ scoreBeforeClear: score })]),
        ).achieved,
      ).not.toContain('E01');
    },
  );
  it('preserves an earlier within-match achievement candidate after later success/reset', () => {
    const rooms = Array.from({ length: 5 }, () =>
      emptyRoom({ bidSuccesses: [false] }),
    );
    rooms.push(emptyRoom({ bidSuccesses: [true] }));
    expect(evaluateAchievementRun(analysis(rooms)).achieved).toContain('A03');
    expect(
      evaluateAchievementRun(
        analysis([emptyRoom({ eternalCleared: true, babylonCleared: true })]),
      ).achieved,
    ).toContain('C07');
  });
  it('rejects duplicate/out-of-order units, invalid counts, unsafe sums and survival facts in classic', () => {
    const input = analysis([emptyRoom()]);
    input.rooms = [...input.rooms, ...input.rooms];
    expect(() => evaluateAchievementRun(input)).toThrow('位置唯一');
    expect(() =>
      evaluateAchievementRun(
        analysis([emptyRoom({ highestAwardOpportunities: 3 })]),
      ),
    ).toThrow();
    expect(() =>
      evaluateAchievementRun(analysis([emptyRoom({ hiddenAwardCopies: 1 })]), {
        ...emptyAchievementCounters(),
        hiddenCopies: Number.MAX_SAFE_INTEGER,
      }),
    ).toThrow();
    expect(() =>
      evaluateAchievementRun({
        ...analysis(),
        floors: [{ eligible: true, facts: floor() }],
      }),
    ).toThrow('经典');
  });
});

describe('survival layer/terminal boundaries and actual file facts', () => {
  it('uses tied lowest surviving layer scores, not eliminated lower scores', () => {
    expect(
      extractAchievementFloorFacts(floorRecord([10, 10, 1], ['human', 'ai-1'])),
    ).toMatchObject({ humanSurvived: true, lowestSurvivor: true });
    expect(
      extractAchievementFloorFacts(floorRecord([12, 10, 1], ['human', 'ai-1']))!
        .lowestSurvivor,
    ).toBe(false);
    expect(
      extractAchievementFloorFacts(floorRecord([1, 10, 10], ['ai-1', 'ai-2'])),
    ).toMatchObject({ humanEliminated: true, lowestSurvivor: false });
  });
  it('requires all official first three new layer passes, not old passes or any later three', () => {
    const input = {
      ...analysis(),
      mode: 'survival' as const,
      floors: [0, 1, 2].map((i) => ({ eligible: true, facts: floor(i) })),
    };
    expect(evaluateAchievementRun(input).achieved).toContain('F04');
    expect(
      evaluateAchievementRun({
        ...input,
        floors: input.floors.map((u, i) => ({ ...u, eligible: i === 2 })),
      }).achieved,
    ).not.toContain('F04');
    expect(
      evaluateAchievementRun({
        ...input,
        floors: [2, 3, 4].map((i) => ({ eligible: true, facts: floor(i) })),
      }).achieved,
    ).not.toContain('F04');
  });
  it('allows first-layer elimination and final-layer elimination together only after new terminal confirmation', () => {
    const input: AchievementRunAnalysis = {
      ...analysis(),
      mode: 'survival',
      floors: [
        {
          eligible: true,
          facts: floor(0, { humanSurvived: false, humanEliminated: true }),
        },
      ],
      final: {
        eligible: true,
        facts: {
          humanSurvived: false,
          highestDifficulty: false,
          lastEliminationFloor: 0,
          humanEliminationFloor: 0,
        },
      },
    };
    expect(evaluateAchievementRun(input).achieved).toEqual(['F01', 'F05']);
    expect(
      evaluateAchievementRun({ ...input, final: undefined }).achieved,
    ).toEqual(['F01']);
    expect(
      evaluateAchievementRun({
        ...input,
        floors: [{ ...input.floors[0]!, eligible: false }],
      }).achieved,
    ).toEqual([]);
    expect(
      evaluateAchievementRun({
        ...input,
        final: {
          eligible: true,
          facts: { ...input.final!.facts, lastEliminationFloor: 4 },
        },
      }).achieved,
    ).not.toContain('F05');
  });
  it('requires explicit highest difficulty and a live human terminal survivor, independent of ranking', () => {
    const input: AchievementRunAnalysis = {
      ...analysis(),
      mode: 'survival',
      final: {
        eligible: true,
        facts: {
          humanSurvived: true,
          highestDifficulty: true,
          lastEliminationFloor: 4,
          humanEliminationFloor: null,
        },
      },
    };
    expect(evaluateAchievementRun(input).achieved).toContain('F02');
    expect(
      evaluateAchievementRun({
        ...input,
        final: {
          eligible: true,
          facts: { ...input.final!.facts, highestDifficulty: false },
        },
      }).achieved,
    ).not.toContain('F02');
    expect(
      evaluateAchievementRun({
        ...input,
        final: { ...input.final!, eligible: false },
      }).achieved,
    ).not.toContain('F02');
  });
  it('has no RNG/storage side effects and yields the same classic analysis across current-v5 roundtrip', () => {
    const log = classicCompletionFixture(42, true).replay!;
    const original = canonicalJson(log);
    const restored = parseReplay(
      serializeReplay(log, 'achievement-roundtrip'),
    ).replay;
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw Error('判定不得随机');
    });
    try {
      const project = (replay: typeof log) => ({
        ...analysis(),
        entries: replay.rooms.map((r) => ({
          eligible: true,
          facts: extractAchievementEntryFacts(
            r.entryEvents,
            r.settlement.room.floorIndex,
            r.settlement.room.roomIndex,
          ),
        })),
        rooms: replay.rooms.map((r) => ({
          eligible: true,
          facts: extractAchievementRoomFacts(r.settlement)!,
        })),
      });
      expect(evaluateAchievementRun(project(restored))).toEqual(
        evaluateAchievementRun(project(log)),
      );
      expect(canonicalJson(log)).toBe(original);
    } finally {
      random.mockRestore();
    }
  });
  it('preserves frozen human scope and terminal facts across real 35-room survival file facts', () => {
    const log = survivalCompletionFixture();
    const restored = parseSurvivalReplay(serializeSurvivalReplay(log)).replay;
    const project = (replay: typeof log): AchievementRunAnalysis => ({
      mode: 'survival',
      source: 'formal',
      entries: replay.rooms.map((r) => ({
        eligible: true,
        facts: extractAchievementEntryFacts(
          r.entryEvents,
          r.room.floorIndex,
          r.room.roomIndex,
        ),
      })),
      rooms: replay.rooms.flatMap((r) => {
        const facts = extractAchievementRoomFacts(r);
        return facts ? [{ eligible: true, facts }] : [];
      }),
      floors: replay.floors.map((r) => ({
        eligible: true,
        facts: extractAchievementFloorFacts(r),
      })),
      final: { eligible: true, facts: extractAchievementFinalFacts(replay)! },
    });
    expect(evaluateAchievementRun(project(restored))).toEqual(
      evaluateAchievementRun(project(log)),
    );
    expect(project(log).rooms.length).toBeLessThanOrEqual(log.rooms.length);
    expect(extractAchievementFinalFacts({ ...log, final: null })).toBeNull();
    const missingDifficulty = structuredClone(log);
    delete missingDifficulty.ruleFacts.parameters.aiDifficulty;
    expect(
      extractAchievementFinalFacts(missingDifficulty)!.highestDifficulty,
    ).toBe(false);
  }, 20000);
});
