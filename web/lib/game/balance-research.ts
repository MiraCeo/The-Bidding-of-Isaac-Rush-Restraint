import { aiPersonalityOrder, initialAiPersonalityOrder, type AiPersonality } from './ai-personality';
import { defaultRules } from './config';
import { simulateAiGames, type MetricSummary, type SimulationResearchOptions, type SimulationReport } from './simulation';
import type { ResearchCohortSummary } from './simulation-research';

const newPersonalities: readonly AiPersonality[] = ['adaptive', 'rational', 'arrogant', 'stubborn', 'gambler'];

export const twentyPersonalityStudyCases = [
  { name: 'original15', pool: initialAiPersonalityOrder, experiment: {} },
  { name: 'neutral20', pool: aiPersonalityOrder, experiment: { neutralizedPersonalities: newPersonalities } },
  { name: 'formal20', pool: aiPersonalityOrder, experiment: {} },
  { name: 'adaptive_off', pool: aiPersonalityOrder, experiment: { neutralizedPersonalities: ['adaptive'] } },
  { name: 'rational_off', pool: aiPersonalityOrder, experiment: { neutralizedPersonalities: ['rational'] } },
  { name: 'arrogant_off', pool: aiPersonalityOrder, experiment: { neutralizedPersonalities: ['arrogant'] } },
  { name: 'stubborn_off', pool: aiPersonalityOrder, experiment: { neutralizedPersonalities: ['stubborn'] } },
  { name: 'gambler_off', pool: aiPersonalityOrder, experiment: { neutralizedPersonalities: ['gambler'] } },
  { name: 'adaptive_rational_off', pool: aiPersonalityOrder, experiment: { neutralizedPersonalities: ['adaptive', 'rational'] } },
  { name: 'rational_stubborn_off', pool: aiPersonalityOrder, experiment: { neutralizedPersonalities: ['rational', 'stubborn'] } },
  { name: 'arrogant_stubborn_off', pool: aiPersonalityOrder, experiment: { neutralizedPersonalities: ['arrogant', 'stubborn'] } },
  { name: 'gambler_noise05', pool: aiPersonalityOrder, experiment: { gamblerQuoteNoiseRatio: 0.05 } },
  { name: 'gambler_noise10', pool: aiPersonalityOrder, experiment: { gamblerQuoteNoiseRatio: 0.10 } },
  { name: 'character_budget', pool: aiPersonalityOrder, experiment: { doubleActionBudgetBasis: 'character' } },
] satisfies Array<{ name: string; pool: readonly AiPersonality[]; experiment: SimulationResearchOptions }>;

export type TwentyPersonalityStudyCase = typeof twentyPersonalityStudyCases[number]['name'];

export function mergeResearchMetrics(metrics: readonly MetricSummary[]): MetricSummary {
  const count = metrics.reduce((sum, metric) => sum + metric.count, 0);
  if (count === 0) return { count: 0, mean: 0, standardDeviation: 0, minimum: 0, maximum: 0 };
  const mean = metrics.reduce((sum, metric) => sum + metric.count * metric.mean, 0) / count;
  const variance = metrics.reduce((sum, metric) => sum + metric.count * (
    metric.standardDeviation ** 2 + (metric.mean - mean) ** 2
  ), 0) / count;
  const populated = metrics.filter((metric) => metric.count > 0);
  return {
    count, mean, standardDeviation: Math.sqrt(variance),
    minimum: Math.min(...populated.map((metric) => metric.minimum)),
    maximum: Math.max(...populated.map((metric) => metric.maximum)),
  };
}

function weightedMean(values: readonly { value: number; count: number }[]): number {
  const count = values.reduce((sum, value) => sum + value.count, 0);
  return count === 0 ? 0 : values.reduce((sum, value) => sum + value.value * value.count, 0) / count;
}

function compactSeedReport(seed: number, report: SimulationReport) {
  const research = report.research!;
  return {
    seed,
    games: report.games,
    worldFingerprint: research.worldFingerprint,
    personalityFingerprint: research.personalityFingerprint,
    score: report.finalScore,
    winnerScore: report.winnerScore,
    finalMoney: report.endFloorMoneyByFloor['3']!,
    items: report.finalItemCount,
    awardsPerGame: report.averageAwardsPerGame,
    premiumNoMoneyRate: report.quoteAnalysis.premiumRoomNoMoneyRate,
    strategyRates: report.strategyRates,
    scoringTotals: report.scoringTotals,
    rooms: report.roomKindAnalysis,
    doubles: report.doubleActionAnalysis,
    characters: report.characterPerformance,
    doctrines: report.doctrinePerformance,
    cohorts: research.cohorts,
    personalityPrevalence: Object.fromEntries(aiPersonalityOrder.map((personality) => [
      personality, report.personalitySpecialty[personality].prevalence,
    ])),
    hearts: {
      holderRate: report.itemBalance.moms_heart.holderRate,
      championPossessionRate: report.itemBalance.moms_heart.winnerPossessionRate,
      scoreByCopies: report.itemBalance.moms_heart.finalScoreByCopies,
    },
  };
}

