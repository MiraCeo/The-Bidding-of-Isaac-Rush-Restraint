import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allocateCorpusRun, writeCorpusJson } from './ledger-corpus-output.mjs';
const phase = process.argv[2];
if (!['baseline', 'optimized'].includes(phase) || process.argv.length !== 3)
  throw Error('Use npm run report:profile:performance -- baseline|optimized');
const root = fileURLToPath(new URL('..', import.meta.url)),
  directory = allocateCorpusRun(root, 'capacity');
console.log(`独立档案性能对照 ${phase}：${directory}`);
const result = spawnSync(
  process.execPath,
  [
    resolve(root, 'node_modules/vitest/vitest.mjs'),
    'run',
    'lib/ui/achievements/profile-performance.report.test.ts',
    '--maxWorkers=1',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      PROFILE_PERFORMANCE_REPORT: '1',
      PROFILE_PERFORMANCE_PHASE: phase,
      PROFILE_PERFORMANCE_RUN_DIR: directory,
    },
  },
);
writeCorpusJson(root, directory, 'status.json', {
  status: result.status === 0 ? 'completed' : 'failed',
  phase,
  exitCode: result.status ?? 1,
  error: result.error?.message ?? null,
});
process.exitCode = result.status ?? 1;
