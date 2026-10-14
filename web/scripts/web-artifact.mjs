import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { filesIn, fileRecord } from './verify-deployment.mjs';
import { readSourceBuild } from './source-build.mjs';
import { normalizeWebBase } from './deployment-config.mjs';

/** Taken immediately after the gated web build, before any offline library build. */
export async function recordWebArtifact(root, base = '/') {
  base = normalizeWebBase(base);
  const directory = resolve(root, 'dist');
  const html = await readFile(resolve(directory, 'index.html'), 'utf8');
  const sourceBuild = readSourceBuild(root);
  if (!html.includes(`content="${sourceBuild}"`))
    throw new Error('网页构建没有对应当前输入。');
  const files = await Promise.all(
    (await filesIn(directory)).map((name) => fileRecord(directory, name)),
  );
  return { base, sourceBuild, files };
}
