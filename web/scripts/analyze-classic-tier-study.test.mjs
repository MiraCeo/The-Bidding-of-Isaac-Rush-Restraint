import { expect, it } from 'vitest';
import {
  blockBootstrap,
  validateClassicRows,
} from './analyze-classic-tier-study.mjs';

it('bootstraps seed blocks without treating repeated role matches as independent', () => {
  expect(blockBootstrap([2, 2, 2])).toEqual({
    mean: 2,
    lower: 2,
    upper: 2,
    blocks: 3,
  });
  expect(blockBootstrap([-1, 0, 1])).toEqual(blockBootstrap([-1, 0, 1]));
  expect(() => blockBootstrap([])).toThrow();
  expect(() => blockBootstrap([NaN])).toThrow();
});
it('rejects partial matrices before drawing tier conclusions', () => {
  expect(() => validateClassicRows([])).toThrow('3600');
  expect(() =>
    validateClassicRows(Array.from({ length: 3600 }, () => ({}))),
  ).toThrow();
});

it('checks every role/policy/tier cell, seed identity and paired world', () => {
  const rows = Array.from({ length: 60 }, (_, block) =>
    ['isaac', 'lost', 'azazel', 'eden', 'jacob_esau'].flatMap((role) =>
      ['pace', 'public-ai', 'explore'].flatMap((policy) =>
        ['easy', 'standard', 'hard', 'highest'].map((difficulty) => ({
          block,
          role,
          policy,
          difficulty,
          seed: (0x08010000 + Math.imul(2001 + block, 104729)) >>> 0,
          rooms: 15,
          rank: 1,
          score: 100,
          initialWorld: 'a'.repeat(64),
          traceHash: 'b'.repeat(64),
          terminalHash: 'c'.repeat(64),
          floors: [{ turns: 95 }, { turns: 95 }, { turns: 95 }],
        })),
      ),
    ),
  ).flat();
  expect(validateClassicRows(rows).size).toBe(3600);
  expect(() => validateClassicRows([rows[1], ...rows.slice(1)])).toThrow(
    'Duplicate',
  );
  expect(() =>
    validateClassicRows([{ ...rows[0], seed: 0 }, ...rows.slice(1)]),
  ).toThrow('Invalid');
  expect(() =>
    validateClassicRows([
      { ...rows[0], initialWorld: 'd'.repeat(64) },
      ...rows.slice(1),
    ]),
  ).toThrow('Unpaired');
});
