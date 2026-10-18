import type { CharacterId } from '../game/item-types';
import type { SurvivalDifficulty } from '../game/survival-difficulty';
import {
  parseReplay,
  serializeReplay,
  type ReplayDocument,
} from './game-replay';
import {
  parseSurvivalReplay,
  serializeSurvivalReplay,
  type SurvivalReplayDocument,
} from './survival-persistence';
import { replayFactsIdentity } from './replay-facts-codec';
import { survivalCompletionFacts } from './completion-identity';
import { packDataFile, unpackDataFile } from './compressed-file';
import { checkedJson, maxFileBytes } from './file-json';
import { assertCurrentFileHeader } from './file-protocol';
import { readBuildVersion } from './game-version';
import { canonicalJson } from '../shared/json-facts';
import {
  classicLibraryProof,
  sameClassicLibraryProof,
  validClassicLibraryProof,
  type ClassicLibraryProof,
} from './classic-library-equivalence';
import {
  checkLibraryAbort,
  yieldLibraryTask,
  libraryBackupStep,
  validateLibraryBackupData,
  serializeLibraryBackup,
  parseLibraryBackup,
  libraryBackupLimits,
  LibraryBackupChangedError,
  type LibraryBackupData,
  type LibraryBackupOptions,
  type LibraryRestorePreview,
  type LibraryRestoreRow,
} from './replay-library-backup-format';

