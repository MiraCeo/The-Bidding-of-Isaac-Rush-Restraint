import { checkedJson, maxFileBytes } from './file-json';
import { shortHash } from '../shared/json-facts';

export const compressedFileFormat = 'the-bidding-of-isaac-compressed';
export interface PackedFile {
  source: string;
  compressed: boolean;
  originalBytes: number;
  fileBytes: number;
  reason?: 'unsupported' | 'not-smaller';
}
export interface FileCodecOptions {
  signal?: AbortSignal;
}
const utf8 = new TextEncoder();
function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('文件操作已取消。', 'AbortError');
}
function fail(message = '压缩文件损坏或格式不支持。'): never {
  throw new Error(message);
}
function base64(bytes: Uint8Array) {
  let raw = '';
  for (let i = 0; i < bytes.length; i += 0x4000)
    raw += String.fromCharCode(...bytes.subarray(i, i + 0x4000));
  return btoa(raw);
}
function unbase64(text: string) {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      text,
    ) ||
    !text.length
  )
    fail('压缩文件Base64无效。');
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    fail('压缩文件Base64无效。');
  }
  const result = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  if (base64(result) !== text) fail('压缩文件Base64无效。');
  return result;
}
async function transform(
  bytes: Uint8Array,
  stream: ReadableWritablePair<Uint8Array, BufferSource>,
  maximum: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  checkAbort(signal);
  const input = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
  const reader = input.pipeThrough(stream).getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      checkAbort(signal);
      const part = await reader.read();
      checkAbort(signal);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        fail('解压后文件超过8 MiB或声明大小，未载入。');
      }
      chunks.push(part.value);
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
/** Outer transport container only. Inner v2/v3/v4 JSON and checksum are byte-for-byte unchanged. */
export async function packDataFile(
  source: string,
  options: FileCodecOptions = {},
): Promise<PackedFile> {
  checkAbort(options.signal);
  const header = checkedJson(source);
  if (header.format === compressedFileFormat) fail('不能重复压缩容器。');
  const input = utf8.encode(source),
    originalBytes = input.length;
  if (typeof CompressionStream === 'undefined')
    return {
      source,
      compressed: false,
      originalBytes,
      fileBytes: originalBytes,
      reason: 'unsupported',
    };
  const gzip = await transform(
    input,
    new CompressionStream('gzip'),
    // A valid near-limit raw file may grow slightly in gzip. Keep room for
    // codec overhead, then fall back to raw rather than rejecting that export.
    maxFileBytes + 64 * 1024,
    options.signal,
  );
  const output = JSON.stringify({
    format: compressedFileFormat,
    version: 1,
    compression: 'gzip',
    encoding: 'base64',
    originalBytes,
    sourceChecksum: shortHash(source),
    data: base64(gzip),
  });
  const fileBytes = utf8.encode(output).length;
  checkAbort(options.signal);
  if (fileBytes >= originalBytes || fileBytes > maxFileBytes)
    return {
      source,
      compressed: false,
      originalBytes,
      fileBytes: originalBytes,
      reason: 'not-smaller',
    };
  return { source: output, compressed: true, originalBytes, fileBytes };
}
/** Bounded streaming decompression; do not trust the header length or bypass the inner parser. */
export async function unpackDataFile(
  source: string,
  options: FileCodecOptions = {},
): Promise<{
  source: string;
  compressed: boolean;
  originalBytes: number;
  fileBytes: number;
}> {
  checkAbort(options.signal);
  const header = checkedJson(source),
    fileBytes = utf8.encode(source).length;
  if (header.format !== compressedFileFormat)
    return { source, compressed: false, originalBytes: fileBytes, fileBytes };
  const required = [
    'format',
    'version',
    'compression',
    'encoding',
    'originalBytes',
    'sourceChecksum',
    'data',
  ];
  if (
    Object.keys(header).length !== required.length ||
    required.some((key) => !Object.hasOwn(header, key)) ||
    header.version !== 1 ||
    header.compression !== 'gzip' ||
    header.encoding !== 'base64'
  )
    fail();
  if (
    !Number.isSafeInteger(header.originalBytes) ||
    Number(header.originalBytes) < 1 ||
    Number(header.originalBytes) > maxFileBytes
  )
    fail('压缩文件声明的解压大小无效或超过8 MiB。');
  if (
    typeof header.sourceChecksum !== 'string' ||
    !/^[0-9a-f]{8}$/.test(header.sourceChecksum) ||
    typeof header.data !== 'string'
  )
    fail();
  if (typeof DecompressionStream === 'undefined')
    fail(
      '当前浏览器不支持解压，请使用支持gzip文件读取的浏览器或原JSON文件；当前对局未改变。',
    );
  let decoded: Uint8Array;
  try {
    decoded = await transform(
      unbase64(header.data),
      new DecompressionStream('gzip'),
      Number(header.originalBytes),
      options.signal,
    );
  } catch (error) {
    if (options.signal?.aborted) checkAbort(options.signal);
    if (error instanceof Error && error.message.includes('8 MiB')) throw error;
    fail('压缩数据损坏、截断或gzip校验失败，未载入。');
  }
  if (decoded.length !== header.originalBytes) fail('压缩文件大小不一致。');
  let inner: string;
  try {
    inner = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      decoded,
    );
  } catch {
    fail('解压后不是有效UTF8文本。');
  }
  if (shortHash(inner) !== header.sourceChecksum)
    fail('解压后的文件摘要不一致。');
  const innerHeader = checkedJson(inner);
  if (innerHeader.format === compressedFileFormat) fail('不支持嵌套压缩容器。');
  checkAbort(options.signal);
  return {
    source: inner,
    compressed: true,
    originalBytes: decoded.length,
    fileBytes,
  };
}
export function compressedFileSummary(result: PackedFile): string {
  const size = (n: number) => (n / 1024).toFixed(1) + ' KiB';
  return result.compressed
    ? `无损压缩 ${size(result.originalBytes)} → ${size(result.fileBytes)}`
    : result.reason === 'unsupported'
      ? `浏览器不支持压缩，已使用原JSON（${size(result.fileBytes)}）`
      : `原JSON更小，已保留原JSON（${size(result.fileBytes)}）`;
}
