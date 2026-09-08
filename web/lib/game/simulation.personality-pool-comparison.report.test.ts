import { describe, expect, it } from 'vitest';

import { defaultRules } from './config';
import {
  aiPersonalityOrder,
  implementedAiPersonalityOrder,
  initialAiPersonalityOrder,
  type AiPersonality,
} from './ai-personality';
import { simulateAiGames, type SimulationReport } from './simulation';

const requestedGames = Number(process.env.SIM_PERSONALITY_POOL_GAMES ?? 0);
const seed = Number(process.env.SIM_PERSONALITY_POOL_SEED ?? 20260908);

const twentyPersonalityPool = aiPersonalityOrder;

const trackedPersonalities: readonly AiPersonality[] = [
  'adaptive',
  'rational',
  'arrogant',
  'stubborn',
  'gambler',
  'all_in',
];

function compactPerformance(report: SimulationReport, personality: AiPersonality) {
  const performance = report.personalityPerformance[personality];
  const specialty = report.personalitySpecialty[personality];
  return {
    players: performance.playerGames,
    scoreMean: performance.finalScore.mean,
    scoreSd: performance.finalScore.standardDeviation,
    moneyMean: performance.finalMoney.mean,
    itemMean: performance.finalItemCount.mean,
    winnerRate: performance.winnerRate,
    scoreDelta: specialty.scoreDeltaVsAllPlayers,
    strategies: performance.strategyRates,
  };
}

function compactReport(report: SimulationReport, pool: readonly AiPersonality[]) {
  const quote = report.quoteAnalysis;
  return {
    poolSize: pool.length,
    finalScore: report.finalScore,
    scoreCv: report.finalScore.mean === 0
      ? 0
      : report.finalScore.standardDeviation / report.finalScore.mean,
    winnerScore: report.winnerScore,
    finalItems: report.finalItemCount,
    finalMoney: report.endFloorMoneyByFloor['3'],
    strategies: report.strategyRates,
    belowHalfMoneyRate: report.belowHalfStartingMoneyRate,
    premiumRoomNoMoneyRate: quote.premiumRoomNoMoneyRate,
    scorePerActualMoney: quote.scorePerActualMoney,
    averageAwardsPerGame: report.averageAwardsPerGame,
    qualificationCounts: {
      total: quote.totalQualificationSlots,
      highPrice: quote.highPriceQualificationSlots,
      cooperation: quote.cooperationQualificationSlots,
      disruptedHighPrice: quote.disruptedHighPriceQualificationSlots,
      disruptedCooperation: quote.disruptedCooperationQualificationSlots,
      transcendence: quote.transcendenceRedemptions,
    },
    roomKinds: Object.fromEntries(Object.entries(report.roomKindAnalysis).map(([kind, value]) => [
      kind,
      {
        participationRate: value.participationRate,
        scoreMean: value.roomScore.mean,
        actualCostRatio: value.averageActualCostRatioPerDecision,
      },
    ])),
    doctrines: Object.fromEntries(Object.entries(report.doctrinePerformance).map(([doctrine, value]) => [
      doctrine,
      {
        scoreMean: value.finalScore.mean,
        scoreSd: value.finalScore.standardDeviation,
        moneyMean: value.finalMoney.mean,
        itemMean: value.finalItemCount.mean,
        winnerRate: value.winnerRate,
      },
    ])),
    deciles: report.rankingAnalysis.allPlayerDeciles.map((band) => ({
      band: band.band,
      scoreMean: band.scoreMean,
      scoreMedian: band.scoreMedian,
      itemMean: band.itemCountMean,
    })),
    trackedPersonalities: Object.fromEntries(
      trackedPersonalities
        .filter((personality) => pool.includes(personality))
        .map((personality) => [personality, compactPerformance(report, personality)]),
    ),
  };
}

describe.skipIf(requestedGames <= 0)('fifteen, twenty, and twenty-one personality pools', () => {
  it(
    `compares three personality pools across ${requestedGames} games each`,
    () => {
      const rules = { ...defaultRules, playerCount: 19 };
      const common = {
        doctrinePopulation: { balanced: 9, cooperative: 5, chaotic: 5 },
        enableSituationAnalysis: true,
        enableItemAnalysis: true,
        enablePersonalities: true,
        personalityCountMinimum: 2,
        personalityCountMaximum: 4,
        enableDoubleActions: true,
      } as const;
      const reports = [
        ['original15', initialAiPersonalityOrder],
        ['expanded20', twentyPersonalityPool],
        ['complete21', implementedAiPersonalityOrder],
      ] as const;

      const result = Object.fromEntries(reports.map(([name, pool]) => {
        const report = simulateAiGames(requestedGames, seed, rules, {
          ...common,
          personalityPool: pool,
        });
        return [name, compactReport(report, pool)];
      }));

      console.log(`PERSONALITY_POOL_COMPARISON=${JSON.stringify(result)}`);
      expect(twentyPersonalityPool).toHaveLength(20);
      expect(Object.keys(result)).toEqual(['original15', 'expanded20', 'complete21']);
    },
    240_000,
  );
});
