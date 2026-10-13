import type { RuntimePlayerState, RoomKind } from './item-types';
import type { RulesConfig, PlayerAction } from './types';
import { countItem, hasItem } from './runtime';
import { getRuntimeActionAmounts } from './turns';
import { getDoubleActionScoreMultiplier } from './characters';

/** Public pre-submit layer facts only. No current turns, rival forecasts, tie RNG or future rewards. */
export interface SurvivalAiPublicContext {
  cutLine: number;
  moneyExchangeRatio: number;
  scoreInheritanceRatio: number;
  minimumEliminations: number;
  participants: readonly {
    playerId: string;
    money: number;
    roomScore: number;
    previousSurvivalScore: number;
  }[];
}
export interface SurvivalAiPlan {
  utilityInfluence?: number;
  cutLine: number;
  bankedScore: number;
  targetScore: number;
  scoreRankPercentile: number;
  relativeRisk: number;
  urgency: number;
  expectedFutureScore: number;
  moneyExchangeRatio: number;
  reservedFutureMoney: number;
  maximumActualCost: number;
  safe: boolean;
}
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/** Expected owned-build score; no new reward, dice draw, collar refund or hidden pool knowledge. */
export function estimateSurvivalTurnScore(
  player: RuntimePlayerState,
  actions: readonly PlayerAction[],
  target: number,
  highest: number,
  floorMoney: number,
  kind: RoomKind,
  rules: RulesConfig,
): number {
  const actualCost = actions.reduce(
    (sum, action) =>
      sum + getRuntimeActionAmounts(player, action, rules).actualCost,
    0,
  );
  const moneyAfter = Math.max(0, player.money - actualCost),
    sigma = floorMoney * rules.scoreSigmaRatio;
  let sum = 0;
  for (const action of actions) {
    if (action.type === 'withdraw') continue;
    let equivalent = getRuntimeActionAmounts(
      player,
      action,
      rules,
    ).scoringEquivalent!;
    if (action.type === 'bid' && hasItem(player, 'brimstone'))
      equivalent = clamp(target, action.amount * 0.8, action.amount * 1.25);
    if (action.type === 'disrupt' && hasItem(player, 'short_brimstone'))
      equivalent = clamp(target, equivalent * 0.85, equivalent * 1.2);
    sum +=
      rules.maximumBaseScore *
        Math.exp(-Math.abs(equivalent - target) / sigma) +
      countItem(player, 'score_charm') * 10 +
      countItem(player, 'blood_of_the_martyr') * 20 +
      countItem(player, 'poor_charm') *
        (moneyAfter < floorMoney * 0.3 ? 20 : 5) +
      countItem(player, 'moms_knife') *
        50 *
        Math.exp(-Math.abs(equivalent - highest / 4) / sigma);
  }
  const multiplier =
    rules.roomScoreMultipliers[kind] *
    1.5 ** countItem(player, 'sacred_heart') *
    1.25 ** countItem(player, 'pentagram') *
    (kind === 'boss' ? 2 ** countItem(player, 'moms_heart') : 1) *
    (7 / 6) ** countItem(player, 'd6') *
    1.125 ** countItem(player, 'eternal_d6') *
    1.25 ** countItem(player, 'whore_of_babylon') *
    (actions.length === 2 ? getDoubleActionScoreMultiplier(player) : 1);
  // Prediction is uncertain: below predicted T is a risk discount, not knowledge of the real clear.
  const clearRisk =
    hasItem(player, 'whore_of_babylon') &&
    actions.some((action) => action.type === 'bid' && action.amount < target)
      ? 0.25
      : 1;
  return sum * multiplier * clearRisk;
}

export function planSurvivalAi(
  player: RuntimePlayerState,
  roomIndex: number,
  kind: RoomKind,
  rules: RulesConfig,
  floorMoney: number,
  context: SurvivalAiPublicContext,
): SurvivalAiPlan {
  const own = context.participants.find(
    (entry) => entry.playerId === player.id,
  );
  if (!own) throw new Error('Missing public survival participant.');
  const projected = (entry: SurvivalAiPublicContext['participants'][number]) =>
    entry.roomScore +
    entry.money * context.moneyExchangeRatio +
    entry.previousSurvivalScore * context.scoreInheritanceRatio;
  const bankedScore = projected(own),
    scores = context.participants.map(projected).sort((a, b) => a - b);
  const below = scores.filter((score) => score < bankedScore).length,
    tied = scores.filter((score) => score === bankedScore).length;
  const scoreRankPercentile =
    scores.length < 2 ? 1 : (below + (tied - 1) / 2) / (scores.length - 1);
  const relativeRisk =
    roomIndex === 0
      ? 0
      : clamp(
          (context.minimumEliminations + 2 - below - (tied - 1) / 2) /
            (context.minimumEliminations + 2),
          0,
          1,
        ) *
        (roomIndex / 4);
  const cutoff =
    scores[Math.min(context.minimumEliminations - 1, scores.length - 1)]!;
  const targetScore = Math.max(context.cutLine, cutoff + floorMoney * 0.025);
  const ordinaryEstimate = estimateSurvivalTurnScore(
    player,
    [
      {
        type: 'bid',
        group: 'A',
        amount: Math.min(player.money, Math.round(floorMoney * 0.25)),
      },
    ],
    floorMoney * 0.3,
    floorMoney * 0.6,
    floorMoney,
    'normal',
    rules,
  );
  const typicalRoomScore =
    roomIndex > 0
      ? clamp(
          own.roomScore / roomIndex,
          ordinaryEstimate * 0.5,
          Math.max(ordinaryEstimate * 1.6, 50),
        )
      : ordinaryEstimate;
  const expectedFutureScore = typicalRoomScore * (5 - roomIndex) * 0.65;
  const absoluteRisk = clamp(
    (context.cutLine - bankedScore - expectedFutureScore) /
      Math.max(50, context.cutLine * 0.35),
    0,
    1,
  );
  const urgency = Math.max(absoluteRisk, relativeRisk);
  const safe =
    bankedScore >= targetScore + floorMoney * 0.025 && relativeRisk < 0.25;
  // Reserve for public future room positions, notably BOSS; never inspect their actual kinds/items.
  const futureWeights = [1.25, 1.5, 1.25, 1, 2].slice(roomIndex + 1);
  const currentWeight = rules.roomScoreMultipliers[kind],
    totalWeight =
      currentWeight + futureWeights.reduce((sum, value) => sum + value, 0);
  const reservedFutureMoney =
    roomIndex === 4
      ? 0
      : Math.min(
          Math.floor(player.money * 0.55),
          Math.ceil(
            (player.characterFloorStartingMoney ?? floorMoney) *
              0.12 *
              (1 - 0.35 * urgency),
          ),
        );
  const maximumActualCost =
    roomIndex === 4
      ? player.money
      : Math.max(
          0,
          Math.min(
            player.money - reservedFutureMoney,
            Math.floor(
              ((player.money * currentWeight) / totalWeight) *
                (1.2 + 0.45 * urgency),
            ),
          ),
        );
  return {
    cutLine: context.cutLine,
    bankedScore,
    targetScore,
    scoreRankPercentile,
    relativeRisk,
    urgency,
    expectedFutureScore,
    moneyExchangeRatio: context.moneyExchangeRatio,
    reservedFutureMoney,
    maximumActualCost,
    safe,
  };
}
