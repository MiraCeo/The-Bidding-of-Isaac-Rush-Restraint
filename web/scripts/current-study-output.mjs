import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  lstatSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { resolve, dirname, basename, sep } from 'node:path';
import { corpusSourceProvenance } from './ledger-corpus-output.mjs';
export { corpusSourceProvenance };
export function allocateStudyRun(webRoot, purpose) {
  if (!['pilot', 'main', 'campaign', 'analysis'].includes(purpose))
    throw Error('Unknown study purpose');
  const root = realpathSync(webRoot),
    parent = resolve(root, 'work/current-achievement-study');
  for (const path of [resolve(root, 'work'), parent])
    if (
      existsSync(path) &&
      (lstatSync(path).isSymbolicLink() || realpathSync(path) !== path)
    )
      throw Error('Linked study output parent');
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(resolve(parent, purpose + '-'));
  writeFileSync(
    resolve(directory, 'run.json'),
    JSON.stringify(
      {
        kind: 'current-achievement-difficulty',
        version: 1,
        purpose,
        createdAt: new Date().toISOString(),
        source: corpusSourceProvenance(root),
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  return directory;
}
export function assertStudyRun(webRoot, directory) {
  const root = realpathSync(webRoot),
    target = resolve(directory),
    parent = resolve(root, 'work/current-achievement-study');
  if (
    dirname(target) !== parent ||
    !/^(pilot|main|campaign|analysis)-[A-Za-z0-9-]+$/.test(basename(target)) ||
    !target.startsWith(root + sep) ||
    lstatSync(target).isSymbolicLink() ||
    realpathSync(target) !== target
  )
    throw Error('Invalid study output');
  const marker = JSON.parse(readFileSync(resolve(target, 'run.json'), 'utf8'));
  if (
    marker.kind !== 'current-achievement-difficulty' ||
    marker.version !== 1 ||
    !['pilot', 'main', 'campaign', 'analysis'].includes(marker.purpose)
  )
    throw Error('Unknown study marker');
  return marker;
}
export function writeStudyJson(webRoot, directory, name, value) {
  assertStudyRun(webRoot, directory);
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.json$/.test(name) || name === 'run.json')
    throw Error('Invalid study output filename');
  writeFileSync(
    resolve(directory, name),
    JSON.stringify(value, null, 2) + '\n',
    { flag: 'wx' },
  );
}
