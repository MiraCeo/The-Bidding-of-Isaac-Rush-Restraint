import { prepareAchievementBaseline } from './achievements/registry';
import { currentFileVersion, assertCurrentFileHeader } from './file-protocol';
import { validateGrowthProfilePair, type GrowthContext } from './achievements/lifecycle';
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
import {
  createSurvivalReplay,
  type SurvivalReplayLog,
} from './survival-record';
import {
  checkedJson,
  keys,
  checkChecksum,
  date,
  stringifyChecked,
  equal,
  fail,
} from './file-json';

export interface SurvivalBackupDocument {
  format: 'the-bidding-of-isaac-save';
  version: typeof currentFileVersion;
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
  growth?: GrowthContext,
): string {
  if (growth) validateGrowthProfilePair(profile, growth);
  return stringifyChecked({
    format: 'the-bidding-of-isaac-save',
    version: currentFileVersion,
    mode: 'survival',
    kind: 'backup',
    savedAt: now.toISOString(),
    checkpoint: JSON.parse(serializeSurvivalCheckpoint(game, draft, now, growth)),
    replay: JSON.parse(
      serializeSurvivalReplay(
        createSurvivalReplay(game),
        game.currentBuild,
        now,
      ),
    ),
    profile: prepareAchievementBaseline(readPlayerProfile(profile), now),
  });
}
export function parseSurvivalBackup(source: string): SurvivalBackupDocument {
  const doc = checkedJson(source);
  assertCurrentFileHeader(doc, 'survival');
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
    doc.version !== currentFileVersion ||
    doc.mode !== 'survival' ||
    doc.kind !== 'backup'
  )
    fail('不是v5生存完整备份。');
  checkChecksum(doc);
  date(doc.savedAt);
  const checkpoint = parseSurvivalCheckpoint(JSON.stringify(doc.checkpoint));
  const replay = parseSurvivalReplay(JSON.stringify(doc.replay));
  equalBackupReplay(replay.replay, createSurvivalReplay(checkpoint.game));
  if (checkpoint.growth) validateGrowthProfilePair(readPlayerProfile(doc.profile), checkpoint.growth);
  return {
    format: 'the-bidding-of-isaac-save',
    version: currentFileVersion,
    mode: 'survival',
    kind: 'backup',
    savedAt: doc.savedAt as string,
    checkpoint,
    profile: readPlayerProfile(doc.profile),
  };
}
/** Math.exp may differ in its last bits between JS runtimes. Only the unrounded
 * knife explanation amount gets an eight-epsilon relative allowance. All
 * authoritative scores, money, identities, ordering and other facts stay exact.
 * The recorded document is never edited; expected is a fresh reconstruction. */
function equalBackupReplay(
  recorded: SurvivalReplayLog,
  expected: SurvivalReplayLog,
) {
  for (const [roomIndex, room] of expected.rooms.entries()) {
    for (const [playerId, score] of Object.entries(room.scoreBreakdowns)) {
      for (const [index, trigger] of score.triggers.entries()) {
        const original =
          recorded.rooms[roomIndex]?.scoreBreakdowns[playerId]?.triggers[index];
        if (
          trigger.itemId !== 'moms_knife' ||
          trigger.kind !== 'additive_score' ||
          original?.itemId !== trigger.itemId ||
          original.kind !== trigger.kind ||
          typeof trigger.amount !== 'number' ||
          typeof original.amount !== 'number' ||
          !Number.isFinite(trigger.amount) ||
          !Number.isFinite(original.amount)
        )
          continue;
        if (
          Math.abs(trigger.amount - original.amount) <=
          8 *
            Number.EPSILON *
            Math.max(Math.abs(trigger.amount), Math.abs(original.amount))
        )
          trigger.amount = original.amount;
      }
    }
  }
  equal(recorded, expected);
}
