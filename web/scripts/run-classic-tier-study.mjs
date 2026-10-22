import {
  existsSync,
  lstatSync,
  realpathSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { corpusSourceProvenance } from './ledger-corpus-output.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const parent = resolve(root, 'work/0.8/classic-tier-study');
for (const path of [resolve(root, 'work'), resolve(root, 'work/0.8'), parent]) {
  if (
    existsSync(path) &&
    (lstatSync(path).isSymbolicLink() || realpathSync(path) !== path)
  )
    throw Error('Linked classic study output');
}
mkdirSync(parent, { recursive: true });
const directory = mkdtempSync(resolve(parent, 'current-'));
writeFileSync(
  resolve(directory, 'run.json'),
  JSON.stringify(
    {
      kind: 'v080-classic-tier-diagnosis',
      version: 1,
      blocks: 60,
      createdAt: new Date().toISOString(),
      seedFormula: '(0x08010000 + Math.imul(2001 + block, 104729)) >>> 0',
      blockRange: [0, 59],
      roles: ['isaac', 'lost', 'azazel', 'eden', 'jacob_esau'],
      policies: ['pace', 'public-ai', 'explore'],
      tiers: ['easy', 'standard', 'hard', 'highest'],
      source: corpusSourceProvenance(root),
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log(directory);
const result = spawnSync(
  process.execPath,
  [
    resolve(root, 'node_modules/vitest/vitest.mjs'),
    'run',
    'lib/ui/achievements/classic-tier-study.report.test.ts',
    '--maxWorkers=1',
    '--reporter=verbose',
  ],
  {
    cwd: root,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      CLASSIC_TIER_STUDY: '1',
      CLASSIC_TIER_STUDY_DIR: directory,
    },
  },
);
writeFileSync(
  resolve(directory, 'runner.log'),
  (result.stdout ?? '') + (result.stderr ?? ''),
  { flag: 'wx' },
);
console.log(result.stdout ?? '', result.stderr ?? '');
if (result.error || result.status !== 0) {
  writeFileSync(
    resolve(directory, 'failed.json'),
    JSON.stringify({
      error: String(result.error ?? ''),
      status: result.status,
    }),
    { flag: 'wx' },
  );
  process.exitCode = 1;
}
