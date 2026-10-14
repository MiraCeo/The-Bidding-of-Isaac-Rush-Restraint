/** Opt-in native study. Fresh origin only; append synthetic data and retain it for inspection.
 * Never delete databases, clear user storage, download files, run AI, or change game/profile state. */
import {
  ReplayLibrary,
  replayLibraryDatabase,
  librarySha256,
  prepareLibraryReplay,
  replayLibraryKey,
  type ReplayLibraryEntry,
} from '../replay-library';
import {
  parseLibraryBackup,
  validateLibraryBackupData,
  checkLibraryAbort,
  yieldLibraryTask,
  type LibraryBackupData,
} from '../replay-library-backup-format';
import { unpackDataFile, packDataFile } from '../compressed-file';
import { parseSurvivalReplay } from '../survival-persistence';
import { canonicalJson } from '../../shared/json-facts';
import type { LargeLibraryCorpus } from './large-library-fixtures';

export interface StudyTiming {
  n: number;
  medianMs: number;
  p95Ms: number;
  maximumMs: number;
  samplesMs: number[];
}
export function studyStats(samplesMs: number[]): StudyTiming {
  if (!samplesMs.length || samplesMs.some((n) => !Number.isFinite(n) || n < 0))
    throw Error('无有效测量样本。');
  const ordered = samplesMs.slice().sort((a, b) => a - b);
  return {
    n: ordered.length,
    medianMs: ordered[Math.floor(ordered.length / 2)]!,
    p95Ms:
      ordered[
        Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)
      ]!,
    maximumMs: ordered.at(-1)!,
    samplesMs,
  };
}
export async function assertFreshStudyOrigin(
  factory: IDBFactory | undefined,
  storage: Pick<Storage, 'length'> | null,
) {
  if (
    !factory ||
    !storage ||
    storage.length !== 0 ||
    typeof factory.databases !== 'function'
  )
    throw Error('要求可核验的空白独立来源；未清除或覆盖已有资料。');
  if ((await factory.databases()).length !== 0)
    throw Error('此来源已有数据库，不能运行隔离测量；未清库。');
}
function heapSample(): number | null {
  const memory = (
    performance as Performance & { memory?: { usedJSHeapSize?: number } }
  ).memory;
  return typeof memory?.usedJSHeapSize === 'number' &&
    Number.isFinite(memory.usedJSHeapSize)
    ? memory.usedJSHeapSize
    : null;
}
function monitor() {
  const heaps: number[] = [],
    gaps: number[] = [],
    longTasks: number[] = [];
  let previous = performance.now();
  const sample = () => {
    const heap = heapSample();
    if (heap !== null) heaps.push(heap);
  };
  sample();
  const timer = setInterval(() => {
    const now = performance.now();
    gaps.push(Math.max(0, now - previous - 50));
    previous = now;
    sample();
  }, 50);
  let observer: PerformanceObserver | undefined;
  try {
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) longTasks.push(e.duration);
      });
      observer.observe({ type: 'longtask', buffered: false });
    }
  } catch {
    /* Optional measurement, not a persistence failure. */
  }
  return {
    sample,
    stop: () => {
      clearInterval(timer);
      sample();
      if (observer) {
        for (const e of observer.takeRecords()) longTasks.push(e.duration);
        observer.disconnect();
      }
      return {
        timerDelay: gaps.length ? studyStats(gaps) : null,
        longTasks: {
          supported: !!observer,
          count: longTasks.length,
          maximumMs: longTasks.length ? Math.max(...longTasks) : 0,
          totalMs: longTasks.reduce((n, v) => n + v, 0),
        },
        sampledHeapBytes: heaps.length
          ? {
              first: heaps[0],
              last: heaps.at(-1),
              maximumObserved: Math.max(...heaps),
              n: heaps.length,
            }
          : null,
        qualification:
          'timer delay is not FPS; sampled Chromium JS heap is not peak process memory; includes setup and verification',
      };
    },
  };
}
async function snapshot(
  factory: IDBFactory,
  name: string,
): Promise<LibraryBackupData> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result,
        tx = db.transaction(['index', 'payload', 'removed'], 'readonly'),
        index = tx.objectStore('index').getAll(),
        payload = tx.objectStore('payload').getAll(),
        removed = tx.objectStore('removed').getAll();
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
      tx.oncomplete = () => {
        db.close();
        resolve({
          entries: index.result,
          payloads: payload.result,
          removed: removed.result,
        });
      };
    };
  });
}
async function sameData(a: LibraryBackupData, b: LibraryBackupData) {
  const ordered = (d: LibraryBackupData) => [
    d.entries.slice().sort((a, b) => a.key.localeCompare(b.key)),
    d.payloads.slice().sort((a, b) => a.key.localeCompare(b.key)),
    d.removed.slice().sort((a, b) => a.key.localeCompare(b.key)),
  ];
  return (
    (await librarySha256(canonicalJson(ordered(a)))) ===
    (await librarySha256(canonicalJson(ordered(b))))
  );
}
async function appendMarkers(
  factory: IDBFactory,
  name: string,
  from: number,
  to: number,
  corpus: LargeLibraryCorpus,
  signal?: AbortSignal,
) {
  for (let begin = from; begin < to; begin += 256) {
    checkLibraryAbort(signal);
    await new Promise<void>((resolve, reject) => {
      const request = factory.open(name, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result,
          tx = db.transaction('removed', 'readwrite');
        const abort = () => {
          try {
            tx.abort();
          } catch {
            /* Finished. */
          }
        };
        signal?.addEventListener('abort', abort, { once: true });
        tx.oncomplete = () => {
          signal?.removeEventListener('abort', abort);
          db.close();
          resolve();
        };
        tx.onabort = () => {
          signal?.removeEventListener('abort', abort);
          db.close();
          reject(tx.error ?? Error('标记设置已中止。'));
        };
        for (let i = begin; i < Math.min(to, begin + 256); i++) {
          const key =
            'classic/' + 'f'.repeat(56) + i.toString(16).padStart(8, '0');
          if (corpus.prepared.some((p) => p.entry.key === key)) {
            tx.abort();
            return;
          }
          tx.objectStore('removed').add({
            key,
            removedAt: '2026-10-14T08:00:00.000Z',
            ...(i % 2 ? { classicProof: corpus.markerProof } : {}),
          });
        }
      };
    });
    await yieldLibraryTask(signal);
  }
}
export async function runLargeLibraryStudy(
  corpus: LargeLibraryCorpus,
  options: {
    phase: string;
    factory?: IDBFactory;
    storage?: Pick<Storage, 'length'> | null;
    signal?: AbortSignal;
    onProgress?: (message: string) => void;
    onReport?: (report: unknown) => void;
    measureUi?: (entries: ReplayLibraryEntry[]) => Promise<unknown>;
  },
) {
  const factory = options.factory ?? globalThis.indexedDB,
    storage = options.storage === undefined ? localStorage : options.storage;
  await assertFreshStudyOrigin(factory, storage);
  if (
    corpus.kind !== 'large-library-study-corpus-1' ||
    corpus.prepared.length !== 100 ||
    new Set(corpus.prepared.map((p) => p.entry.key)).size !== 100 ||
    corpus.anchor.rooms !== 35
  )
    throw Error('研究数据身份／数量无效，未写入。');
  checkLibraryAbort(options.signal);
  const progress = options.onProgress ?? (() => {}),
    signal = options.signal,
    ui = monitor(),
    run = crypto.randomUUID(),
    library = new ReplayLibrary(() => factory, replayLibraryDatabase),
    cases: unknown[] = [],
    markerCases: unknown[] = [];
  const report = {
    kind: 'native-large-library-performance-study-1',
    phase: options.phase,
    run,
    createdAt: new Date().toISOString(),
    status: 'running',
    protocol: location.protocol,
    userAgent: navigator.userAgent,
    visibility: document.visibilityState,
    logicalProcessors: navigator.hardwareConcurrency,
    sampling:
      '3 timed repeats; 1 warmup for read-only operations; append population is a single-pass distribution; cold restore targets are distinct',
    dataScope:
      'synthetic corpus only; fresh origin; study databases retained, never deleted; no game/profile/localStorage writes, no native download',
    anchor: {} as Record<string, unknown>,
    cases,
    markerCases,
    runtime: null as unknown,
    error: '',
  };
  const emit = () => options.onReport?.(report);
  async function measure(
    label: string,
    action: () => Promise<unknown>,
    repeats = 3,
    warm = true,
  ) {
    checkLibraryAbort(signal);
    progress(label);
    ui.sample();
    if (warm) {
      await action();
      await yieldLibraryTask(signal);
    }
    const samples: number[] = [];
    for (let i = 0; i < repeats; i++) {
      checkLibraryAbort(signal);
      const start = performance.now();
      await action();
      samples.push(performance.now() - start);
      ui.sample();
      await yieldLibraryTask(signal);
    }
    return studyStats(samples);
  }
  try {
    const anchor = corpus.prepared.find(
      (p) => p.entry.key === corpus.anchor.key,
    )!;
    const anchorDoc = parseSurvivalReplay(corpus.anchor.raw);
    report.anchor = {
      rooms: 35,
      storedBytes: anchor.entry.bytes,
      rawBytes: anchor.entry.rawBytes,
      sha256Stored: await measure(
        '35房：正文SHA256',
        () => librarySha256(anchor.source),
        5,
      ),
      decompress: await measure(
        '35房：解压／容器核验',
        () => unpackDataFile(anchor.source),
        5,
      ),
      parseFacts: await measure(
        '35房：事实解析核验',
        async () => parseSurvivalReplay(corpus.anchor.raw),
        5,
      ),
      factIdentity: await measure(
        '35房：事实身份SHA256',
        () => replayLibraryKey(anchorDoc),
        5,
      ),
      compress: await measure(
        '35房：gzip打包',
        () => packDataFile(corpus.anchor.raw),
        5,
      ),
      prepare: await measure(
        '35房：正式入库准备',
        () => prepareLibraryReplay(corpus.anchor.raw),
        5,
      ),
    };
    emit();
    let populated = 0;
    for (const count of [10, 50, 100]) {
      const appendTimes: number[] = [];
      while (populated < count) {
        checkLibraryAbort(signal);
        progress(`${count}份库：插入第 ${populated + 1} 份`);
        const start = performance.now(),
          added = await library.add(corpus.prepared[populated]!);
        appendTimes.push(performance.now() - start);
        if (added !== 'added') throw Error('真实独立研究记录没有全部新增。');
        populated++;
        await yieldLibraryTask(signal);
      }
      const entries = await library.list(),
        expected = new Map(
          corpus.prepared.slice(0, count).map((p) => [p.entry.key, p]),
        );
      if (
        entries.length !== count ||
        entries.some(
          (e) => canonicalJson(e) !== canonicalJson(expected.get(e.key)?.entry),
        )
      )
        throw Error('研究库索引改变来源／数量。');
      const row: Record<string, unknown> = {
        count,
        classic: entries.filter((e) => e.mode === 'classic').length,
        survival: entries.filter((e) => e.mode === 'survival').length,
        storedBytes: entries.reduce((n, e) => n + e.bytes, 0),
        populateAppend: studyStats(appendTimes),
        list: await measure(`${count}份库：轻索引查询`, () => library.list()),
        readAnchor: await measure(`${count}份库：35房正式读取`, () =>
          library.read(corpus.anchor.key),
        ),
        duplicateAdd: await measure(`${count}份库：重复入库`, () =>
          library.add(anchor),
        ),
        nativeSnapshot: await measure(`${count}份库：原生三store只读快照`, () =>
          snapshot(factory, replayLibraryDatabase),
        ),
      };
      const exported = await library.exportBackup({ signal });
      row.exportFileBytes = new TextEncoder().encode(exported.source).length;
      row.export = await measure(`${count}份库：完整导出`, () =>
        library.exportBackup({ signal }),
      );
      row.parseContainer = await measure(`${count}份库：整库容器校验`, () =>
        parseLibraryBackup(exported.source, signal),
      );
      row.previewDuplicate = await measure(
        `${count}份库：重复恢复预览`,
        async () => {
          const p = await library.previewBackup(exported.source, { signal });
          if (p.added || p.duplicates !== count || !p.canRestore)
            throw Error('重复预览改变合并计划。');
        },
      );
      const previews: number[] = [],
        commits: number[] = [];
      for (let i = 0; i < 3; i++) {
        checkLibraryAbort(signal);
        progress(`${count}份库：空库恢复 ${i + 1}/3`);
        const name = `bidding-large-study-${run}-${count}-${i}`,
          target = new ReplayLibrary(() => factory, name);
        let start = performance.now();
        const preview = await target.previewBackup(exported.source, { signal });
        previews.push(performance.now() - start);
        start = performance.now();
        const restored = await target.restoreBackup(preview, { signal });
        commits.push(performance.now() - start);
        if (
          restored.added !== count ||
          !(await sameData(exported.document, await snapshot(factory, name)))
        )
          throw Error('空库恢复改变原索引／正文／标记。');
        await yieldLibraryTask(signal);
      }
      row.previewEmpty = studyStats(previews);
      row.restoreCommit = studyStats(commits);
      if (options.measureUi) {
        progress(`${count}份库：正式界面DOM提交与筛选`);
        row.ui = await options.measureUi(entries);
      }
      const after = await snapshot(factory, replayLibraryDatabase);
      if (!(await sameData(exported.document, after)) || storage?.length !== 0)
        throw Error('研究读取改变源库／localStorage。');
      row.sourceUnchanged = true;
      cases.push(row);
      ui.sample();
      emit();
    }
    let marked = 0;
    for (const count of [0, 1000, 8192]) {
      progress(`删除标记增长：设置 ${count} 条`);
      await appendMarkers(
        factory,
        replayLibraryDatabase,
        marked,
        count,
        corpus,
        signal,
      );
      marked = count;
      const before = await snapshot(factory, replayLibraryDatabase);
      validateLibraryBackupData(before);
      const exported = await library.exportBackup({ signal });
      const row = {
        count,
        oldKeyOnly: Math.ceil(count / 2),
        proofV1: Math.floor(count / 2),
        proofAmounts: corpus.markerProof.amounts.length,
        metadataBytes: new TextEncoder().encode(
          JSON.stringify([before.entries, before.removed]),
        ).length,
        exportFileBytes: new TextEncoder().encode(exported.source).length,
        export: await measure(
          `${count}条标记：完整导出`,
          () => library.exportBackup({ signal }),
          3,
          false,
        ),
        previewDuplicate: await measure(
          `${count}条标记：重复恢复预览`,
          async () => {
            const p = await library.previewBackup(exported.source, { signal });
            if (
              p.markerDuplicates !== count ||
              p.duplicates !== 100 ||
              p.added ||
              !p.canRestore
            )
              throw Error('标记增长改变恢复计划。');
          },
          3,
          false,
        ),
        sourceUnchanged: await sameData(
          before,
          await snapshot(factory, replayLibraryDatabase),
        ),
      };
      if (!row.sourceUnchanged) throw Error('标记读取改写资料。');
      markerCases.push(row);
      ui.sample();
      emit();
    }
    report.status = 'complete';
    return report;
  } catch (error) {
    report.status = signal?.aborted ? 'cancelled' : 'failed';
    report.error = error instanceof Error ? error.message : String(error);
    return report;
  } finally {
    report.runtime = ui.stop();
    emit();
  }
}
