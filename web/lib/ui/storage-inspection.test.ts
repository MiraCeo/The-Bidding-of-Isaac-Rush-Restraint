import { describe, it, expect, vi } from 'vitest';
import {
  inspectStorage,
  siteStorageEstimate,
  maximumInspectedKeys,
} from './storage-inspection';
import { gameSaveKey } from './game-save';
import { survivalSaveKey } from './survival-persistence';
function storage(data: Map<string, string>) {
  return {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };
}
describe('read-only storage inventory', () => {
  it('includes current, old and other-source keys and both text sizes without writes or value disclosure', () => {
    const data = new Map([
        [gameSaveKey, '经典👽'],
        [survivalSaveKey, 'survival'],
        ['bidding-game-save-v1', 'old'],
        ['secret-key', 'private-value'],
        ['__proto__', 'not-a-descriptor'],
      ]),
      before = new Map(data),
      backend = storage(data),
      report = inspectStorage(backend);
    expect(report.status).toBe('available');
    expect(report.scannedCount).toBe(5);
    expect(report.entries.map((e) => e.group).sort()).toEqual([
      'classic',
      'legacy',
      'other',
      'other',
      'survival',
    ]);
    const encoder = new TextEncoder();
    expect(report.totalUtf8Bytes).toBe(
      [...data].reduce(
        (sum, [k, v]) =>
          sum + encoder.encode(k).length + encoder.encode(v).length,
        0,
      ),
    );
    expect(report.totalUtf16EstimateBytes).toBe(
      [...data].reduce((sum, [k, v]) => sum + (k.length + v.length) * 2, 0),
    );
    expect(JSON.stringify(report)).not.toContain('private-value');
    expect(JSON.stringify(report)).not.toContain('secret-key');
    expect(data).toEqual(before);
    expect(backend.setItem).not.toHaveBeenCalled();
    expect(backend.removeItem).not.toHaveBeenCalled();
  });
  it('reports unknown/unavailable rather than pretending blocked storage has zero data', () => {
    expect(inspectStorage(null)).toMatchObject({
      status: 'unavailable',
      reportedCount: null,
    });
    expect(
      inspectStorage({
        get length(): number {
          throw Error('blocked');
        },
        key: () => null,
        getItem: () => null,
      }),
    ).toMatchObject({ status: 'unavailable', reportedCount: null });
  });
  it('retains successfully measured entries if a later read fails', () => {
    const report = inspectStorage({
      length: 2,
      key: (i) => ['a', 'b'][i]!,
      getItem: (key) => {
        if (key === 'b') throw Error('blocked');
        return 'value';
      },
    });
    expect(report).toMatchObject({
      status: 'partial',
      reportedCount: 2,
      scannedCount: 1,
    });
    expect(report.entries).toHaveLength(1);
  });
  it('caps enumeration and marks disappearing or repeated keys as partial rather than double counting', () => {
    const data = new Map(
      Array.from({ length: maximumInspectedKeys + 5 }, (_, i) => [
        'k' + i,
        'x',
      ]),
    );
    expect(inspectStorage(storage(data))).toMatchObject({
      status: 'partial',
      scannedCount: maximumInspectedKeys,
    });
    const report = inspectStorage({
      length: 3,
      key: (i) => (i === 2 ? null : 'same'),
      getItem: () => 'value',
    });
    expect(report).toMatchObject({ status: 'partial', scannedCount: 1 });
  });
  it('treats an empty accessible origin as a complete zero-entry inventory', () => {
    expect(inspectStorage(storage(new Map()))).toMatchObject({
      status: 'available',
      scannedCount: 0,
      reportedCount: 0,
      totalUtf8Bytes: 0,
    });
  });
  it('labels the separate site-wide estimate and handles missing/invalid values or rejected APIs', async () => {
    expect(
      await siteStorageEstimate({
        estimate: async () => ({ usage: 123, quota: 987 }),
      }),
    ).toMatchObject({
      usageBytes: 123,
      quotaBytes: 987,
      message: expect.stringContaining('不是localStorage'),
    });
    expect(
      await siteStorageEstimate({
        estimate: async () => ({ usage: NaN, quota: Infinity }),
      }),
    ).toMatchObject({ usageBytes: null, quotaBytes: null });
    expect(
      await siteStorageEstimate({
        estimate: async () => {
          throw Error('blocked');
        },
      }),
    ).toMatchObject({ usageBytes: null, quotaBytes: null });
    expect(await siteStorageEstimate(null)).toMatchObject({
      usageBytes: null,
      quotaBytes: null,
    });
  });
});
import { profileReplacementEpochKey } from './profile-write-coordinator';
it('classifies the operational replacement epoch with profile storage, without reading it as achievements or exposing its value', () => {
  const data = new Map([[profileReplacementEpochKey, 'a'.repeat(64)]]),
    backend = storage(data),
    report = inspectStorage(backend);
  expect(report.entries[0]).toMatchObject({
    group: 'profile',
    label: '档案替换代次（本机协调）',
  });
  expect(JSON.stringify(report)).not.toContain('a'.repeat(64));
  expect(backend.setItem).not.toHaveBeenCalled();
});