type SeedReport = ReturnType<typeof compactSeedReport>;

function poolCohorts(cohorts: readonly ResearchCohortSummary[]) {
  const players = cohorts.reduce((sum, cohort) => sum + cohort.players, 0);
  const counters = {
    quoteAttempts: 0, quoteClamps: 0, cooperationAttempts: 0, cooperationHits: 0,
    disruptedHighPriceSlots: 0, disruptedHighPriceVacancies: 0,
  };
  for (const cohort of cohorts) {
    for (const key of Object.keys(counters) as (keyof typeof counters)[]) counters[key] += cohort[key];
  }
  return {
    players,
    score: mergeResearchMetrics(cohorts.map((cohort) => cohort.score)),
    money: mergeResearchMetrics(cohorts.map((cohort) => cohort.money)),
    items: mergeResearchMetrics(cohorts.map((cohort) => cohort.items)),
    winnerRate: weightedMean(cohorts.map((cohort) => ({ value: cohort.winnerRate, count: cohort.players }))),
    awardsPerPlayerGame: weightedMean(cohorts.map((cohort) => ({ value: cohort.awardsPerPlayerGame, count: cohort.players }))),
    strategyRates: Object.fromEntries(Object.keys(cohorts[0]!.strategyRates).map((strategy) => [strategy,
      weightedMean(cohorts.map((cohort) => ({
        value: cohort.strategyRates[strategy as keyof typeof cohort.strategyRates], count: cohort.players,
      }))),
    ])),
    ...counters,
    quoteClampRate: counters.quoteAttempts === 0 ? 0 : counters.quoteClamps / counters.quoteAttempts,
    cooperationHitRate: counters.cooperationAttempts === 0 ? 0 : counters.cooperationHits / counters.cooperationAttempts,
    // Quantiles deliberately remain per seed; averaging quantiles is not a pooled quantile.
  };
}

function poolCase(seeds: readonly SeedReport[]) {
  const games = seeds.reduce((sum, report) => sum + report.games, 0);
  const total = (field: keyof SeedReport['scoringTotals']) => seeds.reduce((sum, report) => sum + report.scoringTotals[field], 0);
  return {
    games,
    score: mergeResearchMetrics(seeds.map((report) => report.score)),
    winnerScore: mergeResearchMetrics(seeds.map((report) => report.winnerScore)),
    finalMoney: mergeResearchMetrics(seeds.map((report) => report.finalMoney)),
    items: mergeResearchMetrics(seeds.map((report) => report.items)),
    awardsPerGame: weightedMean(seeds.map((report) => ({ value: report.awardsPerGame, count: report.games }))),
    premiumNoMoneyRate: weightedMean(seeds.map((report) => ({ value: report.premiumNoMoneyRate, count: report.games }))),
    strategyRates: Object.fromEntries(Object.keys(seeds[0]!.strategyRates).map((strategy) => [strategy,
      weightedMean(seeds.map((report) => ({ value: report.strategyRates[strategy as keyof typeof report.strategyRates], count: report.games }))),
    ])),
    efficiency: {
      initial: total('actualCosts') === 0 ? 0 : total('initialRoomScore') / total('actualCosts'),
      final: total('actualCosts') === 0 ? 0 : total('finalRoomScore') / total('actualCosts'),
    },
    rooms: Object.fromEntries(Object.keys(seeds[0]!.rooms).map((kind) => {
      const reports = seeds.map((report) => report.rooms[kind as keyof typeof report.rooms]);
      return [kind, {
        participationRate: weightedMean(reports.map((report) => ({ value: report.participationRate, count: report.decisions }))),
        initialScore: mergeResearchMetrics(reports.map((report) => report.initialRoomScore)),
        retroactiveScore: mergeResearchMetrics(reports.map((report) => report.retroactiveRoomScore)),
        finalScore: mergeResearchMetrics(reports.map((report) => report.finalRoomScore)),
      }];
    })),
    doubles: {
      considered: seeds.reduce((sum, report) => sum + report.doubles.considered, 0),
      feasible: seeds.reduce((sum, report) => sum + report.doubles.feasible, 0),
      selected: seeds.reduce((sum, report) => sum + report.doubles.selected, 0),
      finalScore: mergeResearchMetrics(seeds.map((report) => report.doubles.finalRoomScore)),
      cost: mergeResearchMetrics(seeds.map((report) => report.doubles.actualTotalCost)),
      awards: mergeResearchMetrics(seeds.map((report) => report.doubles.awardsPerTurn)),
    },
    cohorts: Object.fromEntries(Object.keys(seeds[0]!.cohorts).map((name) => [
      name, poolCohorts(seeds.map((report) => report.cohorts[name]!)),
    ])),
    characters: Object.fromEntries(Object.keys(seeds[0]!.characters).map((name) => {
      const reports = seeds.map((report) => report.characters[name as keyof typeof report.characters]);
      return [name, {
        players: reports.reduce((sum, report) => sum + report.playerGames, 0),
        score: mergeResearchMetrics(reports.map((report) => report.finalScore)),
        money: mergeResearchMetrics(reports.map((report) => report.finalMoney)),
        items: mergeResearchMetrics(reports.map((report) => report.finalItemCount)),
        winnerRate: weightedMean(reports.map((report) => ({ value: report.winnerRate, count: report.playerGames }))),
      }];
    })),
    heartChampionPossessionRate: weightedMean(seeds.map((report) => ({ value: report.hearts.championPossessionRate, count: report.games }))),
    personalityPrevalence: Object.fromEntries(aiPersonalityOrder.map((personality) => [personality,
      weightedMean(seeds.map((report) => ({ value: report.personalityPrevalence[personality]!, count: report.games }))),
    ])),
  };
}

