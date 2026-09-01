import type { AiAnalysisResult, AiDecisionContext } from './ai-analysis';
import type { AiStrategy } from './ai-decision';
import type { RoomKind, RuntimePlayerState } from './item-types';
import { roundMoney } from './money';
import { getRoomScoreMultiplier } from './room-modifiers';
import { countItem, hasItem } from './runtime';
import { getRuntimeActionAmounts } from './turns';
import type { PlayerAction, RandomSource, RewardGroup, RulesConfig } from './types';

type QuotingStrategy = Exclude<AiStrategy, 'withdraw'>;

export interface AiQuoteProfile {
  highestPredictionBias: number;
  targetPredictionBias: number;
  cooperationPositionBias: number;
  qualificationPredictionBias?: number;
}

export interface AiMarketPrediction {
  predictedHighestMarketEquivalent: number;
  predictedHighPriceQualificationEquivalent: number;
  predictedTarget: number;
  predictedCooperationLower: number;
  predictedCooperationUpper: number;
  cooperationAim: number;
  confidence: number;
  highestPredictionNoise: number;
  qualificationPredictionNoise: number;
  targetPredictionNoise: number;
}

export interface AiQuoteCandidate {
  level: 'low' | 'model' | 'high';
  desiredEquivalent: number;
  nominalQuote: number;
  expectedActualCost: number;
  utility: number;
  weight: number;
}

export interface AiQuoteAnalysis {
  baseQuote: number;
  fundingMultiplier: number;
  marketMultiplier: number;
  itemValueMultiplier: number;
  personalityMultiplier: number;
  predictionMultiplier: number;
  randomFactor: number;
  desiredEquivalentBeforePrediction: number;
  desiredEquivalentBeforeNoise: number;
  desiredEquivalentQuote: number;
  nominalQuoteBeforeLimit: number;
  opportunityBudget: number;
  paceMaximumActualCost: number;
  legalMaximum: number;
  amount: number;
  expectedActualCost: number;
  wasClamped: boolean;
  candidates: readonly AiQuoteCandidate[];
  selectedCandidate: AiQuoteCandidate['level'];
  prediction: AiMarketPrediction;
  profile: AiQuoteProfile;
}

export interface AnalyzeAiQuoteOptions {
  player: RuntimePlayerState;
  strategy: QuotingStrategy;
  group: RewardGroup;
  floorIndex: number;
  remainingRooms: number;
  liquidityRatio: number;
  rules: RulesConfig;
  random: RandomSource;
  analysis: AiAnalysisResult | null;
  context?: AiDecisionContext;
  profile?: AiQuoteProfile;
  cooperationPositionOverride?: number;
}

const baseQuoteRatios: Readonly<Record<QuotingStrategy, number>> = {
  high_bid: 0.6,
  cooperate: 0.25,
  disrupt_high: 0.6,
  disrupt_cooperate: 0.2,
};

function roomOpportunityWeight(roomKind: RoomKind, rules: RulesConfig): number {
  if (roomKind === 'shop') return 1.6;
  return getRoomScoreMultiplier(roomKind, rules.roomScoreMultipliers);
}

function expectedFutureRoomWeights(rules: RulesConfig): readonly number[] {
  const expectedOrdinaryRoom =
    getRoomScoreMultiplier('normal', rules.roomScoreMultipliers) * 0.75 +
    getRoomScoreMultiplier('hidden', rules.roomScoreMultipliers) * 0.25;
  return [
    expectedOrdinaryRoom,
    getRoomScoreMultiplier('treasure', rules.roomScoreMultipliers),
    expectedOrdinaryRoom,
    1.6,
    getRoomScoreMultiplier('boss', rules.roomScoreMultipliers),
  ];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function weightedRecentMean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const totalWeight = (values.length * (values.length + 1)) / 2;
  return values.reduce((sum, value, index) => sum + value * (index + 1), 0) / totalWeight;
}

function weightedPick<T extends { weight: number }>(values: readonly T[], random: RandomSource): T {
  const total = values.reduce((sum, value) => sum + value.weight, 0);
  let cursor = random.next() * total;
  for (const value of values) {
    cursor -= value.weight;
    if (cursor < 0) return value;
  }
  return values[values.length - 1]!;
}

