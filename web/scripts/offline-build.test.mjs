import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

import { expect, it } from 'vitest';

import { bundleOfflineGame } from './build-offline.mjs';
import { assertStandaloneHtml } from './offline-html.mjs';

it('builds the real game as a production single-file document without touching dist', async () => {
  const webIndex = new URL('../dist/index.html', import.meta.url);
  const before = await readFile(webIndex, 'utf8').catch(() => null);
  const { html } = await bundleOfflineGame({ logLevel: 'silent' });
  const script = html.match(
    /<script id="offline-game">([\s\S]*?)<\/script>/,
  )[1];
  expect(() => new Script(script)).not.toThrow();
  expect(script).not.toMatch(
    /\bprocess\.env\b|\bimport\.meta\b|\bimport\s*\(|\bfetch\s*\(/,
  );
  expect(html).toContain('角色');
  expect(html).toContain('id="root"');
  expect(html).not.toContain('raw.githubusercontent.com');
  expect(() => assertStandaloneHtml(html)).not.toThrow();
  expect(await readFile(webIndex, 'utf8').catch(() => null)).toBe(before);
}, 30000);
