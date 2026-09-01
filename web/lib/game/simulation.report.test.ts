import { describe, expect, it } from 'vitest';

import { simulateAiGames } from './simulation';
import type { AiDoctrine } from './ai-decision';
import { defaultRules } from './config';

const requestedGames = Number(process.env.SIM_GAMES ?? 0);

function requestedPopulation(): Partial<Record<AiDoctrine, number>> | undefined {
  const raw = process.env.SIM_DISTRIBUTION;
  if (!raw) return undefined;
  const [balanced, cooperative, chaotic] = raw.split(',').map(Number);
  return { balanced, cooperative, chaotic };
}

describe.skipIf(requestedGames <= 0)('simulation report runner', () => {
  it(
    `prints a ${requestedGames}-game aggregate report`,
    () => {
      const report = simulateAiGames(
        requestedGames,
        Number(process.env.SIM_SEED ?? 20260831),
        {
          ...defaultRules,
          playerCount: Number(process.env.SIM_AI_COUNT ?? defaultRules.playerCount),
        },
        {
          enableSituationAnalysis: process.env.SIM_SITUATION !== '0',
          enableItemAnalysis: process.env.SIM_ITEMS !== '0',
          doctrine: (process.env.SIM_DOCTRINE as AiDoctrine | undefined) ?? 'balanced',
          doctrinePopulation: requestedPopulation(),
          enablePersonalities: process.env.SIM_PERSONALITIES === '1',
          personalityCountMinimum: Number(process.env.SIM_PERSONALITY_MIN ?? 1),
          personalityCountMaximum: Number(process.env.SIM_PERSONALITY_MAX ?? 3),
          enableDoubleActions: process.env.SIM_DOUBLE_ACTIONS !== '0',
        },
      );
      const { itemBalance, ...coreReport } = report;
      console.log(`SIMULATION_REPORT=${JSON.stringify(coreReport)}`);
      console.log(`QUALIFICATION_SUMMARY=${JSON.stringify({
        ...report.quoteAnalysis,
      })}`);
      console.log(`SCORE_BAND_SUMMARY=${JSON.stringify({
        winnerScore: report.winnerScore,
        scoreBands: report.scoreBands,
        winnerDoctrineShares: report.winnerDoctrineShares,
        winnerPersonalityShares: report.winnerPersonalityShares.slice(0, 10),
      })}`);
      console.log(`BASE_RANKING_TEMPLATE=${JSON.stringify(report.rankingAnalysis)}`);
      console.log(`PERSONALITY_SPECIALTY=${JSON.stringify(report.personalitySpecialty)}`);
      console.log(`CHARACTER_SUMMARY=${JSON.stringify({
        population: report.characterPopulation,
        performance: report.characterPerformance,
      })}`);
      console.log(`DOUBLE_ACTION_SUMMARY=${JSON.stringify(report.doubleActionAnalysis)}`);
      console.log(`PERSONALITY_SUMMARY=${JSON.stringify(Object.fromEntries(
        Object.entries(report.personalityPerformance).map(([id, personality]) => [id, {
          players: personality.playerGames,
          score: personality.finalScore.mean,
          money: personality.finalMoney.mean,
          items: personality.finalItemCount.mean,
          winRate: personality.winnerRate,
          cooperationHitRate: personality.cooperationZoneHitRate,
          preferredTargetRate: personality.preferredTargetSelectionRate,
          repeatStrategyRate: personality.repeatStrategyRate,
          strategies: personality.strategyRates,
        }]),
      ))}`);
      console.log(`ITEM_BALANCE_SUMMARY=${JSON.stringify(Object.fromEntries(
        Object.entries(itemBalance).map(([id, item]) => [id, {
          name: item.name,
          pool: item.pool,
          rarity: item.rarity,
          appearances: item.appearances,
          copies: item.copiesAwarded,
          holderRate: item.holderRate,
          score: item.holderFinalScore.mean,
          money: item.holderFinalMoney.mean,
          scoreDelta: item.meanWithinGameScoreDeltaVsNonholders,
          moneyDelta: item.meanWithinGameMoneyDeltaVsNonholders,
          holderWinRate: item.holderWinRate,
          winnerPossessionRate: item.winnerPossessionRate,
          directMoney: item.directMoneyAmount,
          directScore: item.directScoreAmount,
          events: item.directEventCounts,
          triggers: item.scoringTriggerCounts,
          triggerAmount: item.scoringTriggerAmount,
          score1: item.finalScoreByCopies['1'].mean,
          score2: item.finalScoreByCopies['2'].mean,
          score3Plus: item.finalScoreByCopies['3+'].mean,
        }]),
      ))}`);
      console.log(`ITEM_EVENT_SUMMARY=${JSON.stringify(Object.fromEntries(
        Object.entries(itemBalance).map(([id, item]) => [id, {
          events: item.directEventCounts,
          money: item.directMoneyAmount,
          score: item.directScoreAmount,
          triggers: item.scoringTriggerCounts,
        }]),
      ))}`);
      expect(report.games).toBe(requestedGames);
    },
    120_000,
  );
});