export function createAiQuoteProfile(random: RandomSource): AiQuoteProfile {
  return {
    highestPredictionBias: 0.92 + random.next() * 0.16,
    targetPredictionBias: 0.95 + random.next() * 0.1,
    cooperationPositionBias: -0.35 + random.next() * 0.7,
    qualificationPredictionBias: 0.94 + random.next() * 0.12,
  };
}

function calculateFundingMultiplier(strategy: QuotingStrategy, liquidityRatio: number): number {
  const liquidity = clamp(liquidityRatio, 0, 1.5);
  if (strategy === 'high_bid') return clamp(0.35 + liquidity * 0.72, 0.35, 1.2);
  if (strategy === 'cooperate') return clamp(0.5 + liquidity * 0.5, 0.5, 1.1);
  if (strategy === 'disrupt_high') return clamp(0.45 + liquidity * 0.45, 0.45, 1.05);
  return clamp(0.5 + liquidity * 0.38, 0.5, 1);
}

function calculateMarketMultiplier(
  strategy: QuotingStrategy,
  context: AiDecisionContext | undefined,
): number {
  const markets = context?.recentMarkets ?? [];
  if (markets.length === 0) return 1;
  const targetRatio = weightedRecentMean(markets.map((market) => market.targetRatio));
  const participation = weightedRecentMean(markets.map((market) => market.participationRate));
  const disruption = weightedRecentMean(markets.map((market) => market.disruptionRate));
  const heat = clamp((targetRatio - 0.3) / 0.2, -1, 1);
  const participationPressure = clamp((participation - 0.75) / 0.25, -1, 1);
  const disruptionPressure = clamp((disruption - 0.1) / 0.2, -1, 1);
  if (strategy === 'high_bid') return clamp(1 + heat * 0.14 + participationPressure * 0.06, 0.78, 1.22);
  if (strategy === 'cooperate') return clamp(1 + heat * 0.08 + participationPressure * 0.04, 0.86, 1.16);
  if (strategy === 'disrupt_high') {
    return clamp(1 + participationPressure * 0.08 - disruptionPressure * 0.12, 0.82, 1.18);
  }
  return clamp(1 + heat * 0.1 - disruptionPressure * 0.08, 0.82, 1.18);
}

function calculateItemValueMultiplier(
  player: RuntimePlayerState,
  strategy: QuotingStrategy,
  group: RewardGroup,
  analysis: AiAnalysisResult | null,
): number {
  const value = clamp(analysis?.groupValues[group] ?? 0.5, 0, 1.25);
  let multiplier = strategy === 'high_bid'
    ? 0.72 + value * 0.55
    : strategy === 'cooperate'
      ? 0.85 + value * 0.3
      : strategy === 'disrupt_high'
        ? hasItem(player, 'transcendence')
          ? 0.82 + value * 0.42
          : 0.78 + value * 0.28
        : hasItem(player, 'transcendence')
        ? 0.8 + value * 0.45
        : 1.05 - value * 0.15;
  if (strategy === 'disrupt_cooperate' && hasItem(player, 'short_brimstone')) multiplier *= 1.12;
  if (strategy === 'cooperate' && hasItem(player, 'lucky_foot')) multiplier *= 1.08;
  if (hasItem(player, 'whore_of_babylon')) {
    if (strategy === 'high_bid') multiplier *= 1.18;
    if (strategy === 'cooperate') multiplier *= 0.75;
  }
  if (strategy === 'cooperate' && hasItem(player, 'brimstone')) multiplier *= 1.08;
  if (strategy === 'high_bid' && (hasItem(player, 'holy_mantle') || hasItem(player, 'steam_sale'))) {
    multiplier *= 1.08;
  }
  return clamp(multiplier, 0.55, 1.55);
}

function calculateOpportunityBudget(
  playerMoney: number,
  roomKind: RoomKind | undefined,
  roomIndex: number | undefined,
  selectedValue: number,
  remainingRooms: number,
  rules: RulesConfig,
): number {
  if (roomKind === undefined || roomIndex === undefined) {
    return playerMoney / Math.max(1, remainingRooms);
  }
  const currentWeight = roomOpportunityWeight(roomKind, rules) * (0.6 + clamp(selectedValue, 0, 1.25) * 0.8);
  const futureWeight = expectedFutureRoomWeights(rules)
    .slice(roomIndex + 1)
    .reduce((sum, weight) => sum + weight, 0);
  return playerMoney * currentWeight / Math.max(currentWeight + futureWeight, 0.01);
}

