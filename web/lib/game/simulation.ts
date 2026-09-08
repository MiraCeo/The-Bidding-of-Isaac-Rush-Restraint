import {
  decideAiTurn,
  getAiLiquidityBand,
  type AiDoctrine,
  type AiLiquidityBand,
  type AiStrategy,
} from './ai-decision';
import {
  createAiQuoteProfile,
  type AiQuoteAnalysis,
  type AiQuoteProfile,
} from './ai-quote';
import {
  aiItemProfiles,
  createEmptyAiHistory,
  type AiPlayerHistory,
  type AiPublicMarketSnapshot,
} from './ai-analysis';
import {
  aiPersonalityOrder,
  generateAiPersonalities,
  type AiPersonality,
} from './ai-personality';
import { defaultRules } from './config';
import { assignCharacter, characterOrder, chooseRandomCharacter } from './characters';
import { itemCatalog } from './item-catalog';
import { calculateFinalScore } from './item-scoring';
import type { CharacterId, ItemId, RoomKind, RuntimePlayerState, SettlementEvent } from './item-types';
import { createSeededRandom } from './random';
import { preparePlayersForRoom } from './room-economy';
import { settleRuntimeRoom } from './room-engine';
import { calculateHighPriceSlotCount } from './rewards';
import { generateFloor } from './rooms';
import { createRuntimePlayer } from './runtime';
import type { RulesConfig } from './types';

interface RunningMetric {
  count: number;
  sum: number;
  sumSquares: number;
  minimum: number;
  maximum: number;
}

const strategyOrderForReport: readonly AiStrategy[] = [
  'high_bid',
  'cooperate',
  'disrupt_high',
  'disrupt_cooperate',
  'withdraw',
];

const doctrineOrderForReport: readonly AiDoctrine[] = ['balanced', 'cooperative', 'chaotic'];
const roomKindOrderForReport: readonly RoomKind[] = [
  'normal',
  'treasure',
  'shop',
  'hidden',
  'boss',
];

export interface MetricSummary {
  count: number;
  mean: number;
  standardDeviation: number;
  minimum: number;
  maximum: number;
}

export interface RankedPlayerRecord {
  game: number;
  playerId: string;
  finalScore: number;
  doctrine: AiDoctrine;
  character: CharacterId;
  personalities: AiPersonality[];
  itemCount: number;
  items: ItemId[];
}

export interface RankingBandSummary {
  band: string;
  count: number;
  scoreMean: number;
  scoreMedian: number;
  itemCountMean: number;
  itemCountMedian: number;
  doctrineShares: Record<AiDoctrine, number>;
  characterShares: Record<CharacterId, number>;
  topPersonalities: Array<{ personality: AiPersonality; count: number; prevalence: number }>;
}

export interface SimulationReport {
  games: number;
  playersPerGame: number;
  roomsPerGame: number;
  decisions: number;
  strategyCounts: Record<AiStrategy, number>;
  strategyRates: Record<AiStrategy, number>;
  belowHalfStartingMoneyRate: number;
  liquidityBandCounts: Record<AiLiquidityBand, number>;
  strategyRatesByLiquidityBand: Record<AiLiquidityBand, Record<AiStrategy, number>>;
  roomKindAnalysis: Record<RoomKind, {
    roomCount: number;
    scoreMultiplier: number;
    decisions: number;
    participationRate: number;
    strategyRates: Record<AiStrategy, number>;
    averageActualCostRatioPerDecision: number;
    roomScore: MetricSummary;
  }>;
  decisionAnalysis: {
    situationMultiplierMeans: Record<AiStrategy, number>;
    itemMultiplierMeans: Record<AiStrategy, number>;
    higherValueGroupSelectionRate: number;
    evaluatedGroupSelections: number;
    hiddenGroupSelectionRate: number;
  };
  quoteAnalysis: {
    fundingMultiplier: MetricSummary;
    marketMultiplier: MetricSummary;
    itemValueMultiplier: MetricSummary;
    predictionMultiplier: MetricSummary;
    finalNoiseMultiplier: MetricSummary;
    clampRate: number;
    meanClampAmount: number;
    targetPredictionErrorRatio: MetricSummary;
    highestPredictionErrorRatio: MetricSummary;
    qualificationPredictionErrorRatio: MetricSummary;
    cooperationZoneHitRate: number;
    scorePerActualMoney: number;
    averageActualCostRatioByRoomKind: Record<RoomKind, number>;
    averageQuoteRatioByItemValueBand: Record<'low' | 'medium' | 'high', number>;
    premiumRoomNoMoneyRate: number;
    cooperationSlots: number;
    cooperationVacancies: number;
    highPriceDisruptionSlots: number;
    highPriceDisruptionVacancies: number;
    highPriceDisruptionRecoveryRate: number;
    totalQualificationSlots: number;
    highPriceQualificationSlots: number;
    cooperationQualificationSlots: number;
    disruptedHighPriceQualificationSlots: number;
    disruptedCooperationQualificationSlots: number;
    transcendenceRedemptions: number;
    highPriceTranscendenceRedemptions: number;
    cooperationTranscendenceRedemptions: number;
  };
  averageQuotesByFloor: Record<string, Record<Exclude<AiStrategy, 'withdraw'>, number>>;
  targetRatioByFloor: Record<string, MetricSummary>;
  endFloorMoneyByFloor: Record<string, MetricSummary>;
  finalScore: MetricSummary;
  winnerScore: MetricSummary;
  scoreBands: Array<{ band: string; playerCount: number; averageScore: number; averageItemCount: number }>;
  finalItemCount: MetricSummary;
  averageAwardsPerGame: number;
  entitlementSources: Record<string, number>;
  itemAppearanceCounts: Partial<Record<ItemId, number>>;
  itemAwardCounts: Partial<Record<ItemId, number>>;
  itemBalance: Record<ItemId, ItemBalanceSummary>;
  doctrinePopulation: Record<AiDoctrine, number>;
  doctrinePerformance: Record<AiDoctrine, DoctrinePerformanceSummary>;
  characterPopulation: Record<CharacterId, number>;
  characterPerformance: Record<CharacterId, DoctrinePerformanceSummary>;
  winnerDoctrineShares: Record<AiDoctrine, number>;
  personalityEnabled: boolean;
  personalityCountDistribution: Record<'1' | '2' | '3' | '4', number>;
  personalityPerformance: Record<AiPersonality, PersonalityPerformanceSummary>;
  winnerPersonalityShares: Array<{ personality: AiPersonality; share: number }>;
  rankingAnalysis: {
    championTop10: RankedPlayerRecord[];
    championDeciles: RankingBandSummary[];
    allPlayerDeciles: RankingBandSummary[];
  };
  personalitySpecialty: Record<AiPersonality, {
    carriers: number;
    prevalence: number;
    scoreMean: number;
    scoreDeltaVsAllPlayers: number;
    moneyMean: number;
    itemCountMean: number;
    itemCountDeltaVsAllPlayers: number;
    championIncidence: number;
    strategyRates: Record<AiStrategy, number>;
    cooperationZoneHitRate: number;
    preferredTargetSelectionRate: number;
    repeatStrategyRate: number;
  }>;
  doubleActionAnalysis: {
    considered: number;
    feasible: number;
    budgetBlocked: number;
    selected: number;
    stoppedAfterFirst: number;
    selectionRate: number;
    feasibleSelectionRate: number;
    doubleBidTurns: number;
    doubleDisruptTurns: number;
    secondaryStrategyCounts: Record<Exclude<AiStrategy, 'withdraw'>, number>;
    secondaryQuote: MetricSummary;
    predictedUtility: MetricSummary;
    actualRoomScore: MetricSummary;
    actualTotalCost: MetricSummary;
    entitlementsPerTurn: MetricSummary;
    awardsPerTurn: MetricSummary;
  };
  emptyMarketRooms: number;
}

export interface SimulationOptions {
  enableSituationAnalysis?: boolean;
  enableItemAnalysis?: boolean;
  doctrine?: AiDoctrine;
  doctrinePopulation?: Partial<Record<AiDoctrine, number>>;
  enablePersonalities?: boolean;
  personalityCountMinimum?: number;
  personalityCountMaximum?: number;
  enableDoubleActions?: boolean;
  personalityPool?: readonly AiPersonality[];
}

export interface DoctrinePerformanceSummary {
  playerGames: number;
  decisions: number;
  strategyRates: Record<AiStrategy, number>;
  finalScore: MetricSummary;
  finalMoney: MetricSummary;
  finalItemCount: MetricSummary;
  winnerRate: number;
  awardsPerPlayerGame: number;
}

