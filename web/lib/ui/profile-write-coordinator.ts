import { sha256Hex } from '../shared/sha256';

export const profileWriteLockName =
  'bidding-profile-write:bidding-player-profile-v1';
export const profileReplacementEpochKey =
  'bidding-profile-replacement-epoch-v1';
export interface ProfileWriteCoordinator {
  exclusive<T>(name: string, work: () => T, signal?: AbortSignal): Promise<T>;
}
export function browserProfileWriteCoordinator(): ProfileWriteCoordinator | null {
  if (typeof navigator === 'undefined' || !navigator.locks) return null;
  return {
    exclusive: (name, work, signal) =>
      navigator.locks.request(
        name,
        { mode: 'exclusive', ...(signal ? { signal } : {}) },
        work,
      ),
  };
}
export function readProfileReplacementEpoch(
  storage: Pick<Storage, 'getItem'> | null,
): string | null {
  const source = storage?.getItem(profileReplacementEpochKey) ?? null;
  if (source !== null && !/^[a-f0-9]{64}$/.test(source))
    throw Error('档案替换代次损坏，未重新解释成长上下文。');
  return source;
}
export function newProfileReplacementEpoch(): string {
  return sha256Hex(crypto.randomUUID());
}
export function coordinateProfileWrite<T>(
  work: () => T,
  {
    coordinator = browserProfileWriteCoordinator(),
    signal,
    requireCoordinator = false,
  }: {
    coordinator?: ProfileWriteCoordinator | null;
    signal?: AbortSignal;
    requireCoordinator?: boolean;
  } = {},
): Promise<T> {
  const checked = () => {
    if (signal?.aborted)
      throw new DOMException('保存已取消，原资料保留。', 'AbortError');
    return work();
  };
  if (!coordinator) {
    if (requireCoordinator)
      return Promise.reject(
        Error('成长保存需要同源写入协调能力，未修改原档案。'),
      );
    // Legacy/no-growth fallback executes synchronously, retaining the prior API
    // timing. Growth never uses this path to pretend it acquired a global lock.
    return new Promise<T>((resolve, reject) => {
      try {
        resolve(checked());
      } catch (error) {
        reject(error);
      }
    });
  }
  try {
    return coordinator.exclusive(profileWriteLockName, checked, signal);
  } catch (error) {
    return Promise.reject(error);
  }
}
