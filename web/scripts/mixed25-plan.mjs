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
/** Public numbers, mapped strictly once by the research evaluator. Never production config. */
export const mixed25Plan = Object.freeze({
  kind: 'v081-mixed25-threshold-trial',
  version: 1,
  blocks: 6,
  games: 30,
  seedStart: 25000,
  pilotSeedStart: 24900,
  routes: ['public', 'mixed', 'collector'],
  checkpoints: [20, 25, 30],
  targets: {
    E12: 10,
    F13: 10,
    A09: 7,
    A10: 10,
    A11: 3,
    A12: 5,
    A13: 10,
    F04: 2,
    F05: 3,
    C16: 2,
    C17: 3,
    C18: 2,
    C19: 3,
    E06: 6,
    E07: 10,
    C11: 12,
    C12: 24,
    E16: 2,
    E17: 3,
    E21: 2,
    E22: 3,
    D07: 3,
    D08: 6,
    D10: 2,
    D11: 3,
    D05: 1500,
    D18: 1500,
    D21: 1500,
  },
  scope:
    'same-trajectory current/candidate readouts; single real profile, unlocked roles only; first20=10classic+10survival, 21-30 target remaining gaps; no production or migration changes',
});
export function mixed25Seed(block, index, pilot = false) {
  if (
    !Number.isInteger(block) ||
    block < 0 ||
    block >= (pilot ? 1 : 6) ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= (pilot ? 4 : 30)
  )
    throw Error('Invalid mixed25 coordinate');
  return (
    (0x08010000 +
      Math.imul((pilot ? 24900 : 25000) + block * 30 + index + 1, 104729)) >>>
    0
  );
}
export function allocateMixed25(root, purpose) {
  if (!['pilot', 'main'].includes(purpose)) throw Error('Use pilot or main');
  root = realpathSync(root);
  const parent = resolve(root, 'work/0.8/mixed25');
  for (const p of [resolve(root, 'work'), resolve(root, 'work/0.8'), parent])
    if (
      existsSync(p) &&
      (lstatSync(p).isSymbolicLink() || realpathSync(p) !== p)
    )
      throw Error('Linked mixed25 output');
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(resolve(parent, purpose + '-'));
  writeFileSync(
    resolve(directory, 'run.json'),
    JSON.stringify(
      {
        kind: mixed25Plan.kind,
        purpose,
        plan: mixed25Plan,
        createdAt: new Date().toISOString(),
        node: process.version,
        source: corpusSourceProvenance(root),
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  return directory;
}
export function assertMixed25(root, directory) {
  const p = resolve(directory);
  if (
    dirname(p) !== resolve(realpathSync(root), 'work/0.8/mixed25') ||
    !/^(pilot|main)-[A-Za-z0-9]+$/.test(basename(p)) ||
    lstatSync(p).isSymbolicLink() ||
    realpathSync(p) !== p
  )
    throw Error('Invalid mixed25 directory');
  const m = JSON.parse(readFileSync(resolve(p, 'run.json'), 'utf8'));
  if (
    m.kind !== mixed25Plan.kind ||
    !['pilot', 'main'].includes(m.purpose) ||
    JSON.stringify(m.plan) !== JSON.stringify(mixed25Plan)
  )
    throw Error('Unknown mixed25 marker');
  return m;
}
