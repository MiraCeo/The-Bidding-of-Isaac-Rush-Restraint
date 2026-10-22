import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ReplayLibrary,
  prepareLibraryReplay,
  replayLibraryKey,
  newLibraryDocument,
  replaySource,
} from './replay-library';
import { createGameSession, reduceGameSession } from './game-session';
import { serializeGameCheckpoint } from './game-save';
import { playLongRun } from './survival-long-run';
import { createSurvivalReplay } from './survival-record';
import { packDataFile, unpackDataFile } from './compressed-file';
import type { ReplayDocument } from './game-replay';
import type { PreparedReplay } from './replay-library';
import * as engine from './game-session';
import * as survivalEngine from '../game/survival-session';

export function classicLibraryFixture(seed = 42, bid = false) {
  let s = reduceGameSession(createGameSession(seed), {
    type: 'start_game',
    characterId: 'isaac',
  });
  for (let i = 0; i < 15; i++) {
    s = reduceGameSession(s, {
      type: 'submit_player_turn',
      turn: {
        playerId: 'human',
        actions:
          bid && i === 0
            ? [{ type: 'bid', group: 'A', amount: 20 }]
            : [{ type: 'withdraw' }],
      },
    });
    s = reduceGameSession(s, { type: 'advance_room' });
  }
  return newLibraryDocument({
    mode: 'classic',
    replay: s.replay!,
  }) as ReplayDocument;
}
let classic: PreparedReplay, survival: PreparedReplay;
beforeAll(async () => {
  classic = await prepareLibraryReplay(replaySource(classicLibraryFixture()));
  survival = await prepareLibraryReplay(
    replaySource(
      newLibraryDocument({
        mode: 'survival',
        replay: createSurvivalReplay(playLongRun(3).game),
      }),
    ),
  );
});
const db = (limits = { count: 100, bytes: 64 * 1024 * 1024 }) =>
  new ReplayLibrary(() => newFactory, crypto.randomUUID(), limits);
