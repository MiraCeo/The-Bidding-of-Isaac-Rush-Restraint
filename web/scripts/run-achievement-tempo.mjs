import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allocateTempoRun, tempoPlan } from './achievement-tempo-plan.mjs';
const root = fileURLToPath(new URL('..', import.meta.url)),
  purpose = process.argv[2] ?? 'pilot';
const directory = allocateTempoRun(root, purpose),
  blocks = purpose === 'pilot' ? 1 : tempoPlan.blocks;
console.log(`定向成就节奏研究：${directory}`);
for (let block = 0; block < blocks; block++) {
  console.log(`开始 ${purpose} block ${block + 1}/${blocks}`);
  const result = spawnSync(
    process.execPath,
    [
      resolve(root, 'node_modules/vitest/vitest.mjs'),
      'run',
      'lib/ui/achievements/tempo-study.report.test.ts',
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
        ACHIEVEMENT_TEMPO: '1',
        ACHIEVEMENT_TEMPO_DIR: directory,
        ACHIEVEMENT_TEMPO_BLOCK: String(block),
      },
    },
  );
  const log = (result.stdout ?? '') + (result.stderr ?? '');
  writeFileSync(resolve(directory, `runner-${block}.log`), log, { flag: 'wx' });
  process.stdout.write(log);
  if (result.error || result.status !== 0) {
    writeFileSync(
      resolve(directory, 'status.json'),
      JSON.stringify({
        status: 'failed',
        block,
        error: String(result.error ?? ''),
        exitCode: result.status,
      }) + '\n',
      { flag: 'wx' },
    );
    process.exitCode = 1;
    break;
  }
  if (block === blocks - 1)
    writeFileSync(
      resolve(directory, 'status.json'),
      JSON.stringify({
        status: 'completed',
        blocks,
        matches:
          blocks *
          (purpose === 'pilot' ? 1 : tempoPlan.steps) *
          tempoPlan.scenarios.length *
          tempoPlan.policies.length,
      }) + '\n',
      { flag: 'wx' },
    );
}
