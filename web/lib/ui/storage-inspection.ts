import {
  gameSaveKey,
  activeReplayKey,
  lastCompletedKey,
  draftSaveKey,
} from './game-save';
import {
  survivalSaveKey,
  survivalLastCompletedKey,
} from './survival-persistence';
import { playerProfileKey } from './player-profile';
import { gamePreferencesKey } from './game-preferences';
import { activeModeKey } from './survival-client';

type InspectableStorage = Pick<Storage, 'length' | 'key' | 'getItem'>;
export type StorageGroup =
  | 'classic'
  | 'survival'
  | 'profile'
  | 'preferences'
  | 'legacy'
  | 'other';
export interface StorageEntry {
  label: string;
  group: StorageGroup;
  utf8Bytes: number;
  utf16EstimateBytes: number;
}
export interface StorageInspection {
  status: 'available' | 'partial' | 'unavailable';
  entries: StorageEntry[];
  totalUtf8Bytes: number;
  totalUtf16EstimateBytes: number;
  scannedCount: number;
  reportedCount: number | null;
  message: string;
}
const knownKeys: Record<string, { label: string; group: StorageGroup }> = {
  [gameSaveKey]: { label: '经典续玩检查点', group: 'classic' },
  [activeReplayKey]: { label: '经典进行中回放', group: 'classic' },
  [lastCompletedKey]: { label: '经典最近完成回放', group: 'classic' },
  [draftSaveKey]: { label: '经典未提交草稿', group: 'classic' },
  [survivalSaveKey]: { label: '生存续玩检查点', group: 'survival' },
  [survivalLastCompletedKey]: { label: '生存最近完成回放', group: 'survival' },
  [playerProfileKey]: { label: '玩家档案', group: 'profile' },
  [gamePreferencesKey]: { label: '显示偏好', group: 'preferences' },
  [activeModeKey]: { label: '上次活动模式', group: 'preferences' },
};
const legacyKeys = new Set([
  'bidding-game-save-v1',
  'bidding-active-replay-v2',
  'bidding-last-completed-v2',
  'bidding-game-draft-v2',
  'bidding-survival-checkpoint-v4',
  'bidding-survival-last-completed-v4',
]);
export const maximumInspectedKeys = 256;
/** Read-only text footprint including keys, not actual disk bytes or a quota guarantee. */
export function inspectStorage(
  storage: InspectableStorage | null,
): StorageInspection {
  const result: StorageInspection = {
    status: 'available',
    entries: [],
    totalUtf8Bytes: 0,
    totalUtf16EstimateBytes: 0,
    scannedCount: 0,
    reportedCount: null,
    message: '',
  };
  if (!storage)
    return {
      ...result,
      status: 'unavailable',
      message: '浏览器存储不可读取，未修改任何数据。',
    };
  try {
    const count = storage.length;
    if (!Number.isSafeInteger(count) || count < 0)
      throw Error('Invalid storage length');
    result.reportedCount = count;
    const encoder = new TextEncoder();
    const seen = new Set<string>();
    for (let i = 0; i < Math.min(count, maximumInspectedKeys); i++) {
      const key = storage.key(i);
      if (key === null || seen.has(key)) {
        result.status = 'partial';
        continue;
      }
      seen.add(key);
      const value = storage.getItem(key);
      if (value === null) {
        result.status = 'partial';
        continue;
      }
      const identity =
        (Object.hasOwn(knownKeys, key) ? knownKeys[key] : undefined) ??
        (legacyKeys.has(key)
          ? { label: `旧开发缓存 ${i + 1}`, group: 'legacy' as const }
          : { label: `其他来源 ${i + 1}`, group: 'other' as const });
      const utf8Bytes =
          encoder.encode(key).byteLength + encoder.encode(value).byteLength,
        utf16EstimateBytes = (key.length + value.length) * 2;
      result.entries.push({ ...identity, utf8Bytes, utf16EstimateBytes });
      result.totalUtf8Bytes += utf8Bytes;
      result.totalUtf16EstimateBytes += utf16EstimateBytes;
      result.scannedCount++;
    }
    if (count > maximumInspectedKeys || storage.length !== count)
      result.status = 'partial';
    result.entries.sort((a, b) => b.utf16EstimateBytes - a.utf16EstimateBytes);
    if (result.status === 'partial')
      result.message =
        '仅统计成功读取的部分条目；数据在测量中变化或条目超出上限。';
  } catch {
    result.status = result.scannedCount ? 'partial' : 'unavailable';
    result.message =
      '部分浏览器存储不可读取，仅显示已读取部分；未修改任何数据。';
  }
  return result;
}
export interface SiteEstimate {
  usageBytes: number | null;
  quotaBytes: number | null;
  message: string;
}
/** Origin-wide estimate, explicitly not the localStorage maximum. */
export async function siteStorageEstimate(
  manager: Pick<StorageManager, 'estimate'> | null,
): Promise<SiteEstimate> {
  if (!manager)
    return {
      usageBytes: null,
      quotaBytes: null,
      message: '当前环境未提供站点存储估算。',
    };
  try {
    const estimate = await manager.estimate();
    const valid = (v: unknown): v is number =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0;
    return {
      usageBytes: valid(estimate.usage) ? estimate.usage : null,
      quotaBytes: valid(estimate.quota) ? estimate.quota : null,
      message: '站点级估算，不是localStorage的可用空间或上限。',
    };
  } catch {
    return {
      usageBytes: null,
      quotaBytes: null,
      message: '站点存储估算不可用，未修改任何数据。',
    };
  }
}
