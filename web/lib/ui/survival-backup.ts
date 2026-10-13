import type { SurvivalGameState } from '../game/survival-session';
import type { RoomDraft } from './game-session';
import { readPlayerProfile, type PlayerProfile } from './player-profile';
import {
  serializeSurvivalCheckpoint,
  parseSurvivalCheckpoint,
  serializeSurvivalReplay,
  parseSurvivalReplay,
  type SurvivalSaveDocument,
} from './survival-persistence';
import { createSurvivalReplay } from './survival-record';
import {
  checkedJson,
  keys,
  checkChecksum,
  date,
  stringifyChecked,
  equal,
  fail,
} from './survival-json';

export interface SurvivalBackupDocument {
  format: 'the-bidding-of-isaac-save';
  version: 4;
  mode: 'survival';
  kind: 'backup';
  savedAt: string;
  checkpoint: SurvivalSaveDocument;
  profile: PlayerProfile;
}
export function serializeSurvivalBackup(
  game: SurvivalGameState,
  draft: RoomDraft | null,
  profile: PlayerProfile,
  now = new Date(),
): string {
  return stringifyChecked({
    format: 'the-bidding-of-isaac-save',
    version: 4,
    mode: 'survival',
    kind: 'backup',
    savedAt: now.toISOString(),
    checkpoint: JSON.parse(serializeSurvivalCheckpoint(game, draft, now)),
    replay: JSON.parse(
      serializeSurvivalReplay(
        createSurvivalReplay(game),
        game.currentBuild,
        now,
      ),
    ),
    profile: readPlayerProfile(profile),
  });
}
export function parseSurvivalBackup(source: string): SurvivalBackupDocument {
  const doc = checkedJson(source);
  keys(doc, [
    'format',
    'version',
    'mode',
    'kind',
    'savedAt',
    'checkpoint',
    'replay',
    'profile',
    'checksum',
  ]);
  if (
    doc.format !== 'the-bidding-of-isaac-save' ||
    doc.version !== 4 ||
    doc.mode !== 'survival' ||
    doc.kind !== 'backup'
  )
    fail('不是v4生存完整备份。');
  checkChecksum(doc);
  date(doc.savedAt);
  const checkpoint = parseSurvivalCheckpoint(JSON.stringify(doc.checkpoint));
  const replay = parseSurvivalReplay(JSON.stringify(doc.replay));
  equal(replay.replay, createSurvivalReplay(checkpoint.game));
  return {
    format: 'the-bidding-of-isaac-save',
    version: 4,
    mode: 'survival',
    kind: 'backup',
    savedAt: doc.savedAt as string,
    checkpoint,
    profile: readPlayerProfile(doc.profile),
  };
}
