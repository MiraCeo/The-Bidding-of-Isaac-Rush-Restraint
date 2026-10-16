import { it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import {
  allocateCorpusRun,
  assertCorpusRun,
  writeCorpusJson,
} from './ledger-corpus-output.mjs';
const roots = [];
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'isaac-corpus-output-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (
      !root.startsWith(resolve(tmpdir()) + sep) ||
      !root.split(sep).at(-1).startsWith('isaac-corpus-output-')
    )
      throw Error('Not an owned test root');
    rmSync(root, { recursive: true, force: true });
  }
});
it('allocates distinct output directories and never replaces a prior manifest or the run marker', () => {
  const root = fixture(),
    a = allocateCorpusRun(root),
    b = allocateCorpusRun(root);
  expect(a).not.toBe(b);
  expect(assertCorpusRun(root, a)).toBe(a);
  writeCorpusJson(root, a, 'manifest.json', { kept: true });
  expect(() =>
    writeCorpusJson(root, a, 'manifest.json', { kept: false }),
  ).toThrow();
  expect(() => writeCorpusJson(root, a, 'run.json', {})).toThrow();
  expect(JSON.parse(readFileSync(resolve(a, 'manifest.json'), 'utf8'))).toEqual(
    { kept: true },
  );
});
it('rejects historical, outside, unallocated and traversal paths without touching old reports', () => {
  const root = fixture(),
    old = resolve(root, 'work/v050-ledger');
  mkdirSync(old, { recursive: true });
  writeFileSync(resolve(old, 'growth-capacity.json'), 'old-proof');
  const current = allocateCorpusRun(root);
  for (const directory of [
    old,
    root,
    resolve(root, 'work/v05-closeout-ledger/corpus-missing'),
  ])
    expect(() =>
      writeCorpusJson(root, directory, 'manifest.json', {}),
    ).toThrow();
  for (const name of [
    '../manifest.json',
    'nested/manifest.json',
    'C:\\outside.json',
    '..json',
  ])
    expect(() => writeCorpusJson(root, current, name, {})).toThrow();
  expect(readFileSync(resolve(old, 'growth-capacity.json'), 'utf8')).toBe(
    'old-proof',
  );
  expect(existsSync(resolve(root, 'manifest.json'))).toBe(false);
});

it('rejects a redirected output parent before creating any run outside the workspace', () => {
  const root = fixture(),
    other = fixture();
  mkdirSync(resolve(root, 'work'));
  symlinkSync(
    other,
    resolve(root, 'work/v05-closeout-ledger'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  expect(() => allocateCorpusRun(root)).toThrow('linked parent');
  expect(readdirSync(other)).toEqual([]);
});

it('rejects unknown run markers instead of treating arbitrary directories as writable report runs', () => {
  const root = fixture(),
    current = allocateCorpusRun(root);
  writeFileSync(
    resolve(current, 'run.json'),
    JSON.stringify({
      kind: 'schema6-corpus-run',
      version: 2,
      id: 'unsupported',
    }),
  );
  expect(() => writeCorpusJson(root, current, 'manifest.json', {})).toThrow(
    'Unknown corpus run marker',
  );
  expect(existsSync(resolve(current, 'manifest.json'))).toBe(false);
});
