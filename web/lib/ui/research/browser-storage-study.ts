/** Opt-in research harness for a fresh, isolated browser origin. Not imported by the game. */
import {
  parseGameSave,
  serializeGameCheckpoint,
  serializeGameBackup,
  persistGameSession,
  loadAutoSave,
  type SaveStorage,
} from '../game-save';
import {
  parseSurvivalCheckpoint,
  survivalSaveKey,
  survivalLastCompletedKey,
} from '../survival-persistence';
import { parseSurvivalBackup } from '../survival-backup';
import {
  serializeSurvivalCheckpoint,
  serializeSurvivalReplay,
  saveSurvivalProgress,
  loadSurvivalCheckpoint,
} from '../survival-persistence';
import { createSurvivalReplay } from '../survival-record';
import { packDataFile, unpackDataFile } from '../compressed-file';
import { canonicalJson } from '../../shared/json-facts';
import { inspectStorage } from '../storage-inspection';

type NativeStorage = SaveStorage & Pick<Storage, 'length' | 'key'>;
function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('已停止隔离测量。', 'AbortError');
}
async function yieldBrowser() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
function stats(times: number[]) {
  const ordered = times.slice().sort((a, b) => a - b);
  return {
    n: times.length,
    medianMs: ordered[Math.floor(ordered.length / 2)]!,
    p95Ms:
      ordered[
        Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)
      ]!,
    maximumMs: ordered.at(-1)!,
  };
}
async function measure(
  action: (index: number) => unknown,
  n = 5,
  signal?: AbortSignal,
) {
  const times = [];
  await action(-1);
  for (let i = 0; i < n; i++) {
    aborted(signal);
    const started = performance.now();
    await action(i);
    times.push(performance.now() - started);
    await yieldBrowser();
  }
  return stats(times);
}
/** Only this caller's new key is removed; an intervening replacement is left untouched. */
export async function probeIsolatedTextQuota(
  storage: NativeStorage,
  key: string,
  character: 'x' | '存',
  signal?: AbortSignal,
) {
  if (storage.getItem(key) !== null) throw Error('测试键已存在，未覆盖。');
  const step = 32768,
    cap = 6 * 1024 * 1024;
  let lower = 0,
    upper: number | null = null,
    last: string | null = null,
    attempts = 0;
  try {
    async function attempt(size: number) {
      aborted(signal);
      const source = character.repeat(size);
      attempts++;
      try {
        storage.setItem(key, source);
        last = source;
        if (storage.getItem(key) !== source)
          throw Error('测试写入未完整保存。');
        await yieldBrowser();
        aborted(signal);
        return true;
      } catch (error) {
        if (error instanceof Error && error.name === 'QuotaExceededError') {
          await yieldBrowser();
          aborted(signal);
          return false;
        }
        throw error;
      }
    }
    if (await attempt(cap)) {
      lower = cap;
    } else {
      let high = cap;
      while (high - lower > step) {
        const middle: number = Math.floor((lower + high) / 2 / step) * step;
        if (await attempt(middle)) lower = middle;
        else high = middle;
      }
      upper = high;
    }
    const encoder = new TextEncoder();
    return {
      character,
      attempts,
      largestAcceptedCodeUnits: lower,
      firstRejectedCodeUnits: upper,
      boundOnly: upper === null,
      acceptedUtf8TextBytes: encoder.encode(character.repeat(lower)).length,
      acceptedUtf16EstimateBytes: lower * 2,
      resolutionCodeUnits: step,
    };
  } finally {
    if (last !== null && storage.getItem(key) === last) storage.removeItem(key);
  }
}
export interface BrowserStudyInputs {
  classicActive: string;
  classicBackup: string;
  survivalActive: string;
  survivalBackup: string;
  survivalPreviousReplay: string;
}
export async function runBrowserStorageStudy(
  storage: NativeStorage,
  inputs: BrowserStudyInputs,
  {
    signal,
    onProgress = () => {},
  }: { signal?: AbortSignal; onProgress?: (message: string) => void } = {},
) {
  if (storage.length !== 0)
    throw Error('此来源已有数据，不能进行隔离容量探测；未清除或覆盖。');
  const prefix = 'bidding-storage-study-v1:' + crypto.randomUUID() + ':',
    owned = new Map<string, string>(),
    scoped: SaveStorage = {
      getItem: (key) => storage.getItem(prefix + key),
      setItem: (key, value) => {
        const target = prefix + key;
        if (!owned.has(target) && storage.getItem(target) !== null)
          throw Error('测试键冲突');
        storage.setItem(target, value);
        owned.set(target, value);
      },
      removeItem: (key) => {
        const target = prefix + key;
        if (
          owned.has(target) &&
          storage.getItem(target) === owned.get(target)
        ) {
          storage.removeItem(target);
          owned.delete(target);
        }
      },
    };
  const cleanup = () => {
    for (const [key, value] of owned) {
      if (storage.getItem(key) === value) storage.removeItem(key);
    }
    owned.clear();
  };
  try {
    onProgress('测量空来源的ASCII和中文文本容量…');
    const quotas = [];
    for (const character of ['x', '存'] as const)
      quotas.push(
        await probeIsolatedTextQuota(
          storage,
          prefix + character,
          character,
          signal,
        ),
      );
    aborted(signal);
    const classicActive = parseGameSave(inputs.classicActive),
      classicBackup = parseGameSave(inputs.classicBackup),
      survivalActive = parseSurvivalCheckpoint(inputs.survivalActive),
      survivalBackup = parseSurvivalBackup(inputs.survivalBackup),
      now = new Date('2026-10-14T00:00:00Z');
    const cases = [
      {
        name: 'classic-active',
        source: inputs.classicActive,
        serialize: () => serializeGameCheckpoint(classicActive.session, now),
        parse: () => parseGameSave(inputs.classicActive),
        save: () => persistGameSession(scoped, classicActive.session),
        load: () => loadAutoSave(scoped),
        game: classicActive.session.game,
      },
      {
        name: 'classic-complete',
        source: inputs.classicBackup,
        serialize: () =>
          serializeGameBackup(
            classicBackup.session,
            classicBackup.profile!,
            now,
          ),
        parse: () => parseGameSave(inputs.classicBackup),
        save: () => persistGameSession(scoped, classicBackup.session),
        load: null,
        game: classicBackup.session.game,
      },
      {
        name: 'survival-active',
        source: inputs.survivalActive,
        serialize: () =>
          serializeSurvivalCheckpoint(
            survivalActive.game,
            survivalActive.draft,
            now,
          ),
        parse: () => parseSurvivalCheckpoint(inputs.survivalActive),
        save: () =>
          saveSurvivalProgress(
            scoped,
            survivalActive.game,
            survivalActive.draft,
          ),
        load: () => loadSurvivalCheckpoint(scoped),
        game: survivalActive.game,
      },
      {
        name: 'survival-complete',
        source: inputs.survivalBackup,
        serialize: () =>
          serializeSurvivalReplay(
            createSurvivalReplay(survivalBackup.checkpoint.game),
            'browser-study',
            now,
          ),
        parse: () => parseSurvivalBackup(inputs.survivalBackup),
        save: () =>
          saveSurvivalProgress(scoped, survivalBackup.checkpoint.game, null),
        load: () => loadSurvivalCheckpoint(scoped),
        game: survivalBackup.checkpoint.game,
      },
    ];
    const measurements = [];
    for (const entry of cases) {
      onProgress('原生浏览器测量：' + entry.name);
      aborted(signal);
      cleanup();
      const before = canonicalJson(entry.game);
      const serialize = await measure(entry.serialize, 5, signal),
        parse = await measure(entry.parse, 5, signal),
        payloads = Array.from(
          { length: 6 },
          (_, i) => entry.source + ' '.repeat(i + 1),
        );
      const nativeWrite = await measure(
        (i) => scoped.setItem('raw-payload', payloads[i + 1]!),
        5,
        signal,
      );
      const nativeRead = await measure(
        () => {
          if (scoped.getItem('raw-payload') === null) throw Error('读取失败');
        },
        5,
        signal,
      );
      cleanup();
      const productionSave = await measure(
        () => {
          const result = entry.save();
          if (
            typeof result === 'boolean'
              ? !result
              : !result.checkpointSaved || result.archiveSaved === false
          )
            throw Error('正式保存失败');
        },
        5,
        signal,
      );
      const footprint = inspectStorage(storage),
        productionLoad = entry.load
          ? await measure(() => entry.load!(), 5, signal)
          : null;
      const packed = await packDataFile(entry.source),
        compression = await measure(
          () => packDataFile(entry.source),
          5,
          signal,
        ),
        decompression = await measure(
          () => unpackDataFile(packed.source),
          5,
          signal,
        );
      if ((await unpackDataFile(packed.source)).source !== entry.source)
        throw Error('压缩还原改变原文');
      if (canonicalJson(entry.game) !== before) throw Error('测量改变游戏状态');
      measurements.push({
        name: entry.name,
        serialize,
        parse,
        nativeWrite,
        nativeRead,
        productionSave,
        productionLoad,
        compression,
        decompression,
        utf8Bytes: new TextEncoder().encode(entry.source).length,
        compressedBytes: packed.fileBytes,
        automaticStorage: footprint,
        verified: true,
      });
      cleanup();
    }
    onProgress('真实配额失败时的检查点保留验证…');
    const game = survivalBackup.checkpoint.game;
    scoped.setItem(survivalSaveKey, inputs.survivalActive);
    scoped.setItem(survivalLastCompletedKey, inputs.survivalPreviousReplay);
    let padding = 0,
      nativeQuota = false;
    for (let next = 256 * 1024; next <= 6 * 1024 * 1024; next += 256 * 1024) {
      aborted(signal);
      try {
        scoped.setItem('quota-padding', 'x'.repeat(next));
        padding = next;
        await yieldBrowser();
      } catch (error) {
        if (error instanceof Error && error.name === 'QuotaExceededError') {
          nativeQuota = true;
          break;
        }
        throw error;
      }
    }
    if (!nativeQuota)
      throw Error('在有界测试范围内未遇到原生配额，不能声称完成原生失败验证。');
    scoped.setItem(
      'quota-padding',
      'x'.repeat(Math.max(0, padding - 256 * 1024)),
    );
    const failure = saveSurvivalProgress(scoped, game, null),
      restored = loadSurvivalCheckpoint(scoped),
      oldArchiveKept =
        scoped.getItem(survivalLastCompletedKey) ===
        inputs.survivalPreviousReplay;
    if (
      !failure.checkpointSaved ||
      failure.archiveSaved !== false ||
      !restored.document ||
      !oldArchiveKept ||
      canonicalJson(restored.document.game) !== canonicalJson(game)
    )
      throw Error('检查点失败保留验证未通过');
    cleanup();
    return {
      kind: 'native-browser-storage-study-1',
      createdAt: new Date().toISOString(),
      protocol: location.protocol,
      userAgent: navigator.userAgent,
      environment:
        'isolated empty origin; native localStorage and gzip; no layout/frame-rate measurements',
      quotas,
      measurements,
      archiveFailureKeepsCheckpoint: true,
      previousArchivePreserved: true,
      nativeQuotaFailureVerified: true,
      finalKeyCount: storage.length,
      cleanupVerified: storage.length === 0,
    };
  } finally {
    cleanup();
  }
}
