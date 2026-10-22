import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

import { expect, it, vi } from 'vitest';

import { bundleOfflineGame } from './build-offline.mjs';
import { assertStandaloneHtml } from './offline-html.mjs';

it('builds the real game as a production single-file document without touching dist', async () => {
  const webIndex = new URL('../dist/index.html', import.meta.url);
  const before = await readFile(webIndex, 'utf8').catch(() => null);
  let html;
  vi.stubEnv('BIDDING_WEB_BASE', 'https://invalid-for-online.example/');
  try {
    ({ html } = await bundleOfflineGame({ logLevel: 'silent' }));
  } finally {
    vi.unstubAllEnvs();
  }
  expect(html).not.toContain('invalid-for-online.example');
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
  const images = Array.from(
    script.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g),
  ).map((match) => Buffer.from(match[1], 'base64'));
  const expectedImages = [
    'items/collectibles-sprite.png',
    'items/trinket-sprite.png',
    'items/grab-bag.png',
    'characters/isaac.png',
    'characters/lost.png',
    'characters/azazel.png',
    'characters/eden.png',
    'characters/jacob.png',
    'characters/esau.png',
  ];
  expect(images).toHaveLength(expectedImages.length);
  for (const filename of expectedImages) {
    const source = await readFile(
      new URL(`../assets/${filename}`, import.meta.url),
    );
    expect(images.filter((bytes) => bytes.equals(source))).toHaveLength(1);
  }
  expect(() => assertStandaloneHtml(html)).not.toThrow();
  expect(await readFile(webIndex, 'utf8').catch(() => null)).toBe(before);
}, 30000);