export interface PersonalityPerformanceSummary {
  playerGames: number;
  decisions: number;
  strategyRates: Record<AiStrategy, number>;
  finalScore: MetricSummary;
  finalMoney: MetricSummary;
  finalItemCount: MetricSummary;
  winnerRate: number;
  awardsPerPlayerGame: number;
  cooperationZoneHitRate: number;
  preferredTargetSelectionRate: number;
  repeatStrategyRate: number;
}

export interface ItemBalanceSummary {
  name: string;
  pool: string;
  rarity: string;
  appearances: number;
  awardEvents: number;
  copiesAwarded: number;
  appearanceToCopyRate: number;
  meanAcquisitionRoom: number;
  holderPlayerGames: number;
  holderRate: number;
  holderFinalScore: MetricSummary;
  holderFinalMoney: MetricSummary;
  holderWinRate: number;
  winnerPossessionRate: number;
  meanWithinGameScoreDeltaVsNonholders: number;
  meanWithinGameMoneyDeltaVsNonholders: number;
  meanScoreGainedAfterFirstCopy: number;
  meanMoneyChangeAfterFirstCopy: number;
  decisionsWhileHeld: number;
  strategyRatesWhileHeld: Record<AiStrategy, number>;
  meanQuoteWhileHeld: number;
  directEventCounts: Record<string, number>;
  directMoneyAmount: number;
  directScoreAmount: number;
  scoringTriggerCounts: Record<string, number>;
  scoringTriggerAmount: number;
  finalScoreByCopies: Record<'1' | '2' | '3+', MetricSummary>;
}

interface ItemAccumulator {
  appearance: number;
  awardEvents: number;
  copies: number;
  acquisitionRoom: RunningMetric;
  holderScore: RunningMetric;
  holderMoney: RunningMetric;
  holderCount: number;
  holderWins: number;
  winnerSlots: number;
  winnerHolders: number;
  withinGameScoreDelta: RunningMetric;
  withinGameMoneyDelta: RunningMetric;
  scoreAfterAcquisition: RunningMetric;
  moneyAfterAcquisition: RunningMetric;
  decisions: number;
  strategies: Record<AiStrategy, number>;
  quotes: RunningMetric;
  eventCounts: Record<string, number>;
  directMoney: number;
  directScore: number;
  scoringTriggers: Record<string, number>;
  scoringTriggerAmount: number;
  scoreByCopies: Record<'1' | '2' | '3+', RunningMetric>;
}

interface DoctrineAccumulator {
  playerGames: number;
  decisions: number;
  strategies: Record<AiStrategy, number>;
  score: RunningMetric;
  money: RunningMetric;
  items: RunningMetric;
  winnerSlots: number;
  awards: number;
  cooperationAttempts: number;
  cooperationHits: number;
  preferredTargetOpportunities: number;
  preferredTargetSelections: number;
  repeatOpportunities: number;
  repeatSelections: number;
}

type PersonalityAccumulator = DoctrineAccumulator;

function metric(): RunningMetric {
  return { count: 0, sum: 0, sumSquares: 0, minimum: Infinity, maximum: -Infinity };
}

function addMetric(target: RunningMetric, value: number): void {
  target.count += 1;
  target.sum += value;
  target.sumSquares += value * value;
  target.minimum = Math.min(target.minimum, value);
  target.maximum = Math.max(target.maximum, value);
}

function summarize(target: RunningMetric): MetricSummary {
  if (target.count === 0) {
    return { count: 0, mean: 0, standardDeviation: 0, minimum: 0, maximum: 0 };
  }
  const mean = target.sum / target.count;
  const variance = Math.max(0, target.sumSquares / target.count - mean * mean);
  return {
    count: target.count,
    mean,
    standardDeviation: Math.sqrt(variance),
    minimum: target.minimum,
    maximum: target.maximum,
  };
}

function increment<T extends string>(record: Partial<Record<T, number>>, key: T, amount = 1): void {
  record[key] = (record[key] ?? 0) + amount;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function createRankingDeciles(records: readonly RankedPlayerRecord[]): RankingBandSummary[] {
  const ranked = [...records].sort(
    (left, right) => right.finalScore - left.finalScore || left.game - right.game || left.playerId.localeCompare(right.playerId),
  );
  return Array.from({ length: 10 }, (_, index) => {
    const start = Math.floor((index * ranked.length) / 10);
    const end = Math.floor(((index + 1) * ranked.length) / 10);
    const bandRecords = ranked.slice(start, end);
    const doctrineCounts: Record<AiDoctrine, number> = { balanced: 0, cooperative: 0, chaotic: 0 };
    const personalityCounts = Object.fromEntries(
      aiPersonalityOrder.map((personality) => [personality, 0]),
    ) as Record<AiPersonality, number>;
    const characterCounts = Object.fromEntries(
      characterOrder.map((character) => [character, 0]),
    ) as Record<CharacterId, number>;
    for (const record of bandRecords) {
      doctrineCounts[record.doctrine] += 1;
      characterCounts[record.character] += 1;
      for (const personality of record.personalities) personalityCounts[personality] += 1;
    }
    const scores = bandRecords.map((record) => record.finalScore);
    const itemCounts = bandRecords.map((record) => record.itemCount);
    const count = bandRecords.length;
    return {
      band: `${index * 10}-${(index + 1) * 10}%`,
      count,
      scoreMean: count === 0 ? 0 : scores.reduce((sum, value) => sum + value, 0) / count,
      scoreMedian: median(scores),
      itemCountMean: count === 0 ? 0 : itemCounts.reduce((sum, value) => sum + value, 0) / count,
      itemCountMedian: median(itemCounts),
      doctrineShares: Object.fromEntries(
        doctrineOrderForReport.map((doctrine) => [doctrine, count === 0 ? 0 : doctrineCounts[doctrine] / count]),
      ) as Record<AiDoctrine, number>,
      characterShares: Object.fromEntries(
        characterOrder.map((character) => [character, count === 0 ? 0 : characterCounts[character] / count]),
      ) as Record<CharacterId, number>,
      topPersonalities: aiPersonalityOrder
        .map((personality) => ({
          personality,
          count: personalityCounts[personality],
          prevalence: count === 0 ? 0 : personalityCounts[personality] / count,
        }))
        .sort((left, right) => right.count - left.count || left.personality.localeCompare(right.personality))
        .slice(0, 10),
    };
  });
}

function emptyStrategies(): Record<AiStrategy, number> {
  return {
    high_bid: 0,
    cooperate: 0,
    disrupt_high: 0,
    disrupt_cooperate: 0,
    withdraw: 0,
  };
}

function createItemAccumulator(): ItemAccumulator {
  return {
    appearance: 0,
    awardEvents: 0,
    copies: 0,
    acquisitionRoom: metric(),
    holderScore: metric(),
    holderMoney: metric(),
    holderCount: 0,
    holderWins: 0,
    winnerSlots: 0,
    winnerHolders: 0,
    withinGameScoreDelta: metric(),
    withinGameMoneyDelta: metric(),
    scoreAfterAcquisition: metric(),
    moneyAfterAcquisition: metric(),
    decisions: 0,
    strategies: emptyStrategies(),
    quotes: metric(),
    eventCounts: {},
    directMoney: 0,
    directScore: 0,
    scoringTriggers: {},
    scoringTriggerAmount: 0,
    scoreByCopies: { '1': metric(), '2': metric(), '3+': metric() },
  };
}

function createDoctrineAccumulator(): DoctrineAccumulator {
  return {
    playerGames: 0,
    decisions: 0,
    strategies: emptyStrategies(),
    score: metric(),
    money: metric(),
    items: metric(),
    winnerSlots: 0,
    awards: 0,
    cooperationAttempts: 0,
    cooperationHits: 0,
    preferredTargetOpportunities: 0,
    preferredTargetSelections: 0,
    repeatOpportunities: 0,
    repeatSelections: 0,
  };
}

function resolveDoctrinePopulation(
  playerCount: number,
  options: SimulationOptions,
): Record<AiDoctrine, number> {
  if (!options.doctrinePopulation) {
    const doctrine = options.doctrine ?? 'balanced';
    return {
      balanced: doctrine === 'balanced' ? playerCount : 0,
      cooperative: doctrine === 'cooperative' ? playerCount : 0,
      chaotic: doctrine === 'chaotic' ? playerCount : 0,
    };
  }
  const population = Object.fromEntries(
    doctrineOrderForReport.map((doctrine) => [doctrine, options.doctrinePopulation?.[doctrine] ?? 0]),
  ) as Record<AiDoctrine, number>;
  if (Object.values(population).some((count) => !Number.isInteger(count) || count < 0)) {
    throw new RangeError('Doctrine population counts must be non-negative integers.');
  }
  if (Object.values(population).reduce((sum, count) => sum + count, 0) !== playerCount) {
    throw new RangeError('Doctrine population must equal the configured player count.');
  }
  return population;
}

function shuffledPlayerDoctrines(
  population: Record<AiDoctrine, number>,
  random: ReturnType<typeof createSeededRandom>,
): AiDoctrine[] {
  const doctrines = doctrineOrderForReport.flatMap((doctrine) =>
    Array.from({ length: population[doctrine] }, () => doctrine),
  );
  for (let index = doctrines.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random.next() * (index + 1));
    [doctrines[index], doctrines[swapIndex]] = [doctrines[swapIndex]!, doctrines[index]!];
  }
  return doctrines;
}

