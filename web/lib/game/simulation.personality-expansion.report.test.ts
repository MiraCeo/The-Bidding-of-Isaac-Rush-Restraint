import { describe, expect, it } from 'vitest';

import { defaultRules } from './config';
import {
  implementedAiPersonalityOrder,
  initialAiPersonalityOrder,
  type AiPersonality,
} from './ai-personality';
import { simulateAiGames, type SimulationReport } from './simulation';

const requestedGames = Number(process.env.SIM_PERSONALITY_EXPANSION_GAMES ?? 0);
const seed = Number(process.env.SIM_PERSONALITY_EXPANSION_SEED ?? 20260908);
const rankingOnly = process.env.SIM_PERSONALITY_EXPANSION_RANKING_ONLY === '1';
const newPersonalities: readonly AiPersonality[] = [
  'adaptive',
  'rational',
  'arrogant',
  'all_in',
  'stubborn',
  'gambler',
];

function compactBands(report: SimulationReport) {
  return report.rankingAnalysis.allPlayerDeciles.map((band) => ({
    band: band.band,
    scoreMean: band.scoreMean,
    scoreMedian: band.scoreMedian,
    itemCountMean: band.itemCountMean,
    itemCountMedian: band.itemCountMedian,
    doctrineShares: band.doctrineShares,
    topPersonalities: band.topPersonalities.slice(0, 10),
  }));
}

function compactChampionBands(report: SimulationReport) {
  return report.rankingAnalysis.championDeciles.map((band) => ({
    band: band.band,
    scoreMean: band.scoreMean,
    scoreMedian: band.scoreMedian,
    itemCountMean: band.itemCountMean,
    itemCountMedian: band.itemCountMedian,
    doctrineShares: band.doctrineShares,
    topPersonalities: band.topPersonalities.slice(0, 10),
  }));
}

function compactPerformance(report: SimulationReport, personality: AiPersonality) {
  const performance = report.personalityPerformance[personality];
  const specialty = report.personalitySpecialty[personality];
  return {
    players: performance.playerGames,
    score: performance.finalScore,
    money: performance.finalMoney,
    items: performance.finalItemCount,
    winnerRate: performance.winnerRate,
    awardsPerPlayerGame: performance.awardsPerPlayerGame,
    strategyRates: performance.strategyRates,
    scoreDeltaVsAllPlayers: specialty.scoreDeltaVsAllPlayers,
    itemCountDeltaVsAllPlayers: specialty.itemCountDeltaVsAllPlayers,
    cooperationZoneHitRate: specialty.cooperationZoneHitRate,
  };
}

function compactReport(report: SimulationReport, includeExpansionDetails: boolean) {
  return {
    games: report.games,
    personalityPoolSize: includeExpansionDetails
      ? implementedAiPersonalityOrder.length
      : initialAiPersonalityOrder.length,
    personalityCountDistribution: report.personalityCountDistribution,
    finalScore: report.finalScore,
    winnerScore: report.winnerScore,
    finalItemCount: report.finalItemCount,
    finalMoney: report.endFloorMoneyByFloor['3'],
    strategyRates: report.strategyRates,
    belowHalfStartingMoneyRate: report.belowHalfStartingMoneyRate,
    scorePerActualMoney: report.quoteAnalysis.scorePerActualMoney,
    premiumRoomNoMoneyRate: report.quoteAnalysis.premiumRoomNoMoneyRate,
    finalNoiseMultiplier: report.quoteAnalysis.finalNoiseMultiplier,
    clampRate: report.quoteAnalysis.clampRate,
    averageAwardsPerGame: report.averageAwardsPerGame,
    qualificationCounts: {
      total: report.quoteAnalysis.totalQualificationSlots,
      highPrice: report.quoteAnalysis.highPriceQualificationSlots,
      cooperation: report.quoteAnalysis.cooperationQualificationSlots,
      disruptedHighPrice: report.quoteAnalysis.disruptedHighPriceQualificationSlots,
      disruptedCooperation: report.quoteAnalysis.disruptedCooperationQualificationSlots,
      transcendence: report.quoteAnalysis.transcendenceRedemptions,
      highPriceTranscendence: report.quoteAnalysis.highPriceTranscendenceRedemptions,
      cooperationTranscendence: report.quoteAnalysis.cooperationTranscendenceRedemptions,
    },
    roomKindAnalysis: report.roomKindAnalysis,
    doctrinePerformance: report.doctrinePerformance,
    characterPerformance: report.characterPerformance,
    doubleActionAnalysis: report.doubleActionAnalysis,
    allPlayerDeciles: compactBands(report),
    championDeciles: includeExpansionDetails ? compactChampionBands(report) : undefined,
    championTop10: includeExpansionDetails ? report.rankingAnalysis.championTop10 : undefined,
    championTopDecile: includeExpansionDetails ? report.rankingAnalysis.championDeciles[0] : undefined,
    winnerDoctrineShares: report.winnerDoctrineShares,
    winnerPersonalityShares: report.winnerPersonalityShares.slice(0, 10),
    newPersonalityPerformance: includeExpansionDetails
      ? Object.fromEntries(newPersonalities.map((personality) => [
          personality,
          compactPerformance(report, personality),
        ]))
      : undefined,
  };
}

describe.skipIf(requestedGames <= 0)('personality expansion comparison report', () => {
  it(
    `compares ${requestedGames} games with twenty-one and fifteen personalities`,
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
      const expanded = simulateAiGames(requestedGames, seed, rules, {
        ...common,
        personalityPool: implementedAiPersonalityOrder,
      });
      const control = simulateAiGames(requestedGames, seed, rules, {
        ...common,
        personalityPool: initialAiPersonalityOrder,
      });

      if (rankingOnly) {
        console.log(`PERSONALITY_EXPANSION_RANKING=${JSON.stringify({
          qualificationCounts: compactReport(expanded, true).qualificationCounts,
          championDeciles: compactChampionBands(expanded),
          allPlayerDeciles: compactBands(expanded),
        })}`);
      } else {
        console.log(`PERSONALITY_EXPANSION_CURRENT=${JSON.stringify(compactReport(expanded, true))}`);
        console.log(`PERSONALITY_EXPANSION_CONTROL=${JSON.stringify(compactReport(control, false))}`);
      }
      expect(expanded.games).toBe(requestedGames);
      expect(control.games).toBe(requestedGames);
    },
    180_000,
  );
});
