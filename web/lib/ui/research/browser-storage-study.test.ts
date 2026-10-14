import { describe, it, expect, vi } from 'vitest';
import {
  probeIsolatedTextQuota,
  runBrowserStorageStudy,
} from './browser-storage-study';
function store(quota = 100000) {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (key.length + value.length > quota)
        throw new DOMException('quota', 'QuotaExceededError');
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
describe('isolated browser quota research safety', () => {
  it('bounds probing, identifies quota errors and removes only its own new key', async () => {
    const backend = store();
    backend.data.set('unrelated', 'keep');
    const report = await probeIsolatedTextQuota(backend, 'new-test', 'x');
    expect(report.largestAcceptedCodeUnits).toBeGreaterThan(0);
    expect(report.firstRejectedCodeUnits).not.toBeNull();
    expect(report.attempts).toBeLessThan(20);
    expect(backend.data).toEqual(new Map([['unrelated', 'keep']]));
  });
  it('never overwrites an existing probe key and stops if the origin already has user data', async () => {
    const backend = store();
    backend.data.set('existing', 'keep');
    await expect(
      probeIsolatedTextQuota(backend, 'existing', 'x'),
    ).rejects.toThrow('已存在');
    const inputs = {
      classicActive: '',
      classicBackup: '',
      survivalActive: '',
      survivalBackup: '',
      survivalPreviousReplay: '',
    };
    await expect(runBrowserStorageStudy(backend, inputs)).rejects.toThrow(
      '已有数据',
    );
    expect(backend.data.get('existing')).toBe('keep');
  });
  it('cleans up a successful write when cancelled and does not relabel other failures as a quota', async () => {
    const backend = store(),
      controller = new AbortController(),
      set = backend.setItem;
    backend.setItem = (key, value) => {
      set(key, value);
      controller.abort();
    };
    await expect(
      probeIsolatedTextQuota(backend, 'test', 'x', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(backend.data.size).toBe(0);
    const failure = {
      ...store(),
      setItem: vi.fn(() => {
        throw Error('access denied');
      }),
    };
    await expect(
      probeIsolatedTextQuota(failure, 'other', '存'),
    ).rejects.toThrow('access denied');
  });
  it('preserves an intervening replacement rather than deleting data it no longer owns', async () => {
    const backend = store(),
      controller = new AbortController(),
      set = backend.setItem,
      get = backend.getItem;
    let reads = 0;
    backend.setItem = (key, value) => {
      set(key, value);
      controller.abort();
    };
    backend.getItem = (key) => {
      reads++;
      if (reads === 3) backend.data.set(key, 'external-replacement');
      return get(key);
    };
    await expect(
      probeIsolatedTextQuota(backend, 'test', 'x', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(backend.data.get('test')).toBe('external-replacement');
  });
});
