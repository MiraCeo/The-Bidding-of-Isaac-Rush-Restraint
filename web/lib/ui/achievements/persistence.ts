import { persistCompletionProfile } from '../completion-persistence';
import { playerProfileKey, type PlayerProfile } from '../player-profile';
import type { SaveStorage } from '../game-save';

export const achievementProfileLockName = `bidding-profile-write:${playerProfileKey}`;
/** All future profile writers must join this lock before claiming global cross-tab
 * serialization. Existing completion/restore writers are not yet wired here. */
export interface AchievementWriteCoordinator {
  exclusive<T>(name: string, work: () => T, signal?: AbortSignal): Promise<T>;
}
export function browserAchievementWriteCoordinator(): AchievementWriteCoordinator | null {
  if (typeof navigator === 'undefined' || !navigator.locks) return null;
  return {
    exclusive: (name, work, signal) =>
      navigator.locks.request(
        name,
        { mode: 'exclusive', ...(signal ? { signal } : {}) },
        work,
      ),
  };
}
export async function persistAchievementProfile(
  storage: Pick<SaveStorage, 'getItem' | 'setItem'> | null,
  compute: (profile: PlayerProfile) => PlayerProfile,
  coordinator: AchievementWriteCoordinator | null,
  signal?: AbortSignal,
) {
  const check = () => {
    if (signal?.aborted)
      throw new DOMException('成长保存已取消，原资料保留。', 'AbortError');
  };
  check();
  if (!coordinator) throw Error('成长保存需要同源写入协调能力，未修改原档案。');
  return coordinator.exclusive(
    achievementProfileLockName,
    () => {
      check();
      return persistCompletionProfile(storage, compute);
    },
    signal,
  );
}
