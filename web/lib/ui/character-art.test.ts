import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import manifest from '../../assets/characters/manifest.json';

it('retains all six original 64px transparent PNG frames with recorded hashes', () => {
  expect(manifest.files.map((f) => f.file)).toEqual([
    'azazel.png',
    'eden.png',
    'esau.png',
    'isaac.png',
    'jacob.png',
    'lost.png',
  ]);
  for (const image of manifest.files) {
    const bytes = readFileSync(`assets/characters/${image.file}`);
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.readUInt32BE(16)).toBe(64);
    expect(bytes.readUInt32BE(20)).toBe(64);
    expect(bytes[25]).toBe(6); // RGBA, including the supplied transparent padding.
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(image.sha256);
    expect(image.source).toMatch(/^codex-clipboard-.*\.png$/);
  }
});
