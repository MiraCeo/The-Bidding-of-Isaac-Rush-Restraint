import { expect, it } from 'vitest';
import { generateLargeLibraryCorpus } from './large-library-fixtures';
import { parseSurvivalReplay } from '../survival-persistence';
it('builds genuinely played, distinct mixed-mode records with a formal 35-room anchor', async () => {
  const corpus = await generateLargeLibraryCorpus(4);
  expect(corpus.prepared.map((p) => p.entry.mode)).toEqual([
    'classic',
    'survival',
    'classic',
    'survival',
  ]);
  expect(new Set(corpus.prepared.map((p) => p.entry.key)).size).toBe(4);
  expect(corpus.prepared.map((p) => p.entry.seed)).toEqual([
    42, 3, 43, 20262001,
  ]);
  expect(parseSurvivalReplay(corpus.anchor.raw).replay.rooms).toHaveLength(35);
  expect(corpus.markerProof.amounts.length).toBeGreaterThan(0);
}, 20000);
it('bounds the opt-in corpus without touching user storage', async () => {
  for (const n of [0, 3, 101])
    await expect(generateLargeLibraryCorpus(n)).rejects.toThrow('偶数');
});
