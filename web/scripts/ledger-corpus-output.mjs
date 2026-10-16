import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  lstatSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { resolve, dirname, basename, sep } from 'node:path';

/** This is NOT the legacy v050-ledger output or an application save path. */
function outputRoot(webRoot) {
  return resolve(realpathSync(webRoot), 'work/v05-closeout-ledger');
}
export function allocateCorpusRun(webRoot) {
  const root = realpathSync(webRoot),
    parent = outputRoot(root);
  // Check existing ancestors BEFORE mkdir: do not create a child through a
  // workspace alias/junction and only then discover that it escaped the root.
  for (const directory of [resolve(root, 'work'), parent])
    if (
      existsSync(directory) &&
      (lstatSync(directory).isSymbolicLink() ||
        realpathSync(directory) !== directory)
    )
      throw Error('Corpus output cannot use linked parent directories');
  mkdirSync(parent, { recursive: true });
  if (
    !realpathSync(parent).startsWith(root + sep) ||
    lstatSync(parent).isSymbolicLink()
  )
    throw Error('Corpus output must stay inside this workspace');
  const directory = mkdtempSync(resolve(parent, 'corpus-'));
  writeFileSync(
    resolve(directory, 'run.json'),
    JSON.stringify(
      {
        kind: 'schema6-corpus-run',
        version: 1,
        id: randomUUID(),
        allocatedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  return directory;
}
export function assertCorpusRun(webRoot, directory) {
  const target = resolve(directory),
    parent = outputRoot(webRoot);
  if (
    dirname(target) !== parent ||
    !/^corpus-[a-zA-Z0-9-]+$/.test(basename(target)) ||
    lstatSync(target).isSymbolicLink() ||
    realpathSync(target) !== target
  )
    throw Error('Not an allocated schema6 corpus output directory');
  const marker = JSON.parse(readFileSync(resolve(target, 'run.json'), 'utf8'));
  if (
    marker.kind !== 'schema6-corpus-run' ||
    marker.version !== 1 ||
    typeof marker.id !== 'string'
  )
    throw Error('Unknown corpus run marker');
  return target;
}
export function writeCorpusJson(webRoot, directory, filename, value) {
  const target = assertCorpusRun(webRoot, directory);
  if (
    !/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.json$/.test(filename) ||
    filename === 'run.json'
  )
    throw Error('Invalid corpus output filename');
  // Never overwrite a finished report, partial run, historical JSON or symlink.
  writeFileSync(
    resolve(target, filename),
    JSON.stringify(value, null, 2) + '\n',
    { flag: 'wx' },
  );
}
export function corpusSourceProvenance(webRoot) {
  const git = (args) =>
    execFileSync('git', args, {
      cwd: webRoot,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
  const paths = [
    ...new Set(
      git([
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        '--',
        'lib',
        'components',
        'scripts',
        'package.json',
        'package-lock.json',
        'release-config.json',
        'release-notes.json',
        'vite.config.ts',
        'vitest.config.ts',
      ])
        .split(/\r?\n/)
        .filter(Boolean),
    ),
  ].sort();
  const files = paths.map((path) => {
    const bytes = readFileSync(resolve(webRoot, path));
    return {
      path,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  });
  return {
    commit: git(['rev-parse', 'HEAD']),
    dirty: !!git(['status', '--porcelain']),
    files,
  };
}
