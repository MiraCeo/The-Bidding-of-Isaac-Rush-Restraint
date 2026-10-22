import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  existsSync,
  lstatSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { resolve, dirname, basename, sep } from 'node:path';
import { corpusSourceProvenance } from './ledger-corpus-output.mjs';
export { corpusSourceProvenance };
export const balanceStudyPlan = Object.freeze({
  pilot: { steps: 1, stepsPerBatch: 1, batches: 1, seedStart: 0 },
  main: { steps: 10, stepsPerBatch: 2, batches: 5, seedStart: 100 },
  campaign: {
    steps: 20,
    stepsPerBatch: 5,
    batches: 4,
    seedStart: 1000,
    repetitions: 3,
  },
});
export function allocateBalanceRun(webRoot, purpose) {
  if (!['pilot', 'main', 'campaign', 'analysis'].includes(purpose))
    throw Error('Unknown balance purpose');
  const root = realpathSync(webRoot),
    parent = resolve(root, 'work/0.8/balance-study');
  for (const p of [resolve(root, 'work'), resolve(root, 'work/0.8'), parent])
    if (
      existsSync(p) &&
      (lstatSync(p).isSymbolicLink() || realpathSync(p) !== p)
    )
      throw Error('Linked balance output parent');
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(resolve(parent, purpose + '-'));
  writeFileSync(
    resolve(directory, 'run.json'),
    JSON.stringify(
      {
        kind: 'v080-ai-achievement-balance',
        version: 1,
        purpose,
        createdAt: new Date().toISOString(),
        plan: balanceStudyPlan,
        source: corpusSourceProvenance(root),
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  return directory;
}
export function assertBalanceRun(webRoot, directory) {
  const root = realpathSync(webRoot),
    target = resolve(directory),
    parent = resolve(root, 'work/0.8/balance-study');
  if (
    dirname(target) !== parent ||
    !/^(pilot|main|campaign|analysis)-[A-Za-z0-9-]+$/.test(basename(target)) ||
    !target.startsWith(root + sep) ||
    lstatSync(target).isSymbolicLink() ||
    realpathSync(target) !== target
  )
    throw Error('Invalid balance output directory');
  const run = JSON.parse(readFileSync(resolve(target, 'run.json'), 'utf8'));
  if (
    run.kind !== 'v080-ai-achievement-balance' ||
    run.version !== 1 ||
    !['pilot', 'main', 'campaign', 'analysis'].includes(run.purpose) ||
    JSON.stringify(run.plan) !== JSON.stringify(balanceStudyPlan)
  )
    throw Error('Unknown balance marker/plan');
  return run;
}
export function writeBalanceJson(webRoot, directory, name, value) {
  assertBalanceRun(webRoot, directory);
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.json$/.test(name) || name === 'run.json')
    throw Error('Invalid balance filename');
  writeFileSync(
    resolve(directory, name),
    JSON.stringify(value, null, 2) + '\n',
    { flag: 'wx' },
  );
}
