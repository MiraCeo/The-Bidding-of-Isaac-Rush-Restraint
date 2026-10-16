import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allocateCorpusRun, writeCorpusJson } from './ledger-corpus-output.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const directory = allocateCorpusRun(root, 'capacity');
console.log(`schema6容量／核验测量输出：${directory}`);
const result = spawnSync(
  process.execPath,
  [
    resolve(root, 'node_modules/vitest/vitest.mjs'),
    'run',
    'lib/ui/achievements/closeout-capacity.report.test.ts',
    '--maxWorkers=1',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      LEDGER_CAPACITY_REPORT: '1',
      LEDGER_CAPACITY_RUN_DIR: directory,
    },
  },
);
const code = result.status ?? 1;
writeCorpusJson(root, directory, 'status.json', {
  status: code === 0 ? 'completed' : 'failed',
  exitCode: code,
  error: result.error?.message ?? null,
  signal: result.signal,
  scope:
    'Node/in-memory schema6 capacity and timings; no browser or physical-quota acceptance.',
});
process.exitCode = code;
