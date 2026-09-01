import { getItemDefinition } from './item-catalog';
import type { GeneratedRoom, ItemId, RuntimePlayerState } from './item-types';
import { countItem, hasItem } from './runtime';
import type { AiStrategy, AiStrategyWeights } from './ai-decision';
import type { RewardGroup } from './types';

export type AiItemType = 'score' | 'economy' | 'acquisition' | 'protection' | 'risk' | 'utility';
export type AiBenefitHorizon = 'immediate' | 'short' | 'long';

export interface AiItemProfile {
  strength: number;
  types: readonly AiItemType[];
  horizon: AiBenefitHorizon;
  affinities?: Partial<Record<AiStrategy, number>>;
  synergies?: readonly ItemId[];
}

export interface AiPublicMarketSnapshot {
  targetRatio: number;
  participationRate: number;
  disruptionRate: number;
  /** Highest market-equivalent sample divided by this floor's starting money. */
  highestMarketEquivalentRatio?: number;
  /** Cutoff market-equivalent ratio for the high-price top-20% qualification. */
  highPriceQualificationRatio?: number;
}

export interface AiPlayerHistory {
  rounds: number;
  competitiveRounds: number;
  awards: number;
  failedCompetitiveRounds: number;
  strategyCounts: Record<AiStrategy, number>;
  lastStrategy: AiStrategy | null;
}

export interface AiDecisionContext {
  /** 1 is the richest/highest-scoring player and 0 is the last player. */
  moneyRankPercentile: number;
  scoreRankPercentile: number;
  recentMarkets: readonly AiPublicMarketSnapshot[];
  history: AiPlayerHistory;
  room: GeneratedRoom;
  remainingGameRooms: number;
}

export interface AiAnalysisResult {
  situationMultipliers: AiStrategyWeights;
  itemMultipliers: AiStrategyWeights;
  groupWeights: Record<RewardGroup, number>;
  groupValues: Record<RewardGroup, number>;
  inventoryPower: number;
}

const profile = (
  strength: number,
  types: readonly AiItemType[],
  horizon: AiBenefitHorizon,
  affinities?: Partial<Record<AiStrategy, number>>,
  synergies?: readonly ItemId[],
): AiItemProfile => ({ strength, types, horizon, affinities, synergies });

/** Provisional values live in one table so simulations can calibrate them without rewriting logic. */
export const aiItemProfiles: Readonly<Record<ItemId, AiItemProfile>> = {
  moms_knife: profile(0.9, ['score'], 'long', { high_bid: 0.2, cooperate: 0.1 }),
  sacred_heart: profile(0.95, ['score'], 'long', { high_bid: 0.25 }),
  brimstone: profile(0.88, ['score', 'utility'], 'long', { cooperate: 0.25 }),
  moms_heart: profile(0.92, ['score'], 'immediate', { high_bid: 0.3 }),
  lucky_foot: profile(0.7, ['acquisition'], 'long', { cooperate: 0.35 }),
  transcendence: profile(
    0.58,
    ['acquisition'],
    'long',
    { disrupt_high: 0.35, disrupt_cooperate: 0.6 },
    ['short_brimstone', 'more_options_question'],
  ),
  short_brimstone: profile(
    0.62,
    ['score', 'utility'],
    'long',
    { disrupt_high: 0.1, disrupt_cooperate: 0.45 },
    ['transcendence'],
  ),
  pentagram: profile(0.82, ['score'], 'long', { high_bid: 0.15 }),
  guppys_collar: profile(0.68, ['economy', 'protection'], 'long'),
  holy_mantle: profile(0.8, ['economy', 'protection'], 'long'),
  twenty_twenty: profile(0.62, ['acquisition'], 'long', { high_bid: 0.25 }),
  blood_of_the_martyr: profile(0.82, ['score'], 'long', { high_bid: 0.15, cooperate: 0.1 }),
  steam_sale: profile(0.76, ['economy'], 'long', { high_bid: 0.15 }),
  money_bag: profile(0.66, ['economy'], 'long'),
  poor_charm: profile(0.7, ['score'], 'long', { cooperate: 0.1 }),
  grab_bag: profile(0.58, ['economy'], 'immediate'),
  score_charm: profile(0.63, ['score'], 'long'),
  interest: profile(0.66, ['economy'], 'long'),
  d6: profile(0.62, ['score', 'risk'], 'long'),
  wooden_cross: profile(0.52, ['economy', 'protection'], 'long'),
  more_options: profile(0.42, ['acquisition', 'risk'], 'long'),
  more_options_question: profile(
    0.38,
    ['acquisition', 'risk'],
    'long',
    { disrupt_high: 0.2, disrupt_cooperate: 0.3 },
    ['transcendence'],
  ),
  dark_princes_crown: profile(0.64, ['score', 'risk'], 'long'),
  eternal_d6: profile(0.58, ['score', 'risk'], 'long'),
  whore_of_babylon: profile(0.48, ['score', 'risk'], 'long', { high_bid: 0.45, cooperate: -0.2 }),
  guppys_tail: profile(0.46, ['acquisition', 'risk'], 'long', undefined, ['grab_bag']),
};

