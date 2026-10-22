import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allocateCorpusRun, writeCorpusJson } from './ledger-corpus-output.mjs';

if (
  process.argv.length > 3 ||
  (process.argv[2] && process.argv[2] !== '--schema8')
)
  throw Error('Only optional --schema8 is supported');
const schema = process.argv[2] === '--schema8' ? 8 : 6;
const root = fileURLToPath(new URL('..', import.meta.url));
const directory = allocateCorpusRun(root);
console.log(`现行schema${schema}语料输出：${directory}`);
const result = spawnSync(
  process.execPath,
  [
    resolve(root, 'node_modules/vitest/vitest.mjs'),
    'run',
    'lib/ui/achievements/closeout-corpus.report.test.ts',
    '--maxWorkers=1',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      LEDGER_REPORT_SCHEMA: String(schema),
      LEDGER_CORPUS_REPORT: '1',
      LEDGER_CORPUS_RUN_DIR: directory,
    },
  },
);
const code = result.status ?? 1;
writeCorpusJson(root, directory, 'status.json', {
  schema,
  status: code === 0 ? 'completed' : 'failed',
  exitCode: code,
  error: result.error?.message ?? null,
  signal: result.signal,
  scope:
    'Corpus generation and validity checks only; no capacity/performance acceptance.',
});
process.exitCode = code;
