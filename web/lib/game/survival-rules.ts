/** Survival preset, separate from classic. Cut lines remain explicit internal test inputs. */
export interface SurvivalRules {
  initialPlayerCount: number;
  roomsPerFloor: number;
  floorStartingMoney: number;
  minimumEliminations: number;
  finalSurvivorCount: number;
  moneyExchangeRatio: number;
  scoreInheritanceRatio: number;
  scoreStorageDecimals: number;
}

/** Confirmed preset; 10%/20% are the agreed trial values pending balance simulations. */
export const survivalPrototypeRules: Readonly<SurvivalRules> = Object.freeze({
  initialPlayerCount: 20,
  roomsPerFloor: 5,
  floorStartingMoney: 1000,
  minimumEliminations: 2,
  finalSurvivorCount: 6,
  moneyExchangeRatio: 0.1,
  scoreInheritanceRatio: 0.2,
  scoreStorageDecimals: 4,
});

/** User-selected v33 schedule, kept separate from experimental inputs and classic configuration. */
export const survivalOfficialCutLines = Object.freeze([
  200, 325, 500, 750, 1050, 1500, 2500,
]);

export function validateSurvivalRules(rules: Readonly<SurvivalRules>): void {
  for (const value of [
    rules.initialPlayerCount,
    rules.roomsPerFloor,
    rules.floorStartingMoney,
    rules.minimumEliminations,
    rules.finalSurvivorCount,
  ]) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(
        'Survival counts and starting money must be positive safe integers.',
      );
    }
  }
  if (
    rules.finalSurvivorCount > rules.initialPlayerCount ||
    rules.minimumEliminations > rules.initialPlayerCount
  ) {
    throw new RangeError(
      'Survival thresholds cannot exceed the initial player count.',
    );
  }
  if (rules.minimumEliminations > rules.finalSurvivorCount) {
    throw new RangeError(
      'Minimum-only eliminations must leave a survivor in the smallest ongoing roster.',
    );
  }
  for (const ratio of [rules.moneyExchangeRatio, rules.scoreInheritanceRatio]) {
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
      throw new RangeError(
        'Survival score ratios must be between zero and one.',
      );
    }
  }
  if (rules.scoreInheritanceRatio === 1) {
    throw new RangeError('Survival score inheritance must decay.');
  }
  if (
    !Number.isInteger(rules.scoreStorageDecimals) ||
    rules.scoreStorageDecimals < 0 ||
    rules.scoreStorageDecimals > 8
  ) {
    throw new RangeError(
      'Survival score precision must be between zero and eight decimals.',
    );
  }
}

/** A derived bound, not an additional forced-finish rule. */
export function maximumSurvivalFloors(rules: Readonly<SurvivalRules>): number {
  validateSurvivalRules(rules);
  return Math.ceil(
    (rules.initialPlayerCount - rules.finalSurvivorCount) /
      rules.minimumEliminations,
  );
}
