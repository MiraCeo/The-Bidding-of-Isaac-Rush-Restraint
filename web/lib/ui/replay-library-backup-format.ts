import { canonicalJson } from '../shared/json-facts';
import { readBuildVersion } from './game-version';
import {
  librarySha256,
  validEntry,
  validRemoved,
  type ReplayLibraryEntry,
  type RemovedReplay,
} from './replay-library';

export const libraryBackupFormat = 'the-bidding-of-isaac-library-backup';
export const libraryBackupLimits = {
  records: 100,
  payloadBytes: 64 * 1024 * 1024,
  removed: 8192,
  metadataBytes: 16 * 1024 * 1024,
  fileBytes: 160 * 1024 * 1024,
};
export interface LibraryPayload {
  key: string;
  source: string;
  [field: string]: unknown;
}
export interface LibraryBackupData {
  entries: ReplayLibraryEntry[];
  payloads: LibraryPayload[];
  removed: RemovedReplay[];
}
export interface LibraryBackupDocument extends LibraryBackupData {
  format: typeof libraryBackupFormat;
  version: 1;
  databaseVersion: 1;
  exportedAt: string;
  exportedBuild: string;
  checksum: string;
}
const encoder = new TextEncoder();
export function checkLibraryAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('整库操作已取消。', 'AbortError');
}
export async function yieldLibraryTask(signal?: AbortSignal) {
  checkLibraryAbort(signal);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  checkLibraryAbort(signal);
}
/** Publish a stage before its bounded synchronous work, so UI/cancel can run. */
export async function libraryBackupStep(
  options: LibraryBackupOptions,
  message: string,
) {
  checkLibraryAbort(options.signal);
  options.onProgress?.(message);
  await yieldLibraryTask(options.signal);
}
/** Independent bounds for a whole library; the per-replay 8 MiB rule is unchanged. */
function inspectJson(value: unknown) {
  let nodes = 0;
  function visit(node: unknown, depth: number) {
    if (++nodes > 1_000_000 || depth > 32)
      throw Error('整库文件结构过大或嵌套过深。');
    if (node === null || typeof node === 'string' || typeof node === 'boolean')
      return;
    if (typeof node === 'number' && Number.isFinite(node)) return;
    if (
      typeof node !== 'object' ||
      (!Array.isArray(node) && Object.getPrototypeOf(node) !== Object.prototype)
    )
      throw Error('整库资料含非JSON数据，未丢弃或改写原资料。');
    for (const key of Object.keys(node)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key))
        throw Error('整库文件包含非法字段。');
      visit((node as Record<string, unknown>)[key], depth + 1);
    }
  }
  visit(value, 0);
}
export function validateLibraryBackupData(data: LibraryBackupData): void {
  inspectJson(data);
  if (
    !Array.isArray(data.entries) ||
    !Array.isArray(data.payloads) ||
    !Array.isArray(data.removed) ||
    data.entries.length > libraryBackupLimits.records ||
    data.payloads.length !== data.entries.length ||
    data.removed.length > libraryBackupLimits.removed ||
    !data.entries.every(validEntry) ||
    !data.removed.every(validRemoved)
  )
    throw Error('整库索引、正文或删除标记损坏／超过有界备份上限；原数据保留。');
  const keys = new Set(data.entries.map((e) => e.key)),
    marks = new Set(data.removed.map((r) => r.key)),
    payloadKeys = new Set(data.payloads.map((p) => p?.key));
  if (
    keys.size !== data.entries.length ||
    marks.size !== data.removed.length ||
    payloadKeys.size !== keys.size ||
    data.payloads.some(
      (p) =>
        !p ||
        typeof p !== 'object' ||
        typeof p.source !== 'string' ||
        !keys.has(p.key),
    ) ||
    [...marks].some((k) => keys.has(k))
  )
    throw Error(
      '整库存在重复键、缺失／孤立正文或同键存活与删除冲突；未忽略原资料。',
    );
  let bytes = 0;
  const extraPayloadFields = data.payloads.map((p) => {
    bytes += encoder.encode(p.source).length;
    const { source: _source, ...extra } = p;
    return extra;
  });
  if (
    bytes > libraryBackupLimits.payloadBytes ||
    data.entries.reduce((n, e) => n + e.bytes, 0) >
      libraryBackupLimits.payloadBytes ||
    encoder.encode(
      JSON.stringify([data.entries, data.removed, extraPayloadFields]),
    ).length > libraryBackupLimits.metadataBytes
  )
    throw Error('整库正文超过64 MiB或元数据超过16 MiB，未截断或写入。');
}
export async function serializeLibraryBackup(
  data: LibraryBackupData,
  signal?: AbortSignal,
  now = new Date(),
) {
  checkLibraryAbort(signal);
  validateLibraryBackupData(data);
  const body = {
    format: libraryBackupFormat as typeof libraryBackupFormat,
    version: 1 as const,
    databaseVersion: 1 as const,
    exportedAt: now.toISOString(),
    exportedBuild: readBuildVersion(),
    entries: data.entries,
    payloads: data.payloads,
    removed: data.removed,
  };
  const checksum = await librarySha256(canonicalJson(body));
  checkLibraryAbort(signal);
  const document: LibraryBackupDocument = { ...body, checksum },
    source = JSON.stringify(document);
  if (encoder.encode(source).length > libraryBackupLimits.fileBytes)
    throw Error('整库文件超过160 MiB，未导出。');
  return { source, document };
}
export async function parseLibraryBackup(
  source: string,
  signal?: AbortSignal,
): Promise<LibraryBackupDocument> {
  checkLibraryAbort(signal);
  if (encoder.encode(source).length > libraryBackupLimits.fileBytes)
    throw Error('整库文件超过160 MiB，未读取。');
  let doc: LibraryBackupDocument;
  try {
    doc = JSON.parse(source.replace(/^\uFEFF/, ''));
  } catch {
    throw Error('不是有效的整库JSON备份。');
  }
  inspectJson(doc);
  if (
    !doc ||
    doc.format !== libraryBackupFormat ||
    doc.version !== 1 ||
    doc.databaseVersion !== 1
  )
    throw Error('仅支持整库备份v1；单局回放、对局和玩家档案请使用各自入口。');
  const fields = [
    'format',
    'version',
    'databaseVersion',
    'exportedAt',
    'exportedBuild',
    'entries',
    'payloads',
    'removed',
    'checksum',
  ];
  if (
    fields.some((k) => !Object.hasOwn(doc, k)) ||
    Object.keys(doc).some((k) => !fields.includes(k)) ||
    typeof doc.exportedAt !== 'string' ||
    !Number.isFinite(Date.parse(doc.exportedAt)) ||
    typeof doc.exportedBuild !== 'string' ||
    !doc.exportedBuild.trim() ||
    doc.exportedBuild.length > 160 ||
    typeof doc.checksum !== 'string' ||
    !/^[a-f0-9]{64}$/.test(doc.checksum)
  )
    throw Error('整库文件头或摘要字段损坏。');
  validateLibraryBackupData(doc);
  const { checksum, ...body } = doc;
  if ((await librarySha256(canonicalJson(body))) !== checksum)
    throw Error('整库SHA256摘要不一致，未恢复。');
  checkLibraryAbort(signal);
  return doc;
}
export class LibraryBackupChangedError extends Error {
  constructor() {
    super('预览后回放库已变化，未写入；请重新核对新增、重复与删除冲突。');
    this.name = 'LibraryBackupChangedError';
  }
}
export interface LibraryRestoreRow {
  entry: ReplayLibraryEntry;
  status: 'add' | 'duplicate' | 'blocked';
  referenceKey?: string;
}
export interface LibraryRestorePreview {
  exportedAt: string;
  exportedBuild: string;
  rows: LibraryRestoreRow[];
  added: number;
  duplicates: number;
  blocked: number;
  markerAdded: number;
  markerDuplicates: number;
  markerConflicts: number;
  finalCount: number;
  finalBytes: number;
  canRestore: boolean;
  reason: string;
}
export interface LibraryBackupOptions {
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}
