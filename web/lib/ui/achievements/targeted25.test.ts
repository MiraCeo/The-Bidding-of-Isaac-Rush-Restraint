import { expect, it } from 'vitest';
import { startSurvivalClient, survivalRoomRules } from '../survival-client';
import { startClientGame } from '../../game/client-session';
import { defaultRules } from '../../game/config';
import { validateTurn } from '../../game/turns';
import {
  targetPublicInput,
  chooseTargetTurn,
  freshTargetState,
  observeTargetRoom,
  confirmTargetFloor,
} from './targeted25-controller.test-helper';
import { chooseTarget25, runTarget25Match } from './targeted25.test-helper';
import { mixed25Seed, mixed25Plan } from '../../../scripts/mixed25-plan.mjs';
import {
  targeted25Seed,
  targeted25Plan,
} from '../../../scripts/targeted25-plan.mjs';
import {
  freshStudyProfile,
  advanceStudyProfile,
} from './current-study.test-helper';
import { mixed25Readout } from './mixed25.test-helper';
import { createRuntimePlayer } from '../../game/runtime';
import { settleRuntimeRoom } from '../../game/room-engine';
import type { ClientRoomSettlementRecord } from '../../game/client-session';
import type { SurvivalFloorRecord } from '../../game/survival-session';
import { canonicalJson } from '../../shared/json-facts';
import { sha256Hex } from '../../shared/sha256';
it('freezes 28 thresholds, pairs all 180 seeds and uses one new route only', () => {
  expect(targeted25Plan.targets).toEqual(mixed25Plan.targets);
  expect(targeted25Plan.routes).toEqual(['targeted']);
  for (let b = 0; b < 6; b++)
    for (let i = 0; i < 30; i++)
      expect(targeted25Seed(b, i)).toBe(mixed25Seed(b, i));
  expect(targeted25Seed(0, 0, true)).not.toBe(targeted25Seed(0, 0));
});
it('does not access current rival quotes, RNG, settlement, or a future room; hidden identities are inert', () => {
  const g = startClientGame('isaac', 42),
    h = g.players.find((p) => p.id === 'human')!;
  h.items.push({
    itemId: 'eternal_d6',
    instanceId: 'fixture',
    acquiredOrder: 2,
  });
  const room = g.rooms[0]![0]!;
  g.rooms = [
    [
      room,
      new Proxy(room, {
        get() {
          throw Error('future room read');
        },
      }),
    ],
  ];
  const before = JSON.stringify(h);
  for (const key of [
    'aiProfiles',
    'pendingRoomTurns',
    'revealedAiDecisions',
    'roomSettlement',
  ] as const)
    Object.defineProperty(g, key, {
      get() {
        throw Error('private state read');
      },
    });
  const decide = () =>
    chooseTargetTurn(
      targetPublicInput(g),
      defaultRules,
      ['C13'],
      freshTargetState(),
      false,
    );
  room.rewards = [
    { group: 'A', hidden: true, itemId: 'whore_of_babylon' },
    { group: 'B', hidden: true, itemId: 'more_options' },
  ];
  const first = decide();
  room.rewards = [
    { group: 'A', hidden: true, itemId: 'holy_mantle' },
    { group: 'B', hidden: true, itemId: 'transcendence' },
  ];
  expect(decide()).toEqual(first);
  expect(JSON.stringify(h)).toBe(before);
  expect(validateTurn(h, first.turn, defaultRules)).toEqual([]);
  expect(first.goal).not.toBe('visible-item');
});
it('only attempts full capital when actual debit clears the role-adjusted 50 percent condition', () => {
  const g = startClientGame('lost', 5),
    input = targetPublicInput(g),
    h = input.human;
  const choose = () =>
    chooseTargetTurn(input, defaultRules, ['D12'], freshTargetState(), false);
  expect(choose().goal).toBe('capital');
  expect(choose().actualCost).toBe(h.money);
  h.money = 1;
  expect(choose().eligible.capital).toBe(false);
  expect(choose().goal).not.toBe('capital');
  h.money = 100;
  for (let i = 0; i < 3; i++)
    h.items.push({
      itemId: 'steam_sale',
      instanceId: 'sale' + i,
      acquiredOrder: 10 + i,
    });
  expect(choose().eligible.capital).toBe(false);
});
it('provides legal distinct-group double bids and disruptions, never calls redemption a vacancy', () => {
  const g = startClientGame('jacob_esau', 3),
    input = targetPublicInput(g),
    h = input.human;
  for (const [missing, goal] of [
    [['B07'], 'double-bid'],
    [['C15'], 'double-disrupt'],
  ] as const) {
    const d = chooseTargetTurn(
      input,
      defaultRules,
      missing,
      freshTargetState(),
      false,
    );
    expect(d.goal).toBe(goal);
    expect(d.turn.actions).toHaveLength(2);
    expect(validateTurn(h, d.turn, defaultRules)).toEqual([]);
  }
  h.items.push({ itemId: 'transcendence', instanceId: 't', acquiredOrder: 10 });
  const d = chooseTargetTurn(
    input,
    defaultRules,
    ['C15', 'C14'],
    freshTargetState(),
    false,
  );
  expect(d.eligible.doubleDisrupt).toBe(false);
  expect(d.goal).toBe('redemption');
});
it('does not infer successes from holding items or intentions; low all-in and starting mantle do not count', () => {
  const h = createRuntimePlayer({
      id: 'human',
      money: 1,
      score: 0,
      isHuman: true,
    }),
    a = createRuntimePlayer({ id: 'ai', money: 100, score: 0, isHuman: false });
  h.characterId = 'lost';
  h.characterFloorStartingMoney = 100;
  h.items = [
    { itemId: 'holy_mantle', instanceId: 'starting', acquiredOrder: 1 },
  ];
  a.characterFloorStartingMoney = 100;
  const room = {
      floorIndex: 0,
      roomIndex: 0,
      kind: 'normal' as const,
      rewards: [
        { group: 'A' as const, itemId: 'score_charm' as const, hidden: false },
        { group: 'B' as const, itemId: 'poor_charm' as const, hidden: false },
      ] as const,
    },
    turns = [
      {
        playerId: 'human',
        actions: [{ type: 'bid' as const, group: 'A' as const, amount: 1 }],
      },
      {
        playerId: 'ai',
        actions: [{ type: 'bid' as const, group: 'A' as const, amount: 30 }],
      },
    ],
    settled = settleRuntimeRoom(room, [h, a], turns, defaultRules, {
      next: () => 0.9,
    }),
    record: ClientRoomSettlementRecord = {
      ...settled,
      room,
      turns,
      playersBefore: [h, a],
    },
    r = observeTargetRoom(freshTargetState(), record);
  expect(r.actual.success).not.toContain('D12');
  expect(r.actual.success).not.toContain('E18');
  expect(r.actual.success).not.toContain('C15');
  expect(r.state.redeemedRooms).toEqual([]);
});
it('switches edge to scoring only after a settled actual lowest-survivor floor, not an intended attempt', () => {
  const g = startSurvivalClient('isaac', 42, 'standard').game,
    input = targetPublicInput(g),
    rules = survivalRoomRules(g),
    state = freshTargetState();
  expect(chooseTargetTurn(input, rules, [], state, true).goal).toBe('edge');
  const floor = {
    floorIndex: 0,
    activePlayerIds: ['human', 'other'],
    scores: { human: { survivalScore: 400 }, other: { survivalScore: 300 } },
    plan: { survivorIds: ['human', 'other'], eliminations: [] },
  } as unknown as SurvivalFloorRecord;
  expect(confirmTargetFloor(state, floor).lowestConfirmed).toBe(false);
  floor.scores.human!.survivalScore = 300;
  const confirmed = confirmTargetFloor(state, floor);
  expect(confirmed.lowestConfirmed).toBe(true);
  expect(
    chooseTargetTurn(
      input,
      rules,
      ['D12', 'C15', 'B07', 'C14'],
      confirmed,
      true,
    ).goal,
  ).toBe('score');
  expect(state.lowestConfirmed).toBe(false);
});
it('counts actual full-capital debit without requiring a prize and deduplicates redemption rooms', () => {
  const h = createRuntimePlayer({
      id: 'human',
      money: 100,
      score: 0,
      isHuman: true,
    }),
    a = createRuntimePlayer({ id: 'ai', money: 400, score: 0, isHuman: false });
  h.characterFloorStartingMoney = 100;
  a.characterFloorStartingMoney = 100;
  const room = {
    floorIndex: 0,
    roomIndex: 0,
    kind: 'normal' as const,
    rewards: [
      { group: 'A' as const, itemId: 'score_charm' as const, hidden: false },
      { group: 'B' as const, itemId: 'poor_charm' as const, hidden: false },
    ] as const,
  };
  const settle = (disrupt: boolean): ClientRoomSettlementRecord => {
    const turns = [
      {
        playerId: 'human',
        actions: [
          {
            type: disrupt ? ('disrupt' as const) : ('bid' as const),
            group: 'A' as const,
            amount: disrupt ? 40 : 100,
          },
        ],
      },
      {
        playerId: 'ai',
        actions: [
          {
            type: 'bid' as const,
            group: 'A' as const,
            amount: disrupt ? 20 : 300,
          },
        ],
      },
    ];
    return {
      ...settleRuntimeRoom(room, [h, a], turns, defaultRules, {
        next: () => (disrupt ? 0.1 : 0.9),
      }),
      room,
      turns,
      playersBefore: [h, a],
    };
  };
  const full = observeTargetRoom(freshTargetState(), settle(false));
  expect(full.actual.success).toContain('D12');
  expect(full.actual.awards).toHaveLength(0);
  h.items.push({ itemId: 'transcendence', instanceId: 't', acquiredOrder: 1 });
  const r = settle(true),
    once = observeTargetRoom(freshTargetState(), r);
  expect(once.actual.redeemed).toBe(true);
  expect(observeTargetRoom(once.state, r).actual.success).not.toContain('C14');
  expect(
    observeTargetRoom(once.state, { ...r, room: { ...room, roomIndex: 1 } })
      .actual.success,
  ).toContain('C14');
});
it('reads dual qualification before More Options destruction, not the post-destruction entitlement map', () => {
  const h = createRuntimePlayer({
      id: 'human',
      money: 100,
      score: 0,
      isHuman: true,
    }),
    a = createRuntimePlayer({ id: 'ai', money: 100, score: 0, isHuman: false });
  h.characterId = 'jacob_esau';
  h.characterFloorStartingMoney = 120;
  h.items = [{ itemId: 'more_options', instanceId: 'o', acquiredOrder: 1 }];
  const room = {
      floorIndex: 0,
      roomIndex: 0,
      kind: 'normal' as const,
      rewards: [
        { group: 'A' as const, itemId: 'score_charm' as const, hidden: false },
        { group: 'B' as const, itemId: 'poor_charm' as const, hidden: false },
      ] as const,
    },
    turns = [
      {
        playerId: 'human',
        actions: [
          { type: 'bid' as const, group: 'A' as const, amount: 20 },
          { type: 'bid' as const, group: 'B' as const, amount: 22 },
        ],
      },
      {
        playerId: 'ai',
        actions: [{ type: 'bid' as const, group: 'A' as const, amount: 5 }],
      },
    ],
    record = {
      ...settleRuntimeRoom(room, [h, a], turns, defaultRules, {
        next: () => 0.1,
      }),
      room,
      turns,
      playersBefore: [h, a],
    },
    observed = observeTargetRoom(freshTargetState(), record);
  expect(
    record.entitlements.filter((e) => e.playerId === 'human'),
  ).toHaveLength(1);
  expect(observed.actual.success).toContain('B07');
  expect(observed.actual.doubleQualified).toBe(true);
});
it('runs deterministic real authority, actual unlocks and production profile without shadow writes', () => {
  const p = freshStudyProfile(),
    before = JSON.stringify(p),
    choice = chooseTarget25(1, p, [], {}, 0),
    seed = targeted25Seed(0, 0, true),
    a = runTarget25Match(seed, choice, ['D12', 'E13']),
    b = runTarget25Match(seed, choice, ['D12', 'E13']);
  expect(a).toEqual(b);
  expect(a.traceFingerprint).toBe(sha256Hex(canonicalJson(a.context)));
  expect(a.context.units.at(-1)?.stage).toBe('complete');
  expect(a.humanRooms).toBe(15);
  const advanced = advanceStudyProfile(p, a.context, 1, true),
    earned = mixed25Readout(advanced.progress, advanced.achieved).candidate;
  const next = chooseTarget25(2, advanced.profile, earned, { isaac: 1 }, 0);
  expect(next.available).toContain(next.role);
  expect(next.mode).toBe('survival');
  expect(JSON.stringify(p)).toBe(before);
  expect(a.attempts.every((r) => r.goal !== 'capital')).toBe(true); // Isaac champion precedence.
}, 60000);
