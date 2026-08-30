import type { RulesConfig } from './types';

export const defaultRules: RulesConfig = {
  playerCount: 20,
  roomsPerFloor: [5, 5, 5],
  floorStartingMoney: [100, 500, 1000],
  disruptionMaxMoneyRatio: 0.5,
  disruptionMarketMultiplier: 2.5,
  disruptionScoringMultiplier: 1.25,
  cooperationZoneRadius: 10,
};
