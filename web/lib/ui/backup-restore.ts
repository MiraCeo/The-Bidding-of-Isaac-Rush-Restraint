import {
  gameSaveKey,
  activeReplayKey,
  draftSaveKey,
  serializeGameCheckpoint,
  type SaveStorage,
} from './game-save';
import { serializeReplay } from './game-replay';
import { readBuildVersion, shortHash } from './game-version';
import {
  playerProfileKey,
  readPlayerProfile,
  type PlayerProfile,
} from './player-profile';
import { PlayerProfileChangedError } from './player-profile-file';
import { notifyPlayerProfileChanged } from './profile-events';
import type { GameSession } from './game-session';
import { validateGrowthProfilePair } from './achievements/lifecycle';

/** Bounded synchronous rollback, not a global cross-page transaction or crash journal. */
export function restoreBackupWrites(
  storage: SaveStorage | null,
  writes: readonly (readonly [string, string])[],
  expectedProfileSource?: string | null,
): void {
  if (!storage) throw Error('存储不可用，未覆盖对局与玩家进度。');
  const previous = writes.map(([key]) => storage.getItem(key));
  if (
    expectedProfileSource !== undefined &&
    previous[writes.findIndex(([key]) => key === playerProfileKey)] !==
      expectedProfileSource
  )
    throw new PlayerProfileChangedError();
  let applied = 0;
  try {
    for (const [key, value] of writes) {
      if (
        key === playerProfileKey &&
        expectedProfileSource !== undefined &&
        storage.getItem(playerProfileKey) !== expectedProfileSource
      )
        throw new PlayerProfileChangedError();
      storage.setItem(key, value);
      applied++;
    }
  } catch (error) {
    let rollbackFailed = false;
    while (applied > 0) {
      const i = --applied,
        key = writes[i]![0];
      try {
        if (storage.getItem(key) !== writes[i]![1]) {
          rollbackFailed = true;
          continue;
        }
        if (previous[i] === null) storage.removeItem(key);
        else storage.setItem(key, previous[i]!);
      } catch {
        rollbackFailed = true;
      }
    }
    if (!rollbackFailed && error instanceof PlayerProfileChangedError)
      throw error;
    throw Error(
      rollbackFailed
        ? '备份载入失败，浏览器未能恢复旧存储；当前内存对局仍保留，请立即导出原对局。'
        : '备份载入失败，已恢复原存储，当前对局与玩家进度未改变。',
    );
  }
  notifyPlayerProfileChanged();
}

/** Save the match and exact profile before changing React state; never register completion here. */
export function restoreClassicBackupProgress(
  storage: SaveStorage | null,
  session: GameSession,
  profile: PlayerProfile,
  expectedProfileSource?: string | null,
): void {
  const core = serializeGameCheckpoint(session);
  if (session.growth && !session.growthIssue) validateGrowthProfilePair(profile, session.growth);
  if (!session.replay) throw Error('备份缺少完整事实，未覆盖对局与玩家进度。');
  restoreBackupWrites(
    storage,
    [
      [activeReplayKey, serializeReplay(session.replay, readBuildVersion())],
      [gameSaveKey, core],
      [
        draftSaveKey,
        JSON.stringify({ token: shortHash(core), draft: session.draft }),
      ],
      [playerProfileKey, JSON.stringify(readPlayerProfile(profile))],
    ],
    expectedProfileSource,
  );
}