function predictMarket(
  floorMoney: number,
  rules: RulesConfig,
  context: AiDecisionContext | undefined,
  profile: AiQuoteProfile,
  random: RandomSource,
): AiMarketPrediction {
  const markets = context?.recentMarkets ?? [];
  const targetRatios = markets.map((market) => market.targetRatio);
  const highestRatios = markets.flatMap((market) =>
    market.highestMarketEquivalentRatio === undefined ? [] : [market.highestMarketEquivalentRatio],
  );
  const qualificationRatios = markets.flatMap((market) =>
    market.highPriceQualificationRatio === undefined ? [] : [market.highPriceQualificationRatio],
  );
  const sampleRatio = clamp(markets.length / 3, 0, 1);
  const volatility = clamp(standardDeviation(targetRatios) / 0.12, 0, 1);
  const confidence = clamp(0.15 + sampleRatio * (1 - volatility) * 0.7, 0.15, 0.85);
  const publicTargetRatio = 0.3 * (1 - confidence) +
    (targetRatios.length === 0 ? 0.3 : weightedRecentMean(targetRatios)) * confidence;
  const publicHighestRatio = 0.6 * (1 - confidence) +
    (highestRatios.length === 0 ? 0.6 : weightedRecentMean(highestRatios)) * confidence;
  const publicQualificationRatio = (publicHighestRatio * 0.78) * (1 - confidence) +
    (qualificationRatios.length === 0 ? publicHighestRatio * 0.78 : weightedRecentMean(qualificationRatios)) * confidence;
  const highestError = 0.025 + (1 - confidence) * 0.075;
  const targetError = 0.015 + (1 - confidence) * 0.045;
  const highestPredictionNoise = 1 + (random.next() * 2 - 1) * highestError;
  const qualificationPredictionNoise = 1 + (random.next() * 2 - 1) * (highestError * 0.85);
  const targetPredictionNoise = 1 + (random.next() * 2 - 1) * targetError;
  const predictedHighestMarketEquivalent = roundMoney(
    floorMoney * publicHighestRatio * profile.highestPredictionBias * highestPredictionNoise,
  );
  const predictedHighPriceQualificationEquivalent = roundMoney(
    floorMoney * publicQualificationRatio * (profile.qualificationPredictionBias ?? 1) * qualificationPredictionNoise,
  );
  const predictedTarget = roundMoney(
    floorMoney * publicTargetRatio * profile.targetPredictionBias * targetPredictionNoise,
  );
  const cooperationRadius = floorMoney * rules.cooperationZoneRatio;
  const positionNoise = (random.next() * 2 - 1) * 0.15;
  const cooperationPosition = clamp(profile.cooperationPositionBias + positionNoise, -0.8, 0.8);
  return {
    predictedHighestMarketEquivalent,
    predictedHighPriceQualificationEquivalent,
    predictedTarget,
    predictedCooperationLower: Math.max(0, roundMoney(predictedTarget - cooperationRadius)),
    predictedCooperationUpper: roundMoney(predictedTarget + cooperationRadius),
    cooperationAim: roundMoney(predictedTarget + cooperationRadius * cooperationPosition),
    confidence,
    highestPredictionNoise,
    qualificationPredictionNoise,
    targetPredictionNoise,
  };
}

function maximumPredictionIncrease(liquidityRatio: number): number {
  if (liquidityRatio >= 1) return 0.25;
  if (liquidityRatio >= 0.75) return 0.15;
  if (liquidityRatio >= 0.5) return 0.05;
  return 0;
}

