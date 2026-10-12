import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { normalizeWebBase } from './scripts/deployment-config.mjs';
import { readSourceBuild } from './scripts/source-build.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const sourceBuild = readSourceBuild(root);

export default defineConfig(({ mode }) => ({
  base:
    mode === 'offline'
      ? '/'
      : normalizeWebBase(process.env.BIDDING_WEB_BASE ?? '/'),
  define: { __BIDDING_BUILD__: JSON.stringify(sourceBuild) },
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [
    react(),
    {
      name: 'bidding-web-build-identity',
      transformIndexHtml: () => [
        {
          tag: 'meta',
          attrs: { name: 'bidding-web-build', content: sourceBuild },
          injectTo: 'head' as const,
        },
      ],
    },
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
}));
