import { parseDataFile, type DataCandidate } from './data-management';
import { unpackDataFile, type FileCodecOptions } from './compressed-file';
import {
  parseSurvivalCheckpoint,
  parseSurvivalReplay,
  type SurvivalSaveDocument,
  type SurvivalReplayDocument,
} from './survival-persistence';
import { checkedJson, fail } from './file-json';
import { assertCurrentFileHeader } from './file-protocol';
import { profileBackupFormat } from './player-profile-file';
import {
  parseSurvivalBackup,
  type SurvivalBackupDocument,
} from './survival-backup';

export type ModeDataCandidate =
  | DataCandidate
  | {
      kind: 'survival-backup';
      document: SurvivalBackupDocument;
      filename: string;
    }
  | {
      kind: 'survival-checkpoint';
      document: SurvivalSaveDocument;
      filename: string;
    }
  | {
      kind: 'survival-replay';
      document: SurvivalReplayDocument;
      filename: string;
    };
/** Current v5 JSON, raw or inside the lossless transport container. No legacy migration. */
export async function readModeDataFile(
  source: string,
  filename: string,
  options: FileCodecOptions = {},
): Promise<ModeDataCandidate> {
  const unpacked = await unpackDataFile(source, options);
  return parseModeDataFile(unpacked.source, filename);
}
/** Explicit mode dispatch, shared by both UI import previews; never converts one mode into another. */
export function parseModeDataFile(
  source: string,
  filename: string,
): ModeDataCandidate {
  const header = checkedJson(source);
  if (header.format === profileBackupFormat)
    throw new Error(
      '这是独立玩家档案备份，请使用“读取玩家档案文件”入口；当前对局未改变。',
    );
  assertCurrentFileHeader(header);
  if (header.mode === 'classic') return parseDataFile(source, filename);
  if (header.format === 'the-bidding-of-isaac-save' && header.kind === 'backup')
    return {
      kind: 'survival-backup',
      document: parseSurvivalBackup(source),
      filename,
    };
  if (header.format === 'the-bidding-of-isaac-save')
    return {
      kind: 'survival-checkpoint',
      document: parseSurvivalCheckpoint(source),
      filename,
    };
  if (header.format === 'the-bidding-of-isaac-replay')
    return {
      kind: 'survival-replay',
      document: parseSurvivalReplay(source),
      filename,
    };
  fail('无法识别当前v5生存文件。');
}
