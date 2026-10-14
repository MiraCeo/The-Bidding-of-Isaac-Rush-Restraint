import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {
  ReplayLibrary,
  librarySha256,
  prepareLibraryReplay,
  replaySource,
  newLibraryDocument,
  type PreparedReplay,
} from './replay-library';
import {
  parseLibraryBackup,
  serializeLibraryBackup,
  LibraryBackupChangedError,
  libraryBackupLimits,
  type LibraryBackupData,
} from './replay-library-backup-format';
import {
  equivalentPreparedFixture,
  editLibraryStore,
  seedLegacyLibrary,
} from './classic-library-equivalence.test-helper';
import { playLongRun } from './survival-long-run';
import { createSurvivalReplay } from './survival-record';
import { canonicalJson } from '../shared/json-facts';
import * as classicEngine from './game-session';
import * as survivalEngine from '../game/survival-session';
import * as classicReplayParser from './game-replay';
import { libraryBackupStep } from './replay-library-backup-format';

let original: PreparedReplay,
  nearby: PreparedReplay,
  branch: PreparedReplay,
  survival: PreparedReplay,
  factory: IDBFactory;
const oldKey = 'classic/' + 'e'.repeat(64);
beforeAll(async () => {
  original = await equivalentPreparedFixture();
  nearby = await equivalentPreparedFixture(1);
  branch = await equivalentPreparedFixture(0, true);
  survival = await prepareLibraryReplay(
    replaySource(
      newLibraryDocument({
        mode: 'survival',
        replay: createSurvivalReplay(playLongRun(3).game),
      }),
    ),
  );
});
beforeEach(() => {
  factory = new IDBFactory();
});
function db(limits = { count: 100, bytes: 64 * 1024 * 1024 }) {
  const name = crypto.randomUUID();
  return { name, library: new ReplayLibrary(() => factory, name, limits) };
}
const data = (doc: LibraryBackupData): LibraryBackupData => ({
  entries: doc.entries,
  payloads: doc.payloads,
  removed: doc.removed,
});
async function mixed() {
  const source = db();
  await source.library.list();
  await seedLegacyLibrary(factory, source.name, [original, nearby, survival]);
  await source.library.add(branch);
  await source.library.remove(branch.entry.key);
  await editLibraryStore(factory, source.name, 'removed', (s) =>
    s.add({ key: oldKey, removedAt: '2026-10-10T01:00:00Z' }),
  );
  return source;
}
it('publishes a stage and yields for cancellation before its following work', async () => {
  const controller = new AbortController(),
    progress = vi.fn(() => setTimeout(() => controller.abort(), 0));
  await expect(
    libraryBackupStep(
      { signal: controller.signal, onProgress: progress },
      '准备核验',
    ),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(progress).toHaveBeenCalledWith('准备核验');
});
it.each(['校验元数据并生成文件摘要', '再次核对本机资料'])(
  'can cancel export at the %s stage without creating a partial result or modifying data',
  async (stage) => {
    const source = db();
    await source.library.add(original);
    const before = await source.library.exportBackup(),
      controller = new AbortController();
    await expect(
      source.library.exportBackup({
        signal: controller.signal,
        onProgress: (text) => {
          if (text.includes(stage)) controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(data((await source.library.exportBackup()).document)).toEqual(
      data(before.document),
    );
  },
);
it('reports marker progress in bounded chunks and can cancel before a preview is offered', async () => {
  const source = db(),
    target = db();
  const marks = Array.from({ length: 600 }, (_, i) => ({
    key: 'classic/' + i.toString(16).padStart(64, '0'),
    removedAt: '2026-10-14T00:00:00Z',
  }));
  const packed = await serializeLibraryBackup({
      entries: [],
      payloads: [],
      removed: marks,
    }),
    controller = new AbortController(),
    updates: string[] = [];
  await expect(
    target.library.previewBackup(packed.source, {
      signal: controller.signal,
      onProgress: (text) => {
        updates.push(text);
        if (text.includes('删除标记 256 / 600')) controller.abort();
      },
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(updates.some((text) => text.includes('删除标记 0 / 600'))).toBe(true);
  expect(data((await target.library.exportBackup()).document)).toEqual(
    data((await source.library.exportBackup()).document),
  );
});
it('releases an explicitly discarded preview without deleting stored records', async () => {
  const source = db(),
    target = db();
  await source.library.add(original);
  const exported = await source.library.exportBackup(),
    preview = await target.library.previewBackup(exported.source);
  target.library.discardBackupPreview(preview);
  target.library.discardBackupPreview(preview);
  expect(await target.library.isBackupPreviewCurrent(preview)).toBe(false);
  await expect(target.library.restoreBackup(preview)).rejects.toThrow(
    '预览不存在',
  );
  expect(await target.library.list()).toEqual([]);
  expect((await source.library.read(original.entry.key)).source).toBe(
    original.source,
  );
});
it('still decodes every exported source even though export no longer retains all parsed documents', async () => {
  const source = db();
  await source.library.list();
  await seedLegacyLibrary(factory, source.name, [original, nearby]);
  const parser = vi.spyOn(classicReplayParser, 'parseReplay');
  try {
    expect((await source.library.exportBackup()).document.entries).toHaveLength(
      2,
    );
    expect(parser).toHaveBeenCalledTimes(2);
  } finally {
    parser.mockRestore();
  }
});
it('roundtrips both modes, legacy equivalent copies, first provenance and old/new deletion evidence exactly into an empty library', async () => {
  const source = await mixed(),
    exported = await source.library.exportBackup(),
    target = db();
  const preview = await target.library.previewBackup(exported.source);
  expect(preview).toMatchObject({
    added: 3,
    duplicates: 0,
    blocked: 0,
    markerAdded: 2,
    canRestore: true,
  });
  expect(await target.library.list()).toEqual([]);
  await target.library.restoreBackup(preview);
  const restored = await target.library.exportBackup();
  expect(data(restored.document)).toEqual(data(exported.document));
  expect((await target.library.read(original.entry.key)).source).toBe(
    original.source,
  );
  expect((await target.library.read(nearby.entry.key)).source).toBe(
    nearby.source,
  );
  expect(
    restored.document.removed.find((r) => r.key === oldKey),
  ).not.toHaveProperty('classicProof');
  expect(
    restored.document.removed.find((r) => r.key === branch.entry.key)
      ?.classicProof,
  ).toBeDefined();
  const second = await target.library.previewBackup(exported.source);
  expect(second).toMatchObject({
    added: 0,
    duplicates: 3,
    markerAdded: 0,
    markerDuplicates: 2,
  });
  await target.library.restoreBackup(second);
  expect(data((await target.library.exportBackup()).document)).toEqual(
    data(exported.document),
  );
}, 20000);
it('keeps the first local equivalent source and timestamp instead of replacing it with either backup copy', async () => {
  const source = await mixed(),
    target = db();
  const stored = structuredClone(nearby);
  stored.entry.origin = 'automatic';
  stored.entry.savedAt = '2026-10-09T01:00:00Z';
  await target.library.add(stored);
  const before = await target.library.list(),
    exported = await source.library.exportBackup();
  const preview = await target.library.previewBackup(exported.source);
  expect(preview).toMatchObject({ added: 1, duplicates: 2, blocked: 0 });
  await target.library.restoreBackup(preview);
  expect(
    (await target.library.list()).find((e) => e.key === stored.entry.key),
  ).toEqual(before[0]);
  expect((await target.library.read(stored.entry.key)).source).toBe(
    stored.source,
  );
  expect(await target.library.add(original)).toBe('duplicate');
});
it('never revives an exact or semantically deleted local record, even when the source backup includes it', async () => {
  const source = await mixed(),
    target = db();
  await target.library.add(nearby);
  await target.library.remove(nearby.entry.key);
  const preview = await target.library.previewBackup(
    (await source.library.exportBackup()).source,
  );
  expect(preview).toMatchObject({ added: 1, blocked: 2, duplicates: 0 });
  await target.library.restoreBackup(preview);
  expect((await target.library.list()).map((e) => e.mode)).toEqual([
    'survival',
  ]);
  expect(
    await target.library.add({
      ...original,
      entry: { ...original.entry, origin: 'automatic' },
    }),
  ).toBe('removed');
});
it('does not import deletion evidence over a currently live local fact or delete that fact', async () => {
  const source = await mixed(),
    target = db();
  await target.library.add(branch);
  const preview = await target.library.previewBackup(
    (await source.library.exportBackup()).source,
  );
  expect(preview.markerConflicts).toBe(1);
  await target.library.restoreBackup(preview);
  expect((await target.library.read(branch.entry.key)).source).toBe(
    branch.source,
  );
  expect(
    (await target.library.exportBackup()).document.removed.some(
      (r) => r.key === branch.entry.key,
    ),
  ).toBe(false);
}, 20000);
it.each(['index', 'payload', 'removed'] as const)(
  'rejects a stale preview after %s changes, without automatically recomputing an approved plan',
  async (store) => {
    const source = await mixed(),
      target = db();
    await target.library.add(branch);
    const preview = await target.library.previewBackup(
      (await source.library.exportBackup()).source,
    );
    await editLibraryStore(factory, target.name, store, (s) => {
      if (store === 'index')
        s.put({ ...branch.entry, savedAt: '2026-10-08T00:00:00Z' });
      if (store === 'payload')
        s.put({ key: branch.entry.key, source: branch.source + ' ' });
      if (store === 'removed')
        s.add({ key: oldKey, removedAt: '2026-10-09T00:00:00Z' });
    });
    expect(await target.library.isBackupPreviewCurrent(preview)).toBe(false);
    await expect(target.library.restoreBackup(preview)).rejects.toThrow(
      LibraryBackupChangedError,
    );
    expect(await target.library.list()).toHaveLength(1);
  },
);
it.each([
  { count: 2, bytes: 64 * 1024 * 1024 },
  { count: 100, bytes: 1 },
])(
  'rejects the entire batch at application limits %j and retains every local record',
  async (limits) => {
    const source = await mixed(),
      target = db(limits);
    const preview = await target.library.previewBackup(
      (await source.library.exportBackup()).source,
    );
    expect(preview.canRestore).toBe(false);
    await expect(target.library.restoreBackup(preview)).rejects.toThrow('上限');
    expect(await target.library.list()).toEqual([]);
  },
);
it.each(['payload', 'removed'])(
  'rolls back all stores on a simulated mid-batch %s transaction failure',
  async (failedStore) => {
    const source = await mixed(),
      target = db(),
      exported = await source.library.exportBackup();
    const preview = await target.library.previewBackup(exported.source),
      add = Reflect.get(
        IDBObjectStore.prototype,
        'add',
      ) as IDBObjectStore['add'];
    const spy = vi
      .spyOn(IDBObjectStore.prototype, 'add')
      .mockImplementation(function (this: IDBObjectStore, value, key) {
        if (this.name === failedStore)
          throw new DOMException('quota', 'QuotaExceededError');
        return add.call(this, value, key);
      });
    try {
      await expect(target.library.restoreBackup(preview)).rejects.toThrow(
        'quota',
      );
    } finally {
      spy.mockRestore();
    }
    expect(data((await target.library.exportBackup()).document)).toEqual({
      entries: [],
      payloads: [],
      removed: [],
    });
  },
);
it('preserves additional JSON provenance fields in indexes, payload rows and legacy markers instead of reconstructing them', async () => {
  const source = await mixed(),
    target = db();
  await editLibraryStore(factory, source.name, 'index', (s) =>
    s.put({
      ...original.entry,
      provenance: { file: 'original.json', note: 'retain raw metadata' },
    }),
  );
  await editLibraryStore(factory, source.name, 'payload', (s) =>
    s.put({
      key: original.entry.key,
      source: original.source,
      provenance: ['existing', 1],
    }),
  );
  await editLibraryStore(factory, source.name, 'removed', (s) =>
    s.put({
      key: oldKey,
      removedAt: '2026-10-10T01:00:00Z',
      note: 'old key-only evidence',
    }),
  );
  const exported = await source.library.exportBackup();
  await target.library.restoreBackup(
    await target.library.previewBackup(exported.source),
  );
  expect(data((await target.library.exportBackup()).document)).toEqual(
    data(exported.document),
  );
});
it('refuses unknown deletion-proof versions rather than silently turning them into old key-only marks', async () => {
  const source = await mixed(),
    target = db(),
    exported = await source.library.exportBackup();
  const invalid = JSON.parse(exported.source);
  invalid.removed.find(
    (r: { classicProof?: { version: number } }) => r.classicProof,
  ).classicProof.version = 2;
  await expect(
    target.library.previewBackup(JSON.stringify(invalid)),
  ).rejects.toThrow('删除标记损坏');
  expect(await target.library.list()).toEqual([]);
});
it('retries an export snapshot changed during verification and exports the new consistent metadata', async () => {
  const source = db();
  await source.library.add(original);
  let changed = false;
  const writes: Promise<void>[] = [];
  const exported = await source.library.exportBackup({
    onProgress: () => {
      if (changed) return;
      changed = true;
      writes.push(
        editLibraryStore(factory, source.name, 'index', (s) =>
          s.put({ ...original.entry, savedAt: '2026-10-08T00:00:00Z' }),
        ),
      );
    },
  });
  await Promise.all(writes);
  expect(exported.document.entries[0]?.savedAt).toBe('2026-10-08T00:00:00Z');
});
it('does not expose a late successful export after cancellation during fact validation', async () => {
  const source = db();
  await source.library.add(original);
  const controller = new AbortController();
  await expect(
    source.library.exportBackup({
      signal: controller.signal,
      onProgress: () => controller.abort(),
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect((await source.library.read(original.entry.key)).source).toBe(
    original.source,
  );
});
it('reuses a verified document only inside a preview when the entire index and exact source match', async () => {
  const target = db();
  await target.library.add(original);
  const exported = await target.library.exportBackup();
  const parser = vi.spyOn(classicReplayParser, 'parseReplay');
  try {
    const preview = await target.library.previewBackup(exported.source);
    expect(preview.duplicates).toBe(1);
    expect(parser).toHaveBeenCalledTimes(1);
    await target.library.restoreBackup(preview);
  } finally {
    parser.mockRestore();
  }
  expect((await target.library.read(original.entry.key)).source).toBe(
    original.source,
  );
});
it('does not reuse across an index-only provenance change or a source change with a valid new hash', async () => {
  const target = db();
  await target.library.add(original);
  const exported = await target.library.exportBackup();
  await editLibraryStore(factory, target.name, 'index', (s) =>
    s.put({ ...original.entry, savedAt: '2026-10-08T00:00:00Z' }),
  );
  const parser = vi.spyOn(classicReplayParser, 'parseReplay');
  try {
    expect(
      (await target.library.previewBackup(exported.source)).duplicates,
    ).toBe(1);
    expect(parser).toHaveBeenCalledTimes(2);
    parser.mockClear();
    const source = original.source + ' ',
      entry = {
        ...original.entry,
        bytes: original.entry.bytes + 1,
        payloadHash: await librarySha256(source),
      };
    await editLibraryStore(factory, target.name, 'index', (s) => s.put(entry));
    await editLibraryStore(factory, target.name, 'payload', (s) =>
      s.put({ key: entry.key, source }),
    );
    expect(
      (await target.library.previewBackup(exported.source)).duplicates,
    ).toBe(1);
    expect(parser).toHaveBeenCalledTimes(2);
  } finally {
    parser.mockRestore();
  }
});
it('still rejects corrupted local metadata/source and final snapshot changes after reuse', async () => {
  const target = db();
  await target.library.add(original);
  const exported = await target.library.exportBackup(),
    preview = await target.library.previewBackup(exported.source);
  await editLibraryStore(factory, target.name, 'index', (s) =>
    s.put({ ...original.entry, payloadHash: '0'.repeat(64) }),
  );
  await expect(target.library.restoreBackup(preview)).rejects.toThrow(
    LibraryBackupChangedError,
  );
  await expect(target.library.previewBackup(exported.source)).rejects.toThrow(
    '缺失或损坏',
  );
  expect((await target.library.list())[0]?.payloadHash).toBe('0'.repeat(64));
});
it('aborts before and during append without leaving an index-only or tombstone-only batch', async () => {
  const source = await mixed(),
    target = db(),
    exported = await source.library.exportBackup();
  const controller = new AbortController();
  controller.abort();
  await expect(
    target.library.previewBackup(exported.source, {
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  const preview = await target.library.previewBackup(exported.source),
    running = new AbortController(),
    add = Reflect.get(IDBObjectStore.prototype, 'add') as IDBObjectStore['add'];
  const spy = vi
    .spyOn(IDBObjectStore.prototype, 'add')
    .mockImplementation(function (this: IDBObjectStore, value, key) {
      const result = add.call(this, value, key);
      running.abort();
      return result;
    });
  try {
    await expect(
      target.library.restoreBackup(preview, { signal: running.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  } finally {
    spy.mockRestore();
  }
  expect(await target.library.list()).toEqual([]);
});
it('rejects forged or already-consumed preview objects', async () => {
  const source = db(),
    target = db(),
    preview = await target.library.previewBackup(
      (await source.library.exportBackup()).source,
    );
  await expect(target.library.restoreBackup({ ...preview })).rejects.toThrow(
    '预览不存在',
  );
  await target.library.restoreBackup(preview);
  await expect(target.library.restoreBackup(preview)).rejects.toThrow(
    '预览不存在',
  );
});
it('fails whole export/restore for damaged facts, mismatched metadata, unsupported markers or orphan payloads without dropping anything', async () => {
  const source = await mixed(),
    exported = await source.library.exportBackup(),
    target = db();
  const tampered = JSON.parse(exported.source);
  tampered.entries[0].seed++;
  await expect(
    target.library.previewBackup(JSON.stringify(tampered)),
  ).rejects.toThrow('摘要不一致');
  const resigned = await serializeLibraryBackup(data(tampered));
  await expect(target.library.previewBackup(resigned.source)).rejects.toThrow(
    '索引与实际事实不一致',
  );
  await editLibraryStore(factory, source.name, 'payload', (s) =>
    s.add({ key: 'orphan', source: 'original-orphan' }),
  );
  await expect(source.library.exportBackup()).rejects.toThrow('损坏');
  await expect(
    target.library.previewBackup(
      JSON.stringify({ ...JSON.parse(exported.source), version: 2 }),
    ),
  ).rejects.toThrow('仅支持整库');
  expect(await target.library.list()).toEqual([]);
});
it('rejects prototype fields and bounded marker growth, and handles empty backups', async () => {
  const source = db(),
    exported = await source.library.exportBackup();
  expect(
    (await parseLibraryBackup('\uFEFF' + exported.source)).entries,
  ).toEqual([]);
  const poisoned = exported.source.replace(
    '"entries":[]',
    '"entries":[],"__proto__":{}',
  );
  await expect(parseLibraryBackup(poisoned)).rejects.toThrow('非法字段');
  const overflow = {
    entries: [],
    payloads: [],
    removed: Array.from(
      { length: libraryBackupLimits.removed + 1 },
      (_, i) => ({
        key: 'classic/' + i.toString(16).padStart(64, '0'),
        removedAt: '2026-10-09T00:00:00Z',
      }),
    ),
  };
  await expect(serializeLibraryBackup(overflow)).rejects.toThrow('上限');
});
it('exports and restores an actual library larger than a single-file 8 MiB limit without recompressing either raw payload', async () => {
  const source = db(),
    target = db();
  await source.library.list();
  const raw = async (p: PreparedReplay) => {
    const decoded = await import('./compressed-file').then((m) =>
      m.unpackDataFile(p.source),
    );
    const source = decoded.source + ' '.repeat(4 * 1024 * 1024),
      bytes = new TextEncoder().encode(source).length;
    return {
      source,
      entry: {
        ...p.entry,
        compressed: false,
        bytes,
        rawBytes: bytes,
        payloadHash: await librarySha256(source),
      },
    };
  };
  const prepared = [await raw(original), await raw(branch)];
  await seedLegacyLibrary(factory, source.name, prepared);
  const exported = await source.library.exportBackup();
  expect(new TextEncoder().encode(exported.source).length).toBeGreaterThan(
    8 * 1024 * 1024,
  );
  const preview = await target.library.previewBackup(exported.source);
  await target.library.restoreBackup(preview);
  expect((await target.library.read(original.entry.key)).source).toBe(
    prepared[0]!.source,
  );
  expect((await target.library.read(branch.entry.key)).source).toBe(
    prepared[1]!.source,
  );
}, 20000);
it('writes a retained mixed-library fixture and its roundtrip report without invoking game engines', async () => {
  const source = await mixed(),
    target = db();
  const classic = vi.spyOn(classicEngine, 'reduceGameSession'),
    survival = vi.spyOn(survivalEngine, 'survivalGameReducer');
  let exported, restored;
  try {
    exported = await source.library.exportBackup();
    await target.library.restoreBackup(
      await target.library.previewBackup(exported.source),
    );
    restored = await target.library.exportBackup();
    expect(classic).not.toHaveBeenCalled();
    expect(survival).not.toHaveBeenCalled();
  } finally {
    classic.mockRestore();
    survival.mockRestore();
  }
  expect(canonicalJson(data(exported!.document))).toBe(
    canonicalJson(data(restored!.document)),
  );
  const directory = resolve('work/library-backup-roundtrip');
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, 'mixed-library.backup.json'),
    exported!.source,
  );
  await writeFile(
    resolve(directory, 'mixed-library.restored.json'),
    restored!.source,
  );
  await writeFile(
    resolve(directory, 'report.json'),
    JSON.stringify(
      {
        version: 1,
        records: exported!.document.entries.length,
        removed: exported!.document.removed.length,
        bytes: Buffer.byteLength(exported!.source),
        sourceSha256: createHash('sha256')
          .update(exported!.source)
          .digest('hex'),
        dataSha256: createHash('sha256')
          .update(canonicalJson(data(exported!.document)))
          .digest('hex'),
        roundtripDataEqual: true,
        engineCalls: 0,
      },
      null,
      2,
    ),
  );
});
