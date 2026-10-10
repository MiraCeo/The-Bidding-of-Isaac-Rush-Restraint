import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

import { createOfflineHtml, readOfflineBundle } from './offline-html.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
export const offlineFile = resolve(root, 'dist-offline', '以撒的竞合.html');

export async function bundleOfflineGame({ logLevel = 'info' } = {}) {
  const result = await build({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    mode: 'production',
    publicDir: false,
    logLevel,
    // Library mode otherwise leaves process.env.NODE_ENV for the consumer.
    // Bundle React production code rather than relying on a browser Node shim.
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir: 'dist-offline',
      write: false,
      emptyOutDir: false,
      copyPublicDir: false,
      sourcemap: false,
      minify: true,
      cssCodeSplit: false,
      modulePreload: false,
      lib: {
        entry: resolve(root, 'main.tsx'),
        name: 'BiddingOfIsaacOffline',
        formats: ['iife'],
        fileName: 'offline-game',
        cssFileName: 'offline-game',
      },
      rolldownOptions: {
        external: [],
        output: { codeSplitting: false },
      },
    },
  });
  const [template, favicon, packageJson] = await Promise.all([
    readFile(resolve(root, 'index.html'), 'utf8'),
    readFile(resolve(root, 'public/favicon.svg'), 'utf8'),
    readFile(resolve(root, 'package.json'), 'utf8'),
  ]);
  return createOfflineHtml({
    template,
    favicon,
    version: JSON.parse(packageJson).version,
    ...readOfflineBundle(result),
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { html, buildId } = await bundleOfflineGame();
    await mkdir(dirname(offlineFile), { recursive: true });
    await writeFile(offlineFile, html, 'utf8');
    console.log(`\n离线 HTML：${offlineFile}`);
    console.log(
      `大小：${(Buffer.byteLength(html) / 1024).toFixed(1)} KiB；构建标识：${buildId}`,
    );
    console.log(
      '双击打开即可验收，不需要启动服务；分发时只需发送这一个 HTML 文件。',
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
