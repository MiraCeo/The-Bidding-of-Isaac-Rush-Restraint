import type { PlayerState, RulesConfig } from './types';

/** Reset every player's funds when entering a floor; score and identity persist. */
export function resetFundsForFloor(
  players: readonly PlayerState[],
  floorIndex: number,
  rules: RulesConfig,
): PlayerState[] {
  const startingMoney = rules.floorStartingMoney[floorIndex];
  if (startingMoney === undefined) {
    throw new RangeError(`Unknown floor index: ${floorIndex}`);
  }
  return players.map((player) => ({ ...player, money: startingMoney }));
}
