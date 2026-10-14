import { validateSurvivalRules, type SurvivalRules } from './survival-rules';

export interface SurvivalFloorScoreInput {
  /** Authoritative final room scores, including any heart retroactivity. */
  finalRoomScores: readonly number[];
  remainingMoney: number;
  /** Pass zero on the first floor; never pass the all-game cumulative score. */
  previousSurvivalScore: number;
}

export interface SurvivalFloorScore {
  roomScore: number;
  remainingMoney: number;
  exchangedScore: number;
  previousSurvivalScore: number;
  inheritedScore: number;
  /** This floor's contribution to final cumulative score, excluding inherited points. */
  newScore: number;
  survivalScore: number;
}

function score(value: number, decimals: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('Survival scores must be finite and non-negative.');
  }
  const factor = 10 ** decimals;
  const scaled = Math.round((value + Number.EPSILON) * factor);
  if (!Number.isSafeInteger(scaled)) {
    throw new RangeError('Survival score exceeds the safely representable storage precision.');
  }
  return scaled / factor;
}

export function validateSurvivalStoredScore(value: number, decimals: number): void {
  if (score(value, decimals) !== value) {
    throw new RangeError('Input score must already use the declared storage precision.');
  }
}

/** No items, RNG, money deductions or writes: consume already-settled room facts once. */
export function calculateSurvivalFloorScore(
  input: SurvivalFloorScoreInput,
  rules: Readonly<SurvivalRules>,
): SurvivalFloorScore {
  validateSurvivalRules(rules);
  if (input.finalRoomScores.length !== rules.roomsPerFloor) {
    throw new RangeError('Survival floor scoring requires all completed rooms in the floor.');
  }
  if (!Number.isSafeInteger(input.remainingMoney) || input.remainingMoney < 0) {
    throw new RangeError('Remaining money must be a non-negative safe integer.');
  }
  const decimals = rules.scoreStorageDecimals;
  let total = 0;
  for (const value of input.finalRoomScores) {
    validateSurvivalStoredScore(value, decimals);
    total += value;
  }
  const roomScore = score(total, decimals);
  validateSurvivalStoredScore(input.previousSurvivalScore, decimals);
  const exchangedScore = score(input.remainingMoney * rules.moneyExchangeRatio, decimals);
  const inheritedScore = score(input.previousSurvivalScore * rules.scoreInheritanceRatio, decimals);
  const newScore = score(roomScore + exchangedScore, decimals);
  return {
    roomScore,
    remainingMoney: input.remainingMoney,
    exchangedScore,
    previousSurvivalScore: input.previousSurvivalScore,
    inheritedScore,
    newScore,
    survivalScore: score(newScore + inheritedScore, decimals),
  };
}

export interface SurvivalParticipantScore {
  playerId: string;
  survivalScore: number;
}

export interface SurvivalElimination {
  playerId: string;
  reason: 'below_cut_line' | 'lowest_score';
}

export type SurvivalEliminationPlan =
  | {
      status: 'resolved';
      eliminations: SurvivalElimination[];
      survivorIds: string[];
      shouldFinish: boolean;
    }
  | {
      status: 'requires_tie_break';
      /** Facts guaranteed regardless of how the cutoff tie is resolved. Do not apply yet. */
      certainEliminations: SurvivalElimination[];
      tiedPlayerIds: string[];
      tieEliminationCount: number;
    }
  | {
      status: 'requires_all_below_policy';
      belowCutLineIds: string[];
    };

/**
 * Plan only for current survivors. Cut line is required, with no invented default.
 * Pending results never fabricate survivors/champions or consume a tie-break random draw.
 */
export function planSurvivalEliminations(
  participants: readonly SurvivalParticipantScore[],
  cutLine: number,
  rules: Readonly<SurvivalRules>,
): SurvivalEliminationPlan {
  validateSurvivalRules(rules);
  const decimals = rules.scoreStorageDecimals;
  validateSurvivalStoredScore(cutLine, decimals);
  if (participants.length === 0 || participants.length > rules.initialPlayerCount) {
    throw new RangeError('Elimination planning requires a non-empty current survivor roster.');
  }
  const ids = new Set<string>();
  for (const participant of participants) {
    if (!participant.playerId.trim() || ids.has(participant.playerId)) {
      throw new RangeError('Survivor identities must be non-empty and unique.');
    }
    ids.add(participant.playerId);
    validateSurvivalStoredScore(participant.survivalScore, decimals);
  }

  // Already-finished states must not run another elimination floor (including a lone survivor).
  if (participants.length <= rules.finalSurvivorCount) {
    return {
      status: 'resolved',
      eliminations: [],
      survivorIds: participants.map((participant) => participant.playerId),
      shouldFinish: true,
    };
  }

  const below = participants.filter((participant) => participant.survivalScore < cutLine);
  if (below.length === participants.length) {
    return {
      status: 'requires_all_below_policy',
      belowCutLineIds: below.map((participant) => participant.playerId),
    };
  }
  const eliminations: SurvivalElimination[] = below.map((participant) => ({
    playerId: participant.playerId,
    reason: 'below_cut_line',
  }));
  const additionalCount = Math.max(0, rules.minimumEliminations - below.length);
  if (additionalCount > 0) {
    const eligible = participants
      .filter((participant) => participant.survivalScore >= cutLine)
      .sort((left, right) => left.survivalScore - right.survivalScore);
    const cutoffScore = eligible[additionalCount - 1]!.survivalScore;
    const strictlyLower = eligible.filter((participant) => participant.survivalScore < cutoffScore);
    eliminations.push(...strictlyLower.map((participant): SurvivalElimination => ({
      playerId: participant.playerId,
      reason: 'lowest_score',
    })));
    const tied = eligible.filter((participant) => participant.survivalScore === cutoffScore);
    const tieEliminationCount = additionalCount - strictlyLower.length;
    if (tied.length > tieEliminationCount) {
      return {
        status: 'requires_tie_break',
        certainEliminations: eliminations,
        tiedPlayerIds: tied.map((participant) => participant.playerId),
        tieEliminationCount,
      };
    }
    eliminations.push(...tied.map((participant): SurvivalElimination => ({
      playerId: participant.playerId,
      reason: 'lowest_score',
    })));
  }

  const eliminatedIds = new Set(eliminations.map((elimination) => elimination.playerId));
  const survivorIds = participants
    .filter((participant) => !eliminatedIds.has(participant.playerId))
    .map((participant) => participant.playerId);
  return {
    status: 'resolved',
    eliminations,
    survivorIds,
    shouldFinish: survivorIds.length <= rules.finalSurvivorCount,
  };
}
