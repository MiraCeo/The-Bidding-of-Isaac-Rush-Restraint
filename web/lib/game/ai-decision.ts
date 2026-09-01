import { analyzeAiDecision, type AiAnalysisResult, type AiDecisionContext } from './ai-analysis';
import { analyzeAiQuote, type AiQuoteAnalysis, type AiQuoteProfile } from './ai-quote';
import { getDoubleActionScoreMultiplier } from './characters';
import {
  calculatePersonalityGroupMultipliers,
  calculatePersonalityMultipliers,
  personalityCooperationPosition,
  reshapeWeightsForPersonalities,
  type AiPersonality,
} from './ai-personality';
import type { PlayerTurn, RuntimePlayerState } from './item-types';
import { roundMoney } from './money';
import { getRoomScoreMultiplier } from './room-modifiers';
import { countItem, hasItem } from './runtime';
import { getRuntimeActionAmounts } from './turns';
import type { RandomSource, RewardGroup, RulesConfig } from './types';

export type AiStrategy =
  | 'high_bid'
  | 'cooperate'
  | 'disrupt_high'
  | 'disrupt_cooperate'
  | 'withdraw';

export type AiDoctrine = 'balanced' | 'cooperative' | 'chaotic';

export type AiStrategyWeights = Record<AiStrategy, number>;

export interface AiDecisionOptions {
  strategyMultipliers?: Partial<Record<AiStrategy, number>>;
  groupWeights?: Partial<Record<RewardGroup, number>>;
  context?: AiDecisionContext;
  enableSituationAnalysis?: boolean;
  enableItemAnalysis?: boolean;
  quoteProfile?: AiQuoteProfile;
  /** Keeps quote and prediction randomness independent from strategy selection. */
  quoteRandom?: RandomSource;
  doctrine?: AiDoctrine;
  personalities?: readonly AiPersonality[];
  /** Includes the room currently being played. */
  remainingRooms?: number;
  enableDoubleActions?: boolean;
}

export interface AiDecision {
  strategy: AiStrategy;
  finalWeights: AiStrategyWeights;
  baseQuote: number | null;
  quoteFactor: number | null;
  quoteAnalysis: AiQuoteAnalysis | null;
  liquidityRatio: number;
  roomBudget: number;
  analysis: AiAnalysisResult | null;
  personalityMultipliers: AiStrategyWeights;
  turn: PlayerTurn;
  secondaryActionAnalysis?: AiSecondaryActionAnalysis;
}

export interface AiSecondaryCandidateAnalysis {
  strategy: Exclude<AiStrategy, 'withdraw'>;
  amount: number;
  predictedTarget: number;
  expectedScoreDelta: number;
  expectedItemUtility: number;
  expectedSabotageUtility: number;
  expectedUtility: number;
  weight: number;
}

export interface AiSecondaryActionAnalysis {
  considered: boolean;
  mode: 'bid' | 'disrupt';
  remainingGroup: RewardGroup;
  conservativeRemainingMoney: number;
  nextRoomReserve: number;
  totalNominalCap: number;
  totalActualCostCap: number;
  legalSecondaryMaximum: number;
  selectedStrategy: Exclude<AiStrategy, 'withdraw'> | null;
  selectedQuote: AiQuoteAnalysis | null;
  candidates: AiSecondaryCandidateAnalysis[];
}

const doubleActionNominalMoneyRatio = 0.4;
const doubleActionFloorActualCostRatio = 0.17;
const doubleActionStopWeight = 3;

export const aiDoctrineWeights: Readonly<Record<AiDoctrine, Readonly<AiStrategyWeights>>> = {
  balanced: {
    high_bid: 20,
    cooperate: 50,
    disrupt_high: 5,
    disrupt_cooperate: 10,
    withdraw: 15,
  },
  cooperative: {
    high_bid: 10,
    cooperate: 55,
    disrupt_high: 0,
    disrupt_cooperate: 25,
    withdraw: 10,
  },
  chaotic: {
    high_bid: 5,
    cooperate: 25,
    disrupt_high: 15,
    disrupt_cooperate: 35,
    withdraw: 20,
  },
};

export const baseAiStrategyWeights = aiDoctrineWeights.balanced;

const strategyOrder: readonly AiStrategy[] = [
  'high_bid',
  'cooperate',
  'disrupt_high',
  'disrupt_cooperate',
  'withdraw',
];