const strategyOrder: readonly AiStrategy[] = [
  'high_bid',
  'cooperate',
  'disrupt_high',
  'disrupt_cooperate',
  'withdraw',
];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function productMultipliers(...values: number[]): number {
  return clamp(values.reduce((result, value) => result * value, 1), 0.35, 2.5);
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function horizonFactor(horizon: AiBenefitHorizon, remainingGameRooms: number): number {
  const remainingRatio = clamp((remainingGameRooms - 1) / 14, 0, 1);
  if (horizon === 'immediate') return 1;
  if (horizon === 'short') return 0.75 + remainingRatio * 0.25;
  return 0.4 + remainingRatio * 0.6;
}

function visibleRewardValue(
  itemId: ItemId,
  player: RuntimePlayerState,
  remainingGameRooms: number,
): number {
  const itemProfile = aiItemProfiles[itemId];
  const definition = getItemDefinition(itemId);
  const copies = countItem(player, itemId);
  if (!definition.effectStacks && copies > 0) return 0.08;
  const duplicateFactor = copies === 0 ? 1 : 0.82 ** copies;
  const synergyCount = (itemProfile.synergies ?? []).filter((owned) => hasItem(player, owned)).length;
  const synergyFactor = 1 + synergyCount * 0.18;
  return clamp(
    itemProfile.strength *
      horizonFactor(itemProfile.horizon, remainingGameRooms) *
      duplicateFactor *
      synergyFactor,
    0.05,
    1.25,
  );
}

function calculateSituationMultipliers(context: AiDecisionContext): AiStrategyWeights {
  const moneyRank = clamp(context.moneyRankPercentile, 0, 1);
  const scoreRank = clamp(context.scoreRankPercentile, 0, 1);
  const moneyPressure = 1 - moneyRank;
  const scorePressure = 1 - scoreRank;
  const recentTarget = mean(context.recentMarkets.map((market) => market.targetRatio));
  const marketHeat = context.recentMarkets.length === 0
    ? 0
    : clamp((recentTarget - 0.3) / 0.15, -1, 1);
  const recentParticipation = context.recentMarkets.length === 0
    ? 0.8
    : mean(context.recentMarkets.map((market) => market.participationRate));
  const participationPressure = clamp((recentParticipation - 0.75) / 0.25, -1, 1);
  const recentDisruption = context.recentMarkets.length === 0
    ? 0.1
    : mean(context.recentMarkets.map((market) => market.disruptionRate));
  const disruptionPressure = clamp((recentDisruption - 0.1) / 0.2, -1, 1);
  const history = context.history;
  const successRate = history.competitiveRounds === 0
    ? 0.5
    : clamp(history.awards / history.competitiveRounds, 0, 1);
  const failureRate = history.competitiveRounds === 0
    ? 0
    : clamp(history.failedCompetitiveRounds / history.competitiveRounds, 0, 1);

  return {
    high_bid: productMultipliers(
      0.95 + moneyRank * 0.25,
      1 + scorePressure * 0.18 + scoreRank * 0.12,
      1 + marketHeat * 0.1,
      1 + participationPressure * 0.05,
      0.95 + successRate * 0.2,
      1 + failureRate * 0.1,
    ),
    cooperate: productMultipliers(
      0.98 + moneyRank * 0.12,
      1 + scorePressure * 0.05 + scoreRank * 0.08,
      1 - Math.abs(marketHeat) * 0.03,
      1 + participationPressure * 0.08,
      1 - disruptionPressure * 0.04,
      0.98 + successRate * 0.12,
    ),
    disrupt_high: productMultipliers(
      0.95 + moneyRank * 0.12,
      0.95 + scoreRank * 0.1,
      1 + marketHeat * 0.12,
      1 - disruptionPressure * 0.15,
      1 + failureRate * 0.08,
    ),
    disrupt_cooperate: productMultipliers(
      1 + moneyPressure * 0.18,
      1 + scorePressure * 0.12,
      1 + marketHeat * 0.05,
      1 - disruptionPressure * 0.08,
      1 + failureRate * 0.2,
    ),
    withdraw: productMultipliers(
      0.72 + moneyPressure * 0.12,
      0.78 + scoreRank * 0.12,
      0.9 + marketHeat * 0.08,
      0.95 + disruptionPressure * 0.05,
    ),
  };
}

function calculateItemAnalysis(
  player: RuntimePlayerState,
  context: AiDecisionContext,
): Pick<AiAnalysisResult, 'itemMultipliers' | 'groupWeights' | 'groupValues' | 'inventoryPower'> {
  const values = Object.fromEntries(
    context.room.rewards.map((reward) => {
      const value = reward.hidden
        ? 0.52 * horizonFactor('long', context.remainingGameRooms)
        : visibleRewardValue(reward.itemId, player, context.remainingGameRooms);
      return [reward.group, value];
    }),
  ) as Record<RewardGroup, number>;
  const visibleProfiles = context.room.rewards.flatMap((reward) =>
    reward.hidden ? [] : [aiItemProfiles[reward.itemId]],
  );
  const bestValue = Math.max(values.A, values.B);
  const averageValue = (values.A + values.B) / 2;
  const inventoryStrengths = player.items.map((instance) => aiItemProfiles[instance.itemId].strength);
  const inventoryPower = clamp(mean(inventoryStrengths) * Math.min(1, player.items.length / 5), 0, 1);
  const affinity = (strategy: AiStrategy): number =>
    Math.max(0, ...visibleProfiles.map((itemProfile) => itemProfile.affinities?.[strategy] ?? 0));

  let highBid = 0.8 + bestValue * 0.85 + affinity('high_bid');
  let cooperate = 0.85 + averageValue * 0.5 + affinity('cooperate');
  let disruptCooperate = hasItem(player, 'transcendence')
    ? 0.8 + bestValue * 0.7
    : 1.1 - averageValue * 0.2;
  disruptCooperate += affinity('disrupt_cooperate');
  let disruptHigh = hasItem(player, 'transcendence')
    ? 0.85 + bestValue * 0.55
    : 0.75 + bestValue * 0.35;
  disruptHigh += affinity('disrupt_high');
  let withdraw = 1.05 - bestValue * 0.7;

  // Strong builds pursue extensions rather than automatically protecting a lead.
  highBid *= 1 + inventoryPower * 0.18;
  cooperate *= 1 + inventoryPower * 0.08;
  disruptHigh *= 1 + inventoryPower * 0.04;
  disruptCooperate *= 1 + inventoryPower * 0.05;
  withdraw *= 1 - inventoryPower * 0.25;
  if (hasItem(player, 'short_brimstone')) disruptCooperate *= 1.35;
  if (hasItem(player, 'lucky_foot')) cooperate *= 1.3;
  if (hasItem(player, 'whore_of_babylon')) {
    highBid *= 1.7;
    cooperate *= 0.45;
  }
  if (hasItem(player, 'brimstone')) cooperate *= 1.2;
  if (hasItem(player, 'holy_mantle') || hasItem(player, 'steam_sale')) highBid *= 1.12;

  return {
    itemMultipliers: {
      high_bid: clamp(highBid, 0.35, 2.5),
      cooperate: clamp(cooperate, 0.35, 2.5),
      disrupt_high: clamp(disruptHigh, 0.35, 2.5),
      disrupt_cooperate: clamp(disruptCooperate, 0.35, 2.5),
      withdraw: clamp(withdraw, 0.35, 2.5),
    },
    groupValues: values,
    groupWeights: {
      A: 0.08 + values.A ** 2.3,
      B: 0.08 + values.B ** 2.3,
    },
    inventoryPower,
  };
}

export function analyzeAiDecision(
  player: RuntimePlayerState,
  context: AiDecisionContext,
): AiAnalysisResult {
  return {
    situationMultipliers: calculateSituationMultipliers(context),
    ...calculateItemAnalysis(player, context),
  };
}

export function createEmptyAiHistory(): AiPlayerHistory {
  return {
    rounds: 0,
    competitiveRounds: 0,
    awards: 0,
    failedCompetitiveRounds: 0,
    strategyCounts: Object.fromEntries(strategyOrder.map((strategy) => [strategy, 0])) as Record<AiStrategy, number>,
    lastStrategy: null,
  };
}
