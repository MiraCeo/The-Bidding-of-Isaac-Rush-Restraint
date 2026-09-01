import { describe, expect, it } from 'vitest';

import { defaultRules } from './config';
import { simulateAiGames, type SimulationReport } from './simulation';

const requestedGames = Number(process.env.SIM_ROOM_MULTIPLIER_GAMES ?? 0);
const seed = Number(process.env.SIM_ROOM_MULTIPLIER_SEED ?? 20260831);

function compactReport(report: SimulationReport) {
  const compactBands = report.rankingAnalysis.allPlayerDeciles.map((band) => ({
    band: band.band,
    scoreMean: band.scoreMean,
    scoreMedian: band.scoreMedian,
    itemCountMean: band.itemCountMean,
    itemCountMedian: band.itemCountMedian,
    doctrineShares: band.doctrineShares,
    characterShares: band.characterShares,
  }));
  return {
    games: report.games,
    decisions: report.decisions,
    finalScore: report.finalScore,
    winnerScore: report.winnerScore,
    finalItemCount: report.finalItemCount,
    averageAwardsPerGame: report.averageAwardsPerGame,
    strategyRates: report.strategyRates,
    roomKindAnalysis: report.roomKindAnalysis,
    scorePerActualMoney: report.quoteAnalysis.scorePerActualMoney,
    premiumRoomNoMoneyRate: report.quoteAnalysis.premiumRoomNoMoneyRate,
    endFloorMoneyByFloor: report.endFloorMoneyByFloor,
    scoreBands: report.scoreBands,
    doctrinePerformance: report.doctrinePerformance,
    characterPerformance: report.characterPerformance,
    doubleActionAnalysis: {
      considered: report.doubleActionAnalysis.considered,
      feasible: report.doubleActionAnalysis.feasible,
      selected: report.doubleActionAnalysis.selected,
      selectionRate: report.doubleActionAnalysis.selectionRate,
      feasibleSelectionRate: report.doubleActionAnalysis.feasibleSelectionRate,
      actualRoomScore: report.doubleActionAnalysis.actualRoomScore,
      actualTotalCost: report.doubleActionAnalysis.actualTotalCost,
    },
    championTop10: report.rankingAnalysis.championTop10.map((player) => ({
      game: player.game,
      finalScore: player.finalScore,
      doctrine: player.doctrine,
      character: player.character,
      personalities: player.personalities,
      itemCount: player.itemCount,
    })),
    championTopDecile: report.rankingAnalysis.championDeciles[0],
    allPlayerDeciles: compactBands,
    winnerDoctrineShares: report.winnerDoctrineShares,
    winnerPersonalityShares: report.winnerPersonalityShares.slice(0, 10),
  };
}

describe.skipIf(requestedGames <= 0)('room multiplier comparison report', () => {
  it(
    `compares ${requestedGames} current games with an all-x1 control`,
    () => {
      const options = {
        doctrinePopulation: { balanced: 9, cooperative: 5, chaotic: 5 },
        enableSituationAnalysis: true,
        enableItemAnalysis: true,
        enablePersonalities: true,
        personalityCountMinimum: 2,
        personalityCountMaximum: 4,
        enableDoubleActions: true,
      } as const;
      const current = simulateAiGames(requestedGames, seed, { ...defaultRules, playerCount: 19 }, options);
      const control = simulateAiGames(
        requestedGames,
        seed,
        {
          ...defaultRules,
          playerCount: 19,
          roomScoreMultipliers: {
            normal: 1,
            treasure: 1,
            shop: 1,
            hidden: 1,
            boss: 1,
          },
        },
        options,
      );

      console.log(`ROOM_MULTIPLIER_CURRENT=${JSON.stringify(compactReport(current))}`);
      console.log(`ROOM_MULTIPLIER_CONTROL=${JSON.stringify(compactReport(control))}`);
      expect(current.games).toBe(requestedGames);
      expect(control.games).toBe(requestedGames);
    },
    180_000,
  );
});
