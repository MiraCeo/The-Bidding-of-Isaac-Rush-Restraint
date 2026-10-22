import type { PlayerProfile } from '../player-profile';

/** One fixed data boundary, NOT the app version. Future patches keep this value
 * and therefore inherit current achievements instead of resetting every release. */
export const achievementBaselineModule = 'achievementBaselineV1';
export const currentAchievementBaseline = 1;
export function hasCurrentAchievementBaseline(profile: PlayerProfile): boolean {
  const value = profile.progression.modules[achievementBaselineModule];
  if (value === undefined) return false;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    value.version !== currentAchievementBaseline
  )
    throw Error('成就数据基线损坏或版本不支持，原档案保留。');
  return true;
}
