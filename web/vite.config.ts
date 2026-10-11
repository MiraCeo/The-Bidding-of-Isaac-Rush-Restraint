import { fileURLToPath, URL } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const hash = createHash('sha256');
function hashSource(directory: string) {
  for (const entry of readdirSync(resolve(root, directory), {
    withFileTypes: true,
  }).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) hashSource(name);
    else if (/\.(tsx?|css)$/.test(name) && !name.endsWith('.test.ts'))
      hash.update(name).update(readFileSync(resolve(root, name)));
  }
}
for (const directory of ['app', 'components', 'lib']) hashSource(directory);
for (const name of ['main.tsx', 'index.html', 'package.json'])
  hash.update(name).update(readFileSync(resolve(root, name)));
const version = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
).version;
const sourceBuild = `${version}-web-${hash.digest('hex').slice(0, 12)}`;

export default defineConfig({
  define: { __BIDDING_BUILD__: JSON.stringify(sourceBuild) },
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
});
