import type { SurvivalGameState } from '../game/survival-session';
import type { RoomDraft } from './game-session';
import type { SaveStorage } from './game-save';
import {
  playerProfileKey,
  readPlayerProfile,
  type PlayerProfile,
} from './player-profile';
import {
  serializeSurvivalCheckpoint,
  survivalSaveKey,
} from './survival-persistence';

/** Explicit profile restore must not succeed separately from restoring its paired match. */
export function restoreSurvivalBackupProgress(
  storage: SaveStorage | null,
  game: SurvivalGameState,
  draft: RoomDraft | null,
  profile: PlayerProfile,
): void {
  const checkpoint = serializeSurvivalCheckpoint(game, draft),
    playerProfile = JSON.stringify(readPlayerProfile(profile));
  if (!storage) throw new Error('存储不可用，未覆盖对局与玩家进度。');
  const writes = [
    [survivalSaveKey, checkpoint],
    [playerProfileKey, playerProfile],
  ] as const;
  const previous = writes.map(([key]) => storage.getItem(key));
  let applied = 0;
  try {
    for (const [key, value] of writes) {
      storage.setItem(key, value);
      applied++;
    }
  } catch {
    let rollbackFailed = false;
    while (applied > 0) {
      const i = --applied,
        key = writes[i]![0];
      try {
        if (previous[i] === null) storage.removeItem(key);
        else storage.setItem(key, previous[i]!);
      } catch {
        rollbackFailed = true;
      }
    }
    throw new Error(
      rollbackFailed
        ? '备份载入失败，浏览器未能恢复旧存储；当前内存对局仍保留，请立即导出原对局。'
        : '备份载入失败，已恢复原存储，当前对局与玩家进度未改变。',
    );
  }
}
