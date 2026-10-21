import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { allocateTargeted25, assertTargeted25 } from './targeted25-plan.mjs';
import { corpusSourceProvenance } from './ledger-corpus-output.mjs';
const root = fileURLToPath(new URL('..', import.meta.url)),
  purpose = process.argv[2] ?? 'pilot';
const directory = process.argv[3]
    ? resolve(process.argv[3])
    : allocateTargeted25(root, purpose),
  marker = assertTargeted25(root, directory),
  hash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
if (marker.purpose !== purpose) throw Error('Wrong targeted25 purpose');
console.log(`定向补缺配对试验：${directory}`);
for (let block = 0; block < (purpose === 'pilot' ? 1 : 6); block++) {
  if (
    JSON.stringify(corpusSourceProvenance(root)) !==
    JSON.stringify(marker.source)
  )
    throw Error('Targeted25 source drift');
  const done = resolve(directory, `done-${block}.json`);
  if (existsSync(done)) {
    const d = JSON.parse(readFileSync(done, 'utf8'));
    for (const [name, sha] of Object.entries(d.outputs))
      if (hash(resolve(directory, name)) !== sha)
        throw Error('Changed completed block');
    continue;
  }
  const names = [
    `rows-${block}.json`,
    `profiles-${block}.json`,
    `witness-${block}.jsonl`,
    `block-${block}.json`,
  ];
  for (const name of [...names, `runner-${block}.log`])
    if (existsSync(resolve(directory, name)))
      renameSync(
        resolve(directory, name),
        resolve(directory, `interrupted-${Date.now()}-${name}`),
      );
  const result = spawnSync(
    process.execPath,
    [
      resolve(root, 'node_modules/vitest/vitest.mjs'),
      'run',
      'lib/ui/achievements/targeted25.report.test.ts',
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
        TARGETED25: '1',
        TARGETED25_DIR: directory,
        TARGETED25_BLOCK: String(block),
      },
    },
  );
  const log = (result.stdout ?? '') + (result.stderr ?? '');
  writeFileSync(resolve(directory, `runner-${block}.log`), log, { flag: 'wx' });
  process.stdout.write(log);
  if (result.error || result.status !== 0) {
    process.exitCode = 1;
    break;
  }
  writeFileSync(
    done,
    JSON.stringify({
      block,
      outputs: Object.fromEntries(
        names.map((n) => [n, hash(resolve(directory, n))]),
      ),
    }) + '\n',
    { flag: 'wx' },
  );
  if (block === (purpose === 'pilot' ? 0 : 5))
    writeFileSync(
      resolve(directory, 'status.json'),
      JSON.stringify({
        status: 'completed',
        blocks: block + 1,
        matches: (block + 1) * (purpose === 'pilot' ? 4 : 30) * 1,
      }) + '\n',
      { flag: 'wx' },
    );
}
