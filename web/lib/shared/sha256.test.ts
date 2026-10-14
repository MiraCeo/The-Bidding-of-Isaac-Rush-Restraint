import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { sha256Hex } from './sha256';
it('matches standard SHA256 vectors and UTF8 binary block boundaries', async () => {
  expect(sha256Hex('')).toBe(
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  expect(sha256Hex('abc')).toBe(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  for (const source of [
    'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    '以撒🎲生存\uFEFF测试\ud800',
    ...Array.from({ length: 140 }, (_, n) => 'a'.repeat(n)),
    'a'.repeat(1000000),
  ]) {
    const expected = createHash('sha256').update(source, 'utf8').digest('hex');
    expect(sha256Hex(source)).toBe(expected);
    const native = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(source),
    );
    expect(Buffer.from(native).toString('hex')).toBe(expected);
  }
});
