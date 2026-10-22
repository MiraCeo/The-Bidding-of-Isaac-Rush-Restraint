import {
  existsSync,
  lstatSync,
  realpathSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { corpusSourceProvenance } from './ledger-corpus-output.mjs';
import { mixed25Plan, mixed25Seed } from './mixed25-plan.mjs';
import { createHash } from 'node:crypto';
/** Public numbers, mapped strictly once by the research evaluator. Never production config. */
export const targeted25Plan = Object.freeze({
  kind: 'v081-targeted25-public-strategy-trial',
  version: 2,
  blocks: 6,
  games: 30,
  seedStart: 25000,
  pilotSeedStart: 24900,
  routes: ['targeted'],
  checkpoints: [20, 25, 30],
  targets: mixed25Plan.targets,
  baseline: 'main-0HD6uI',
  parameters: {
    candidateLiquidity: [0.4, 0.5, 0.6, 0.75, 1],
    scoreCostPerRemainingRoom: 32,
    pilotGames: 4,
    mainGames: 30,
    first20: '10classic+10survival',
    intervention: 'public-score-plus-targeted-actions-1',
  },
  scope:
    'same-trajectory current/candidate readouts; single real profile, unlocked roles only; first20=10classic+10survival, 21-30 target remaining gaps; no production or migration changes',
});
export const targeted25Seed = mixed25Seed;
export function allocateTargeted25(root, purpose) {
  if (!['pilot', 'main'].includes(purpose)) throw Error('Use pilot or main');
  root = realpathSync(root);
  const parent = resolve(root, 'work/0.8/targeted25');
  for (const p of [resolve(root, 'work'), resolve(root, 'work/0.8'), parent])
    if (
      existsSync(p) &&
      (lstatSync(p).isSymbolicLink() || realpathSync(p) !== p)
    )
      throw Error('Linked targeted25 output');
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(resolve(parent, purpose + '-'));
  writeFileSync(
    resolve(directory, 'run.json'),
    JSON.stringify(
      {
        kind: targeted25Plan.kind,
        purpose,
        plan: targeted25Plan,
        createdAt: new Date().toISOString(),
        node: process.version,
        source: corpusSourceProvenance(root),
        baselineHashes: targeted25BaselineHashes(root),
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  return directory;
}
export function assertTargeted25(root, directory) {
  const p = resolve(directory);
  if (
    dirname(p) !== resolve(realpathSync(root), 'work/0.8/targeted25') ||
    !/^(pilot|main)-[A-Za-z0-9]+$/.test(basename(p)) ||
    lstatSync(p).isSymbolicLink() ||
    realpathSync(p) !== p
  )
    throw Error('Invalid targeted25 directory');
  const m = JSON.parse(readFileSync(resolve(p, 'run.json'), 'utf8'));
  if (
    m.kind !== targeted25Plan.kind ||
    !['pilot', 'main'].includes(m.purpose) ||
    JSON.stringify(m.plan) !== JSON.stringify(targeted25Plan)
  )
    throw Error('Unknown targeted25 marker');
  return m;
}
export function targeted25BaselineHashes(root) {
  const directory = resolve(root, 'work/0.8/mixed25', targeted25Plan.baseline);
  const names = [
    'run.json',
    'status.json',
    'analysis.json',
    ...Array.from({ length: 6 }, (_, b) => [
      `rows-${b}.json`,
      `profiles-${b}.json`,
      `block-${b}.json`,
      `witness-${b}.jsonl`,
      `done-${b}.json`,
    ]).flat(),
  ];
  return Object.fromEntries(
    names.map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(resolve(directory, name)))
        .digest('hex'),
    ]),
  );
}
