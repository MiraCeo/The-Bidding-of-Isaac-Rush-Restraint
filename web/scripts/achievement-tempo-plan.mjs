import {
  mkdirSync,
  mkdtempSync,
  existsSync,
  lstatSync,
  realpathSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { corpusSourceProvenance } from './ledger-corpus-output.mjs';

/** Preregistered sensitivity analysis, not an approved change to the catalog. */
export const tempoPlan = Object.freeze({
  kind: 'v081-targeted-achievement-tempo',
  version: 1,
  blocks: 6,
  steps: 20,
  seedStart: 12000,
  pilotSeedStart: 11900,
  policies: ['pace', 'public-ai', 'explore'],
  scenarios: [
    ...['easy', 'standard', 'hard', 'highest'].map((difficulty) => ({
      id: `population-${difficulty}`,
      mode: 'classic',
      aiPolicy: 'classic-population-1',
      difficulty,
    })),
    {
      id: 'legacy-standard',
      mode: 'classic',
      aiPolicy: 'classic-tiered-1',
      difficulty: 'standard',
    },
    {
      id: 'survival-standard',
      mode: 'survival',
      aiPolicy: 'role-aware-1',
      difficulty: 'standard',
    },
  ],
  thresholds: [1, 5, 10, 15, 20, 25, 30, 40, 50],
  current: { allIn: [1, 5, 10], boss: [1, 5, 15] },
  candidates: {
    allIn: [
      [1, 5, 10],
      [1, 10, 20],
      [1, 10, 30],
      [1, 15, 40],
    ],
    boss: [
      [1, 5, 15],
      [1, 10, 25],
      [1, 10, 30],
      [1, 15, 40],
    ],
  },
  roleSelection: 'rotate-actually-unlocked-roles',
  scope:
    'scripted new profiles; natural role/trajectory divergence; no human probability or threshold change',
});
export function tempoSeed(block, step, purpose = 'main') {
  if (
    !['pilot', 'main'].includes(purpose) ||
    !Number.isInteger(block) ||
    block < 0 ||
    block >= (purpose === 'pilot' ? 1 : tempoPlan.blocks) ||
    !Number.isInteger(step) ||
    step < 0 ||
    step >= (purpose === 'pilot' ? 1 : tempoPlan.steps)
  )
    throw Error('Invalid tempo seed coordinate');
  const index =
    (purpose === 'pilot' ? tempoPlan.pilotSeedStart : tempoPlan.seedStart) +
    block * tempoPlan.steps +
    step;
  return (0x08010000 + Math.imul(index + 1, 104729)) >>> 0;
}
export function allocateTempoRun(webRoot, purpose) {
  if (!['pilot', 'main'].includes(purpose)) throw Error('Use pilot or main');
  const root = realpathSync(webRoot),
    parent = resolve(root, 'work/0.8/achievement-tempo');
  for (const p of [resolve(root, 'work'), resolve(root, 'work/0.8'), parent])
    if (
      existsSync(p) &&
      (lstatSync(p).isSymbolicLink() || realpathSync(p) !== p)
    )
      throw Error('Linked tempo output');
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(resolve(parent, purpose + '-'));
  writeFileSync(
    resolve(directory, 'run.json'),
    JSON.stringify(
      {
        kind: tempoPlan.kind,
        version: 1,
        purpose,
        appVersion: JSON.parse(
          readFileSync(resolve(root, 'package.json'), 'utf8'),
        ).version,
        plan: tempoPlan,
        createdAt: new Date().toISOString(),
        node: process.version,
        platform: process.platform,
        source: corpusSourceProvenance(root),
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  return directory;
}
export function assertTempoRun(webRoot, directory) {
  const target = resolve(directory),
    parent = resolve(realpathSync(webRoot), 'work/0.8/achievement-tempo');
  if (
    dirname(target) !== parent ||
    !/^(pilot|main)-[A-Za-z0-9]+$/.test(basename(target)) ||
    lstatSync(target).isSymbolicLink() ||
    realpathSync(target) !== target
  )
    throw Error('Invalid tempo output directory');
  const run = JSON.parse(readFileSync(resolve(target, 'run.json'), 'utf8'));
  if (
    run.kind !== tempoPlan.kind ||
    run.version !== 1 ||
    !['pilot', 'main'].includes(run.purpose) ||
    JSON.stringify(run.plan) !== JSON.stringify(tempoPlan)
  )
    throw Error('Unknown tempo marker/plan');
  return run;
}
