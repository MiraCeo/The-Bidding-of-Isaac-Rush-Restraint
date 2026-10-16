import {
  createPlayerProfile,
  playerProfileKey,
  readPlayerProfile,
  type PlayerProfile,
} from './player-profile';
import { checkedJson } from './file-json';
import { notifyPlayerProfileChanged } from './profile-events';
import type { SaveStorage } from './game-save';
import { prepareAchievementBaseline } from './achievements/registry';

/** Re-read/rebase if a profile changed during fact hashing. One profile write
 * commits counters+receipts+history together; this is not a cross-tab lock/CAS. */
export function persistCompletionProfile(
  storage: Pick<SaveStorage, 'getItem' | 'setItem'> | null,
  compute: (profile: PlayerProfile) => PlayerProfile,
) {
  if (!storage) throw Error('玩家档案存储不可用，完成登记未保存。');
  for (let attempt = 0; attempt < 3; attempt++) {
    const source = storage.getItem(playerProfileKey);
    const current =
      source === null
        ? createPlayerProfile()
        : readPlayerProfile(checkedJson(source));
    const next = compute(prepareAchievementBaseline(current));
    if (next === current) return { profile: current, changed: false };
    const validated = readPlayerProfile(next),
      target = JSON.stringify(validated);
    if (storage.getItem(playerProfileKey) !== source) continue;
    storage.setItem(playerProfileKey, target);
    notifyPlayerProfileChanged();
    return { profile: validated, changed: true };
  }
  throw Error(
    '玩家档案持续发生变化，本次完成登记未保存；现有累计保留，请稍后重试。',
  );
}
