import type { RandomSource } from './types';
import {
  planSurvivalEliminations,
  validateSurvivalStoredScore,
  type SurvivalEliminationPlan,
  type SurvivalParticipantScore,
} from './survival-floor';
import type { SurvivalRules } from './survival-rules';

export interface SurvivalTieFact {
  playerId: string;
  value: number;
}
export type ResolvedSurvivalPlan = Extract<
  SurvivalEliminationPlan,
  { status: 'resolved' }
>;
export interface SurvivalEliminationResolution {
  plan: ResolvedSurvivalPlan;
  reason: 'score_order' | 'random_tie' | 'all_below';
  tieBreaks: SurvivalTieFact[];
}

/** Pure interpretation of recorded tie facts. Read-only imports never call an RNG. */
export function resolveSurvivalPlanFacts(
  participants: readonly SurvivalParticipantScore[],
  cutLine: number,
  rules: Readonly<SurvivalRules>,
  tieBreaks: readonly SurvivalTieFact[],
): SurvivalEliminationResolution {
  const planned = planSurvivalEliminations(participants, cutLine, rules);
  if (planned.status === 'resolved') {
    if (tieBreaks.length) throw new Error('Unexpected survival tie facts.');
    return { plan: planned, reason: 'score_order', tieBreaks: [] };
  }
  if (planned.status === 'requires_all_below_policy') {
    if (tieBreaks.length)
      throw new Error('A total elimination does not use a tie break.');
    return {
      plan: {
        status: 'resolved',
        eliminations: planned.belowCutLineIds.map((playerId) => ({
          playerId,
          reason: 'below_cut_line',
        })),
        survivorIds: [],
        shouldFinish: true,
      },
      reason: 'all_below',
      tieBreaks: [],
    };
  }
  if (
    tieBreaks.length !== planned.tiedPlayerIds.length ||
    tieBreaks.some(
      (tie, index) =>
        tie.playerId !== planned.tiedPlayerIds[index] ||
        !Number.isFinite(tie.value) ||
        tie.value < 0 ||
        tie.value >= 1,
    )
  ) {
    throw new Error('Survival tie facts do not match the cutoff group.');
  }
  const selected = [...tieBreaks]
    .sort(
      (left, right) =>
        left.value - right.value || left.playerId.localeCompare(right.playerId),
    )
    .slice(0, planned.tieEliminationCount);
  const eliminations = [
    ...planned.certainEliminations,
    ...selected.map((tie) => ({
      playerId: tie.playerId,
      reason: 'lowest_score' as const,
    })),
  ];
  const excluded = new Set(
    eliminations.map((elimination) => elimination.playerId),
  );
  const survivorIds = participants
    .filter((participant) => !excluded.has(participant.playerId))
    .map((participant) => participant.playerId);
  return {
    plan: {
      status: 'resolved',
      eliminations,
      survivorIds,
      shouldFinish: survivorIds.length <= rules.finalSurvivorCount,
    },
    reason: 'random_tie',
    tieBreaks: tieBreaks.map((tie) => ({ ...tie })),
  };
}

export function settleSurvivalEliminations(
  participants: readonly SurvivalParticipantScore[],
  cutLine: number,
  rules: Readonly<SurvivalRules>,
  random: RandomSource,
): SurvivalEliminationResolution {
  const planned = planSurvivalEliminations(participants, cutLine, rules);
  const ties =
    planned.status === 'requires_tie_break'
      ? planned.tiedPlayerIds.map((playerId) => ({
          playerId,
          value: random.next(),
        }))
      : [];
  return resolveSurvivalPlanFacts(participants, cutLine, rules, ties);
}

export interface SurvivalRankingInput {
  playerId: string;
  eliminationFloorIndex: number | null;
  finalScore: number;
  tieBreaker: number;
}
export interface SurvivalRankingEntry extends SurvivalRankingInput {
  rank: number;
  status: 'survived' | 'eliminated';
  isChampion: boolean;
}

/** Survivors are a higher group, not a fabricated elimination-floor number. */
export function rankSurvivalFacts(
  entries: readonly SurvivalRankingInput[],
  decimals: number,
): SurvivalRankingEntry[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (
      !entry.playerId.trim() ||
      ids.has(entry.playerId) ||
      (entry.eliminationFloorIndex !== null &&
        (!Number.isSafeInteger(entry.eliminationFloorIndex) ||
          entry.eliminationFloorIndex < 0)) ||
      !Number.isFinite(entry.tieBreaker) ||
      entry.tieBreaker < 0 ||
      entry.tieBreaker >= 1
    )
      throw new Error('Invalid survival ranking facts.');
    ids.add(entry.playerId);
    validateSurvivalStoredScore(entry.finalScore, decimals);
  }
  const sorted = [...entries].sort((left, right) => {
    const leftAlive = left.eliminationFloorIndex === null,
      rightAlive = right.eliminationFloorIndex === null;
    return (
      Number(rightAlive) - Number(leftAlive) ||
      (right.eliminationFloorIndex ?? 0) - (left.eliminationFloorIndex ?? 0) ||
      right.finalScore - left.finalScore ||
      left.tieBreaker - right.tieBreaker ||
      left.playerId.localeCompare(right.playerId)
    );
  });
  return sorted.map((entry, index) => ({
    ...entry,
    rank: index + 1,
    status: entry.eliminationFloorIndex === null ? 'survived' : 'eliminated',
    isChampion: index === 0 && entry.eliminationFloorIndex === null,
  }));
}

export function survivalRankingStatus(
  entry: Pick<SurvivalRankingEntry, 'eliminationFloorIndex'>,
): string {
  return entry.eliminationFloorIndex === null
    ? '存活'
    : `第 ${entry.eliminationFloorIndex + 1} 层淘汰`;
}
