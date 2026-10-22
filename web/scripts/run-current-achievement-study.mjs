import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allocateStudyRun, writeStudyJson } from './current-study-output.mjs';
const root = fileURLToPath(new URL('..', import.meta.url)),
  purpose = process.argv[2] ?? 'pilot';
if (!['pilot', 'main', 'campaign'].includes(purpose))
  throw Error('Use pilot, main or campaign');
const directory = allocateStudyRun(root, purpose);
console.log(`独立成就研究输出：${directory}`);
const batches = purpose === 'pilot' ? 1 : 4;
for (let batch = 0; batch < batches; batch++) {
  const result = spawnSync(
    process.execPath,
    [
      resolve(root, 'node_modules/vitest/vitest.mjs'),
      'run',
      'lib/ui/achievements/current-study.report.test.ts',
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
        CURRENT_ACHIEVEMENT_STUDY: '1',
        CURRENT_STUDY_DIR: directory,
        CURRENT_STUDY_BATCH: String(batch),
      },
    },
  );
  const log = (result.stdout ?? '') + (result.stderr ?? '');
  writeFileSync(resolve(directory, `batch-${batch}.log`), log, { flag: 'wx' });
  process.stdout.write(log);
  if (result.status !== 0) {
    writeStudyJson(root, directory, 'status.json', {
      status: 'failed',
      batch,
      exitCode: result.status,
      error: result.error?.message ?? null,
      signal: result.signal,
    });
    process.exitCode = result.status ?? 1;
    break;
  }
  if (batch === batches - 1)
    writeStudyJson(root, directory, 'status.json', {
      status: 'completed',
      batches,
      scope:
        'scripted Node study and memory profile campaigns only; no balance writes or browser acceptance',
    });
}