function actionFromEquivalent(
  player: RuntimePlayerState,
  strategy: QuotingStrategy,
  group: RewardGroup,
  desiredEquivalent: number,
  rules: RulesConfig,
): PlayerAction {
  if (strategy === 'disrupt_high') {
    return {
      type: 'disrupt',
      group,
      amount: Math.max(1, roundMoney(desiredEquivalent / rules.disruptionMarketMultiplier)),
    };
  }
  if (strategy === 'disrupt_cooperate') {
    return {
      type: 'disrupt',
      group,
      amount: Math.max(1, roundMoney(desiredEquivalent / rules.disruptionScoringMultiplier)),
    };
  }
  if (strategy === 'high_bid') {
    const marketMultiplier = 1.25 ** countItem(player, 'twenty_twenty');
    return { type: 'bid', group, amount: Math.max(1, roundMoney(desiredEquivalent / marketMultiplier)) };
  }
  return { type: 'bid', group, amount: Math.max(1, roundMoney(desiredEquivalent)) };
}

function candidateUtility(
  player: RuntimePlayerState,
  action: PlayerAction,
  strategy: QuotingStrategy,
  groupValue: number,
  liquidityRatio: number,
  prediction: AiMarketPrediction,
  opportunityBudget: number,
  floorMoney: number,
  roomKind: RoomKind | undefined,
  rules: RulesConfig,
): { utility: number; actualCost: number } {
  const amounts = getRuntimeActionAmounts(player, action, rules);
  const sigma = floorMoney * rules.scoreSigmaRatio;
  const scoreUtility = Math.exp(-Math.abs((amounts.scoringEquivalent ?? 0) - prediction.predictedTarget) / sigma);
  const roomAdjustedScoreUtility = scoreUtility * getRoomScoreMultiplier(
    roomKind,
    rules.roomScoreMultipliers,
  );
  const acquisitionUtility = strategy === 'high_bid'
    ? 1 / (1 + Math.exp(-((amounts.marketEquivalent ?? 0) - prediction.predictedHighPriceQualificationEquivalent) / sigma))
      : strategy === 'cooperate'
      ? scoreUtility
      : hasItem(player, 'transcendence') ? scoreUtility * 0.5 : 0;
  const sabotageUtility = strategy === 'disrupt_high'
    ? clamp((amounts.marketEquivalent ?? 0) / Math.max(prediction.predictedHighestMarketEquivalent, 1), 0, 1.5)
    : 0;
  const scarcity = 1 / clamp(liquidityRatio, 0.25, 1.5);
  const costPenalty = amounts.actualCost / Math.max(opportunityBudget, floorMoney * 0.02);
  return {
    utility:
      roomAdjustedScoreUtility * (strategy === 'disrupt_high' ? 0.15 : 0.55) +
      acquisitionUtility * groupValue * 0.55 -
      costPenalty * (0.1 + scarcity * 0.04) +
      sabotageUtility * 0.5,
    actualCost: amounts.actualCost,
  };
}