export function runTwentyPersonalityStudy(options: {
  gamesPerSeed: number;
  seeds: readonly number[];
  cases?: readonly string[];
  onProgress?: (name: string, seed: number) => void;
}) {
  if (!Number.isInteger(options.gamesPerSeed) || options.gamesPerSeed <= 0) throw new RangeError('Games per seed must be positive.');
  if (options.seeds.length === 0 || options.seeds.some((seed) => !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)) {
    throw new RangeError('Study requires valid unsigned integer seeds.');
  }
  if (new Set(options.seeds).size !== options.seeds.length) throw new RangeError('Study seeds must be distinct.');
  const cases = twentyPersonalityStudyCases.filter((variant) => !options.cases || options.cases.includes(variant.name));
  if (cases.length === 0 || options.cases?.some((name) => !cases.some((variant) => variant.name === name))) {
    throw new RangeError('Unknown research case.');
  }
  const results = Object.fromEntries(cases.map((variant) => {
    if (variant.pool.includes('all_in')) throw new RangeError('All-in is excluded from this study.');
    const seeds = options.seeds.map((seed) => {
      const report = simulateAiGames(options.gamesPerSeed, seed, { ...defaultRules, playerCount: 19 }, {
        doctrinePopulation: { balanced: 9, cooperative: 5, chaotic: 5 },
        enablePersonalities: true, personalityCountMinimum: 2, personalityCountMaximum: 4,
        enableSituationAnalysis: true, enableItemAnalysis: true, enableDoubleActions: true,
        personalityPool: variant.pool,
        research: { ...variant.experiment, randomization: 'per-player-room' },
      });
      options.onProgress?.(variant.name, seed);
      return compactSeedReport(seed, report);
    });
    return [variant.name, { seeds, pooled: poolCase(seeds) }];
  }));
  const reference = results.formal20 ?? Object.values(results)[0]!;
  for (const [name, result] of Object.entries(results)) {
    for (let index = 0; index < result.seeds.length; index += 1) {
      if (result.seeds[index]!.worldFingerprint !== reference.seeds[index]!.worldFingerprint) {
        throw new Error(`Exogenous world drift in ${name}.`);
      }
      if (name !== 'original15' && reference === results.formal20 &&
        result.seeds[index]!.personalityFingerprint !== reference.seeds[index]!.personalityFingerprint) {
        throw new Error(`Assigned personality drift in ${name}.`);
      }
    }
  }
  return {
    gamesPerSeed: options.gamesPerSeed, seeds: options.seeds,
    randomization: 'per-player-room', excluded: ['all_in'], cases: results,
  };
}
