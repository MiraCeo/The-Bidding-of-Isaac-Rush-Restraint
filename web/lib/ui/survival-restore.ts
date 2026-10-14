import type { SurvivalGameState } from '../game/survival-session';
import type { RoomDraft } from './game-session';
import type { SaveStorage } from './game-save';
import { restoreBackupWrites } from './backup-restore';
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
  expectedProfileSource?: string | null,
): void {
  const checkpoint = serializeSurvivalCheckpoint(game, draft),
    playerProfile = JSON.stringify(readPlayerProfile(profile));
  const writes = [
    [survivalSaveKey, checkpoint],
    [playerProfileKey, playerProfile],
  ] as const;
  restoreBackupWrites(storage, writes, expectedProfileSource);
}
