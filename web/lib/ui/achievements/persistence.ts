import {
  withAchievementVerificationScope,
  prepareAchievementBaseline,
} from './registry';
import { persistCompletionProfile } from '../completion-persistence';
import { type PlayerProfile } from '../player-profile';
import type { SaveStorage } from '../game-save';
import { applyGrowthContext, type GrowthContext } from './lifecycle';
import {
  profileWriteLockName,
  browserProfileWriteCoordinator,
  type ProfileWriteCoordinator,
} from '../profile-write-coordinator';

export const achievementProfileLockName = profileWriteLockName;
/** All future profile writers must join this lock before claiming global cross-tab
 * serialization. Current UI completion/restore writers share this lock. */
export type AchievementWriteCoordinator = ProfileWriteCoordinator;
export function browserAchievementWriteCoordinator(): AchievementWriteCoordinator | null {
  return browserProfileWriteCoordinator();
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
      return withAchievementVerificationScope(() =>
        persistCompletionProfile(storage, (profile) =>
          compute(prepareAchievementBaseline(profile)),
        ),
      );
    },
    signal,
  );
}
/** Same profile candidate can include terminal statistics. This backend adapter
 * does not run on parsing/importing and does not publish a cursor before commit. */
export async function persistGrowthContext(
  storage: Pick<SaveStorage, 'getItem' | 'setItem'> | null,
  context: GrowthContext,
  coordinator: AchievementWriteCoordinator | null,
  signal?: AbortSignal,
  additionalProfileUpdate?: (profile: PlayerProfile) => PlayerProfile,
) {
  let committedContext = context;
  const result = await persistAchievementProfile(
    storage,
    (profile) => {
      const applied = applyGrowthContext(profile, context);
      committedContext = applied.context;
      const candidate = applied.profile;
      return additionalProfileUpdate
        ? additionalProfileUpdate(candidate)
        : candidate;
    },
    coordinator,
    signal,
  );
  return {
    ...result,
    context: committedContext,
  };
}
