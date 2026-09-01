import type { RulesConfig } from './types';

export const defaultRules: RulesConfig = {
  playerCount: 20,
  roomsPerFloor: [5, 5, 5],
  floorStartingMoney: [100, 500, 1000],
  disruptionMaxMoneyRatio: 0.5,
  disruptionMarketMultiplier: 2.5,
  disruptionScoringMultiplier: 1.25,
  highPriceWinnerRatio: 0.2,
  baselineMeanMultiplier: 2 / 3,
  targetConstantRatio: 0.1,
  maximumBaseScore: 100,
  scoreSigmaRatio: 0.1,
  cooperationZoneRatio: 0.1,
  scoreStorageDecimals: 4,
  scoreDisplayDecimals: 2,
  roomScoreMultipliers: {
    normal: 1,
    treasure: 1.5,
    shop: 1,
    hidden: 2,
    boss: 2,
  },
};
