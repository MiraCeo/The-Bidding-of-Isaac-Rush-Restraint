import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  allocateAudit117,
  assertAudit117,
  audit117Tasks,
} from './audit117-plan.mjs';
import { corpusSourceProvenance } from './ledger-corpus-output.mjs';
const root = fileURLToPath(new URL('..', import.meta.url)),
  directory = process.argv[2]
    ? resolve(process.argv[2])
    : allocateAudit117(root);
const marker = assertAudit117(root, directory),
  hash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
console.log(`117项补测：${directory}`);
for (const task of audit117Tasks()) {
  if (
    JSON.stringify(corpusSourceProvenance(root)) !==
    JSON.stringify(marker.source)
  )
    throw Error('Source drift');
  const done = resolve(directory, `done-${task}.json`);
  if (existsSync(done)) {
    const info = JSON.parse(readFileSync(done, 'utf8'));
    for (const [file, sha] of Object.entries(info.outputs))
      if (hash(resolve(directory, file)) !== sha)
        throw Error('Changed completed audit task');
    console.log('验证并跳过已完成任务 ' + task);
    continue;
  }
  const names =
    task === 'inventory'
      ? ['inventory.json']
      : [
          `rows-${task}.json`,
          `profiles-${task}.json`,
          `witness-${task}.jsonl`,
          ...(task === 'pilot'
            ? ['pilot-edge-0.json', 'pilot-edge-1.json']
            : []),
        ];
  for (const name of [...names, `runner-${task}.log`])
    if (existsSync(resolve(directory, name)))
      renameSync(
        resolve(directory, name),
        resolve(directory, `interrupted-${Date.now()}-${name}`),
      );
  console.log('开始 ' + task);
  const result = spawnSync(
    process.execPath,
    [
      resolve(root, 'node_modules/vitest/vitest.mjs'),
      'run',
      'lib/ui/achievements/audit117.report.test.ts',
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
        AUDIT117: '1',
        AUDIT117_DIR: directory,
        AUDIT117_TASK: task,
      },
    },
  );
  const log = (result.stdout ?? '') + (result.stderr ?? '');
  writeFileSync(resolve(directory, `runner-${task}.log`), log, { flag: 'wx' });
  process.stdout.write(log);
  if (result.error || result.status !== 0) {
    console.log('任务未完成，保留证据；按同目录可恢复。');
    process.exitCode = 1;
    break;
  }
  const outputs = Object.fromEntries(
    names.map((name) => [name, hash(resolve(directory, name))]),
  );
  writeFileSync(
    done,
    JSON.stringify({ task, outputs, completedAt: new Date().toISOString() }) +
      '\n',
    { flag: 'wx' },
  );
  if (task === 'inventory')
    writeFileSync(
      resolve(directory, 'status.json'),
      JSON.stringify({
        status: 'completed',
        newResearchMatches: 1140,
        pilotExcluded: 26,
      }) + '\n',
      { flag: 'wx' },
    );
}
