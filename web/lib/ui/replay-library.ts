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
import { survivalReplayFactIdentity } from './survival-view-model';
import { packDataFile, unpackDataFile } from './compressed-file';
import { checkedJson, maxFileBytes } from './file-json';
import { assertCurrentFileHeader } from './file-protocol';
import { readBuildVersion } from './game-version';

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
const encoder = new TextEncoder();
async function sha256(source: string) {
  if (!globalThis.crypto?.subtle)
    throw Error('当前浏览器无法计算回放SHA256摘要，未写入。');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(source));
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export async function replayLibraryKey(document: LibraryReplay) {
  // The unrounded Moms Knife explanation can differ by a few ULPs between JS
  // runtimes. Normalize ONLY that display trigger in the identity projection;
  // all authoritative four-decimal scores, actions, balances and stored text
  // stay exact. This never changes the original saved payload or profile key.
  const facts =
    document.mode === 'classic'
      ? replayFactsIdentity(document.replay)
      : survivalReplayFactIdentity({
          ...document.replay,
          rooms: document.replay.rooms.map((room) => ({
            ...room,
            scoreBreakdowns: Object.fromEntries(
              Object.entries(room.scoreBreakdowns).map(([id, breakdown]) => [
                id,
                {
                  ...breakdown,
                  triggers: breakdown.triggers.map((trigger) =>
                    trigger.itemId === 'moms_knife' &&
                    trigger.kind === 'additive_score' &&
                    trigger.amount !== undefined
                      ? {
                          ...trigger,
                          amount: Number(trigger.amount.toFixed(8)),
                        }
                      : trigger,
                  ),
                },
              ]),
            ),
          })),
        });
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
        : null,
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
function validEntry(value: unknown): value is ReplayLibraryEntry {
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
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      let value: T, tx: IDBTransaction, failure: unknown;
      try {
        tx = db.transaction(['index', 'payload', 'removed'], mode);
      } catch (error) {
        db.close();
        reject(error);
        return;
      }
      tx.oncomplete = () => {
        db.close();
        resolve(value);
      };
      tx.onabort = () => {
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
            failure = error;
            tx.abort();
          },
        );
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
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
    // Encoding/hashing finishes BEFORE the transaction: no awaits in live IDB callbacks.
    if (
      !validEntry(prepared.entry) ||
      encoder.encode(prepared.source).length !== prepared.entry.bytes ||
      (await sha256(prepared.source)) !== prepared.entry.payloadHash
    )
      throw Error('待入库数据不完整，未写入。');
    const result = await this.transaction<'added' | 'duplicate' | 'removed'>(
      'readwrite',
      (tx, done, fail) => {
        const index = tx.objectStore('index'),
          removed = tx.objectStore('removed');
        const all = index.getAll();
        all.onsuccess = () => {
          if (!all.result.every(validEntry)) {
            fail(Error('回放库索引损坏，原数据保留，未写入。'));
            return;
          }
          if (
            all.result.some(
              (e: ReplayLibraryEntry) => e.key === prepared.entry.key,
            )
          ) {
            done('duplicate');
            return;
          }
          const tombstone = removed.get(prepared.entry.key);
          tombstone.onsuccess = () => {
            if (tombstone.result && prepared.entry.origin === 'automatic') {
              done('removed');
              return;
            }
            if (
              all.result.length >= this.limits.count ||
              all.result.reduce(
                (sum: number, e: ReplayLibraryEntry) => sum + e.bytes,
                0,
              ) +
                prepared.entry.bytes >
                this.limits.bytes
            ) {
              // No eviction, overwrite or checkpoint mutation on capacity failure.
              fail(
                Error('已达到应用保留上限，请先导出并明确删除不再保留的回放。'),
              );
              return;
            }
            try {
              index.add(prepared.entry);
              tx.objectStore('payload').add({
                key: prepared.entry.key,
                source: prepared.source,
              });
              removed.delete(prepared.entry.key);
              done('added');
            } catch (error) {
              fail(error);
            }
          };
        };
      },
    ).catch((error) => {
      throw Error(
        `回放入库失败（可能达到100局／64 MiB上限或浏览器额度不足）。原记录与续玩不变。${error instanceof Error ? error.message : ''}`,
      );
    });
    if (result === 'added') announce();
    // A damaged existing payload is not a successful duplicate. Never silently replace it.
    if (result === 'duplicate') await this.read(prepared.entry.key);
    return result;
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
    await this.transaction<void>('readwrite', (tx, done) => {
      tx.objectStore('index').delete(key);
      tx.objectStore('payload').delete(key);
      tx.objectStore('removed').put({
        key,
        removedAt: new Date().toISOString(),
      });
      done(undefined);
    });
    announce();
  }
}
export const replayLibrary = new ReplayLibrary();
