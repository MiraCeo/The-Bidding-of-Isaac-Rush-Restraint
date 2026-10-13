import { survivalReplayFactIdentity } from './survival-view-model';
import type { SurvivalReplayLog } from './survival-record';
import type { PlayerProfile } from './player-profile';

export async function survivalCompletionKey(
  log: SurvivalReplayLog,
): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(survivalReplayFactIdentity(log)),
  );
  return `${log.id}/${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
export function recordSurvivalCompletedMatch(
  profile: PlayerProfile,
  log: SurvivalReplayLog,
  key: string,
  now = new Date(),
): PlayerProfile {
  if (!log.final || profile.history.some((entry) => entry.key === key))
    return profile;
  const human = log.final.ranking.find((entry) => entry.playerId === 'human');
  if (!human) return profile;
  return {
    ...profile,
    updatedAt: now.toISOString(),
    history: [
      ...profile.history,
      {
        key,
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
    ].slice(-200),
  };
}
