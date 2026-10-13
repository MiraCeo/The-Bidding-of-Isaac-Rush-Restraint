import { describe, expect, it } from 'vitest';
import { defaultRules } from './config';
import { createSeededRandom } from './random';
import { createRuntimePlayer, grantItemInstance } from './runtime';
import { decideAiTurn, type AiDecisionOptions } from './ai-decision';
import {
  decideSurvivalAiTurn,
  decideHighestSurvivalAiTurn,
} from './survival-ai';
import {
  planSurvivalAi,
  estimateSurvivalTurnScore,
  type SurvivalAiPublicContext,
} from './survival-ai-plan';
import { createEmptyAiHistory, type AiDecisionContext } from './ai-analysis';
import { validateTurn, getRuntimeActionAmounts } from './turns';
import type { ItemId, RuntimePlayerState, RoomKind } from './item-types';

const rules = {
  ...defaultRules,
  floorStartingMoney: Array(7).fill(1000),
  roomsPerFloor: Array(7).fill(5),
};
function player(items: ItemId[] = [], money = 1000): RuntimePlayerState {
  const p = createRuntimePlayer({
    id: 'ai-1',
    money,
    score: 99999,
    isHuman: false,
  });
  p.characterId = 'isaac';
  p.characterFloorStartingMoney = 1100;
  items.forEach((id, i) =>
    grantItemInstance(p, {
      itemId: id,
      instanceId: `test-${i}`,
      acquiredOrder: i + 1,
    }),
  );
  return p;
}
function publicState(
  own = 100,
  others = [150, 200, 300, 400, 500],
  cutLine = 200,
): SurvivalAiPublicContext {
  return {
    cutLine,
    moneyExchangeRatio: 0.1,
    scoreInheritanceRatio: 0.2,
    minimumEliminations: 2,
    participants: [
      {
        playerId: 'ai-1',
        money: 1000,
        roomScore: own,
        previousSurvivalScore: 100,
      },
      ...others.map((roomScore, i) => ({
        playerId: `other-${i}`,
        money: 1000,
        roomScore,
        previousSurvivalScore: 100,
      })),
    ],
  };
}
function options(
  roomIndex = 0,
  kind: RoomKind = 'normal',
  pub = publicState(),
): AiDecisionOptions & {
  context: AiDecisionContext;
  survivalContext: SurvivalAiPublicContext;
} {
  return {
    survivalContext: pub,
    remainingRooms: 5 - roomIndex,
    doctrine: 'balanced' as const,
    personalities: [] as const,
    quoteRandom: createSeededRandom(83),
    context: {
      moneyRankPercentile: 0.5,
      scoreRankPercentile: 1,
      recentMarkets: [],
      history: createEmptyAiHistory(),
      room: {
        floorIndex: 0,
        roomIndex,
        kind,
        rewards: [
          { group: 'A' as const, itemId: 'steam_sale' as const, hidden: false },
          { group: 'B' as const, itemId: 'score_charm' as const, hidden: true },
        ] as const,
      },
      remainingGameRooms: 35 - roomIndex,
    },
  };
}
describe('survival-only public score and economy policy', () => {
  it('highest bypasses all difficulty noise and retains frozen decisions', () => {
    for (let seed = 0; seed < 100; seed++) {
      const room = seed % 5,
        p = player([], 1000 - seed),
        baseline = options(room, room === 4 ? 'boss' : 'normal');
      const expected = decideHighestSurvivalAiTurn(
        p,
        0,
        rules,
        createSeededRandom(seed),
        baseline,
      );
      const actual = decideSurvivalAiTurn(
        p,
        0,
        rules,
        createSeededRandom(seed),
        {
          ...options(room, room === 4 ? 'boss' : 'normal'),
          survivalDifficulty: 'highest',
          survivalDifficultyRandom: {
            next() {
              throw new Error('Highest must not consume difficulty RNG');
            },
          },
        },
      );
      expect(actual).toEqual(expected);
    }
  });
  it('lower tiers keep legal actual-cost caps, reserve funds and player state unchanged', () => {
    for (const survivalDifficulty of ['easy', 'standard', 'hard'] as const)
      for (let seed = 0; seed < 100; seed++) {
        const p = player(
            seed % 2
              ? ['brimstone', 'more_options']
              : ['steam_sale', 'score_charm'],
            250 + seed * 3,
          ),
          before = structuredClone(p),
          room = seed % 5;
        const decision = decideSurvivalAiTurn(
          p,
          0,
          rules,
          createSeededRandom(seed),
          {
            ...options(room, room === 4 ? 'boss' : 'normal'),
            survivalDifficulty,
            survivalDifficultyRandom: createSeededRandom(seed + 1000),
          },
        );
        expect(p).toEqual(before);
        expect(validateTurn(p, decision.turn, rules)).toEqual([]);
        const cost = decision.turn.actions.reduce(
          (sum, action) =>
            sum + getRuntimeActionAmounts(p, action, rules).actualCost,
          0,
        );
        expect(cost).toBeLessThanOrEqual(
          decision.survivalAnalysis!.maximumActualCost,
        );
        expect(p.money - cost).toBeGreaterThanOrEqual(
          decision.survivalAnalysis!.reservedFutureMoney,
        );
      }
  });
  it('is exactly classic when no survival context is supplied', () => {
    const p = player();
    expect(decideSurvivalAiTurn(p, 0, rules, createSeededRandom(42))).toEqual(
      decideAiTurn(p, 0, rules, createSeededRandom(42)),
    );
  });
  it('uses layer R, cash exchange and inherited S instead of cumulative room points', () => {
    const plan = planSurvivalAi(
      player(),
      4,
      'boss',
      rules,
      1000,
      publicState(100),
    );
    expect(plan.bankedScore).toBe(220);
    expect(plan.scoreRankPercentile).toBe(0);
    expect(plan.relativeRisk).toBe(1);
    expect(plan.safe).toBe(false);
  });
  it('does not mark a lowest player safe just because the cut line was passed', () => {
    const plan = planSurvivalAi(
      player(),
      4,
      'boss',
      rules,
      1000,
      publicState(400, [500, 600, 700, 800, 900], 200),
    );
    expect(plan.bankedScore).toBeGreaterThan(200);
    expect(plan.safe).toBe(false);
    expect(plan.targetScore).toBeGreaterThan(plan.bankedScore);
    expect(plan.urgency).toBe(1);
  });
  it('retains a safe leader classification only above both absolute and relative targets', () => {
    const plan = planSurvivalAi(
      player(),
      4,
      'boss',
      rules,
      1000,
      publicState(900, [100, 200, 300, 400, 500], 200),
    );
    expect(plan.safe).toBe(true);
    expect(plan.relativeRisk).toBe(0);
    expect(plan.scoreRankPercentile).toBe(1);
  });
  it('treats same-score participants symmetrically, without private tie-break RNG', () => {
    const plan = planSurvivalAi(
      player(),
      4,
      'boss',
      rules,
      1000,
      publicState(100, [100, 100, 100, 100, 100], 200),
    );
    expect(plan.scoreRankPercentile).toBe(0.5);
    expect(plan.safe).toBe(false);
  });
  it('reserves future funds before BOSS and releases the restriction in the final room', () => {
    const p = player(),
      pub = publicState();
    const early = planSurvivalAi(p, 0, 'normal', rules, 1000, pub),
      boss = planSurvivalAi(p, 4, 'boss', rules, 1000, pub);
    expect(early.reservedFutureMoney).toBeGreaterThan(0);
    expect(early.maximumActualCost).toBeLessThan(300);
    expect(boss.maximumActualCost).toBe(p.money);
    expect(boss.reservedFutureMoney).toBe(0);
  });
  it('counts 10% only once and does not multiply exchanged or inherited points by inventory', () => {
    const plain = planSurvivalAi(
        player(),
        4,
        'boss',
        rules,
        1000,
        publicState(),
      ),
      strong = planSurvivalAi(
        player(['sacred_heart', 'pentagram']),
        4,
        'boss',
        rules,
        1000,
        publicState(),
      );
    expect(strong.bankedScore).toBe(plain.bankedScore);
  });
  it('preserves doctrine zero weights and personality-driven diversity', () => {
    const opts = {
      ...options(4, 'boss', publicState(0, [], 500)),
      doctrine: 'cooperative' as const,
    };
    const d = decideSurvivalAiTurn(
      player(),
      0,
      rules,
      createSeededRandom(42),
      opts,
    );
    expect(d.finalWeights.disrupt_high).toBe(0);
    expect(d.survivalAnalysis).toBeDefined();
  });
  it('does not inspect the hidden reward when calculating survival pressure or quotes', () => {
    const a = options(),
      b = options();
    b.context.room = {
      ...b.context.room,
      rewards: [
        a.context.room.rewards[0],
        { ...a.context.room.rewards[1], itemId: 'sacred_heart' },
      ],
    };
    const before = JSON.stringify(a.survivalContext);
    expect(
      decideSurvivalAiTurn(player(), 0, rules, createSeededRandom(71), a),
    ).toEqual(
      decideSurvivalAiTurn(player(), 0, rules, createSeededRandom(71), b),
    );
    expect(JSON.stringify(a.survivalContext)).toBe(before);
  });
  it('includes owned-build effects and expected dice without drawing settlement random outcomes', () => {
    const plain = estimateSurvivalTurnScore(
      player(),
      [{ type: 'bid', group: 'A', amount: 300 }],
      300,
      600,
      1000,
      'boss',
      rules,
    );
    const strong = estimateSurvivalTurnScore(
      player(['sacred_heart', 'moms_heart', 'd6']),
      [{ type: 'bid', group: 'A', amount: 300 }],
      300,
      600,
      1000,
      'boss',
      rules,
    );
    expect(plain).toBe(200);
    expect(strong).toBeCloseTo(700);
  });
  it('discounts a risky below-prediction bid without declaring that the real room will clear', () => {
    const p = player(['whore_of_babylon']);
    expect(
      estimateSurvivalTurnScore(
        p,
        [{ type: 'bid', group: 'A', amount: 100 }],
        300,
        600,
        1000,
        'normal',
        rules,
      ),
    ).toBeGreaterThan(0);
  });
  it.each(
    (
      [
        [],
        ['steam_sale', 'steam_sale', 'steam_sale'],
        ['more_options', 'more_options_question'],
        ['more_options', 'steam_sale', 'poor_charm'],
      ] as ItemId[][]
    ).map((items) => ({ items })),
  )(
    'keeps legal nominal/actual dual caps and future reserve for inventory $items',
    ({ items }) => {
      for (let seed = 0; seed < 100; seed++) {
        const p = player(items),
          d = decideSurvivalAiTurn(
            p,
            0,
            rules,
            createSeededRandom(seed),
            options(2, 'hidden'),
          );
        expect(validateTurn(p, d.turn, rules)).toEqual([]);
        const cost = d.turn.actions.reduce(
          (sum, action) =>
            sum + getRuntimeActionAmounts(p, action, rules).actualCost,
          0,
        );
        expect(cost).toBeLessThanOrEqual(d.survivalAnalysis!.maximumActualCost);
        expect(p.money - cost).toBeGreaterThanOrEqual(
          d.survivalAnalysis!.reservedFutureMoney,
        );
      }
    },
  );
  it('withdraws cleanly with zero funds while retaining a finite analysis', () => {
    const p = player([], 0),
      opts = options();
    opts.survivalContext.participants = [
      { playerId: p.id, money: 0, roomScore: 0, previousSurvivalScore: 0 },
    ];
    const d = decideSurvivalAiTurn(p, 0, rules, createSeededRandom(42), opts);
    expect(d.turn.actions).toEqual([{ type: 'withdraw' }]);
    expect(Number.isFinite(d.survivalAnalysis!.maximumActualCost)).toBe(true);
  });
});