let newFactory: IDBFactory;
beforeEach(() => {
  newFactory = new IDBFactory();
});
async function mutate(
  factory: IDBFactory,
  name: string,
  store: string,
  action: (store: IDBObjectStore) => void,
) {
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onsuccess = () => {
      const connection = request.result,
        tx = connection.transaction(store, 'readwrite');
      tx.oncomplete = () => {
        connection.close();
        resolve();
      };
      tx.onabort = () => {
        connection.close();
        reject(tx.error);
      };
      action(tx.objectStore(store));
    };
    request.onerror = () => reject(request.error);
  });
}
describe('independent indexed replay library', () => {
  it('persists both complete modes through a fresh connection and only lists lightweight indexes', async () => {
    const name = crypto.randomUUID(),
      a = new ReplayLibrary(() => newFactory, name);
    await a.add(classic);
    await a.add(survival);
    const b = new ReplayLibrary(() => newFactory, name),
      rows = await b.list();
    expect(rows).toHaveLength(2);
    expect(rows.every((e) => e.completed)).toBe(true);
    expect(rows.find((e) => e.mode === 'survival')!.rooms).toBe(35);
    expect(JSON.stringify(rows)).not.toContain('settlement');
    expect((await b.read(classic.entry.key)).document).toEqual(
      (await a.read(classic.entry.key)).document,
    );
    expect(
      (await b.read(survival.entry.key)).document.replay.rooms,
    ).toHaveLength(35);
    expect(survival.entry.score).not.toBeNull();
  });
  it('deduplicates builds/export times but preserves the first original source and provenance', async () => {
    const library = db();
    await library.add(classic);
    const first = await library.read(classic.entry.key);
    const doc = first.document as ReplayDocument;
    doc.exportedAt = '2026-10-14T08:00:00.000Z';
    doc.exportedBuild = 'new-build';
    doc.replay.startedBuild = 'new-build';
    doc.replay.rooms.forEach((r) => {
      r.build = 'new-build';
    });
    doc.replay.final!.build = 'new-build';
    const reexport = await prepareLibraryReplay(replaySource(doc), 'manual');
    expect(reexport.entry.key).toBe(classic.entry.key);
    expect(await library.add(reexport)).toBe('duplicate');
    expect((await library.read(classic.entry.key)).source).toBe(first.source);
    expect((await library.list())[0]!.origin).toBe('import');
  });
  it('keeps two actual branches with the same replay ID separate', async () => {
    const branch = await prepareLibraryReplay(
      replaySource(classicLibraryFixture(42, true)),
    );
    expect(branch.entry.replayId).toBe(classic.entry.replayId);
    expect(branch.entry.key).not.toBe(classic.entry.key);
    const library = db();
    await library.add(classic);
    await library.add(branch);
    expect(await library.list()).toHaveLength(2);
  });
  it('serializes competing connections and deduplicates concurrent identical writes', async () => {
    const name = crypto.randomUUID(),
      a = new ReplayLibrary(() => newFactory, name),
      b = new ReplayLibrary(() => newFactory, name);
    expect(
      (await Promise.all([a.add(classic), b.add(classic)])).sort(),
    ).toEqual(['added', 'duplicate']);
    expect(await a.list()).toHaveLength(1);
  });
  it('enforces count limits inside the atomic write transaction without eviction', async () => {
    const library = db({ count: 1, bytes: 64 * 1024 * 1024 });
    const results = await Promise.allSettled([
      library.add(classic),
      library.add(survival),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rows = await library.list();
    expect(rows).toHaveLength(1);
    expect(
      (await library.read(rows[0]!.key)).document.replay.final,
    ).not.toBeNull();
    expect(
      await library.add(rows[0]!.mode === 'classic' ? classic : survival),
    ).toBe('duplicate');
  });
  it('enforces byte limits and keeps the prior payload exact', async () => {
    const library = db({
      count: 100,
      bytes: classic.entry.bytes + survival.entry.bytes - 1,
    });
    await library.add(classic);
    await expect(library.add(survival)).rejects.toThrow('上限');
    expect(await library.list()).toHaveLength(1);
    expect((await library.read(classic.entry.key)).source).toBe(classic.source);
  });
  it('rolls back an index when the payload transaction fails', async () => {
    const library = db(),
      original = Reflect.get(
        IDBObjectStore.prototype,
        'add',
      ) as IDBObjectStore['add'];
    const spy = vi
      .spyOn(IDBObjectStore.prototype, 'add')
      .mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        const request = original.call(this, value, key);
        if (this.name === 'payload') this.transaction.abort();
        return request;
      });
    await expect(library.add(classic)).rejects.toThrow('原记录');
    spy.mockRestore();
    expect(await library.list()).toHaveLength(0);
    expect(await library.add(classic)).toBe('added');
  });
  it('deletes only the selected replay and suppresses automatic re-archive, while manual re-add is explicit', async () => {
    const library = db();
    await library.add(classic);
    await library.add(survival);
    await library.remove(classic.entry.key);
    expect((await library.list()).map((e) => e.key)).toEqual([
      survival.entry.key,
    ]);
    expect(
      await library.add({
        ...classic,
        entry: { ...classic.entry, origin: 'automatic' },
      }),
    ).toBe('removed');
    await expect(library.read(classic.entry.key)).rejects.toThrow('缺失');
    expect(
      await library.add({
        ...classic,
        entry: { ...classic.entry, origin: 'manual' },
      }),
    ).toBe('added');
    expect(await library.list()).toHaveLength(2);
  });
  it('rejects a corrupt or missing payload without deleting or overwriting it on duplicate import', async () => {
    const name = crypto.randomUUID(),
      library = new ReplayLibrary(() => newFactory, name);
    await library.add(classic);
    await mutate(newFactory, name, 'payload', (store) =>
      store.put({ key: classic.entry.key, source: 'broken-original' }),
    );
    await expect(library.read(classic.entry.key)).rejects.toThrow('损坏');
    await expect(library.add(classic)).rejects.toThrow('损坏');
    expect(await library.list()).toHaveLength(1);
    await mutate(newFactory, name, 'payload', (store) =>
      store.delete(classic.entry.key),
    );
    await expect(library.read(classic.entry.key)).rejects.toThrow('缺失');
  });
  it('does not replace an invalid index during list or write', async () => {
    const name = crypto.randomUUID(),
      library = new ReplayLibrary(() => newFactory, name);
    await library.add(classic);
    await mutate(newFactory, name, 'index', (store) =>
      store.put({ ...classic.entry, bytes: -1 }),
    );
    await expect(library.list()).rejects.toThrow();
    await expect(library.add(survival)).rejects.toThrow();
  });
  it('rejects non-string index keys and dates without a callback exception or destructive repair', async () => {
    const name = crypto.randomUUID(),
      library = new ReplayLibrary(() => newFactory, name);
    await library.add(classic);
    await mutate(newFactory, name, 'index', (store) =>
      store.put({
        ...classic.entry,
        key: [classic.entry.key],
        savedAt: new Date(),
      }),
    );
    await expect(library.list()).rejects.toThrow('索引损坏');
    await expect(library.add(survival)).rejects.toThrow('索引损坏');
    expect((await library.read(classic.entry.key)).source).toBe(classic.source);
  });
  it('retains raw original bytes including BOM through packing and export', async () => {
    const raw = '\uFEFF' + (await unpackDataFile(classic.source)).source;
    const prepared = await prepareLibraryReplay(raw),
      library = db();
    await library.add(prepared);
    expect(
      (await unpackDataFile((await library.read(prepared.entry.key)).source))
        .source,
    ).toBe(raw);
  });
  it('reads compressed current files and rejects checkpoints or obsolete files', async () => {
    const raw = (await unpackDataFile(classic.source)).source;
    expect(
      (await prepareLibraryReplay((await packDataFile(raw)).source)).entry.key,
    ).toBe(classic.entry.key);
    const session = reduceGameSession(createGameSession(1), {
      type: 'start_game',
      characterId: 'lost',
    });
    await expect(
      prepareLibraryReplay(serializeGameCheckpoint(session)),
    ).rejects.toThrow('只接收v5回放');
    const obsolete = JSON.parse(raw);
    obsolete.version = 3;
    await expect(
      prepareLibraryReplay(JSON.stringify(obsolete)),
    ).rejects.toThrow('仅支持当前v5');
  });
  it('labels partial snapshots without inventing completion and preserves them independently', async () => {
    let s = reduceGameSession(createGameSession(8), {
      type: 'start_game',
      characterId: 'lost',
    });
    s = reduceGameSession(s, {
      type: 'submit_player_turn',
      turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
    });
    const partial = await prepareLibraryReplay(
        replaySource(
          newLibraryDocument({ mode: 'classic', replay: s.replay! }),
        ),
      ),
      library = db();
    expect(partial.entry.completed).toBe(false);
    expect(partial.entry.rank).toBeNull();
    await library.add(partial);
    expect(
      (await library.read(partial.entry.key)).document.replay.final,
    ).toBeNull();
  });
  it('validates readonly facts without starting or reducing either engine', async () => {
    const c = vi.spyOn(engine, 'reduceGameSession'),
      start = vi.spyOn(engine, 'createGameSession');
    const s = vi.spyOn(survivalEngine, 'survivalGameReducer'),
      startS = vi.spyOn(survivalEngine, 'startSurvivalGame');
    const library = db();
    await library.add(classic);
    await library.add(survival);
    await library.read(classic.entry.key);
    await library.read(survival.entry.key);
    await prepareLibraryReplay(survival.source);
    expect(c).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(s).not.toHaveBeenCalled();
    expect(startS).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  it('fails cleanly when IndexedDB is unavailable or access throws', async () => {
    await expect(new ReplayLibrary(() => undefined).list()).rejects.toThrow(
      'IndexedDB',
    );
    await expect(
      new ReplayLibrary(() => {
        throw new DOMException('blocked', 'SecurityError');
      }).add(classic),
    ).rejects.toThrow('blocked');
  });
  it('rejects a tampered prepared transport before writing', async () => {
    const library = db();
    await expect(
      library.add({ ...classic, source: classic.source + ' ' }),
    ).rejects.toThrow('不完整');
    expect(await library.list()).toHaveLength(0);
    expect(await replayLibraryKey(classicLibraryFixture())).toBe(
      classic.entry.key,
    );
  });
  it('rejects fact-compatible but false metadata without rewriting the index', async () => {
    const name = crypto.randomUUID(),
      library = new ReplayLibrary(() => newFactory, name);
    await library.add(classic);
    await mutate(newFactory, name, 'index', (store) =>
      store.put({ ...classic.entry, score: 999999 }),
    );
    await expect(library.read(classic.entry.key)).rejects.toThrow(
      '索引与实际事实',
    );
    expect((await library.list())[0]!.score).toBe(999999);
    await expect(library.add(classic)).rejects.toThrow('索引与实际事实');
  });
  it('falls back to raw current JSON when native compression is absent', async () => {
    const raw = (await unpackDataFile(classic.source)).source;
    vi.stubGlobal('CompressionStream', undefined);
    try {
      const prepared = await prepareLibraryReplay(raw),
        library = db();
      expect(prepared.entry.compressed).toBe(false);
      expect(prepared.source).toBe(raw);
      await library.add(prepared);
      expect((await library.read(prepared.entry.key)).source).toBe(raw);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('rejects checkpoint imports before any strict engine reconstruction', async () => {
    const session = reduceGameSession(createGameSession(1), {
      type: 'start_game',
      characterId: 'lost',
    });
    const source = serializeGameCheckpoint(session),
      reducer = vi.spyOn(engine, 'reduceGameSession'),
      start = vi.spyOn(engine, 'createGameSession');
    await expect(prepareLibraryReplay(source)).rejects.toThrow('只接收v5回放');
    expect(reducer).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  it('rejects deletion with a non-library key before creating a database', async () => {
    const factory = new IDBFactory(),
      open = vi.spyOn(factory, 'open'),
      library = new ReplayLibrary(() => factory);
    await expect(library.remove('bidding-player-profile-v1')).rejects.toThrow(
      '无效',
    );
    expect(open).not.toHaveBeenCalled();
  });
  it('preserves a future database schema instead of downgrading it', async () => {
    const name = crypto.randomUUID();
    await new Promise<void>((resolve, reject) => {
      const request = newFactory.open(name, 2);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('future');
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    await expect(
      new ReplayLibrary(() => newFactory, name).list(),
    ).rejects.toThrow();
    expect(await newFactory.databases()).toEqual([{ name, version: 2 }]);
  });
  // Full-game reconstruction/archiving can exceed 5s; keep assertions and the global default unchanged.
  it('deduplicates cross-runtime knife explanation tails but retains the first original and distinguishes real scoring changes', async () => {
    const library = db();
    await library.add(survival);
    const doc = (await library.read(survival.entry.key)).document;
    if (doc.mode !== 'survival') throw Error('Expected survival');
    const trigger = doc.replay.rooms
      .flatMap((r) =>
        Object.values(r.scoreBreakdowns).flatMap((b) => b.triggers),
      )
      .find((t) => t.itemId === 'moms_knife' && t.kind === 'additive_score')!;
    trigger.amount = trigger.amount! + 1e-13;
    const changed = await prepareLibraryReplay(replaySource(doc));
    expect(changed.source).not.toBe(survival.source);
    expect(changed.entry.key).toBe(survival.entry.key);
    expect(await library.add(changed)).toBe('duplicate');
    expect((await library.read(survival.entry.key)).source).toBe(
      survival.source,
    );
    trigger.amount += 0.00001;
    expect(await replayLibraryKey(doc)).not.toBe(survival.entry.key);
    const changedScore = structuredClone(doc);
    changedScore.replay.final!.ranking[0]!.finalScore += 0.0001;
    expect(await replayLibraryKey(changedScore)).not.toBe(
      await replayLibraryKey(doc),
    );
  }, 20000);
});
