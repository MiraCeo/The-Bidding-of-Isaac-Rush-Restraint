import {
  existsSync,
  lstatSync,
  realpathSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { corpusSourceProvenance } from './ledger-corpus-output.mjs';
export const audit117Plan = Object.freeze({
  kind: 'v081-all117-audit',
  version: 1,
  matrixBlocks: 4,
  matrixSeedStart: 22000,
  naturalSeedStart: 23000,
  naturalBlocks: 6,
  additionalNaturalGames: 20,
  edgeBlocks: 6,
  edgeGames: 50,
  policies: ['pace', 'public-ai', 'explore'],
  difficulties: ['easy', 'standard', 'hard', 'highest'],
  roles: ['isaac', 'lost', 'azazel', 'eden', 'jacob_esau'],
  baseline: 'work/0.8/achievement-tempo/main-iyi76B',
  confirmation: 'work/0.8/achievement-tempo/confirm-IwFOPp',
  scope:
    'research only; 480 fixed-role matrix games + 360 natural continuation + 300 public edge games; original thresholds unchanged',
});
export function audit117Seed(block, index, kind) {
  if (
    !Number.isInteger(block) ||
    block < 0 ||
    !Number.isInteger(index) ||
    index < 0
  )
    throw Error('Invalid audit seed');
  let n;
  if (kind === 'matrix' && block < 4 && index === 0) n = 22000 + block;
  else if (kind === 'long' && block < 6 && index < 50)
    n =
      index < 20
        ? 12000 + block * 20 + index
        : index < 30
          ? 20000 + block * 10 + index - 20
          : 23000 + block * 20 + index - 30;
  else if (kind === 'pilot' && block === 0 && index < 2) n = 21900 + index;
  else throw Error('Invalid audit coordinate');
  return (0x08010000 + Math.imul(n + 1, 104729)) >>> 0;
}
export function audit117Tasks() {
  return [
    'pilot',
    ...Array.from({ length: 4 }, (_, i) => `matrix-${i}`),
    ...Array.from({ length: 6 }, (_, i) => `natural-${i}`),
    ...Array.from({ length: 6 }, (_, i) => `edge-${i}`),
    'inventory',
  ];
}
export function allocateAudit117(root) {
  root = realpathSync(root);
  const parent = resolve(root, 'work/0.8/audit117');
  for (const p of [resolve(root, 'work'), resolve(root, 'work/0.8'), parent])
    if (
      existsSync(p) &&
      (lstatSync(p).isSymbolicLink() || realpathSync(p) !== p)
    )
      throw Error('Linked audit output');
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(resolve(parent, 'audit-'));
  writeFileSync(
    resolve(directory, 'run.json'),
    JSON.stringify(
      {
        kind: audit117Plan.kind,
        plan: audit117Plan,
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
export function assertAudit117(root, directory) {
  directory = resolve(directory);
  if (
    dirname(directory) !== resolve(realpathSync(root), 'work/0.8/audit117') ||
    !/^audit-[A-Za-z0-9]+$/.test(basename(directory)) ||
    lstatSync(directory).isSymbolicLink() ||
    realpathSync(directory) !== directory
  )
    throw Error('Invalid audit directory');
  const marker = JSON.parse(
    readFileSync(resolve(directory, 'run.json'), 'utf8'),
  );
  if (
    marker.kind !== audit117Plan.kind ||
    JSON.stringify(marker.plan) !== JSON.stringify(audit117Plan)
  )
    throw Error('Unknown audit marker');
  return marker;
}
