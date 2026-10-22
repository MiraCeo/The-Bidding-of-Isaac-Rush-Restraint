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
import { mistakePlan } from './classic-mistake-plan.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const parent = resolve(root, 'work/0.8/classic-mistake-study');
for (const path of [resolve(root, 'work'), resolve(root, 'work/0.8'), parent])
  if (
    existsSync(path) &&
    (lstatSync(path).isSymbolicLink() || realpathSync(path) !== path)
  )
    throw Error('Linked mistake study output');
mkdirSync(parent, { recursive: true });
const directory = mkdtempSync(resolve(parent, 'trial-'));
writeFileSync(
  resolve(directory, 'run.json'),
  JSON.stringify(
    {
      kind: 'v080-isolated-classic-quote-mistakes',
      version: 1,
      createdAt: new Date().toISOString(),
      plan: mistakePlan,
      node: process.version,
      platform: process.platform,
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
    'lib/ui/achievements/classic-mistake.report.test.ts',
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
      CLASSIC_MISTAKE_STUDY: '1',
      CLASSIC_MISTAKE_STUDY_DIR: directory,
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
    }) + '\n',
    { flag: 'wx' },
  );
  process.exitCode = 1;
}
