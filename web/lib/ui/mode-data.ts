import { parseDataFile, type DataCandidate } from './data-management';
import {
  parseSurvivalCheckpoint,
  parseSurvivalReplay,
  type SurvivalSaveDocument,
  type SurvivalReplayDocument,
} from './survival-persistence';
import { checkedJson, fail } from './survival-json';
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
/** Explicit mode dispatch, shared by both UI import previews; never converts one mode into another. */
export function parseModeDataFile(
  source: string,
  filename: string,
): ModeDataCandidate {
  const header = checkedJson(source);
  if (header.version !== 4) return parseDataFile(source, filename);
  if (header.mode !== 'survival') fail('v4文件缺少明确的生存模式身份。');
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
  fail('无法识别v4生存文件。');
}
