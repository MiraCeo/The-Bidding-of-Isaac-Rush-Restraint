import {
  coordinateProfileWrite,
  readProfileReplacementEpoch,
  type ProfileWriteCoordinator,
} from './profile-write-coordinator';
import {
  playerProfileKey,
  readPlayerProfile,
  type PlayerProfile,
} from './player-profile';
import { prepareAchievementBaseline } from './achievements/registry';
import { PlayerProfileChangedError } from './player-profile-file';
import {
  restoreBackupWrites,
  restoreClassicBackupProgress,
} from './backup-restore';
import { restoreSurvivalBackupProgress } from './survival-restore';
import type { SaveStorage } from './game-save';
import type { GameSession } from './game-session';
import type { SurvivalSaveDocument } from './survival-persistence';

export interface ProfileOperationOptions {
  coordinator?: ProfileWriteCoordinator | null;
  signal?: AbortSignal;
}
export function replacePlayerProfileCoordinated(
  storage: SaveStorage | null,
  value: PlayerProfile,
  expected: string | null,
  options: ProfileOperationOptions = {},
) {
  return coordinateProfileWrite(() => {
    if (!storage) throw Error('玩家档案存储不可用，未恢复。');
    const profile = prepareAchievementBaseline(readPlayerProfile(value)),
      source = JSON.stringify(profile);
    if (storage.getItem(playerProfileKey) !== expected)
      throw new PlayerProfileChangedError();
    if (source === expected) return { profile, source, changed: false };
    try {
      restoreBackupWrites(storage, [[playerProfileKey, source]], expected, {
        replaceProfile: true,
      });
    } catch (error) {
      if (error instanceof PlayerProfileChangedError) throw error;
      throw Error(
        `玩家档案保存失败，${error instanceof Error ? error.message : '原资料保留。'}`,
      );
    }
    return { profile, source, changed: true };
  }, options);
}
export function restoreClassicCoordinated(
  storage: SaveStorage | null,
  session: GameSession,
  profile: PlayerProfile,
  expected: string | null | undefined,
  options: ProfileOperationOptions = {},
) {
  return coordinateProfileWrite(() => {
    const source = restoreClassicBackupProgress(
      storage,
      session,
      profile,
      expected,
      true,
    );
    return { source, epoch: readProfileReplacementEpoch(storage) };
  }, options);
}
export function restoreSurvivalCoordinated(
  storage: SaveStorage | null,
  doc: SurvivalSaveDocument,
  profile: PlayerProfile,
  expected: string | null | undefined,
  options: ProfileOperationOptions = {},
) {
  return coordinateProfileWrite(() => {
    const source = restoreSurvivalBackupProgress(
      storage,
      doc.game,
      doc.draft,
      profile,
      expected,
      doc.growth,
      true,
    );
    return { source, epoch: readProfileReplacementEpoch(storage) };
  }, options);
}
