import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  allocateBalanceRun,
  balanceStudyPlan,
  writeBalanceJson,
} from './balance-study-output.mjs';
const root = fileURLToPath(new URL('..', import.meta.url)),
  purpose = process.argv[2] ?? 'pilot';
if (!Object.hasOwn(balanceStudyPlan, purpose))
  throw Error('Use pilot, main or campaign');
const directory = allocateBalanceRun(root, purpose);
console.log(`独立0.8 AI与成就研究：${directory}`);
for (let batch = 0; batch < balanceStudyPlan[purpose].batches; batch++) {
  console.log(
    `开始${purpose}批次${batch + 1}/${balanceStudyPlan[purpose].batches}`,
  );
  const result = spawnSync(
    process.execPath,
    [
      resolve(root, 'node_modules/vitest/vitest.mjs'),
      'run',
      'lib/ui/achievements/balance-study.report.test.ts',
      '--maxWorkers=1',
      '--reporter=verbose',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
      env: {
        ...process.env,
        BALANCE_STUDY: '1',
        BALANCE_STUDY_DIR: directory,
        BALANCE_STUDY_BATCH: String(batch),
      },
    },
  );
  const log = (result.stdout ?? '') + (result.stderr ?? '');
  writeFileSync(resolve(directory, `batch-${batch}.log`), log, { flag: 'wx' });
  process.stdout.write(log);
  if (result.status !== 0) {
    writeBalanceJson(root, directory, 'status.json', {
      status: 'failed',
      batch,
      exitCode: result.status,
      error: result.error?.message ?? null,
      signal: result.signal,
    });
    process.exitCode = result.status ?? 1;
    break;
  }
  if (batch === balanceStudyPlan[purpose].batches - 1)
    writeBalanceJson(root, directory, 'status.json', {
      status: 'completed',
      batches: batch + 1,
      scope:
        'scripted Node study, not human telemetry or browser acceptance; no parameter changes',
    });
}
