import {
  createPlayerProfile,
  playerProfileKey,
  readPlayerProfile,
  type PlayerProfile,
} from './player-profile';
import {
  checkedJson,
  keys,
  date,
  text,
  checkChecksum,
  stringifyChecked,
} from './file-json';
import { unpackDataFile, type FileCodecOptions } from './compressed-file';
import { readBuildVersion } from './game-version';
import { notifyPlayerProfileChanged } from './profile-events';
import type { SaveStorage } from './game-save';

export const profileBackupFormat = 'the-bidding-of-isaac-profile-backup';
export const profileBackupVersion = 1;
export interface PlayerProfileBackupDocument {
  format: typeof profileBackupFormat;
  version: typeof profileBackupVersion;
  kind: 'profile-backup';
  exportedAt: string;
  exportedBuild: string;
  profile: PlayerProfile;
}
export interface PlayerProfileSnapshot {
  available: boolean;
  source: string | null;
  profile: PlayerProfile | null;
  message: string;
}
function validatedProfile(value: unknown): PlayerProfile {
  // Same guarded JSON boundary as game files; never rebuild a game or grant progression.
  const validated = readPlayerProfile(value);
  return readPlayerProfile(checkedJson(JSON.stringify(validated)));
}
export function serializePlayerProfileBackup(
  profile: PlayerProfile,
  build = readBuildVersion(),
  now = new Date(),
): string {
  text(build);
  return stringifyChecked({
    format: profileBackupFormat,
    version: profileBackupVersion,
    kind: 'profile-backup',
    exportedAt: now.toISOString(),
    exportedBuild: build,
    profile: validatedProfile(profile),
  });
}
export function parsePlayerProfileBackup(
  source: string,
): PlayerProfileBackupDocument {
  const doc = checkedJson(source);
  if (
    doc.format !== profileBackupFormat ||
    doc.version !== profileBackupVersion ||
    doc.kind !== 'profile-backup'
  )
    throw Error(
      '仅支持独立玩家档案备份v1；对局存档、回放与完整备份请使用对局文件入口。',
    );
  keys(doc, [
    'format',
    'version',
    'kind',
    'exportedAt',
    'exportedBuild',
    'profile',
    'checksum',
  ]);
  checkChecksum(doc);
  date(doc.exportedAt);
  text(doc.exportedBuild);
  return {
    format: profileBackupFormat,
    version: profileBackupVersion,
    kind: 'profile-backup',
    exportedAt: doc.exportedAt as string,
    exportedBuild: doc.exportedBuild,
    profile: readPlayerProfile(doc.profile),
  };
}
export async function readPlayerProfileBackup(
  source: string,
  options: FileCodecOptions = {},
): Promise<PlayerProfileBackupDocument> {
  return parsePlayerProfileBackup(
    (await unpackDataFile(source, options)).source,
  );
}
/** Read failures/corruption are not replaced by a fabricated empty export. */
export function readPlayerProfileSnapshot(
  storage: Pick<SaveStorage, 'getItem'> | null,
): PlayerProfileSnapshot {
  if (!storage)
    return {
      available: false,
      source: null,
      profile: null,
      message: '玩家档案存储不可读取，未用空档案代替原资料。',
    };
  let source: string | null;
  try {
    source = storage.getItem(playerProfileKey);
  } catch {
    return {
      available: false,
      source: null,
      profile: null,
      message: '玩家档案读取失败，原资料保留。',
    };
  }
  try {
    return {
      available: true,
      source,
      profile:
        source === null
          ? createPlayerProfile()
          : readPlayerProfile(checkedJson(source)),
      message: '',
    };
  } catch {
    return {
      available: true,
      source,
      profile: null,
      message:
        '本机玩家档案无法核验，原文保留。导出不会使用空档案；恢复备份需明确确认替换。',
    };
  }
}
export class PlayerProfileChangedError extends Error {
  constructor() {
    super(
      '预览后本机玩家档案已变化，可能新增了完成记录。未覆盖，请重新核对本机档案后再确认。',
    );
    this.name = 'PlayerProfileChangedError';
  }
}
/** One synchronous, single-key replacement. No merge, other keys or match-state changes.
 * This checks the preview baseline; it is not a cross-tab compare-and-swap transaction.
 */
export function restorePlayerProfileBackup(
  storage: Pick<SaveStorage, 'getItem' | 'setItem'> | null,
  value: PlayerProfile,
  expectedSource: string | null,
) {
  const profile = validatedProfile(value),
    source = JSON.stringify(profile);
  if (!storage) throw Error('玩家档案存储不可用，未恢复；当前资料与对局保留。');
  let current: string | null;
  try {
    current = storage.getItem(playerProfileKey);
  } catch {
    throw Error('本机玩家档案无法读取，未替换。');
  }
  if (current !== expectedSource) throw new PlayerProfileChangedError();
  if (current === source) return { profile, source, changed: false };
  try {
    storage.setItem(playerProfileKey, source);
  } catch {
    throw Error(
      '玩家档案保存失败，可能存储额度不足或写入不可用；未完成恢复，原资料保留。',
    );
  }
  notifyPlayerProfileChanged();
  return { profile, source, changed: true };
}