function uniqueItems(player: RuntimePlayerState): ItemId[] {
  return [...new Set(player.items.map((instance) => instance.itemId))];
}

function collectItemEvents(
  events: readonly SettlementEvent[],
  accumulators: Record<ItemId, ItemAccumulator>,
): void {
  for (const event of events) {
    const sourceItemId = event.effectItemId ?? event.itemId;
    if (!sourceItemId) continue;
    const item = accumulators[sourceItemId];
    increment(item.eventCounts, event.type);
    if (event.type === 'money' || event.type === 'refund') item.directMoney += event.amount ?? 0;
    if (event.type === 'score') item.directScore += event.amount ?? 0;
  }
}

export function simulateAiGames(
  games: number,
  seed = 1,
  rules: RulesConfig = defaultRules,
  options: SimulationOptions = {},
): SimulationReport {
  if (!Number.isInteger(games) || games <= 0) throw new RangeError('Game count must be positive.');

  const doctrinePopulation = resolveDoctrinePopulation(rules.playerCount, options);
  const doctrineAccumulators = Object.fromEntries(
    doctrineOrderForReport.map((doctrine) => [doctrine, createDoctrineAccumulator()]),
  ) as Record<AiDoctrine, DoctrineAccumulator>;
  const characterAccumulators = Object.fromEntries(
    characterOrder.map((character) => [character, createDoctrineAccumulator()]),
  ) as Record<CharacterId, DoctrineAccumulator>;
  const personalityAccumulators = Object.fromEntries(
    aiPersonalityOrder.map((personality) => [personality, createDoctrineAccumulator()]),
  ) as Record<AiPersonality, PersonalityAccumulator>;
  const personalityCountDistribution: Record<'1' | '2' | '3' | '4', number> = {
    '1': 0,
    '2': 0,
    '3': 0,
    '4': 0,
  };

  const strategyCounts: Record<AiStrategy, number> = {
    high_bid: 0,
    cooperate: 0,
    disrupt_high: 0,
    disrupt_cooperate: 0,
    withdraw: 0,
  };
  const quoteMetrics = Array.from({ length: 3 }, () => ({
    high_bid: metric(),
    cooperate: metric(),
    disrupt_high: metric(),
    disrupt_cooperate: metric(),
  }));
  const targetMetrics = Array.from({ length: 3 }, metric);
  const moneyMetrics = Array.from({ length: 3 }, metric);
  const finalScoreMetric = metric();
  const winnerScoreMetric = metric();
  const scoreBandMetrics = Array.from({ length: 5 }, () => ({ score: metric(), items: metric() }));
  const itemCountMetric = metric();
  const winnerDoctrineCounts: Record<AiDoctrine, number> = { balanced: 0, cooperative: 0, chaotic: 0 };
  const winnerPersonalityCounts = Object.fromEntries(
    aiPersonalityOrder.map((personality) => [personality, 0]),
  ) as Record<AiPersonality, number>;
  const allPlayerRecords: RankedPlayerRecord[] = [];
  const championRecords: RankedPlayerRecord[] = [];
  const entitlementSources: Record<string, number> = {};
  const itemAppearanceCounts: Partial<Record<ItemId, number>> = {};
  const itemAwardCounts: Partial<Record<ItemId, number>> = {};
  const itemAccumulators = Object.fromEntries(
    itemCatalog.map((item) => [item.id, createItemAccumulator()]),
  ) as Record<ItemId, ItemAccumulator>;
  const liquidityBandCounts: Record<AiLiquidityBand, number> = {
    comfortable: 0,
    slightly_tight: 0,
    tight: 0,
    critical: 0,
  };
  const liquidityStrategies: Record<AiLiquidityBand, Record<AiStrategy, number>> = {
    comfortable: emptyStrategies(),
    slightly_tight: emptyStrategies(),
    tight: emptyStrategies(),
    critical: emptyStrategies(),
  };
  const situationModifierMetrics = Object.fromEntries(
    strategyOrderForReport.map((strategy) => [strategy, metric()]),
  ) as Record<AiStrategy, RunningMetric>;
  const itemModifierMetrics = Object.fromEntries(
    strategyOrderForReport.map((strategy) => [strategy, metric()]),
  ) as Record<AiStrategy, RunningMetric>;
  const fundingMultiplierMetric = metric();
  const marketQuoteMultiplierMetric = metric();
  const itemValueQuoteMultiplierMetric = metric();
  const predictionMultiplierMetric = metric();
  const finalNoiseMultiplierMetric = metric();
  const clampAmountMetric = metric();
  const targetPredictionErrorMetric = metric();
  const highestPredictionErrorMetric = metric();
  const qualificationPredictionErrorMetric = metric();
  const actualCostByRoomKind = Object.fromEntries(
    roomKindOrderForReport.map((kind) => [kind, metric()]),
  ) as Record<RoomKind, RunningMetric>;
  const scoreByRoomKind = Object.fromEntries(
    roomKindOrderForReport.map((kind) => [kind, metric()]),
  ) as Record<RoomKind, RunningMetric>;
  const roomCounts = Object.fromEntries(
    roomKindOrderForReport.map((kind) => [kind, 0]),
  ) as Record<RoomKind, number>;
  const decisionsByRoomKind = Object.fromEntries(
    roomKindOrderForReport.map((kind) => [kind, 0]),
  ) as Record<RoomKind, number>;
  const strategiesByRoomKind = Object.fromEntries(
    roomKindOrderForReport.map((kind) => [kind, emptyStrategies()]),
  ) as Record<RoomKind, Record<AiStrategy, number>>;
  const quoteByItemValueBand = {
    low: metric(),
    medium: metric(),
    high: metric(),
  };
  let evaluatedGroupSelections = 0;
  let higherValueGroupSelections = 0;
  let hiddenGroupSelections = 0;
  let nonWithdrawSelections = 0;
  let decisions = 0;
  let belowHalfStartingMoney = 0;
  let totalAwards = 0;
  let emptyMarketRooms = 0;
  let quoteClamps = 0;
  let cooperationZoneAttempts = 0;
  let cooperationZoneHits = 0;
  let totalActualCost = 0;
  let totalRoomScore = 0;
  let premiumRoomDecisions = 0;
  let premiumRoomNoMoneyDecisions = 0;
  let cooperationSlots = 0;
  let cooperationVacancies = 0;
  let highPriceDisruptionSlots = 0;
  let highPriceDisruptionVacancies = 0;
  let totalQualificationSlots = 0;
  let highPriceQualificationSlots = 0;
  let cooperationQualificationSlots = 0;
  let disruptedHighPriceQualificationSlots = 0;
  let disruptedCooperationQualificationSlots = 0;
  let transcendenceRedemptions = 0;
  let highPriceTranscendenceRedemptions = 0;
  let cooperationTranscendenceRedemptions = 0;
  let doubleActionConsidered = 0;
  let doubleActionFeasible = 0;
  let doubleActionSelected = 0;
  let doubleBidTurns = 0;
  let doubleDisruptTurns = 0;
  const secondaryStrategyCounts: Record<Exclude<AiStrategy, 'withdraw'>, number> = {
    high_bid: 0,
    cooperate: 0,
    disrupt_high: 0,
    disrupt_cooperate: 0,
  };
  const secondaryQuoteMetric = metric();
  const secondaryUtilityMetric = metric();
  const doubleActionScoreMetric = metric();
  const doubleActionCostMetric = metric();
  const doubleActionEntitlementMetric = metric();
  const doubleActionAwardMetric = metric();

  for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
    const gameSeed = (seed + gameIndex * 0x9e3779b1) >>> 0;
    const roomRandom = createSeededRandom((gameSeed ^ 0x243f6a88) >>> 0);
    const decisionRandom = createSeededRandom((gameSeed ^ 0x85a308d3) >>> 0);
    const quoteProfileRandom = createSeededRandom((gameSeed ^ 0xa4093822) >>> 0);
    const quoteRandom = createSeededRandom((gameSeed ^ 0x299f31d0) >>> 0);
    const gameplayRandom = createSeededRandom((gameSeed ^ 0x13198a2e) >>> 0);
    const doctrineRandom = createSeededRandom((gameSeed ^ 0x7f4a7c15) >>> 0);
    const personalityRandom = createSeededRandom((gameSeed ^ 0x6a09e667) >>> 0);
    const characterRandom = createSeededRandom((gameSeed ^ 0xbb67ae85) >>> 0);
    const generatedFloors = Array.from({ length: 3 }, (_, floorIndex) =>
      generateFloor(floorIndex, roomRandom),
    );
    let players: RuntimePlayerState[] = Array.from({ length: rules.playerCount }, (_, index) =>
      createRuntimePlayer({ id: `ai-${index + 1}`, money: 0, score: 0, isHuman: false }),
    );
    const playerDoctrines = new Map<string, AiDoctrine>();
    const playerPersonalities = new Map<string, AiPersonality[]>();
    const playerCharacters = new Map<string, CharacterId>();
    players = players.map((player) => {
      const character = chooseRandomCharacter(characterRandom);
      playerCharacters.set(player.id, character);
      characterAccumulators[character].playerGames += 1;
      return assignCharacter(player, character, characterRandom);
    });
    const shuffledDoctrines = shuffledPlayerDoctrines(doctrinePopulation, doctrineRandom);
    players.forEach((player, index) => {
      const doctrine = shuffledDoctrines[index]!;
      playerDoctrines.set(player.id, doctrine);
      doctrineAccumulators[doctrine].playerGames += 1;
      const personalities = options.enablePersonalities
        ? generateAiPersonalities(
            personalityRandom,
            options.personalityCountMinimum ?? 1,
            options.personalityCountMaximum ?? 3,
            options.personalityPool,
          )
        : [];
      playerPersonalities.set(player.id, personalities);
      if (personalities.length > 0) {
        personalityCountDistribution[String(personalities.length) as '1' | '2' | '3' | '4'] += 1;
      }
      for (const personality of personalities) personalityAccumulators[personality].playerGames += 1;
    });
    const firstAcquisitions = new Map<string, { score: number; money: number }>();
    const histories = new Map<string, AiPlayerHistory>(
      players.map((player) => [player.id, createEmptyAiHistory()]),
    );
    const quoteProfiles = new Map<string, AiQuoteProfile>(
      players.map((player) => [player.id, createAiQuoteProfile(quoteProfileRandom)]),
    );
    const recentMarkets: AiPublicMarketSnapshot[] = [];

    for (let floorIndex = 0; floorIndex < 3; floorIndex += 1) {
      const rooms = generatedFloors[floorIndex]!;
      const floorMoney = rules.floorStartingMoney[floorIndex]!;
      for (const room of rooms) {
        roomCounts[room.kind] += 1;
        const globalRoom = floorIndex * 5 + room.roomIndex + 1;
        for (const reward of room.rewards) {
          increment(itemAppearanceCounts, reward.itemId);
          itemAccumulators[reward.itemId].appearance += 1;
        }
        const preparation = preparePlayersForRoom(
          players,
          floorIndex,
          room.roomIndex,
          rules,
          gameplayRandom,
        );
        players = preparation.players;
        collectItemEvents(preparation.events, itemAccumulators);

        const rankPercentiles = (value: (player: RuntimePlayerState) => number): Map<string, number> => {
          const ranked = [...players].sort(
            (left, right) => value(right) - value(left) || left.id.localeCompare(right.id),
          );
          return new Map(
            ranked.map((player, index) => [
              player.id,
              ranked.length <= 1 ? 1 : 1 - index / (ranked.length - 1),
            ]),
          );
        };
        const moneyRanks = rankPercentiles((player) => player.money);
        const scoreRanks = rankPercentiles((player) => player.score);

        const quoteAnalysesForRoom: Array<{
          playerId: string;
          strategy: AiStrategy;
          group: 'A' | 'B';
          quote: AiQuoteAnalysis;
        }> = [];
        const strategiesForRoom = new Map<string, AiStrategy>();
        const doubleActionPlayersForRoom = new Set<string>();
        const decisionsForRoom = players.map((player) => {
          if (room.kind === 'shop' || room.kind === 'boss') {
            premiumRoomDecisions += 1;
            if (player.money <= 0) premiumRoomNoMoneyDecisions += 1;
          }
          if (player.money < floorMoney * 0.5) belowHalfStartingMoney += 1;
          const remainingRooms = 5 - room.roomIndex;
          const decision = decideAiTurn(player, floorIndex, rules, decisionRandom, {
            remainingRooms,
            context: {
              moneyRankPercentile: moneyRanks.get(player.id) ?? 0.5,
              scoreRankPercentile: scoreRanks.get(player.id) ?? 0.5,
              recentMarkets: recentMarkets.slice(-3),
              history: histories.get(player.id)!,
              room,
              remainingGameRooms: 15 - (floorIndex * 5 + room.roomIndex),
            },
            enableSituationAnalysis: options.enableSituationAnalysis,
            enableItemAnalysis: options.enableItemAnalysis,
            quoteProfile: quoteProfiles.get(player.id),
            quoteRandom,
            doctrine: playerDoctrines.get(player.id),
            personalities: playerPersonalities.get(player.id),
            enableDoubleActions: options.enableDoubleActions,
          });
          strategiesForRoom.set(player.id, decision.strategy);
          decisionsByRoomKind[room.kind] += 1;
          strategiesByRoomKind[room.kind][decision.strategy] += 1;
          if (decision.secondaryActionAnalysis?.considered) {
            doubleActionConsidered += 1;
            if (
              decision.secondaryActionAnalysis.legalSecondaryMaximum > 0 &&
              decision.secondaryActionAnalysis.candidates.length > 0
            ) {
              doubleActionFeasible += 1;
            }
            if (decision.secondaryActionAnalysis.selectedStrategy && decision.turn.actions.length === 2) {
              doubleActionSelected += 1;
              doubleActionPlayersForRoom.add(player.id);
              if (decision.secondaryActionAnalysis.mode === 'bid') doubleBidTurns += 1;
              else doubleDisruptTurns += 1;
              secondaryStrategyCounts[decision.secondaryActionAnalysis.selectedStrategy] += 1;
              addMetric(secondaryQuoteMetric, decision.secondaryActionAnalysis.selectedQuote!.amount);
              const selectedCandidate = decision.secondaryActionAnalysis.candidates.find(
                (candidate) => candidate.strategy === decision.secondaryActionAnalysis!.selectedStrategy,
              );
              if (selectedCandidate) addMetric(secondaryUtilityMetric, selectedCandidate.expectedUtility);
            }
          }
          if (decision.analysis) {
            for (const strategy of strategyOrderForReport) {
              addMetric(situationModifierMetrics[strategy], decision.analysis.situationMultipliers[strategy]);
              addMetric(itemModifierMetrics[strategy], decision.analysis.itemMultipliers[strategy]);
            }
          }
          if (decision.quoteAnalysis) {
            const quote = decision.quoteAnalysis;
            const quoteAction = decision.turn.actions[0];
            quoteAnalysesForRoom.push({
              playerId: player.id,
              strategy: decision.strategy,
              group: quoteAction && quoteAction.type !== 'withdraw' ? quoteAction.group : 'A',
              quote,
            });
            addMetric(fundingMultiplierMetric, quote.fundingMultiplier);
            addMetric(marketQuoteMultiplierMetric, quote.marketMultiplier);
            addMetric(itemValueQuoteMultiplierMetric, quote.itemValueMultiplier);
            addMetric(predictionMultiplierMetric, quote.predictionMultiplier);
            addMetric(finalNoiseMultiplierMetric, quote.randomFactor);
            if (quote.wasClamped) {
              quoteClamps += 1;
              addMetric(clampAmountMetric, quote.nominalQuoteBeforeLimit - quote.amount);
            }
            const selectedAction = decision.turn.actions[0];
            if (selectedAction && selectedAction.type !== 'withdraw' && decision.analysis) {
              const value = decision.analysis.groupValues[selectedAction.group];
              const band = value < 0.45 ? 'low' : value < 0.75 ? 'medium' : 'high';
              addMetric(quoteByItemValueBand[band], selectedAction.amount / floorMoney);
            }
          }
          const liquidityBand = getAiLiquidityBand(decision.liquidityRatio);
          liquidityBandCounts[liquidityBand] += 1;
          liquidityStrategies[liquidityBand][decision.strategy] += 1;
          decisions += 1;
          strategyCounts[decision.strategy] += 1;
          const doctrineAccumulator = doctrineAccumulators[playerDoctrines.get(player.id)!];
          doctrineAccumulator.decisions += 1;
          doctrineAccumulator.strategies[decision.strategy] += 1;
          const characterAccumulator = characterAccumulators[playerCharacters.get(player.id)!];
          characterAccumulator.decisions += 1;
          characterAccumulator.strategies[decision.strategy] += 1;
          for (const personality of playerPersonalities.get(player.id) ?? []) {
            const target = personalityAccumulators[personality];
            target.decisions += 1;
            target.strategies[decision.strategy] += 1;
            const previousStrategy = histories.get(player.id)!.lastStrategy;
            if (previousStrategy) {
              target.repeatOpportunities += 1;
              if (previousStrategy === decision.strategy) target.repeatSelections += 1;
            }
          }
          if (decision.strategy !== 'withdraw') {
            const amount = decision.turn.actions[0]?.type === 'withdraw' ? 0 : decision.turn.actions[0]?.amount;
            addMetric(quoteMetrics[floorIndex]![decision.strategy], amount ?? 0);
            nonWithdrawSelections += 1;
            const selectedAction = decision.turn.actions[0];
            if (selectedAction && selectedAction.type !== 'withdraw' && decision.analysis) {
              const selectedValue = decision.analysis.groupValues[selectedAction.group];
              const otherValue = decision.analysis.groupValues[selectedAction.group === 'A' ? 'B' : 'A'];
              if (selectedValue !== otherValue) {
                evaluatedGroupSelections += 1;
                if (selectedValue > otherValue) higherValueGroupSelections += 1;
              }
              if (room.rewards.find((reward) => reward.group === selectedAction.group)?.hidden) {
                hiddenGroupSelections += 1;
              }
              for (const personality of playerPersonalities.get(player.id) ?? []) {
                const wantedType = personality === 'vain'
                  ? 'score'
                  : personality === 'greedy'
                    ? 'economy'
                    : null;
                if (!wantedType) continue;
                const eligibleRewards = room.rewards.filter(
                  (reward) => !reward.hidden && aiItemProfiles[reward.itemId].types.includes(wantedType),
                );
                if (eligibleRewards.length === 0) continue;
                const target = personalityAccumulators[personality];
                target.preferredTargetOpportunities += 1;
                if (eligibleRewards.some((reward) => reward.group === selectedAction.group)) {
                  target.preferredTargetSelections += 1;
                }
              }
            }
          }
          const history = histories.get(player.id)!;
          history.rounds += 1;
          history.strategyCounts[decision.strategy] += 1;
          history.lastStrategy = decision.strategy;
          if (decision.strategy !== 'withdraw') history.competitiveRounds += 1;
          for (const itemId of uniqueItems(player)) {
            const item = itemAccumulators[itemId];
            item.decisions += 1;
            item.strategies[decision.strategy] += 1;
            if (decision.strategy !== 'withdraw') {
              const action = decision.turn.actions[0];
              if (action && action.type !== 'withdraw') addMetric(item.quotes, action.amount);
            }
          }
          return decision.turn;
        });

        const settlement = settleRuntimeRoom(room, players, decisionsForRoom, rules, gameplayRandom);
        players = settlement.players;
        for (const playerId of doubleActionPlayersForRoom) {
          addMetric(doubleActionScoreMetric, settlement.scoreBreakdowns[playerId]?.score ?? 0);
          addMetric(
            doubleActionCostMetric,
            settlement.resolvedActions
              .filter((action) => action.playerId === playerId)
              .reduce((sum, action) => sum + action.actualCost, 0),
          );
          addMetric(
            doubleActionEntitlementMetric,
            settlement.entitlements.filter((entitlement) => entitlement.playerId === playerId).length,
          );
          addMetric(
            doubleActionAwardMetric,
            settlement.awards
              .filter((award) => award.playerId === playerId)
              .reduce((sum, award) => sum + award.copies, 0),
          );
        }
        for (const placement of settlement.highPricePlacements) {
          highPriceQualificationSlots += 1;
          totalQualificationSlots += 1;
          if (placement.actionType === 'disrupt') disruptedHighPriceQualificationSlots += 1;
        }
        for (const placement of settlement.cooperationPlacements) {
          cooperationSlots += 1;
          cooperationQualificationSlots += 1;
          totalQualificationSlots += 1;
          const hasEntitlement = settlement.entitlements.some(
            (entitlement) => entitlement.playerId === placement.playerId && entitlement.group === placement.group,
          );
          if (!hasEntitlement) cooperationVacancies += 1;
          if (placement.actionType === 'disrupt') {
            disruptedCooperationQualificationSlots += 1;
            if (strategiesForRoom.get(placement.playerId) === 'disrupt_high') {
              highPriceDisruptionSlots += 1;
              if (!hasEntitlement) highPriceDisruptionVacancies += 1;
            }
          }
        }
        for (const redemption of settlement.transcendenceRedemptions) {
          transcendenceRedemptions += 1;
          if (redemption.slotType === 'highest') highPriceTranscendenceRedemptions += 1;
          else cooperationTranscendenceRedemptions += 1;
        }
        collectItemEvents(settlement.events, itemAccumulators);
        if (!settlement.baseline) emptyMarketRooms += 1;
        else addMetric(targetMetrics[floorIndex]!, settlement.baseline.target / floorMoney);
        const actualHighestMarketEquivalent = settlement.resolvedActions.reduce(
          (highest, action) => Math.max(highest, action.marketEquivalent ?? 0),
          0,
        );
        const actualQualificationByGroup = Object.fromEntries(
          (['A', 'B'] as const).map((group) => {
            const ranked = settlement.resolvedActions
              .filter((action) => action.action.type !== 'withdraw' && action.action.group === group)
              .sort((left, right) => (right.marketEquivalent ?? 0) - (left.marketEquivalent ?? 0));
            const slotCount = calculateHighPriceSlotCount(ranked.length, rules);
            return [group, slotCount === 0 ? 0 : ranked[slotCount - 1]!.marketEquivalent ?? 0];
          }),
        ) as Record<'A' | 'B', number>;
        for (const entry of quoteAnalysesForRoom) {
          if (settlement.baseline) {
            addMetric(
              targetPredictionErrorMetric,
              Math.abs(entry.quote.prediction.predictedTarget - settlement.baseline.target) / floorMoney,
            );
          }
          addMetric(
            highestPredictionErrorMetric,
            Math.abs(
              entry.quote.prediction.predictedHighestMarketEquivalent - actualHighestMarketEquivalent,
            ) / floorMoney,
          );
          addMetric(
            qualificationPredictionErrorMetric,
            Math.abs(
              entry.quote.prediction.predictedHighPriceQualificationEquivalent -
                (actualQualificationByGroup[entry.group] ?? 0),
            ) / floorMoney,
          );
          if (entry.strategy === 'cooperate' || entry.strategy === 'disrupt_cooperate') {
            const resolved = settlement.resolvedActions.find(
              (action) => action.playerId === entry.playerId && action.actionIndex === 0,
            );
            if (resolved?.scoringEquivalent !== null && settlement.baseline) {
              cooperationZoneAttempts += 1;
              for (const personality of playerPersonalities.get(entry.playerId) ?? []) {
                personalityAccumulators[personality].cooperationAttempts += 1;
              }
              if (
                Math.abs(resolved!.scoringEquivalent! - settlement.baseline.target) <=
                floorMoney * rules.cooperationZoneRatio
              ) {
                cooperationZoneHits += 1;
                for (const personality of playerPersonalities.get(entry.playerId) ?? []) {
                  personalityAccumulators[personality].cooperationHits += 1;
                }
              }
            }
          }
        }
        for (const action of settlement.resolvedActions) {
          addMetric(actualCostByRoomKind[room.kind], action.actualCost / floorMoney);
          totalActualCost += action.actualCost;
        }
        for (const breakdown of Object.values(settlement.scoreBreakdowns)) {
          addMetric(scoreByRoomKind[room.kind], breakdown.score);
        }
        totalRoomScore += Object.values(settlement.scoreBreakdowns).reduce(
          (sum, breakdown) => sum + breakdown.score,
          0,
        );
        for (const entitlement of settlement.entitlements) {
          for (const source of entitlement.sources) {
            increment(entitlementSources, source);
          }
        }
        for (const award of settlement.awards) {
          increment(itemAwardCounts, award.itemId, award.copies);
          const item = itemAccumulators[award.itemId];
          item.awardEvents += 1;
          item.copies += award.copies;
          for (let copy = 0; copy < award.copies; copy += 1) addMetric(item.acquisitionRoom, globalRoom);
          const player = players.find((candidate) => candidate.id === award.playerId)!;
          const acquisitionKey = `${player.id}:${award.itemId}`;
          if (!firstAcquisitions.has(acquisitionKey)) {
            firstAcquisitions.set(acquisitionKey, { score: player.score, money: player.money });
          }
          totalAwards += award.copies;
          doctrineAccumulators[playerDoctrines.get(award.playerId)!].awards += award.copies;
          characterAccumulators[playerCharacters.get(award.playerId)!].awards += award.copies;
          for (const personality of playerPersonalities.get(award.playerId) ?? []) {
            personalityAccumulators[personality].awards += award.copies;
          }
          histories.get(award.playerId)!.awards += award.copies;
        }
        for (const turn of decisionsForRoom) {
          if (turn.actions[0]?.type === 'withdraw') continue;
          const earned = settlement.entitlements.some((entitlement) => entitlement.playerId === turn.playerId);
          if (!earned) histories.get(turn.playerId)!.failedCompetitiveRounds += 1;
        }
        for (const breakdown of Object.values(settlement.scoreBreakdowns)) {
          for (const trigger of breakdown.triggers) {
            const item = itemAccumulators[trigger.itemId];
            increment(item.scoringTriggers, trigger.kind);
            item.scoringTriggerAmount += trigger.amount ?? 0;
          }
        }
        for (const action of settlement.resolvedActions) {
          if (
            action.action.type === 'bid' &&
            action.marketEquivalent !== action.action.amount
          ) {
            const item = itemAccumulators.twenty_twenty;
            increment(item.scoringTriggers, 'market_equivalent_adjustment');
            item.scoringTriggerAmount += (action.marketEquivalent ?? 0) - action.action.amount;
          }
        }
        if (settlement.baseline) {
          const marketActions = settlement.resolvedActions.filter(
            (action) => action.action.type !== 'withdraw',
          );
          recentMarkets.push({
            targetRatio: settlement.baseline.target / floorMoney,
            participationRate: settlement.baseline.participantCount / players.length,
            disruptionRate: marketActions.length === 0
              ? 0
              : marketActions.filter((action) => action.action.type === 'disrupt').length / marketActions.length,
            highestMarketEquivalentRatio: Math.max(
              ...marketActions.map((action) => action.marketEquivalent ?? 0),
            ) / floorMoney,
            highPriceQualificationRatio: (['A', 'B'] as const)
              .map((group) => actualQualificationByGroup[group])
              .filter((value) => value > 0)
              .reduce((sum, value, _, values) => sum + value / values.length, 0) / floorMoney,
          });
        }
      }
      for (const player of players) addMetric(moneyMetrics[floorIndex]!, player.money);
    }

    const finalScores = players.map((player) => calculateFinalScore(player));
    const winnerScore = Math.max(...finalScores);
    const winnerIndexes = finalScores.flatMap((score, index) => (score === winnerScore ? [index] : []));
    const rankedIndexes = finalScores
      .map((score, index) => ({ score, index }))
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.index);
    for (let rank = 0; rank < rankedIndexes.length; rank += 1) {
      const bandIndex = Math.min(4, Math.floor((rank * 5) / rankedIndexes.length));
      const playerIndex = rankedIndexes[rank]!;
      addMetric(scoreBandMetrics[bandIndex]!.score, finalScores[playerIndex]!);
      addMetric(scoreBandMetrics[bandIndex]!.items, players[playerIndex]!.items.length);
    }
    for (let index = 0; index < players.length; index += 1) {
      allPlayerRecords.push({
        game: gameIndex + 1,
        playerId: players[index]!.id,
        finalScore: finalScores[index]!,
        doctrine: playerDoctrines.get(players[index]!.id)!,
        character: playerCharacters.get(players[index]!.id)!,
        personalities: [...(playerPersonalities.get(players[index]!.id) ?? [])],
        itemCount: players[index]!.items.length,
        items: players[index]!.items.map((item) => item.itemId),
      });
      addMetric(finalScoreMetric, finalScores[index]!);
      addMetric(itemCountMetric, players[index]!.items.length);
      const doctrineAccumulator = doctrineAccumulators[playerDoctrines.get(players[index]!.id)!];
      addMetric(doctrineAccumulator.score, finalScores[index]!);
      addMetric(doctrineAccumulator.money, players[index]!.money);
      addMetric(doctrineAccumulator.items, players[index]!.items.length);
      const characterAccumulator = characterAccumulators[playerCharacters.get(players[index]!.id)!];
      addMetric(characterAccumulator.score, finalScores[index]!);
      addMetric(characterAccumulator.money, players[index]!.money);
      addMetric(characterAccumulator.items, players[index]!.items.length);
      for (const personality of playerPersonalities.get(players[index]!.id) ?? []) {
        const personalityAccumulator = personalityAccumulators[personality];
        addMetric(personalityAccumulator.score, finalScores[index]!);
        addMetric(personalityAccumulator.money, players[index]!.money);
        addMetric(personalityAccumulator.items, players[index]!.items.length);
      }
    }
    for (const winnerIndex of winnerIndexes) {
      championRecords.push({
        game: gameIndex + 1,
        playerId: players[winnerIndex]!.id,
        finalScore: finalScores[winnerIndex]!,
        doctrine: playerDoctrines.get(players[winnerIndex]!.id)!,
        character: playerCharacters.get(players[winnerIndex]!.id)!,
        personalities: [...(playerPersonalities.get(players[winnerIndex]!.id) ?? [])],
        itemCount: players[winnerIndex]!.items.length,
        items: players[winnerIndex]!.items.map((item) => item.itemId),
      });
      const doctrine = playerDoctrines.get(players[winnerIndex]!.id)!;
      doctrineAccumulators[doctrine].winnerSlots += 1;
      characterAccumulators[playerCharacters.get(players[winnerIndex]!.id)!].winnerSlots += 1;
      winnerDoctrineCounts[doctrine] += 1;
      for (const personality of playerPersonalities.get(players[winnerIndex]!.id) ?? []) {
        personalityAccumulators[personality].winnerSlots += 1;
        winnerPersonalityCounts[personality] += 1;
      }
    }
    addMetric(winnerScoreMetric, winnerScore);

    for (const definition of itemCatalog) {
      const accumulator = itemAccumulators[definition.id];
      const holders = players.flatMap((player, index) => {
        const copies = player.items.filter((instance) => instance.itemId === definition.id).length;
        return copies > 0 ? [{ player, index, copies }] : [];
      });
      const nonholders = players.flatMap((player, index) =>
        player.items.some((instance) => instance.itemId === definition.id) ? [] : [{ player, index }],
      );
      accumulator.winnerSlots += winnerIndexes.length;
      accumulator.winnerHolders += winnerIndexes.filter((index) =>
        players[index]!.items.some((instance) => instance.itemId === definition.id),
      ).length;
      if (holders.length > 0) {
        const holderMeanScore = holders.reduce((sum, holder) => sum + finalScores[holder.index]!, 0) / holders.length;
        const holderMeanMoney = holders.reduce((sum, holder) => sum + holder.player.money, 0) / holders.length;
        if (nonholders.length > 0) {
          const nonholderMeanScore = nonholders.reduce((sum, value) => sum + finalScores[value.index]!, 0) / nonholders.length;
          const nonholderMeanMoney = nonholders.reduce((sum, value) => sum + value.player.money, 0) / nonholders.length;
          addMetric(accumulator.withinGameScoreDelta, holderMeanScore - nonholderMeanScore);
          addMetric(accumulator.withinGameMoneyDelta, holderMeanMoney - nonholderMeanMoney);
        }
      }
      for (const holder of holders) {
        accumulator.holderCount += 1;
        if (winnerIndexes.includes(holder.index)) accumulator.holderWins += 1;
        addMetric(accumulator.holderScore, finalScores[holder.index]!);
        addMetric(accumulator.holderMoney, holder.player.money);
        const bucket = holder.copies === 1 ? '1' : holder.copies === 2 ? '2' : '3+';
        addMetric(accumulator.scoreByCopies[bucket], finalScores[holder.index]!);
        const acquired = firstAcquisitions.get(`${holder.player.id}:${definition.id}`);
        if (acquired) {
          addMetric(accumulator.scoreAfterAcquisition, finalScores[holder.index]! - acquired.score);
          addMetric(accumulator.moneyAfterAcquisition, holder.player.money - acquired.money);
        }
      }
    }
  }

  const rates = Object.fromEntries(
    (Object.keys(strategyCounts) as AiStrategy[]).map((strategy) => [
      strategy,
      strategyCounts[strategy] / decisions,
    ]),
  ) as Record<AiStrategy, number>;

  const itemBalance = Object.fromEntries(
    itemCatalog.map((definition) => {
      const item = itemAccumulators[definition.id];
      return [definition.id, {
        name: definition.name,
        pool: definition.pool,
        rarity: definition.rarity,
        appearances: item.appearance,
        awardEvents: item.awardEvents,
        copiesAwarded: item.copies,
        appearanceToCopyRate: item.appearance === 0 ? 0 : item.copies / item.appearance,
        meanAcquisitionRoom: summarize(item.acquisitionRoom).mean,
        holderPlayerGames: item.holderCount,
        holderRate: item.holderCount / (games * rules.playerCount),
        holderFinalScore: summarize(item.holderScore),
        holderFinalMoney: summarize(item.holderMoney),
        holderWinRate: item.holderCount === 0 ? 0 : item.holderWins / item.holderCount,
        winnerPossessionRate: item.winnerSlots === 0 ? 0 : item.winnerHolders / item.winnerSlots,
        meanWithinGameScoreDeltaVsNonholders: summarize(item.withinGameScoreDelta).mean,
        meanWithinGameMoneyDeltaVsNonholders: summarize(item.withinGameMoneyDelta).mean,
        meanScoreGainedAfterFirstCopy: summarize(item.scoreAfterAcquisition).mean,
        meanMoneyChangeAfterFirstCopy: summarize(item.moneyAfterAcquisition).mean,
        decisionsWhileHeld: item.decisions,
        strategyRatesWhileHeld: Object.fromEntries(strategyOrderForReport.map((strategy) => [
          strategy,
          item.decisions === 0 ? 0 : item.strategies[strategy] / item.decisions,
        ])) as Record<AiStrategy, number>,
        meanQuoteWhileHeld: summarize(item.quotes).mean,
        directEventCounts: item.eventCounts,
        directMoneyAmount: item.directMoney,
        directScoreAmount: item.directScore,
        scoringTriggerCounts: item.scoringTriggers,
        scoringTriggerAmount: item.scoringTriggerAmount,
        finalScoreByCopies: {
          '1': summarize(item.scoreByCopies['1']),
          '2': summarize(item.scoreByCopies['2']),
          '3+': summarize(item.scoreByCopies['3+']),
        },
      } satisfies ItemBalanceSummary];
    }),
  ) as Record<ItemId, ItemBalanceSummary>;

  return {
    games,
    playersPerGame: rules.playerCount,
    roomsPerGame: 15,
    decisions,
    strategyCounts,
    strategyRates: rates,
    belowHalfStartingMoneyRate: belowHalfStartingMoney / decisions,
    liquidityBandCounts,
    strategyRatesByLiquidityBand: Object.fromEntries(
      (Object.keys(liquidityBandCounts) as AiLiquidityBand[]).map((band) => [
        band,
        Object.fromEntries(strategyOrderForReport.map((strategy) => [
          strategy,
          liquidityBandCounts[band] === 0 ? 0 : liquidityStrategies[band][strategy] / liquidityBandCounts[band],
        ])),
      ]),
    ) as Record<AiLiquidityBand, Record<AiStrategy, number>>,
    roomKindAnalysis: Object.fromEntries(
      roomKindOrderForReport.map((kind) => {
        const roomDecisions = decisionsByRoomKind[kind];
        return [kind, {
          roomCount: roomCounts[kind],
          scoreMultiplier: rules.roomScoreMultipliers[kind],
          decisions: roomDecisions,
          participationRate: roomDecisions === 0
            ? 0
            : 1 - strategiesByRoomKind[kind].withdraw / roomDecisions,
          strategyRates: Object.fromEntries(
            strategyOrderForReport.map((strategy) => [
              strategy,
              roomDecisions === 0 ? 0 : strategiesByRoomKind[kind][strategy] / roomDecisions,
            ]),
          ) as Record<AiStrategy, number>,
          averageActualCostRatioPerDecision: roomDecisions === 0
            ? 0
            : actualCostByRoomKind[kind].sum / roomDecisions,
          roomScore: summarize(scoreByRoomKind[kind]),
        }];
      }),
    ) as SimulationReport['roomKindAnalysis'],
    decisionAnalysis: {
      situationMultiplierMeans: Object.fromEntries(
        strategyOrderForReport.map((strategy) => [strategy, summarize(situationModifierMetrics[strategy]).mean]),
      ) as Record<AiStrategy, number>,
      itemMultiplierMeans: Object.fromEntries(
        strategyOrderForReport.map((strategy) => [strategy, summarize(itemModifierMetrics[strategy]).mean]),
      ) as Record<AiStrategy, number>,
      higherValueGroupSelectionRate: evaluatedGroupSelections === 0
        ? 0
        : higherValueGroupSelections / evaluatedGroupSelections,
      evaluatedGroupSelections,
      hiddenGroupSelectionRate: nonWithdrawSelections === 0 ? 0 : hiddenGroupSelections / nonWithdrawSelections,
    },
    quoteAnalysis: {
      fundingMultiplier: summarize(fundingMultiplierMetric),
      marketMultiplier: summarize(marketQuoteMultiplierMetric),
      itemValueMultiplier: summarize(itemValueQuoteMultiplierMetric),
      predictionMultiplier: summarize(predictionMultiplierMetric),
      finalNoiseMultiplier: summarize(finalNoiseMultiplierMetric),
      clampRate: fundingMultiplierMetric.count === 0
        ? 0
        : quoteClamps / fundingMultiplierMetric.count,
      meanClampAmount: summarize(clampAmountMetric).mean,
      targetPredictionErrorRatio: summarize(targetPredictionErrorMetric),
      highestPredictionErrorRatio: summarize(highestPredictionErrorMetric),
      qualificationPredictionErrorRatio: summarize(qualificationPredictionErrorMetric),
      cooperationZoneHitRate: cooperationZoneAttempts === 0
        ? 0
        : cooperationZoneHits / cooperationZoneAttempts,
      scorePerActualMoney: totalActualCost === 0 ? 0 : totalRoomScore / totalActualCost,
      averageActualCostRatioByRoomKind: Object.fromEntries(
        Object.entries(actualCostByRoomKind).map(([kind, target]) => [kind, summarize(target).mean]),
      ) as Record<RoomKind, number>,
      averageQuoteRatioByItemValueBand: Object.fromEntries(
        Object.entries(quoteByItemValueBand).map(([band, target]) => [band, summarize(target).mean]),
      ) as Record<'low' | 'medium' | 'high', number>,
      premiumRoomNoMoneyRate: premiumRoomDecisions === 0
        ? 0
        : premiumRoomNoMoneyDecisions / premiumRoomDecisions,
      cooperationSlots,
      cooperationVacancies,
      highPriceDisruptionSlots,
      highPriceDisruptionVacancies,
      highPriceDisruptionRecoveryRate: highPriceDisruptionSlots === 0
        ? 0
        : (highPriceDisruptionSlots - highPriceDisruptionVacancies) / highPriceDisruptionSlots,
      totalQualificationSlots,
      highPriceQualificationSlots,
      cooperationQualificationSlots,
      disruptedHighPriceQualificationSlots,
      disruptedCooperationQualificationSlots,
      transcendenceRedemptions,
      highPriceTranscendenceRedemptions,
      cooperationTranscendenceRedemptions,
    },
    averageQuotesByFloor: Object.fromEntries(
      quoteMetrics.map((floor, floorIndex) => [
        String(floorIndex + 1),
        {
          high_bid: summarize(floor.high_bid).mean,
          cooperate: summarize(floor.cooperate).mean,
          disrupt_high: summarize(floor.disrupt_high).mean,
          disrupt_cooperate: summarize(floor.disrupt_cooperate).mean,
        },
      ]),
    ),
    targetRatioByFloor: Object.fromEntries(
      targetMetrics.map((target, floorIndex) => [String(floorIndex + 1), summarize(target)]),
    ),
    endFloorMoneyByFloor: Object.fromEntries(
      moneyMetrics.map((money, floorIndex) => [String(floorIndex + 1), summarize(money)]),
    ),
    finalScore: summarize(finalScoreMetric),
    winnerScore: summarize(winnerScoreMetric),
    scoreBands: scoreBandMetrics.map((band, index) => ({
      band: `${index * 20 + 1}-${(index + 1) * 20}%`,
      playerCount: band.score.count,
      averageScore: summarize(band.score).mean,
      averageItemCount: summarize(band.items).mean,
    })),
    finalItemCount: summarize(itemCountMetric),
    averageAwardsPerGame: totalAwards / games,
    entitlementSources,
    itemAppearanceCounts,
    itemAwardCounts,
    itemBalance,
    doctrinePopulation,
    doctrinePerformance: Object.fromEntries(
      doctrineOrderForReport.map((doctrine) => {
        const target = doctrineAccumulators[doctrine];
        return [doctrine, {
          playerGames: target.playerGames,
          decisions: target.decisions,
          strategyRates: Object.fromEntries(
            strategyOrderForReport.map((strategy) => [
              strategy,
              target.decisions === 0 ? 0 : target.strategies[strategy] / target.decisions,
            ]),
          ) as Record<AiStrategy, number>,
          finalScore: summarize(target.score),
          finalMoney: summarize(target.money),
          finalItemCount: summarize(target.items),
          winnerRate: target.playerGames === 0 ? 0 : target.winnerSlots / target.playerGames,
          awardsPerPlayerGame: target.playerGames === 0 ? 0 : target.awards / target.playerGames,
        } satisfies DoctrinePerformanceSummary];
      }),
    ) as Record<AiDoctrine, DoctrinePerformanceSummary>,
    characterPopulation: Object.fromEntries(
      characterOrder.map((character) => [character, characterAccumulators[character].playerGames]),
    ) as Record<CharacterId, number>,
    characterPerformance: Object.fromEntries(
      characterOrder.map((character) => {
        const target = characterAccumulators[character];
        return [character, {
          playerGames: target.playerGames,
          decisions: target.decisions,
          strategyRates: Object.fromEntries(
            strategyOrderForReport.map((strategy) => [
              strategy,
              target.decisions === 0 ? 0 : target.strategies[strategy] / target.decisions,
            ]),
          ) as Record<AiStrategy, number>,
          finalScore: summarize(target.score),
          finalMoney: summarize(target.money),
          finalItemCount: summarize(target.items),
          winnerRate: target.playerGames === 0 ? 0 : target.winnerSlots / target.playerGames,
          awardsPerPlayerGame: target.playerGames === 0 ? 0 : target.awards / target.playerGames,
        } satisfies DoctrinePerformanceSummary];
      }),
    ) as Record<CharacterId, DoctrinePerformanceSummary>,
    winnerDoctrineShares: Object.fromEntries(
      doctrineOrderForReport.map((doctrine) => [
        doctrine,
        winnerScoreMetric.count === 0 ? 0 : winnerDoctrineCounts[doctrine] / winnerScoreMetric.count,
      ]),
    ) as Record<AiDoctrine, number>,
    personalityEnabled: options.enablePersonalities === true,
    personalityCountDistribution,
    personalityPerformance: Object.fromEntries(
      aiPersonalityOrder.map((personality) => {
        const target = personalityAccumulators[personality];
        return [personality, {
          playerGames: target.playerGames,
          decisions: target.decisions,
          strategyRates: Object.fromEntries(
            strategyOrderForReport.map((strategy) => [
              strategy,
              target.decisions === 0 ? 0 : target.strategies[strategy] / target.decisions,
            ]),
          ) as Record<AiStrategy, number>,
          finalScore: summarize(target.score),
          finalMoney: summarize(target.money),
          finalItemCount: summarize(target.items),
          winnerRate: target.playerGames === 0 ? 0 : target.winnerSlots / target.playerGames,
          awardsPerPlayerGame: target.playerGames === 0 ? 0 : target.awards / target.playerGames,
          cooperationZoneHitRate: target.cooperationAttempts === 0
            ? 0
            : target.cooperationHits / target.cooperationAttempts,
          preferredTargetSelectionRate: target.preferredTargetOpportunities === 0
            ? 0
            : target.preferredTargetSelections / target.preferredTargetOpportunities,
          repeatStrategyRate: target.repeatOpportunities === 0
            ? 0
            : target.repeatSelections / target.repeatOpportunities,
        } satisfies PersonalityPerformanceSummary];
      }),
    ) as Record<AiPersonality, PersonalityPerformanceSummary>,
    winnerPersonalityShares: aiPersonalityOrder
      .map((personality) => ({
        personality,
        share: winnerScoreMetric.count === 0 ? 0 : winnerPersonalityCounts[personality] / winnerScoreMetric.count,
      }))
      .sort((left, right) => right.share - left.share),
    rankingAnalysis: {
      championTop10: [...championRecords]
        .sort((left, right) => right.finalScore - left.finalScore || left.game - right.game)
        .slice(0, 10),
      championDeciles: createRankingDeciles(championRecords),
      allPlayerDeciles: createRankingDeciles(allPlayerRecords),
    },
    personalitySpecialty: Object.fromEntries(
      aiPersonalityOrder.map((personality) => {
        const target = personalityAccumulators[personality];
        const scoreMean = summarize(target.score).mean;
        const itemCountMean = summarize(target.items).mean;
        return [personality, {
          carriers: target.playerGames,
          prevalence: allPlayerRecords.length === 0 ? 0 : target.playerGames / allPlayerRecords.length,
          scoreMean,
          scoreDeltaVsAllPlayers: scoreMean - summarize(finalScoreMetric).mean,
          moneyMean: summarize(target.money).mean,
          itemCountMean,
          itemCountDeltaVsAllPlayers: itemCountMean - summarize(itemCountMetric).mean,
          championIncidence: championRecords.length === 0
            ? 0
            : winnerPersonalityCounts[personality] / championRecords.length,
          strategyRates: Object.fromEntries(
            strategyOrderForReport.map((strategy) => [
              strategy,
              target.decisions === 0 ? 0 : target.strategies[strategy] / target.decisions,
            ]),
          ) as Record<AiStrategy, number>,
          cooperationZoneHitRate: target.cooperationAttempts === 0
            ? 0
            : target.cooperationHits / target.cooperationAttempts,
          preferredTargetSelectionRate: target.preferredTargetOpportunities === 0
            ? 0
            : target.preferredTargetSelections / target.preferredTargetOpportunities,
          repeatStrategyRate: target.repeatOpportunities === 0
            ? 0
            : target.repeatSelections / target.repeatOpportunities,
        }];
      }),
    ) as SimulationReport['personalitySpecialty'],
    doubleActionAnalysis: {
      considered: doubleActionConsidered,
      feasible: doubleActionFeasible,
      budgetBlocked: doubleActionConsidered - doubleActionFeasible,
      selected: doubleActionSelected,
      stoppedAfterFirst: doubleActionConsidered - doubleActionSelected,
      selectionRate: doubleActionConsidered === 0 ? 0 : doubleActionSelected / doubleActionConsidered,
      feasibleSelectionRate: doubleActionFeasible === 0 ? 0 : doubleActionSelected / doubleActionFeasible,
      doubleBidTurns,
      doubleDisruptTurns,
      secondaryStrategyCounts,
      secondaryQuote: summarize(secondaryQuoteMetric),
      predictedUtility: summarize(secondaryUtilityMetric),
      actualRoomScore: summarize(doubleActionScoreMetric),
      actualTotalCost: summarize(doubleActionCostMetric),
      entitlementsPerTurn: summarize(doubleActionEntitlementMetric),
      awardsPerTurn: summarize(doubleActionAwardMetric),
    },
    emptyMarketRooms,
  };
}
