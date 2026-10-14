import {
  normalizedSurvivalCompletionKey,
  oldSurvivalCompletionKey,
} from './completion-identity';
import {
  registerCompletion,
  type CompletionOrigin,
} from './completion-registry';
import type { SurvivalReplayLog } from './survival-record';
import { readPlayerProfile, type PlayerProfile } from './player-profile';

export async function survivalCompletionKey(
  log: SurvivalReplayLog,
): Promise<string> {
  return normalizedSurvivalCompletionKey(log);
}
export function recordSurvivalCompletedMatch(
  profile: PlayerProfile,
  log: SurvivalReplayLog,
  key: string,
  now = new Date(),
  origin: CompletionOrigin = 'live',
): PlayerProfile {
  if (!log.final) return profile;
  const human = log.final.ranking.find((entry) => entry.playerId === 'human');
  if (!human) return profile;
  const next = registerCompletion(
    profile,
    {
      key: normalizedSurvivalCompletionKey(log),
      replayId: log.id,
      characterId: log.characterId,
      completedAt: now.toISOString(),
      finalScore: human.finalScore,
      rank: human.rank,
      mode: 'survival' as const,
      ...(log.ruleFacts.parameters.aiDifficulty !== undefined
        ? { aiDifficulty: log.ruleFacts.parameters.aiDifficulty }
        : {}),
      status: human.status,
      eliminationFloorIndex: human.eliminationFloorIndex,
    },
    [key, oldSurvivalCompletionKey(log)],
    human.isChampion,
    origin,
    now,
  );
  return next === profile ? profile : readPlayerProfile(next);
}
