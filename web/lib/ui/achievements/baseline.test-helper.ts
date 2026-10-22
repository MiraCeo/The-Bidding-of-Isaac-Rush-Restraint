import { createPlayerProfile, type PlayerProfile } from '../player-profile';
import { registerCompletion } from '../completion-registry';
import {
  appendAchievementEvent,
  manuallyUnlockAchievementCharacters,
} from './registry';
import { achievementBaselineModule } from './baseline';
import { decodeAchievementEvent } from './event-codec';
import { sha256Hex } from '../../shared/sha256';
export const baselineNow = new Date('2026-10-16T08:00:00.000Z');
export function oldAchievementProfile(manual = false): PlayerProfile {
  let p = createPlayerProfile(new Date('2026-10-15T00:00:00.000Z'));
  p = registerCompletion(
    p,
    {
      key: 'classic/' + sha256Hex('old-complete'),
      replayId: 'old-replay',
      characterId: 'isaac',
      completedAt: p.createdAt,
      finalScore: 100,
      rank: 1,
      mode: 'classic',
    },
    [],
    true,
  );
  for (let i = 0; i < 10; i++)
    p = appendAchievementEvent(
      p,
      {
        source: 'live',
        mode: 'classic',
        root: sha256Hex('old-root' + i),
        parent: null,
        authorityHash: sha256Hex('old-authority' + i),
        event: decodeAchievementEvent({
          stage: 'room',
          position: 0,
          values: [
            1,
            i === 0 ? 512 : 0,
            0,
            i === 0 ? 3 : 0,
            i === 0 ? 10 : null,
          ],
        }),
      },
      new Date(p.createdAt),
    );
  if (manual)
    p = manuallyUnlockAchievementCharacters(
      p,
      new Date('2026-10-15T01:00:00.000Z'),
    );
  p.progression.achievements.old = { achievedAt: p.createdAt, progress: 99 };
  p.progression.characterUnlocks.lost = {
    unlockedAt: p.createdAt,
    conditionId: 'legacy:E01+A02',
  };
  p.progression.characterUnlocks.external = {
    unlockedAt: p.createdAt,
    conditionId: 'external-unrelated',
  };
  p.progression.modules.external = { keep: ['yes', 3] };
  delete p.progression.modules[achievementBaselineModule];
  return p;
}
