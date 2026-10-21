import { expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  allocateBalanceRun,
  assertBalanceRun,
  writeBalanceJson,
  balanceStudyPlan,
} from './balance-study-output.mjs';
it('allocates isolated marked output and never overwrites reports or escapes its directory', () => {
  mkdirSync('work', { recursive: true });
  const root = mkdtempSync(resolve('work/balance-output-spec-'));
  const dir = allocateBalanceRun(root, 'pilot');
  expect(assertBalanceRun(root, dir).purpose).toBe('pilot');
  writeBalanceJson(root, dir, 'test.json', { keep: true });
  expect(() =>
    writeBalanceJson(root, dir, 'test.json', { keep: false }),
  ).toThrow();
  expect(JSON.parse(readFileSync(resolve(dir, 'test.json'), 'utf8'))).toEqual({
    keep: true,
  });
  expect(() => writeBalanceJson(root, dir, '../outside.json', {})).toThrow();
  expect(() => writeBalanceJson(root, dir, 'run.json', {})).toThrow();
  expect(() => assertBalanceRun(root, root)).toThrow();
  expect(() => allocateBalanceRun(root, 'unknown')).toThrow();
});
it('preregisters 120 pilot, 1200 main and 360 campaign matches in disjoint seed blocks', () => {
  expect(balanceStudyPlan.pilot.steps * 120).toBe(120);
  expect(balanceStudyPlan.main.steps * 120).toBe(1200);
  expect(balanceStudyPlan.campaign.steps * 3 * 3 * 2).toBe(360);
  const blocks = Object.values(balanceStudyPlan).map(
    (p) =>
      new Set(
        Array.from(
          { length: p.steps * (p.repetitions ?? 1) },
          (_, i) => p.seedStart + i,
        ),
      ),
  );
  for (let i = 0; i < blocks.length; i++)
    for (let j = i + 1; j < blocks.length; j++)
      expect([...blocks[i]].some((s) => blocks[j].has(s))).toBe(false);
});
