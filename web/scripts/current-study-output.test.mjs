import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  allocateStudyRun,
  assertStudyRun,
  writeStudyJson,
} from './current-study-output.mjs';
it('allocates independent bounded study directories and refuses overwrite, traversal and unknown purposes', () => {
  const web = fileURLToPath(new URL('..', import.meta.url));
  mkdirSync(resolve(web, 'work'), { recursive: true });
  // Test outputs remain inside the named workspace; no recursive cleanup.
  const scratch = mkdtempSync(resolve(web, 'work/current-study-output-test-'));
  const a = allocateStudyRun(scratch, 'pilot'),
    b = allocateStudyRun(scratch, 'pilot');
  expect(a).not.toBe(b);
  expect(assertStudyRun(scratch, a).purpose).toBe('pilot');
  writeStudyJson(scratch, a, 'summary.json', { n: 150 });
  expect(() => writeStudyJson(scratch, a, 'summary.json', { n: 0 })).toThrow();
  expect(JSON.parse(readFileSync(resolve(a, 'summary.json'), 'utf8'))).toEqual({
    n: 150,
  });
  expect(() => writeStudyJson(scratch, a, '../escape.json', {})).toThrow();
  expect(() => writeStudyJson(scratch, a, 'run.json', {})).toThrow();
  expect(() => assertStudyRun(scratch, resolve(scratch, 'other'))).toThrow();
  expect(() => allocateStudyRun(scratch, 'unknown')).toThrow();
});