export type AiLiquidityBand = 'comfortable' | 'slightly_tight' | 'tight' | 'critical';

export const liquidityStrategyMultipliers: Readonly<
  Record<AiLiquidityBand, Readonly<AiStrategyWeights>>
> = {
  comfortable: {
    high_bid: 1.25,
    cooperate: 1.15,
    disrupt_high: 1.2,
    disrupt_cooperate: 0.9,
    withdraw: 0.55,
  },
  slightly_tight: {
    high_bid: 0.8,
    cooperate: 1.15,
    disrupt_high: 0.85,
    disrupt_cooperate: 1.45,
    withdraw: 0.65,
  },
  tight: {
    high_bid: 0.3,
    cooperate: 0.9,
    disrupt_high: 0.45,
    disrupt_cooperate: 2.1,
    withdraw: 0.8,
  },
  critical: {
    high_bid: 0.05,
    cooperate: 0.55,
    disrupt_high: 0.15,
    disrupt_cooperate: 2.8,
    withdraw: 1,
  },
};

export function getAiLiquidityBand(liquidityRatio: number): AiLiquidityBand {
  if (liquidityRatio >= 1) return 'comfortable';
  if (liquidityRatio >= 0.75) return 'slightly_tight';
  if (liquidityRatio >= 0.5) return 'tight';
  return 'critical';
}

function weightedPick<T extends string>(
  values: readonly T[],
  weights: Readonly<Record<T, number>>,
  random: RandomSource,
): T {
  const total = values.reduce((sum, value) => sum + weights[value], 0);
  if (total <= 0) return values[values.length - 1]!;
  let cursor = random.next() * total;
  for (const value of values) {
    cursor -= weights[value];
    if (cursor < 0) return value;
  }
  return values[values.length - 1]!;
}