export function analyzeAiQuote(options: AnalyzeAiQuoteOptions): AiQuoteAnalysis {
  const {
    player,
    strategy,
    group,
    floorIndex,
    remainingRooms,
    liquidityRatio,
    rules,
    random,
    analysis,
    context,
  } = options;
  const floorMoney = rules.floorStartingMoney[floorIndex];
  if (floorMoney === undefined) throw new RangeError(`Unknown floor index: ${floorIndex}`);
  const profile = options.profile ?? createAiQuoteProfile(random);
  const groupValue = clamp(analysis?.groupValues[group] ?? 0.5, 0, 1.25);
  const baseQuote = floorMoney * baseQuoteRatios[strategy];
  const fundingMultiplier = calculateFundingMultiplier(strategy, liquidityRatio);
  const marketMultiplier = calculateMarketMultiplier(strategy, context);
  const itemValueMultiplier = calculateItemValueMultiplier(player, strategy, group, analysis);
  const personalityMultiplier = 1;
  const desiredEquivalentBeforePrediction =
    baseQuote * fundingMultiplier * marketMultiplier * itemValueMultiplier * personalityMultiplier;
  const prediction = predictMarket(floorMoney, rules, context, profile, random);
  if (options.cooperationPositionOverride !== undefined) {
    const cooperationRadius = floorMoney * rules.cooperationZoneRatio;
    prediction.cooperationAim = roundMoney(
      prediction.predictedTarget +
        cooperationRadius * clamp(options.cooperationPositionOverride, -0.8, 0.8),
    );
  }
  const anchor = strategy === 'high_bid'
    ? prediction.predictedHighPriceQualificationEquivalent * (0.96 + groupValue * 0.1)
    : strategy === 'disrupt_high'
      ? prediction.predictedHighestMarketEquivalent * (0.9 + groupValue * 0.16)
    : prediction.cooperationAim;
  const predictionWeight = 0.25 + prediction.confidence * 0.3;
  const predictedBlend = desiredEquivalentBeforePrediction * (1 - predictionWeight) + anchor * predictionWeight;
  const desiredEquivalentBeforeNoise = clamp(
    predictedBlend,
    desiredEquivalentBeforePrediction * 0.75,
    desiredEquivalentBeforePrediction * (1 + maximumPredictionIncrease(liquidityRatio)),
  );
  const predictionMultiplier = desiredEquivalentBeforePrediction <= 0
    ? 1
    : desiredEquivalentBeforeNoise / desiredEquivalentBeforePrediction;

  const opportunityBudget = calculateOpportunityBudget(
    player.money,
    context?.room.kind,
    context?.room.roomIndex,
    groupValue,
    remainingRooms,
    rules,
  );

  const candidateFactors = [
    { level: 'low' as const, factor: 0.7 },
    { level: 'model' as const, factor: 1 },
    { level: 'high' as const, factor: 1.25 },
  ];
  const candidates = candidateFactors.map(({ level, factor }) => {
    const desiredEquivalent = desiredEquivalentBeforeNoise * factor;
    const action = actionFromEquivalent(player, strategy, group, desiredEquivalent, rules);
    const { utility, actualCost } = candidateUtility(
      player,
      action,
      strategy,
      groupValue,
      liquidityRatio,
      prediction,
      opportunityBudget,
      floorMoney,
      context?.room.kind,
      rules,
    );
    return {
      level,
      desiredEquivalent,
      nominalQuote: action.type === 'withdraw' ? 0 : action.amount,
      expectedActualCost: actualCost,
      utility,
      weight: Math.exp(utility * 3),
    };
  });
  const selectedCandidate = weightedPick(candidates, random);
  const randomFactor = 0.95 + random.next() * 0.1;
  const desiredEquivalentQuote = roundMoney(selectedCandidate.desiredEquivalent * randomFactor);
  const requestedAction = actionFromEquivalent(player, strategy, group, desiredEquivalentQuote, rules);
  const nominalQuoteBeforeLimit = requestedAction.type === 'withdraw' ? 0 : requestedAction.amount;
  const paceMaximumActualCost = opportunityBudget *
    (strategy === 'high_bid' ? 4 : strategy === 'cooperate' ? 2 : strategy === 'disrupt_high' ? 1.75 : 1.5);
  const actualCostRatio = requestedAction.type === 'bid' ? 0.7 ** countItem(player, 'steam_sale') : 1;
  const paceMaximumNominal = Math.floor(paceMaximumActualCost / actualCostRatio);
  const legalMaximum = strategy === 'disrupt_high' || strategy === 'disrupt_cooperate'
    ? Math.floor(player.money * rules.disruptionMaxMoneyRatio)
    : player.money;
  const amount = Math.max(0, Math.min(nominalQuoteBeforeLimit, paceMaximumNominal, legalMaximum));
  const finalAction: PlayerAction = strategy === 'disrupt_high' || strategy === 'disrupt_cooperate'
    ? { type: 'disrupt', group, amount }
    : { type: 'bid', group, amount };
  const expectedActualCost = amount > 0 ? getRuntimeActionAmounts(player, finalAction, rules).actualCost : 0;

  return {
    baseQuote,
    fundingMultiplier,
    marketMultiplier,
    itemValueMultiplier,
    personalityMultiplier,
    predictionMultiplier,
    randomFactor,
    desiredEquivalentBeforePrediction,
    desiredEquivalentBeforeNoise,
    desiredEquivalentQuote,
    nominalQuoteBeforeLimit,
    opportunityBudget,
    paceMaximumActualCost,
    legalMaximum,
    amount,
    expectedActualCost,
    wasClamped: amount < nominalQuoteBeforeLimit,
    candidates,
    selectedCandidate: selectedCandidate.level,
    prediction,
    profile,
  };
}