export type LibraryReplay = ReplayDocument | SurvivalReplayDocument;
export const replayLibraryDatabase = 'bidding-replay-library-v1';
export const replayLibraryChanged = 'bidding-replay-library-changed';
export const replayLibraryLimits = { count: 100, bytes: 64 * 1024 * 1024 };
export interface ReplayLibraryEntry {
  key: string;
  mode: 'classic' | 'survival';
  replayId: string;
  characterId: CharacterId;
  difficulty: SurvivalDifficulty | null;
  seed: number;
  completed: boolean;
  rooms: number;
  rank: number | null;
  score: number | null;
  savedAt: string;
  exportedAt: string;
  startedBuild: string;
  origin: 'automatic' | 'manual' | 'import';
  bytes: number;
  rawBytes: number;
  compressed: boolean;
  payloadHash: string;
}
export interface PreparedReplay {
  entry: ReplayLibraryEntry;
  source: string;
}
export interface RemovedReplay {
  key: string;
  removedAt: string;
  classicProof?: ClassicLibraryProof;
}
interface LibrarySnapshot {
  entries: ReplayLibraryEntry[];
  removed: RemovedReplay[];
  token: string;
}
export interface ClassicEquivalentGroup {
  keeper: string;
  copies: string[];
}
const retrySnapshot = Symbol('library-snapshot-changed');
function sameBulkData(a: LibraryBackupData, b: LibraryBackupData): boolean {
  if (
    canonicalJson([a.entries, a.removed]) !==
      canonicalJson([b.entries, b.removed]) ||
    a.payloads.length !== b.payloads.length
  )
    return false;
  const expected = new Map(a.payloads.map((p) => [p.key, p]));
  return b.payloads.every((p) => {
    const old = expected.get(p.key);
    if (!old || p.source !== old.source) return false;
    const { source: _a, ...extraA } = old,
      { source: _b, ...extraB } = p;
    return canonicalJson(extraA) === canonicalJson(extraB);
  });
}
function samePayloadSource(a: unknown, b: unknown) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  try {
    return canonicalJson(a) === canonicalJson(b);
  } catch {
    return false;
  }
}
export function validRemoved(value: unknown): value is RemovedReplay {
  const r = value as RemovedReplay;
  return (
    !!r &&
    typeof r === 'object' &&
    typeof r.key === 'string' &&
    /^(classic|survival)\/[a-f0-9]{64}$/.test(r.key) &&
    typeof r.removedAt === 'string' &&
    Number.isFinite(Date.parse(r.removedAt)) &&
    (r.classicProof === undefined ||
      (r.key.startsWith('classic/') &&
        validClassicLibraryProof(r.classicProof)))
  );
}
const encoder = new TextEncoder();
export async function librarySha256(source: string) {
  if (!globalThis.crypto?.subtle)
    throw Error('当前浏览器无法计算回放SHA256摘要，未写入。');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(source));
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
const sha256 = librarySha256;
export async function replayLibraryKey(document: LibraryReplay) {
  // The unrounded Moms Knife explanation can differ by a few ULPs between JS
  // runtimes. Normalize ONLY that display trigger in the identity projection;
  // all authoritative four-decimal scores, actions, balances and stored text
  // stay exact. The survival projection also supplies completion-registration keys;
  // it never changes the original saved payload.
  const facts =
    document.mode === 'classic'
      ? replayFactsIdentity(document.replay)
      : survivalCompletionFacts(document.replay);
  return `${document.mode}/${await sha256(facts)}`;
}
export function replaySource(document: LibraryReplay) {
  const now = new Date(document.exportedAt);
  return document.mode === 'classic'
    ? serializeReplay(document.replay, document.exportedBuild, now)
    : serializeSurvivalReplay(document.replay, document.exportedBuild, now);
}
function replayMetadata(doc: LibraryReplay) {
  const human = doc.replay.final?.ranking.find(
    (row) => row.playerId === 'human',
  );
  const score = human?.finalScore ?? null;
  const rank =
    doc.mode === 'classic'
      ? score === null
        ? null
        : 1 +
          doc.replay.final!.ranking.filter((row) => row.finalScore > score)
            .length
      : (doc.replay.final?.ranking.find((row) => row.playerId === 'human')
          ?.rank ?? null);
  return {
    mode: doc.mode,
    replayId: doc.replay.id,
    characterId: doc.replay.characterId,
    difficulty:
      doc.mode === 'survival'
        ? (doc.replay.ruleFacts.parameters.aiDifficulty ?? null)
        : (doc.replay.classicAi?.difficulty ?? null),
    seed: doc.replay.seed,
    completed: !!doc.replay.final,
    rooms: doc.replay.rooms.length,
    score,
    rank,
    exportedAt: doc.exportedAt,
    startedBuild: doc.replay.startedBuild,
  };
}
/** Only fact parsers: never reconstruct a game, run AI or register a played result. */
export async function prepareLibraryReplay(
  source: string,
  origin: ReplayLibraryEntry['origin'] = 'import',
): Promise<PreparedReplay> {
  const raw = (await unpackDataFile(source)).source;
  const header = checkedJson(raw);
  assertCurrentFileHeader(header);
  if (
    header.kind !== 'replay' ||
    header.format !== 'the-bidding-of-isaac-replay'
  )
    throw Error('回放库只接收v5回放文件，不载入续玩存档或玩家档案。');
  const doc =
    header.mode === 'classic' ? parseReplay(raw) : parseSurvivalReplay(raw);
  const packed = await packDataFile(raw);
  return {
    source: packed.source,
    entry: {
      key: await replayLibraryKey(doc),
      ...replayMetadata(doc),
      savedAt: new Date().toISOString(),
      origin,
      bytes: packed.fileBytes,
      rawBytes: packed.originalBytes,
      compressed: packed.compressed,
      payloadHash: await sha256(packed.source),
    },
  };
}
export function newLibraryDocument(
  document:
    | Pick<ReplayDocument, 'mode' | 'replay'>
    | Pick<SurvivalReplayDocument, 'mode' | 'replay'>,
): LibraryReplay {
  return {
    ...document,
    format: 'the-bidding-of-isaac-replay',
    version: 5,
    kind: 'replay',
    exportedAt: new Date().toISOString(),
    exportedBuild: readBuildVersion(),
  } as LibraryReplay;
}
export function validEntry(value: unknown): value is ReplayLibraryEntry {
  const e = value as ReplayLibraryEntry;
  return (
    !!e &&
    typeof e === 'object' &&
    typeof e.key === 'string' &&
    /^(classic|survival)\/[a-f0-9]{64}$/.test(e.key) &&
    ['classic', 'survival'].includes(e.mode) &&
    e.key.startsWith(e.mode + '/') &&
    ['isaac', 'lost', 'azazel', 'eden', 'jacob_esau'].includes(e.characterId) &&
    (e.difficulty === null ||
      ['easy', 'standard', 'hard', 'highest'].includes(e.difficulty)) &&
    ['automatic', 'manual', 'import'].includes(e.origin) &&
    typeof e.replayId === 'string' &&
    typeof e.startedBuild === 'string' &&
    Number.isSafeInteger(e.seed) &&
    e.seed >= 0 &&
    e.seed <= 0xffffffff &&
    typeof e.completed === 'boolean' &&
    Number.isInteger(e.rooms) &&
    e.rooms >= 0 &&
    e.rooms <= 35 &&
    (e.rank === null ||
      (Number.isInteger(e.rank) && e.rank >= 1 && e.rank <= 20)) &&
    (e.score === null ||
      (typeof e.score === 'number' && Number.isFinite(e.score))) &&
    typeof e.savedAt === 'string' &&
    Number.isFinite(Date.parse(e.savedAt)) &&
    typeof e.exportedAt === 'string' &&
    Number.isFinite(Date.parse(e.exportedAt)) &&
    Number.isSafeInteger(e.bytes) &&
    e.bytes > 0 &&
    e.bytes <= maxFileBytes &&
    Number.isSafeInteger(e.rawBytes) &&
    e.rawBytes > 0 &&
    e.rawBytes <= maxFileBytes &&
    typeof e.compressed === 'boolean' &&
    typeof e.payloadHash === 'string' &&
    /^[a-f0-9]{64}$/.test(e.payloadHash)
  );
}
function announce() {
  if (typeof window !== 'undefined')
    window.dispatchEvent(new Event(replayLibraryChanged));
}
/** Each operation owns a short-lived connection; version changes cannot strand another tab. */
export class ReplayLibrary {
  private backupPlans = new WeakMap<
    LibraryRestorePreview,
    {
      baseline: LibraryBackupData;
      records: PreparedReplay[];
      payloads: LibraryBackupData['payloads'];
      marks: RemovedReplay[];
      allowed: boolean;
      reason: string;
    }
  >();
  constructor(
    private factory: () => IDBFactory | undefined = () => globalThis.indexedDB,
    private name = replayLibraryDatabase,
    private limits = replayLibraryLimits,
  ) {}
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        const factory = this.factory();
        if (!factory)
          throw Error(
            '当前浏览器无法使用IndexedDB回放库；续玩存档与文件导出仍独立可用。',
          );
        request = factory.open(this.name, 1);
      } catch (error) {
        reject(error);
        return;
      }
      let settled = false;
      const timeout = setTimeout(() => {
        settled = true;
        reject(
          Error('回放库打开超时，请关闭其他旧版本页面后刷新；原数据保留。'),
        );
      }, 5000);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('index', { keyPath: 'key' });
        db.createObjectStore('payload', { keyPath: 'key' });
        // A tiny tombstone prevents an explicitly deleted final from being re-archived on refresh.
        db.createObjectStore('removed', { keyPath: 'key' });
      };
      request.onsuccess = () => {
        clearTimeout(timeout);
        request.result.onversionchange = () => request.result.close();
        if (settled) request.result.close();
        else resolve(request.result);
      };
      request.onerror = () => {
        clearTimeout(timeout);
        reject(request.error ?? Error('回放库无法打开，原数据保留。'));
      };
      request.onblocked = () => {
        settled = true;
        clearTimeout(timeout);
        reject(
          Error('回放库被另一版本页面占用，请关闭该页面后重试；原数据保留。'),
        );
      };
    });
  }
  private async transaction<T>(
    mode: IDBTransactionMode,
    work: (
      tx: IDBTransaction,
      result: (value: T) => void,
      fail: (error: unknown) => void,
    ) => void,
    signal?: AbortSignal,
  ): Promise<T> {
    checkLibraryAbort(signal);
    const db = await this.open();
    if (signal?.aborted) {
      db.close();
      checkLibraryAbort(signal);
    }
    return new Promise<T>((resolve, reject) => {
      let value: T, tx: IDBTransaction, failure: unknown;
      try {
        tx = db.transaction(['index', 'payload', 'removed'], mode);
      } catch (error) {
        db.close();
        reject(error);
        return;
      }
      const abort = () => {
        failure = new DOMException('整库操作已取消。', 'AbortError');
        try {
          tx.abort();
        } catch {
          /* Transaction already completed. */
        }
      };
      signal?.addEventListener('abort', abort, { once: true });
      tx.oncomplete = () => {
        signal?.removeEventListener('abort', abort);
        db.close();
        resolve(value);
      };
      tx.onabort = () => {
        signal?.removeEventListener('abort', abort);
        db.close();
        reject(failure ?? tx.error ?? Error('回放库事务失败，原记录保留。'));
      };
      try {
        work(
          tx,
          (next) => {
            value = next;
          },
          (error) => {
            failure ??= error;
            try {
              tx.abort();
            } catch {
              /* Already aborted by a cancellation. */
            }
          },
        );
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  }
  private bulkSnapshot(signal?: AbortSignal): Promise<LibraryBackupData> {
    return this.transaction(
      'readonly',
      (tx, done) => {
        const index = tx
            .objectStore('index')
            .getAll(undefined, libraryBackupLimits.records + 1),
          payload = tx
            .objectStore('payload')
            .getAll(undefined, libraryBackupLimits.records + 1),
          removed = tx
            .objectStore('removed')
            .getAll(undefined, libraryBackupLimits.removed + 1);
        let pending = 3;
        const finish = () => {
          if (--pending === 0)
            done({
              entries: index.result,
              payloads: payload.result,
              removed: removed.result,
            });
        };
        index.onsuccess = payload.onsuccess = removed.onsuccess = finish;
      },
      signal,
    );
  }
  private async validateBulkFacts(
    data: LibraryBackupData,
    options: LibraryBackupOptions,
    label: string,
    reuse?: { data: LibraryBackupData; documents: Map<string, LibraryReplay> },
    retainDocuments = true,
  ) {
    checkLibraryAbort(options.signal);
    validateLibraryBackupData(data);
    const payloads = new Map(data.payloads.map((p) => [p.key, p.source]));
    const reusableEntries = new Map(reuse?.data.entries.map((e) => [e.key, e]));
    const reusableSources = new Map(
      reuse?.data.payloads.map((p) => [p.key, p.source]),
    );
    const documents = new Map<string, LibraryReplay>();
    for (const [i, entry] of data.entries.entries()) {
      await libraryBackupStep(
        options,
        `${label}：核验第 ${i + 1} / ${data.entries.length} 份回放`,
      );
      const prior = reusableEntries.get(entry.key),
        document = reuse?.documents.get(entry.key);
      // This is operation-local reuse of an already verified input, never a cache
      // across database snapshots. Every index field and exact source must match.
      if (
        document &&
        prior &&
        reusableSources.get(entry.key) === payloads.get(entry.key) &&
        canonicalJson(prior) === canonicalJson(entry)
      ) {
        if (retainDocuments) documents.set(entry.key, document);
      } else {
        const read = await this.decode(
          entry.key,
          entry,
          payloads.get(entry.key),
        );
        if (retainDocuments) documents.set(entry.key, read.document);
      }
      await yieldLibraryTask(options.signal);
    }
    return documents;
  }
  /** Verify an observed full snapshot in the same short transaction as the append. */
  private bulkCommit<T>(
    baseline: LibraryBackupData,
    action: (tx: IDBTransaction, done: (value: T) => void) => void,
    mode: IDBTransactionMode,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.transaction(
      mode,
      (tx, done, fail) => {
        const index = tx
            .objectStore('index')
            .getAll(undefined, libraryBackupLimits.records + 1),
          payload = tx
            .objectStore('payload')
            .getAll(undefined, libraryBackupLimits.records + 1),
          removed = tx
            .objectStore('removed')
            .getAll(undefined, libraryBackupLimits.removed + 1);
        let pending = 3;
        const finish = () => {
          if (--pending) return;
          try {
            checkLibraryAbort(signal);
            if (
              !sameBulkData(baseline, {
                entries: index.result,
                payloads: payload.result,
                removed: removed.result,
              })
            )
              throw new LibraryBackupChangedError();
            action(tx, done);
          } catch (error) {
            fail(error);
          }
        };
        index.onsuccess = payload.onsuccess = removed.onsuccess = finish;
      },
      signal,
    );
  }
  /** Full cross-mode export, including legacy equivalent rows and exact deletion evidence. */
  async exportBackup(options: LibraryBackupOptions = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      await libraryBackupStep(
        options,
        `整库导出：读取一致快照（第 ${attempt + 1} / 3 次核对）`,
      );
      const data = await this.bulkSnapshot(options.signal);
      // Export needs validation, not a retained map of every decoded full game.
      await this.validateBulkFacts(data, options, '整库导出', undefined, false);
      await libraryBackupStep(options, '整库导出：校验元数据并生成文件摘要…');
      const packed = await serializeLibraryBackup(data, options.signal);
      try {
        await libraryBackupStep(
          options,
          '整库导出：再次核对本机资料，完成后才请求下载…',
        );
        await this.bulkCommit(
          data,
          (_tx, done) => done(true),
          'readonly',
          options.signal,
        );
        return packed;
      } catch (error) {
        if (!(error instanceof LibraryBackupChangedError)) throw error;
      }
    }
    throw new LibraryBackupChangedError();
  }
  /** Dry-run only. Compare imports only to the original local library, never collapse
   * historic equivalent rows within the same backup. Empty-target recovery is lossless. */
  async previewBackup(
    source: string,
    options: LibraryBackupOptions = {},
  ): Promise<LibraryRestorePreview> {
    await libraryBackupStep(options, '备份文件：读取文件头、结构与SHA256摘要…');
    const incoming = await parseLibraryBackup(source, options.signal),
      incomingDocs = await this.validateBulkFacts(
        incoming,
        options,
        '备份文件',
      ),
      baseline = await this.bulkSnapshot(options.signal),
      localDocs = await this.validateBulkFacts(
        baseline,
        options,
        '本机回放库',
        { data: incoming, documents: incomingDocs },
      );
    const proofs = new Map<string, ClassicLibraryProof>();
    const proofDocuments = new Map<string, LibraryReplay>();
    const proofTasks = [...localDocs, ...incomingDocs];
    for (const [i, [key, doc]] of proofTasks.entries()) {
      await libraryBackupStep(
        options,
        `恢复预览：核对说明凭据 ${i + 1} / ${proofTasks.length}`,
      );
      // Equal raw keys may have distinct valid export wrappers; identity is still factual.
      if (doc.mode === 'classic' && proofDocuments.get(key) !== doc) {
        proofs.set(key, await classicLibraryProof(doc.replay, sha256));
        proofDocuments.set(key, doc);
      }
      await yieldLibraryTask(options.signal);
    }
    const local = new Map(baseline.entries.map((e) => [e.key, e])),
      payload = new Map(incoming.payloads.map((p) => [p.key, p])),
      rows: LibraryRestoreRow[] = [],
      records: PreparedReplay[] = [],
      additions: LibraryBackupData['payloads'] = [];
    await libraryBackupStep(options, '恢复预览：比较新增、重复与本机删除保护…');
    for (const entry of incoming.entries) {
      const proof = proofs.get(entry.key),
        duplicate =
          local.get(entry.key) ??
          baseline.entries
            .filter(
              (e) => e.mode === 'classic' && e.replayId === entry.replayId,
            )
            .sort(
              (a, b) =>
                Date.parse(a.savedAt) - Date.parse(b.savedAt) ||
                a.key.localeCompare(b.key),
            )
            .find(
              (e) =>
                proof && sameClassicLibraryProof(proof, proofs.get(e.key)!),
            );
      const blocked = duplicate
        ? undefined
        : baseline.removed.find(
            (mark) =>
              mark.key === entry.key ||
              (proof &&
                mark.classicProof &&
                sameClassicLibraryProof(proof, mark.classicProof)),
          );
      rows.push({
        entry: structuredClone(entry),
        status: duplicate ? 'duplicate' : blocked ? 'blocked' : 'add',
        ...(duplicate
          ? { referenceKey: duplicate.key }
          : blocked
            ? { referenceKey: blocked.key }
            : {}),
      });
      if (!duplicate && !blocked) {
        records.push({ entry, source: payload.get(entry.key)!.source });
        additions.push(payload.get(entry.key)!);
      }
    }
    const marks: RemovedReplay[] = [];
    const localMarkerKeys = new Set(baseline.removed.map((mark) => mark.key));
    let markerDuplicates = 0,
      markerConflicts = 0;
    for (const [i, mark] of incoming.removed.entries()) {
      if (i % 256 === 0)
        await libraryBackupStep(
          options,
          `恢复预览：核对删除标记 ${i} / ${incoming.removed.length}`,
        );
      if (localMarkerKeys.has(mark.key)) {
        markerDuplicates++;
        continue;
      }
      if (
        baseline.entries.some(
          (e) =>
            e.key === mark.key ||
            (mark.classicProof &&
              proofs.get(e.key) &&
              sameClassicLibraryProof(mark.classicProof, proofs.get(e.key)!)),
        )
      ) {
        markerConflicts++;
        continue;
      }
      marks.push(mark);
    }
    const finalCount = baseline.entries.length + records.length,
      finalBytes = [...baseline.entries, ...records.map((r) => r.entry)].reduce(
        (n, e) => n + e.bytes,
        0,
      );
    let reason = '';
    if (finalCount > this.limits.count || finalBytes > this.limits.bytes)
      reason =
        '增量恢复会超过100局／64 MiB应用上限，整批未写入；不会自动清库。';
    if (baseline.removed.length + marks.length > libraryBackupLimits.removed)
      reason = '合并后的删除标记超过8192条备份上限，整批未写入。';
    if (!reason) {
      await libraryBackupStep(
        options,
        '恢复预览：核验合并后的容量与元数据边界…',
      );
      try {
        validateLibraryBackupData({
          entries: [...baseline.entries, ...records.map((r) => r.entry)],
          payloads: [...baseline.payloads, ...additions],
          removed: [...baseline.removed, ...marks],
        });
      } catch (error) {
        reason =
          error instanceof Error ? error.message : '整库合并超过有界上限。';
      }
    }
    await libraryBackupStep(options, '恢复预览：最后核对本机快照，尚未写入…');
    await this.bulkCommit(
      baseline,
      (_tx, done) => done(true),
      'readonly',
      options.signal,
    );
    const preview: LibraryRestorePreview = Object.freeze({
      exportedAt: incoming.exportedAt,
      exportedBuild: incoming.exportedBuild,
      rows,
      added: records.length,
      duplicates: rows.filter((r) => r.status === 'duplicate').length,
      blocked: rows.filter((r) => r.status === 'blocked').length,
      markerAdded: marks.length,
      markerDuplicates,
      markerConflicts,
      finalCount,
      finalBytes,
      canRestore: !reason,
      reason,
    });
    this.backupPlans.set(preview, {
      baseline,
      records,
      payloads: additions,
      marks,
      allowed: !reason,
      reason,
    });
    return preview;
  }
  async isBackupPreviewCurrent(
    preview: LibraryRestorePreview,
  ): Promise<boolean> {
    const plan = this.backupPlans.get(preview);
    if (!plan) return false;
    try {
      await this.bulkCommit(
        plan.baseline,
        (_tx, done) => done(true),
        'readonly',
      );
      return true;
    } catch (error) {
      if (error instanceof LibraryBackupChangedError) return false;
      throw error;
    }
  }
  /** Release source payloads held by a cancelled/replaced preview, without storage writes. */
  discardBackupPreview(preview: LibraryRestorePreview): void {
    this.backupPlans.delete(preview);
  }
  /** One atomic append transaction: never clear, overwrite first records, or revive local tombstones. */
  async restoreBackup(
    preview: LibraryRestorePreview,
    options: LibraryBackupOptions = {},
  ) {
    const plan = this.backupPlans.get(preview);
    if (!plan) throw Error('整库预览不存在或已使用，请重新核对。');
    if (!plan.allowed) throw Error(plan.reason);
    checkLibraryAbort(options.signal);
    await libraryBackupStep(
      options,
      '整库恢复：核对原预览并准备原子提交，请等待结果…',
    );
    const result = await this.bulkCommit<{
      added: number;
      markersAdded: number;
      duplicates: number;
      blocked: number;
      markerConflicts: number;
    }>(
      plan.baseline,
      (tx, done) => {
        for (const record of plan.records)
          tx.objectStore('index').add(record.entry);
        for (const payload of plan.payloads)
          tx.objectStore('payload').add(payload);
        for (const mark of plan.marks) tx.objectStore('removed').add(mark);
        done({
          added: plan.records.length,
          markersAdded: plan.marks.length,
          duplicates: preview.duplicates,
          blocked: preview.blocked,
          markerConflicts: preview.markerConflicts,
        });
      },
      'readwrite',
      options.signal,
    );
    this.backupPlans.delete(preview);
    if (result.added || result.markersAdded) announce();
    return result;
  }
  async list(): Promise<ReplayLibraryEntry[]> {
    return this.transaction('readonly', (tx, result, fail) => {
      const request = tx.objectStore('index').getAll();
      request.onsuccess = () => {
        if (!request.result.every(validEntry)) {
          fail(Error('回放库索引损坏，原数据保留，未重建或覆盖。'));
          return;
        }
        result(
          request.result.sort(
            (a: ReplayLibraryEntry, b: ReplayLibraryEntry) =>
              b.savedAt.localeCompare(a.savedAt) || a.key.localeCompare(b.key),
          ),
        );
      };
    });
  }
  async add(
    prepared: PreparedReplay,
  ): Promise<'added' | 'duplicate' | 'removed'> {
    // Freeze caller-owned data before any asynchronous validation.
    prepared = structuredClone(prepared);
    if (
      !validEntry(prepared.entry) ||
      encoder.encode(prepared.source).length !== prepared.entry.bytes ||
      (await sha256(prepared.source)) !== prepared.entry.payloadHash
    )
      throw Error('待入库数据不完整，未写入。');
    const incoming = await this.decode(
      prepared.entry.key,
      prepared.entry,
      prepared.source,
    );
    const proof =
      incoming.document.mode === 'classic'
        ? await classicLibraryProof(incoming.document.replay, sha256)
        : null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = await this.snapshot(),
        witnesses = new Map<string, unknown>();
      let duplicate: string | undefined;
      const candidates = snapshot.entries
        .filter(
          (e) =>
            e.key === prepared.entry.key ||
            (proof &&
              e.mode === 'classic' &&
              e.replayId === prepared.entry.replayId),
        )
        .sort(
          (a, b) =>
            Date.parse(a.savedAt) - Date.parse(b.savedAt) ||
            a.key.localeCompare(b.key),
        );
      for (const entry of candidates) {
        const source = await this.payloadSource(entry.key);
        witnesses.set(entry.key, source);
        const stored = await this.decode(entry.key, entry, source);
        if (
          entry.key === prepared.entry.key ||
          (proof &&
            stored.document.mode === 'classic' &&
            sameClassicLibraryProof(
              proof,
              await classicLibraryProof(stored.document.replay, sha256),
            ))
        ) {
          duplicate ??= entry.key;
        }
      }
      const marks = snapshot.removed.filter(
        (r) =>
          r.key === prepared.entry.key ||
          (proof &&
            r.classicProof &&
            sameClassicLibraryProof(proof, r.classicProof)),
      );
      const result = await this.commitSnapshot<
        'added' | 'duplicate' | 'removed'
      >(snapshot, witnesses, (tx, done, fail) => {
        if (duplicate) {
          done('duplicate');
          return;
        }
        if (marks.length && prepared.entry.origin === 'automatic') {
          done('removed');
          return;
        }
        if (
          snapshot.entries.length >= this.limits.count ||
          snapshot.entries.reduce((n, e) => n + e.bytes, 0) +
            prepared.entry.bytes >
            this.limits.bytes
        ) {
          fail(Error('已达到应用保留上限，请先导出并明确删除不再保留的回放。'));
          return;
        }
        tx.objectStore('index').add(prepared.entry);
        tx.objectStore('payload').add({
          key: prepared.entry.key,
          source: prepared.source,
        });
        for (const mark of marks) tx.objectStore('removed').delete(mark.key);
        done('added');
      });
      if (result === retrySnapshot) continue;
      if (result === 'added') announce();
      return result;
    }
    throw Error('回放库在核验期间持续变化，未写入；原记录保留，请重试。');
  }
  async read(
    key: string,
  ): Promise<{ document: LibraryReplay; source: string }> {
    const stored = await this.transaction<{
      entry: ReplayLibraryEntry;
      source: string;
    }>('readonly', (tx, result) => {
      const entry = tx.objectStore('index').get(key),
        payload = tx.objectStore('payload').get(key);
      payload.onsuccess = () =>
        result({ entry: entry.result, source: payload.result?.source });
    });
    return this.decode(key, stored.entry, stored.source);
  }
  private async decode(
    key: string,
    entry: ReplayLibraryEntry,
    source: unknown,
  ): Promise<{ document: LibraryReplay; source: string }> {
    const stored = { entry, source };
    if (
      !validEntry(stored.entry) ||
      typeof stored.source !== 'string' ||
      encoder.encode(stored.source).length !== stored.entry.bytes ||
      (await sha256(stored.source)) !== stored.entry.payloadHash
    )
      throw Error('完整回放缺失或损坏，未打开；原数据保留。');
    const raw = await unpackDataFile(stored.source);
    const doc =
      stored.entry.mode === 'classic'
        ? parseReplay(raw.source)
        : parseSurvivalReplay(raw.source);
    const metadata = replayMetadata(doc);
    if (
      (await replayLibraryKey(doc)) !== key ||
      raw.originalBytes !== stored.entry.rawBytes ||
      raw.compressed !== stored.entry.compressed ||
      Object.entries(metadata).some(
        ([field, value]) =>
          stored.entry[field as keyof ReplayLibraryEntry] !== value,
      )
    )
      throw Error('回放索引与实际事实不一致，原数据保留。');
    return { document: doc, source: stored.source };
  }
  async remove(key: string): Promise<void> {
    if (!/^(classic|survival)\/[a-f0-9]{64}$/.test(key))
      throw Error('回放键无效，未删除。');
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = await this.snapshot(),
        entry = snapshot.entries.find((e) => e.key === key),
        witnesses = new Map<string, unknown>();
      let proof: ClassicLibraryProof | undefined;
      if (entry) {
        const source = await this.payloadSource(key);
        witnesses.set(key, source);
        try {
          const stored = await this.decode(key, entry, source);
          if (stored.document.mode === 'classic')
            proof = await classicLibraryProof(stored.document.replay, sha256);
        } catch {
          /* Explicit removal may clean a corrupt payload; retain an exact-key marker, never invent missing facts. */
        }
      } else proof = snapshot.removed.find((r) => r.key === key)?.classicProof;
      const result = await this.commitSnapshot(
        snapshot,
        witnesses,
        (tx, done) => {
          tx.objectStore('index').delete(key);
          tx.objectStore('payload').delete(key);
          tx.objectStore('removed').put({
            key,
            removedAt: new Date().toISOString(),
            ...(proof ? { classicProof: proof } : {}),
          });
          done(true);
        },
      );
      if (result === retrySnapshot) continue;
      announce();
      return;
    }
    throw Error('回放库在删除核验期间持续变化，未删除；原记录保留。');
  }
  private payloadSource(key: string): Promise<unknown> {
    return this.transaction('readonly', (tx, done) => {
      const request = tx.objectStore('payload').get(key);
      request.onsuccess = () => done(request.result?.source);
    });
  }
  private snapshot(): Promise<LibrarySnapshot> {
    return this.transaction('readonly', (tx, done, fail) => {
      const index = tx.objectStore('index').getAll(),
        removed = tx.objectStore('removed').getAll();
      let pending = 2;
      const finish = () => {
        if (--pending) return;
        if (!index.result.every(validEntry)) {
          fail(Error('回放库索引损坏，原数据保留，未写入。'));
          return;
        }
        if (!removed.result.every(validRemoved)) {
          fail(Error('回放库删除标记损坏或版本不支持，原数据保留。'));
          return;
        }
        done({
          entries: index.result,
          removed: removed.result,
          token: canonicalJson([index.result, removed.result]),
        });
      };
      index.onsuccess = removed.onsuccess = finish;
    });
  }
  /** All hashing/parsing happens before this short atomic transaction. Its first
   * requests compare the observed index+markers+candidate payloads; no async gaps
   * occur between that check and the mutation. Competing writers cause a re-read. */
  private commitSnapshot<T>(
    snapshot: LibrarySnapshot,
    sources: Map<string, unknown>,
    action: (
      tx: IDBTransaction,
      done: (value: T) => void,
      fail: (error: unknown) => void,
    ) => void,
    mode: IDBTransactionMode = 'readwrite',
  ): Promise<T | typeof retrySnapshot> {
    return this.transaction(mode, (tx, done, fail) => {
      const index = tx.objectStore('index').getAll(),
        removed = tx.objectStore('removed').getAll();
      let pending = 2;
      const finish = () => {
        if (--pending) return;
        try {
          if (
            canonicalJson([index.result, removed.result]) !== snapshot.token
          ) {
            done(retrySnapshot);
            return;
          }
          let left = sources.size,
            changed = false;
          const write = () => {
            try {
              action(tx, done, fail);
            } catch (error) {
              fail(error);
            }
          };
          if (!left) {
            write();
            return;
          }
          for (const [key, source] of sources) {
            const request = tx.objectStore('payload').get(key);
            request.onsuccess = () => {
              if (!samePayloadSource(request.result?.source, source))
                changed = true;
              if (--left === 0) {
                if (changed) done(retrySnapshot);
                else write();
              }
            };
          }
        } catch (error) {
          fail(error);
        }
      };
      index.onsuccess = removed.onsuccess = finish;
    });
  }
  /** Read-only audit: existing copies remain individually viewable/exportable.
   * Equivalence is always relative to the earliest original, never chained. */
  async classicEquivalentGroups(): Promise<ClassicEquivalentGroup[]> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = await this.snapshot(),
        witnesses = new Map<string, unknown>();
      const entries = snapshot.entries
        .filter((e) => e.mode === 'classic')
        .sort(
          (a, b) =>
            Date.parse(a.savedAt) - Date.parse(b.savedAt) ||
            a.key.localeCompare(b.key),
        );
      // Explicit audit verifies every classic payload, not just apparently
      // matching index IDs: corrupt metadata must not create a false "no copies".
      const candidates = entries;
      const keepers: Array<{
        entry: ReplayLibraryEntry;
        proof: ClassicLibraryProof;
        copies: string[];
      }> = [];
      for (const entry of candidates) {
        const source = await this.payloadSource(entry.key);
        witnesses.set(entry.key, source);
        const stored = await this.decode(entry.key, entry, source);
        if (stored.document.mode !== 'classic')
          throw Error('经典索引与回放模式不一致。');
        const proof = await classicLibraryProof(stored.document.replay, sha256),
          keeper = keepers.find((k) => sameClassicLibraryProof(k.proof, proof));
        if (keeper) keeper.copies.push(entry.key);
        else keepers.push({ entry, proof, copies: [] });
      }
      const unchanged = await this.commitSnapshot(
        snapshot,
        witnesses,
        (_tx, done) => done(true),
        'readonly',
      );
      if (unchanged === retrySnapshot) continue;
      return keepers
        .filter((k) => k.copies.length)
        .map((k) => ({ keeper: k.entry.key, copies: k.copies }));
    }
    throw Error('回放库在等价核验期间持续变化，请重新核对；原记录保留。');
  }
}
export const replayLibrary = new ReplayLibrary();
