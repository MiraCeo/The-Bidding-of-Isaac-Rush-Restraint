import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** A fingerprint of build inputs, not of generated outputs or research/test fixtures. */
export function readSourceBuild(root) {
  const hash = createHash('sha256');
  function visit(directory) {
    for (const entry of readdirSync(resolve(root, directory), {
      withFileTypes: true,
    }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const name = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error('构建输入不能是符号链接。');
      if (entry.isDirectory()) visit(name);
      else if (
        /\.(tsx?|css|png|svg|webp|gif|mjs|mts)$/.test(name) &&
        !/\.test\.(ts|mjs)$/.test(name)
      )
        hash.update(name).update(readFileSync(resolve(root, name)));
    }
  }
  for (const directory of ['app', 'components', 'lib', 'assets', 'scripts'])
    visit(directory);
  for (const name of [
    'main.tsx',
    'index.html',
    'vite.config.ts',
    'package.json',
    'package-lock.json',
    'release-config.json',
    'release-notes.json',
  ])
    hash.update(name).update(readFileSync(resolve(root, name)));
  const version = JSON.parse(
    readFileSync(resolve(root, 'package.json'), 'utf8'),
  ).version;
  return `${version}-web-${hash.digest('hex').slice(0, 12)}`;
}
