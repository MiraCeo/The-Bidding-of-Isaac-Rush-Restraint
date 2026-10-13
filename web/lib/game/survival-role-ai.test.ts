import { describe, it, expect } from 'vitest';
import {
  roleAwareSurvivalPlan,
  brimstoneCooperationEquivalent,
} from './survival-role-plan';
import { createRuntimePlayer, grantItemInstance } from './runtime';
import { createEmptyAiHistory } from './ai-analysis';
import {
  decideSurvivalAiTurn,
  decideLegacyTieredSurvivalAiTurn,
} from './survival-ai';
import { createSeededRandom } from './random';
import { defaultRules } from './config';
import { validateTurn, getRuntimeActionAmounts } from './turns';
import { characterOrder, assignCharacter } from './characters';
import type { SurvivalAiPlan } from './survival-ai-plan';
const raw: SurvivalAiPlan = {
  bankedScore: 100,
  cutLine: 500,
  targetScore: 500,
  scoreRankPercentile: 0.5,
  relativeRisk: 0.2,
  urgency: 1,
  expectedFutureScore: 180,
  moneyExchangeRatio: 0.1,
  reservedFutureMoney: 120,
  maximumActualCost: 200,
  safe: false,
};
describe('role-aware lower tiers retain budget, old behavior and doctrine boundaries', () => {
  it('applies double-action score correction rather than a flat Jacob income or score buff', () => {
    const p = createRuntimePlayer({
      id: 'ai-1',
      money: 1000,
      score: 0,
      isHuman: false,
    });
    grantItemInstance(p, {
      itemId: 'more_options',
      instanceId: 'double',
      acquiredOrder: 1,
    });
    const ordinary = roleAwareSurvivalPlan(p, raw, 1);
    p.characterId = 'jacob_esau';
    const jacob = roleAwareSurvivalPlan(p, raw, 1);
    expect(ordinary.expectedFutureScore).toBe(270);
    expect(jacob.expectedFutureScore).toBe(360);
    expect(jacob.maximumActualCost).toBe(raw.maximumActualCost);
    expect(jacob.reservedFutureMoney).toBe(raw.reservedFutureMoney);
    expect(p.money).toBe(1000);
  });
  it('leaves a single-action build or ablation forecast unchanged', () => {
    const p = createRuntimePlayer({
      id: 'ai-1',
      money: 1000,
      score: 0,
      isHuman: false,
    });
    expect(roleAwareSurvivalPlan(p, raw, 1).expectedFutureScore).toBe(
      raw.expectedFutureScore,
    );
    grantItemInstance(p, {
      itemId: 'more_options',
      instanceId: 'double',
      acquiredOrder: 1,
    });
    expect(roleAwareSurvivalPlan(p, raw, 0).expectedFutureScore).toBe(
      raw.expectedFutureScore,
    );
  });
  it('uses brimstone prediction only, with no change when precision is zero', () => {
    expect(brimstoneCooperationEquivalent(300, 300, 1)).toBe(250);
    expect(brimstoneCooperationEquivalent(300, 300, 0)).toBe(300);
    expect(brimstoneCooperationEquivalent(300, 300, 0.15)).toBeGreaterThan(290);
  });
  it.each(characterOrder)(
    'keeps every lower-tier turn legal and within actual shared budget for %s',
    (characterId) => {
      for (const survivalDifficulty of ['easy', 'standard', 'hard'] as const)
        for (let seed = 0; seed < 30; seed++) {
          const p = assignCharacter(
            createRuntimePlayer({
              id: 'ai-1',
              money: 1000,
              score: 0,
              isHuman: false,
            }),
            characterId,
            createSeededRandom(seed),
          );
          const before = structuredClone(p),
            roomIndex = seed % 5,
            rules = {
              ...defaultRules,
              floorStartingMoney: [1000],
              roomsPerFloor: [5],
            };
          const options = {
            doctrine: 'cooperative' as const,
            remainingRooms: 5 - roomIndex,
            survivalDifficulty,
            survivalAiPolicy: 'role-aware-1' as const,
            survivalDifficultyRandom: createSeededRandom(seed + 10),
            quoteRandom: createSeededRandom(seed + 20),
            personalities: [] as const,
            context: {
              moneyRankPercentile: 0.5,
              scoreRankPercentile: 0.5,
              recentMarkets: [],
              history: createEmptyAiHistory(),
              remainingGameRooms: 35 - roomIndex,
              room: {
                floorIndex: 0,
                roomIndex,
                kind: roomIndex === 4 ? ('boss' as const) : ('normal' as const),
                rewards: [
                  {
                    group: 'A' as const,
                    itemId: 'score_charm' as const,
                    hidden: false,
                  },
                  { group: 'B' as const, itemId: 'd6' as const, hidden: true },
                ] as const,
              },
            },
            survivalContext: {
              cutLine: 200,
              moneyExchangeRatio: 0.1,
              scoreInheritanceRatio: 0.2,
              minimumEliminations: 2,
              participants: [
                {
                  playerId: p.id,
                  money: p.money,
                  roomScore: 100,
                  previousSurvivalScore: 0,
                },
                {
                  playerId: 'ai-2',
                  money: 1000,
                  roomScore: 150,
                  previousSurvivalScore: 0,
                },
              ],
            },
          };
          const d = decideSurvivalAiTurn(
            p,
            0,
            rules,
            createSeededRandom(seed),
            options,
          );
          expect(p).toEqual(before);
          expect(validateTurn(p, d.turn, rules)).toEqual([]);
          expect(d.finalWeights.disrupt_high).toBe(0);
          const cost = d.turn.actions.reduce(
            (sum, a) => sum + getRuntimeActionAmounts(p, a, rules).actualCost,
            0,
          );
          expect(cost).toBeLessThanOrEqual(
            d.survivalAnalysis!.maximumActualCost,
          );
          expect(p.money - cost).toBeGreaterThanOrEqual(
            d.survivalAnalysis!.reservedFutureMoney,
          );
          const oldOptions = {
            ...options,
            survivalAiPolicy: undefined,
            survivalDifficultyRandom: createSeededRandom(seed + 10),
            quoteRandom: createSeededRandom(seed + 20),
          };
          expect(
            decideSurvivalAiTurn(
              p,
              0,
              rules,
              createSeededRandom(seed),
              oldOptions,
            ),
          ).toEqual(
            decideLegacyTieredSurvivalAiTurn(
              p,
              0,
              rules,
              createSeededRandom(seed),
              {
                ...oldOptions,
                survivalDifficultyRandom: createSeededRandom(seed + 10),
                quoteRandom: createSeededRandom(seed + 20),
              },
            ),
          );
        }
    },
  );
});
