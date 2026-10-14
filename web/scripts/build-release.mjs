import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { bundleOfflineGame } from './build-offline.mjs';
import { recordWebArtifact } from './web-artifact.mjs';
import {
  readReleaseInputs,
  writeOfflineArtifacts,
} from './release-artifacts.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
async function runLocalCli(packageName, binName, args) {
  const metadata = JSON.parse(
    await readFile(
      resolve(root, 'node_modules', packageName, 'package.json'),
      'utf8',
    ),
  );
  const bin =
    typeof metadata.bin === 'string' ? metadata.bin : metadata.bin[binName];
  if (!bin) throw new Error(`缺少本地工具 ${packageName}/${binName}`);
  const temporary = resolve(root, 'work', 'release-temp');
  await mkdir(temporary, { recursive: true });
  const result = spawnSync(
    process.execPath,
    [resolve(root, 'node_modules', packageName, bin), ...args],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, TEMP: temporary, TMP: temporary },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  await writeFile(
    resolve(root, 'work', `release-${binName}.log`),
    output,
    'utf8',
  );
  if (result.error || result.status !== 0)
    throw new Error(
      `${binName}门禁未通过，不生成发布档案。\n${result.error?.message ?? output.slice(-5000)}`,
    );
  console.log(`${binName}门禁通过。`);
  return output;
}
export async function runReleaseGates({
  run = runLocalCli,
  // Native CSS bindings/config loaders are isolated from the following library build.
  buildWeb = () => run('vite', 'vite', ['build']),
} = {}) {
  const tests = stripVTControlCharacters(
    await run('vitest', 'vitest', ['run']),
  );
  const match = tests.match(/Tests\s+(\d+) passed(?:\s*\|\s*(\d+) skipped)?/);
  if (!match)
    throw new Error('没有取得测试通过数量，不把未知结果标记为发布通过。');
  await run('oxlint', 'oxlint', [
    'components/game',
    'lib/ui',
    'scripts',
    'vite.config.ts',
    '--ignore-pattern',
    'node_modules/**',
    '--ignore-pattern',
    'work/**',
  ]);
  await run('typescript', 'tsc', ['--noEmit']);
  await buildWeb();
  return {
    tests: { passed: Number(match[1]), skipped: Number(match[2] ?? 0) },
    lint: 'passed',
    types: 'passed',
    webBuild: 'passed',
    manualAcceptance: 'pending-user-feedback',
  };
}
export async function buildRelease() {
  await readReleaseInputs(root);
  const gates = await runReleaseGates();
  const webArtifact = await recordWebArtifact(
    root,
    process.env.BIDDING_WEB_BASE ?? '/',
  );
  const bundle = await bundleOfflineGame();
  const validation = { ...gates, offlineContract: 'passed' };
  const offline = await writeOfflineArtifacts(root, bundle, {
    validation,
    webArtifact,
  });
  const release = await writeOfflineArtifacts(root, bundle, {
    validation,
    webArtifact,
    release: true,
  });
  console.log(
    `\n发布文件：${release.htmlPath}\n发布清单：${resolve(release.directory, 'manifest.json')}\n固定验收入口：${resolve(offline.directory, '以撒的竞合.html')}`,
  );
  return release;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await buildRelease();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