function chooseGroup(
  random: RandomSource,
  weights: Partial<Record<RewardGroup, number>> | undefined,
): RewardGroup {
  return weightedPick(
    ['A', 'B'] as const,
    { A: Math.max(0, weights?.A ?? 1), B: Math.max(0, weights?.B ?? 1) },
    random,
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function predictedBaseScore(value: number, target: number, sigma: number): number {
  return 100 * Math.exp(-Math.abs(value - target) / sigma);
}

function considerSecondaryAction(
  player: RuntimePlayerState,
  primaryStrategy: Exclude<AiStrategy, 'withdraw'>,
  primaryGroup: RewardGroup,
  primaryQuote: AiQuoteAnalysis,
  floorIndex: number,
  remainingRooms: number,
  liquidityRatio: number,
  rules: RulesConfig,
  random: RandomSource,
  options: AiDecisionOptions,
  analysis: AiAnalysisResult | null,
  finalWeights: AiStrategyWeights,
): AiSecondaryActionAnalysis | undefined {
  const mode = primaryStrategy === 'high_bid' || primaryStrategy === 'cooperate' ? 'bid' : 'disrupt';
  if (mode === 'bid' ? !hasItem(player, 'more_options') : !hasItem(player, 'more_options_question')) {
    return undefined;
  }
  const remainingGroup: RewardGroup = primaryGroup === 'A' ? 'B' : 'A';
  const primaryAmount = primaryQuote.amount;
  const floorMoney = rules.floorStartingMoney[floorIndex]!;
  const conservativeRemainingMoney = Math.max(0, player.money - primaryAmount);
  const nextRoomReserve = remainingRooms > 1
    ? Math.ceil(Math.max(player.money / remainingRooms, floorMoney * 0.1))
    : 0;
  const totalNominalCap = Math.floor(player.money * doubleActionNominalMoneyRatio);
  const totalActualCostCap = roundMoney(Math.min(
    player.money * doubleActionNominalMoneyRatio,
    floorMoney * doubleActionFloorActualCostRatio,
  ));
  const primaryAction = mode === 'bid'
    ? { type: 'bid' as const, group: primaryGroup, amount: primaryAmount }
    : { type: 'disrupt' as const, group: primaryGroup, amount: primaryAmount };
  const primaryAmounts = getRuntimeActionAmounts(player, primaryAction, rules);
  const remainingActualCostBudget = Math.max(0, totalActualCostCap - primaryAmounts.actualCost);
  const secondaryActualCostRatio = mode === 'bid' ? 0.7 ** countItem(player, 'steam_sale') : 1;
  const maximumByActualCost = Math.floor(remainingActualCostBudget / secondaryActualCostRatio);
  const maximumByReserve = Math.max(0, conservativeRemainingMoney - nextRoomReserve);
  const maximumByNominalCap = Math.max(0, totalNominalCap - primaryAmount);
  const rulesMaximum = mode === 'bid'
    ? Math.floor(player.money * 0.5) - primaryAmount
    : Math.floor(player.money * rules.disruptionMaxMoneyRatio);
  const legalSecondaryMaximum = Math.max(0, Math.min(
    conservativeRemainingMoney,
    maximumByReserve,
    maximumByNominalCap,
    maximumByActualCost,
    rulesMaximum,
  ));
  if (legalSecondaryMaximum <= 0) {
    return {
      considered: true,
      mode,
      remainingGroup,
      conservativeRemainingMoney,
      nextRoomReserve,
      totalNominalCap,
      totalActualCostCap,
      legalSecondaryMaximum: 0,
      selectedStrategy: null,
      selectedQuote: null,
      candidates: [],
    };
  }

  const strategies: readonly Exclude<AiStrategy, 'withdraw'>[] = mode === 'bid'
    ? ['high_bid', 'cooperate']
    : ['disrupt_high', 'disrupt_cooperate'];
  const sigma = floorMoney * rules.scoreSigmaRatio;
  const primarySingleScore = predictedBaseScore(
    primaryAmounts.scoringEquivalent ?? 0,
    primaryQuote.prediction.predictedTarget,
    sigma,
  );
  const estimatedParticipants = Math.max(
    1,
    Math.round(
      (options.context?.recentMarkets.at(-1)?.participationRate ?? 0.8) * rules.playerCount,
    ),
  );
  const predictedMean = Math.max(
    0,
    (primaryQuote.prediction.predictedTarget - floorMoney * rules.targetConstantRatio) /
      rules.baselineMeanMultiplier,
  );
  const groupValue = clamp(analysis?.groupValues[remainingGroup] ?? 0.5, 0, 1.25);

  const candidateBundles = strategies.map((strategy) => {
    const rawQuote = analyzeAiQuote({
      player,
      strategy,
      group: remainingGroup,
      floorIndex,
      remainingRooms,
      liquidityRatio,
      rules,
      random,
      analysis,
      context: options.context,
      profile: options.quoteProfile,
      cooperationPositionOverride: personalityCooperationPosition(options.personalities ?? []),
    });
    const amount = Math.min(rawQuote.amount, legalSecondaryMaximum);
    const action = mode === 'bid'
      ? { type: 'bid' as const, group: remainingGroup, amount }
      : { type: 'disrupt' as const, group: remainingGroup, amount };
    const amounts = getRuntimeActionAmounts(player, action, rules);
    const predictedDoubleMean = (
      predictedMean * estimatedParticipants +
      (primaryAmounts.marketEquivalent ?? 0) +
      (amounts.marketEquivalent ?? 0)
    ) / (estimatedParticipants + 2);
    const predictedTarget = rules.baselineMeanMultiplier * predictedDoubleMean +
      floorMoney * rules.targetConstantRatio;
    const firstDoubleScore = predictedBaseScore(
      primaryAmounts.scoringEquivalent ?? 0,
      predictedTarget,
      sigma,
    );
    const secondScore = predictedBaseScore(amounts.scoringEquivalent ?? 0, predictedTarget, sigma);
    const expectedScoreDelta = getRoomScoreMultiplier(
      options.context?.room.kind,
      rules.roomScoreMultipliers,
    ) * (
      getDoubleActionScoreMultiplier(player) * (firstDoubleScore + secondScore) - primarySingleScore
    );
    const highProbability = 1 / (
      1 + Math.exp(-((amounts.marketEquivalent ?? 0) - rawQuote.prediction.predictedHighPriceQualificationEquivalent) / sigma)
    );
    const cooperationProbability = 0.5 * Math.exp(
      -Math.abs((amounts.scoringEquivalent ?? 0) - predictedTarget) / sigma,
    );
    const qualificationProbability = strategy === 'high_bid' || strategy === 'disrupt_high'
      ? highProbability
      : cooperationProbability;
    const canRedeem = mode === 'bid' || hasItem(player, 'transcendence');
    const expectedItemUtility = groupValue * 85 * qualificationProbability *
      (mode === 'disrupt' ? (canRedeem ? 0.5 : 0) : 1);
    const expectedSabotageUtility = strategy === 'disrupt_high'
      ? clamp(
          (amounts.marketEquivalent ?? 0) /
            Math.max(rawQuote.prediction.predictedHighestMarketEquivalent, 1),
          0,
          1.5,
        ) * 35
      : 0;
    const reservePressure = 1 + Math.max(0, 1 - liquidityRatio) * 0.8 + Math.max(0, remainingRooms - 1) * 0.04;
    const costPenalty = (amount / floorMoney) * 45 * reservePressure;
    const expectedUtility = expectedScoreDelta + expectedItemUtility + expectedSabotageUtility - costPenalty;
    const strategyShare = finalWeights[strategy] /
      Math.max(1, strategies.reduce((sum, value) => sum + finalWeights[value], 0));
    const weight = Math.exp(clamp(expectedUtility / 28, -4, 4)) * (0.45 + strategyShare * 2.2);
    const selectedQuote: AiQuoteAnalysis = {
      ...rawQuote,
      amount,
      legalMaximum: Math.min(rawQuote.legalMaximum, legalSecondaryMaximum),
      expectedActualCost: amounts.actualCost,
      wasClamped: rawQuote.wasClamped || amount < rawQuote.amount,
    };
    return {
      quote: selectedQuote,
      analysis: {
        strategy,
        amount,
        predictedTarget,
        expectedScoreDelta,
        expectedItemUtility,
        expectedSabotageUtility,
        expectedUtility,
        weight,
      } satisfies AiSecondaryCandidateAnalysis,
    };
  }).filter((candidate) => candidate.analysis.amount > 0);

  const stopWeight = doubleActionStopWeight * (0.9 + random.next() * 0.2);
  const totalWeight = stopWeight + candidateBundles.reduce((sum, candidate) => sum + candidate.analysis.weight, 0);
  let cursor = random.next() * totalWeight;
  if ((cursor -= stopWeight) < 0 || candidateBundles.length === 0) {
    return {
      considered: true,
      mode,
      remainingGroup,
      conservativeRemainingMoney,
      nextRoomReserve,
      totalNominalCap,
      totalActualCostCap,
      legalSecondaryMaximum,
      selectedStrategy: null,
      selectedQuote: null,
      candidates: candidateBundles.map((candidate) => candidate.analysis),
    };
  }
  const selected = candidateBundles.find((candidate) => {
    cursor -= candidate.analysis.weight;
    return cursor < 0;
  }) ?? candidateBundles[candidateBundles.length - 1]!;
  return {
    considered: true,
    mode,
    remainingGroup,
    conservativeRemainingMoney,
    nextRoomReserve,
    totalNominalCap,
    totalActualCostCap,
    legalSecondaryMaximum,
    selectedStrategy: selected.analysis.strategy,
    selectedQuote: selected.quote,
    candidates: candidateBundles.map((candidate) => candidate.analysis),
  };
}

export function decideAiTurn(
  player: RuntimePlayerState,
  floorIndex: number,
  rules: RulesConfig,
  random: RandomSource,
  options: AiDecisionOptions = {},
): AiDecision {
  const floorMoney = rules.floorStartingMoney[floorIndex];
  if (floorMoney === undefined) throw new RangeError(`Unknown floor index: ${floorIndex}`);
  const remainingRooms = Math.max(1, Math.floor(options.remainingRooms ?? 5));
  const expectedPaceMoney = (floorMoney * remainingRooms) / 5;
  const liquidityRatio = expectedPaceMoney > 0 ? player.money / expectedPaceMoney : 0;
  const roomBudget = player.money / remainingRooms;
  const liquidityMultipliers = liquidityStrategyMultipliers[getAiLiquidityBand(liquidityRatio)];
  const doctrineWeights = aiDoctrineWeights[options.doctrine ?? 'balanced'];
  const analysis = options.context ? analyzeAiDecision(player, options.context) : null;
  const personalityMultipliers = calculatePersonalityMultipliers(
    options.personalities ?? [],
    options.context,
    analysis,
  );

  let finalWeights = Object.fromEntries(
    strategyOrder.map((strategy) => {
      const modifier = Math.max(0, options.strategyMultipliers?.[strategy] ?? 1);
      const situationModifier = options.enableSituationAnalysis === false
        ? 1
        : analysis?.situationMultipliers[strategy] ?? 1;
      const itemModifier = options.enableItemAnalysis === false
        ? 1
        : analysis?.itemMultipliers[strategy] ?? 1;
      const decisionNoise = 0.9 + random.next() * 0.2;
      return [
        strategy,
        doctrineWeights[strategy] *
          liquidityMultipliers[strategy] *
          situationModifier *
          itemModifier *
          personalityMultipliers[strategy] *
          modifier *
          decisionNoise,
      ];
    }),
  ) as unknown as AiStrategyWeights;
  finalWeights = reshapeWeightsForPersonalities(
    finalWeights,
    doctrineWeights,
    options.personalities ?? [],
  );
  const roomParticipationMultiplier = getRoomScoreMultiplier(
    options.context?.room.kind,
    rules.roomScoreMultipliers,
  );
  for (const strategy of strategyOrder) {
    if (strategy !== 'withdraw') finalWeights[strategy] *= roomParticipationMultiplier;
  }

  if (player.money <= 0) finalWeights.withdraw = Math.max(finalWeights.withdraw, 1);
  const strategy = player.money <= 0 ? 'withdraw' : weightedPick(strategyOrder, finalWeights, random);
  if (strategy === 'withdraw') {
    return {
      strategy,
      finalWeights,
      baseQuote: null,
      quoteFactor: null,
      quoteAnalysis: null,
      liquidityRatio,
      roomBudget,
      analysis,
      personalityMultipliers,
      turn: { playerId: player.id, actions: [{ type: 'withdraw' }] },
    };
  }

  const groupWeights = analysis && options.enableItemAnalysis !== false
    ? {
        A: analysis.groupWeights.A * (options.groupWeights?.A ?? 1),
        B: analysis.groupWeights.B * (options.groupWeights?.B ?? 1),
      }
    : options.groupWeights;
  const personalityGroupMultipliers = calculatePersonalityGroupMultipliers(
    options.personalities ?? [],
    options.context,
  );
  const group = chooseGroup(random, {
    A: (groupWeights?.A ?? 1) * personalityGroupMultipliers.A,
    B: (groupWeights?.B ?? 1) * personalityGroupMultipliers.B,
  });
  const quoteAnalysis = analyzeAiQuote({
    player,
    strategy,
    group,
    floorIndex,
    remainingRooms,
    liquidityRatio,
    rules,
    random: options.quoteRandom ?? random,
    analysis,
    context: options.context,
    profile: options.quoteProfile,
    cooperationPositionOverride: personalityCooperationPosition(options.personalities ?? []),
  });
  const { baseQuote, randomFactor: quoteFactor, amount } = quoteAnalysis;

  if (amount <= 0) {
    return {
      strategy: 'withdraw',
      finalWeights,
      baseQuote,
      quoteFactor,
      quoteAnalysis,
      liquidityRatio,
      roomBudget,
      analysis,
      personalityMultipliers,
      turn: { playerId: player.id, actions: [{ type: 'withdraw' }] },
    };
  }

  const primaryStrategy = strategy as Exclude<AiStrategy, 'withdraw'>;
  const secondaryActionAnalysis = options.enableDoubleActions === false ? undefined : considerSecondaryAction(
    player,
    primaryStrategy,
    group,
    quoteAnalysis,
    floorIndex,
    remainingRooms,
    liquidityRatio,
    rules,
    options.quoteRandom ?? random,
    options,
    analysis,
    finalWeights,
  );
  const primaryAction = strategy === 'disrupt_high' || strategy === 'disrupt_cooperate'
    ? { type: 'disrupt' as const, group, amount }
    : { type: 'bid' as const, group, amount };
  const secondaryAction = secondaryActionAnalysis?.selectedQuote && secondaryActionAnalysis.selectedStrategy
    ? secondaryActionAnalysis.mode === 'bid'
      ? {
          type: 'bid' as const,
          group: secondaryActionAnalysis.remainingGroup,
          amount: secondaryActionAnalysis.selectedQuote.amount,
        }
      : {
          type: 'disrupt' as const,
          group: secondaryActionAnalysis.remainingGroup,
          amount: secondaryActionAnalysis.selectedQuote.amount,
        }
    : null;

  return {
    strategy,
    finalWeights,
    baseQuote,
    quoteFactor,
    quoteAnalysis,
    liquidityRatio,
    roomBudget,
    analysis,
    personalityMultipliers,
    secondaryActionAnalysis,
    turn: {
      playerId: player.id,
      actions: secondaryAction ? [primaryAction, secondaryAction] : [primaryAction],
    },
  };
}
