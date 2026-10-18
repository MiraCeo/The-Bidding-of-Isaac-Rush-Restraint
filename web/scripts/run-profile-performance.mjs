import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allocateCorpusRun, writeCorpusJson } from './ledger-corpus-output.mjs';
const phase = process.argv[2];
if (
  !['baseline', 'optimized', 'repeat'].includes(phase) ||
  (process.argv.length !== 3 &&
    !(process.argv.length === 4 && process.argv[3] === '--schema8'))
)
  throw Error(
    'Use npm run report:profile:performance -- baseline|optimized|repeat [--schema8]',
  );
const schema = process.argv[3] === '--schema8' ? 8 : 6;
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
      LEDGER_REPORT_SCHEMA: String(schema),
      PROFILE_PERFORMANCE_REPORT: '1',
      PROFILE_PERFORMANCE_PHASE: phase,
      PROFILE_PERFORMANCE_RUN_DIR: directory,
    },
  },
);
writeCorpusJson(root, directory, 'status.json', {
  schema,
  status: result.status === 0 ? 'completed' : 'failed',
  phase,
  exitCode: result.status ?? 1,
  error: result.error?.message ?? null,
});
process.exitCode = result.status ?? 1;
