import { expect, it } from 'vitest';
import { mixed25Distribution, summarizeMixed25 } from './analyze-mixed25.mjs';
it('retains absent/full-completion censoring and does not substitute badge percentage for full achievement', () => {
  const catalog = [
    {
      id: 'one',
      number: 'A01',
      name: 'test',
      scope: 'shared',
      kind: 'cumulative',
      target: 20,
      candidateTarget: 10,
    },
  ];
  const rows = [
    {
      block: 0,
      route: 'public',
      index: 20,
      actualEarned: [],
      candidateEarned: ['one'],
      candidateMissing: [],
      progress: { one: 10 },
      choice: { mode: 'classic', difficulty: 'standard', role: 'isaac' },
    },
  ];
  const s = summarizeMixed25(rows, catalog);
  expect(s.checkpoints[0].candidateCount.mean).toBe(1);
  expect(s.checkpoints[0].candidateComplete).toBe(0);
  expect(s.endpoints[0].firstCandidateComplete).toBeNull();
  expect(s.checkpoints[1].paths).toBe(0);
});
it('uses exact distribution with null absent observations rather than zeros', () => {
  expect(mixed25Distribution([])).toEqual({
    n: 0,
    min: null,
    max: null,
    mean: null,
    median: null,
  });
  expect(mixed25Distribution([100, 110])).toMatchObject({
    median: 105,
    mean: 105,
  });
  expect(() => mixed25Distribution([Infinity])).toThrow();
});
