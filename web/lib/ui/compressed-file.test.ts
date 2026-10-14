import { describe, it, expect, afterEach, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import {
  packDataFile,
  unpackDataFile,
  compressedFileFormat,
} from './compressed-file';
import { readModeDataFile } from './mode-data';
import { shortHash } from '../shared/json-facts';
import { withChecksum } from './file-json';
import { startSurvivalClient } from './survival-client';
import {
  serializeSurvivalCheckpoint,
  parseSurvivalCheckpoint,
} from './survival-persistence';
import oldReplay from './fixtures/replay-v2-lost-20261012.json';
afterEach(() => vi.unstubAllGlobals());
function container(
  bytes: Uint8Array,
  originalBytes = bytes.length,
  checksum = '12345678',
) {
  return JSON.stringify({
    format: compressedFileFormat,
    version: 1,
    compression: 'gzip',
    encoding: 'base64',
    originalBytes,
    sourceChecksum: checksum,
    data: gzipSync(bytes).toString('base64'),
  });
}
describe('lossless gzip transport preserves existing format validation', () => {
  it('round trips Unicode, BOM, zero and four-decimal numbers without changing JSON bytes', async () => {
    const source =
      '\uFEFF' +
      JSON.stringify({
        text: '中文事件'.repeat(1000),
        score: 1.2345,
        zero: 0,
        flag: false,
      });
    const packed = await packDataFile(source);
    expect(packed.compressed).toBe(true);
    expect(packed.fileBytes).toBeLessThan(packed.originalBytes);
    expect((await unpackDataFile(packed.source)).source).toBe(source);
  });
  it('passes old plain JSON through unchanged and uses it when compression would grow the file', async () => {
    const source = '{"zero":0}';
    expect((await unpackDataFile(source)).source).toBe(source);
    expect(await packDataFile(source)).toMatchObject({
      source,
      compressed: false,
      reason: 'not-smaller',
    });
  });
  it('restores a compressed survival checkpoint by the original deterministic parser', async () => {
    const session = startSurvivalClient('jacob_esau', 42, 'hard'),
      source = serializeSurvivalCheckpoint(session.game, session.draft),
      packed = await packDataFile(source);
    const candidate = await readModeDataFile(packed.source, 'small.json');
    expect(candidate.kind).toBe('survival-checkpoint');
    if (candidate.kind === 'survival-checkpoint') {
      expect(candidate.document.game).toEqual(session.game);
      expect(candidate.document.draft).toEqual(session.draft);
    }
    expect(
      parseSurvivalCheckpoint((await unpackDataFile(packed.source)).source)
        .game,
    ).toEqual(session.game);
  });
  it('rejects raw and compressed old v2 files without converting their mode', async () => {
    const source = JSON.stringify(oldReplay);
    await expect(readModeDataFile(source, 'old.json')).rejects.toThrow('v5');
    await expect(
      readModeDataFile((await packDataFile(source)).source, 'old-small.json'),
    ).rejects.toThrow('v5');
  });
  it('rejects unknown metadata, invalid Base64, truncation, gzip damage, size and checksum mismatch', async () => {
    const packed = await packDataFile(
      JSON.stringify({ text: 'same data'.repeat(1000) }),
    );
    const good = JSON.parse(packed.source);
    for (const change of [
      { version: 99 },
      { encoding: 'hex' },
      { compression: 'zip' },
      { data: '***' },
      { data: good.data.slice(0, -8) },
      { sourceChecksum: '00000000' },
      { originalBytes: good.originalBytes - 1 },
      { originalBytes: 8 * 1024 * 1024 + 1 },
      { extra: 1 },
    ])
      await expect(
        unpackDataFile(JSON.stringify({ ...good, ...change })),
      ).rejects.toThrow();
  });
  it('bounds actual decompression even when the compressed header lies', async () => {
    const bytes = Buffer.from('x'.repeat(8 * 1024 * 1024 + 100));
    await expect(
      unpackDataFile(container(bytes, 8 * 1024 * 1024)),
    ).rejects.toThrow('8 MiB');
  });
  it('rejects invalid UTF8 and nested containers', async () => {
    await expect(
      unpackDataFile(container(Uint8Array.of(255), 1)),
    ).rejects.toThrow('UTF8');
    const packed = await packDataFile(
      JSON.stringify({ text: 'repeat'.repeat(1000) }),
    );
    const bytes = Buffer.from(packed.source, 'utf8');
    await expect(
      unpackDataFile(container(bytes, bytes.length, shortHash(packed.source))),
    ).rejects.toThrow('嵌套');
    await expect(packDataFile(packed.source)).rejects.toThrow('重复');
  });
  it('does not skip inner semantic checks when the compressed bytes are intact', async () => {
    const source = serializeSurvivalCheckpoint(
        startSurvivalClient('isaac', 42).game,
      ),
      doc = JSON.parse(source);
    doc.snapshot.players[0].money++;
    const { checksum: _checksum, ...body } = doc;
    const packed = await packDataFile(JSON.stringify(withChecksum(body)));
    await expect(
      readModeDataFile(packed.source, 'tampered.json'),
    ).rejects.toThrow();
  });
  it('aborts pre-cancelled operations and immediately cancelled decompression', async () => {
    const source = JSON.stringify({ text: 'long'.repeat(10000) }),
      packed = await packDataFile(source);
    const controller = new AbortController();
    controller.abort();
    await expect(
      packDataFile(source, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      unpackDataFile(packed.source, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    const other = new AbortController(),
      pending = unpackDataFile(packed.source, { signal: other.signal });
    other.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('exports original JSON if compression is unavailable and leaves raw imports usable', async () => {
    const source = JSON.stringify({ text: 'repeat'.repeat(1000) }),
      packed = await packDataFile(source);
    vi.stubGlobal('CompressionStream', undefined);
    expect(await packDataFile(source)).toMatchObject({
      source,
      compressed: false,
      reason: 'unsupported',
    });
    vi.stubGlobal('DecompressionStream', undefined);
    expect((await unpackDataFile(source)).source).toBe(source);
    await expect(unpackDataFile(packed.source)).rejects.toThrow('不支持解压');
  });
});
