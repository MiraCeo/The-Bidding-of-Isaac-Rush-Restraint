import { IDBFactory } from 'fake-indexeddb';
import { expect, it } from 'vitest';
import { assertFreshStudyOrigin, studyStats } from './large-library-study';
it('reports bounded empirical sample percentiles without inventing a zero measurement', () => {
  expect(studyStats([4, 1, 2])).toMatchObject({
    n: 3,
    medianMs: 2,
    p95Ms: 4,
    maximumMs: 4,
  });
  for (const samples of [[], [NaN], [-1]])
    expect(() => studyStats(samples)).toThrow('样本');
});
it('refuses existing localStorage, existing databases and unavailable inventory without deleting them', async () => {
  const factory = new IDBFactory();
  await expect(
    assertFreshStudyOrigin(factory, { length: 0 }),
  ).resolves.toBeUndefined();
  await expect(assertFreshStudyOrigin(factory, { length: 1 })).rejects.toThrow(
    '空白',
  );
  const request = factory.open('retained', 1);
  await new Promise<void>((resolve) => {
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  });
  await expect(assertFreshStudyOrigin(factory, { length: 0 })).rejects.toThrow(
    '已有数据库',
  );
  expect(await factory.databases()).toEqual([{ name: 'retained', version: 1 }]);
  await expect(assertFreshStudyOrigin(undefined, null)).rejects.toThrow('空白');
});
