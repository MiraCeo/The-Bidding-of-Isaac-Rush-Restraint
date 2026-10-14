import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  ReplayLibrary,
  replayLibraryKey,
  newLibraryDocument,
  prepareLibraryReplay,
  replaySource,
  type PreparedReplay,
} from './replay-library';
import {
  classicLibraryProof,
  sameClassicLibraryProof,
  validClassicLibraryProof,
} from './classic-library-equivalence';
import {
  classicEquivalentFixture,
  equivalentPreparedFixture,
  editLibraryStore,
  seedLegacyLibrary,
} from './classic-library-equivalence.test-helper';
import { parseReplay } from './game-replay';
import { unpackDataFile } from './compressed-file';
import { createSurvivalReplay } from './survival-record';
import { playLongRun } from './survival-long-run';
import * as engine from './game-session';
import * as survivalEngine from '../game/survival-session';
let original: PreparedReplay,
  nearby: PreparedReplay,
  farther: PreparedReplay,
  branch: PreparedReplay,
  factory: IDBFactory;
const digest = async (source: string) =>
  createHash('sha256').update(source).digest('hex');
beforeAll(async () => {
  [original, nearby, farther, branch] = await Promise.all([
    equivalentPreparedFixture(),
    equivalentPreparedFixture(1),
    equivalentPreparedFixture(3),
    equivalentPreparedFixture(0, true),
  ]);
});
beforeEach(() => {
  factory = new IDBFactory();
});
const db = (
  name = crypto.randomUUID(),
  limits = { count: 100, bytes: 64 * 1024 * 1024 },
) => new ReplayLibrary(() => factory, name, limits);
it('retains raw library keys while ignoring only positive knife amounts in the compact proof base', async () => {
  const a = classicEquivalentFixture(),
    b = classicEquivalentFixture(1),
    p = await classicLibraryProof(a.replay, digest),
    q = await classicLibraryProof(b.replay, digest);
  expect(await replayLibraryKey(a)).not.toBe(await replayLibraryKey(b));
  expect(sameClassicLibraryProof(p, q)).toBe(true);
  const r = await classicLibraryProof(
    classicEquivalentFixture(3).replay,
    digest,
  );
  expect(p.base).toBe(r.base);
  expect(sameClassicLibraryProof(p, r)).toBe(false);
  expect(
    sameClassicLibraryProof(
      p,
      await classicLibraryProof(
        classicEquivalentFixture(0, true).replay,
        digest,
      ),
    ),
  ).toBe(false);
  expect(validClassicLibraryProof({ ...p, version: 2 })).toBe(false);
  expect(validClassicLibraryProof({ ...p, amounts: [NaN] })).toBe(false);
});
it('deduplicates an equivalent different key while keeping the first raw payload and provenance exact', async () => {
  const library = db();
  await library.add(original);
  const before = await library.list();
  expect(
    await library.add({
      ...nearby,
      entry: { ...nearby.entry, origin: 'automatic' },
    }),
  ).toBe('duplicate');
  expect(await library.list()).toEqual(before);
  expect((await library.read(original.entry.key)).source).toBe(original.source);
  await expect(library.read(nearby.entry.key)).rejects.toThrow('缺失');
});
it('bridges legacy rows without rewriting their keys, indexes, sources or schema', async () => {
  const name = crypto.randomUUID(),
    library = db(name);
  await library.list();
  await seedLegacyLibrary(factory, name, [original]);
  const before = await library.list();
  expect(await library.add(nearby)).toBe('duplicate');
  expect(await library.list()).toEqual(before);
  expect((await library.read(original.entry.key)).source).toBe(original.source);
  expect(await factory.databases()).toEqual([{ name, version: 1 }]);
});
it('audits already-existing copies read-only, relative to the earliest index time, and preserves every record', async () => {
  const name = crypto.randomUUID(),
    library = db(name);
  await library.list();
  const a = {
      ...original,
      entry: { ...original.entry, savedAt: '2026-10-14T00:00:00Z' },
    },
    b = {
      ...nearby,
      entry: { ...nearby.entry, savedAt: '2026-10-14T00:01:00Z' },
    };
  await seedLegacyLibrary(factory, name, [b, a, branch]);
  const before = await library.list();
  const add = vi.spyOn(IDBObjectStore.prototype, 'add'),
    put = vi.spyOn(IDBObjectStore.prototype, 'put'),
    remove = vi.spyOn(IDBObjectStore.prototype, 'delete');
  try {
    expect(await library.classicEquivalentGroups()).toEqual([
      { keeper: a.entry.key, copies: [b.entry.key] },
    ]);
    expect(add).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
  }
  expect(await library.list()).toEqual(before);
  expect((await library.read(b.entry.key)).source).toBe(b.source);
});
it('does not grow equivalence transitively through a nearby middle copy', async () => {
  const name = crypto.randomUUID(),
    library = db(name);
  await library.list();
  const cases = [original, nearby, farther].map((p, i) => ({
    ...p,
    entry: { ...p.entry, savedAt: `2026-10-14T00:0${i}:00Z` },
  }));
  await seedLegacyLibrary(factory, name, cases);
  expect(await library.classicEquivalentGroups()).toEqual([
    { keeper: original.entry.key, copies: [nearby.entry.key] },
  ]);
  expect(await library.list()).toHaveLength(3);
});
it('selects the earliest actual timestamp across valid timezone representations without rewriting metadata', async () => {
  const name = crypto.randomUUID(),
    library = db(name);
  await library.list();
  const a = {
      ...original,
      entry: { ...original.entry, savedAt: '2026-10-14T08:00:00+08:00' },
    },
    b = {
      ...nearby,
      entry: { ...nearby.entry, savedAt: '2026-10-14T00:01:00Z' },
    };
  await seedLegacyLibrary(factory, name, [a, b]);
  expect(await library.classicEquivalentGroups()).toEqual([
    { keeper: a.entry.key, copies: [b.entry.key] },
  ]);
  expect(
    (await library.list()).find((e) => e.key === a.entry.key)!.savedAt,
  ).toBe(a.entry.savedAt);
});
it('keeps real same-seed branches and explanation changes outside two ULP distinct', async () => {
  const library = db();
  expect(await library.add(original)).toBe('added');
  expect(await library.add(branch)).toBe('added');
  expect(await library.add(farther)).toBe('added');
  expect(await library.list()).toHaveLength(3);
});
it('deduplicates simultaneous equivalent writes through independent connections', async () => {
  const name = crypto.randomUUID(),
    a = db(name),
    b = db(name);
  const results = await Promise.all([a.add(original), b.add(nearby)]);
  expect(results.sort()).toEqual(['added', 'duplicate']);
  const rows = await a.list();
  expect(rows).toHaveLength(1);
  expect((await a.read(rows[0]!.key)).source).toBe(
    rows[0]!.key === original.entry.key ? original.source : nearby.source,
  );
});
it('returns duplicate rather than a quota/count error for an equivalent file in a full library', async () => {
  const library = db(crypto.randomUUID(), {
    count: 1,
    bytes: original.entry.bytes,
  });
  await library.add(original);
  expect(await library.add(nearby)).toBe('duplicate');
  await expect(library.add(branch)).rejects.toThrow('上限');
  expect(await library.list()).toHaveLength(1);
});
it('rejects a corrupt exact-key copy even when an earlier valid equivalent sibling exists', async () => {
  const name = crypto.randomUUID(),
    library = db(name);
  await library.list();
  const a = {
      ...original,
      entry: { ...original.entry, savedAt: '2026-10-14T00:00:00Z' },
    },
    b = {
      ...nearby,
      entry: { ...nearby.entry, savedAt: '2026-10-14T00:01:00Z' },
    };
  await seedLegacyLibrary(factory, name, [a, b]);
  await editLibraryStore(factory, name, 'payload', (s) =>
    s.put({ key: b.entry.key, source: 'broken-original' }),
  );
  await expect(library.add(nearby)).rejects.toThrow('损坏');
  expect(await library.list()).toHaveLength(2);
  await expect(library.classicEquivalentGroups()).rejects.toThrow('损坏');
});
it('blocks automatic equivalent resurrection with a compact semantic deletion witness', async () => {
  const name = crypto.randomUUID(),
    library = db(name);
  await library.add(original);
  await library.remove(original.entry.key);
  expect(await library.list()).toHaveLength(0);
  expect(
    await library.add({
      ...nearby,
      entry: { ...nearby.entry, origin: 'automatic' },
    }),
  ).toBe('removed');
  expect(await library.list()).toHaveLength(0);
  let marker: unknown;
  await editLibraryStore(factory, name, 'removed', (s) => {
    const r = s.get(original.entry.key);
    r.onsuccess = () => {
      marker = r.result;
    };
  });
  expect(JSON.stringify(marker)).not.toContain('settlement');
  expect(JSON.stringify(marker)).not.toContain('ISAAC');
  expect(JSON.stringify(marker).length).toBeLessThan(16000);
});
it('manually re-enters an equivalent copy, clears relevant old deletion evidence and can delete/re-enter again', async () => {
  const name = crypto.randomUUID(),
    library = db(name);
  await library.add(original);
  await library.remove(original.entry.key);
  expect(await library.add(nearby)).toBe('added');
  await library.remove(nearby.entry.key);
  expect(
    await library.add({
      ...original,
      entry: { ...original.entry, origin: 'automatic' },
    }),
  ).toBe('removed');
  expect(await library.add(original)).toBe('added');
  expect(await library.list()).toHaveLength(1);
});
it('leaves other real-branch deletion markers intact when manually restoring an equivalent record', async () => {
  const library = db();
  await library.add(original);
  await library.add(branch);
  await library.remove(original.entry.key);
  await library.remove(branch.entry.key);
  await library.add(nearby);
  expect(
    await library.add({
      ...branch,
      entry: { ...branch.entry, origin: 'automatic' },
    }),
  ).toBe('removed');
  expect(await library.list()).toHaveLength(1);
});
it('keeps an active equivalent sibling and deletes only the selected physical record', async () => {
  const name = crypto.randomUUID(),
    library = db(name);
  await library.list();
  await seedLegacyLibrary(factory, name, [original, nearby]);
  await library.remove(nearby.entry.key);
  expect((await library.list()).map((e) => e.key)).toEqual([
    original.entry.key,
  ]);
  expect(
    await library.add({
      ...nearby,
      entry: { ...nearby.entry, origin: 'automatic' },
    }),
  ).toBe('duplicate');
  await library.remove(original.entry.key);
  expect(
    await library.add({
      ...nearby,
      entry: { ...nearby.entry, origin: 'automatic' },
    }),
  ).toBe('removed');
});
it('preserves legacy opaque deletion marks and does not invent evidence for already-erased explanation tails', async () => {
  const name = crypto.randomUUID(),
    library = db(name);
  await library.list();
  await editLibraryStore(factory, name, 'removed', (s) =>
    s.put({ key: original.entry.key, removedAt: new Date().toISOString() }),
  );
  expect(
    await library.add({
      ...original,
      entry: { ...original.entry, origin: 'automatic' },
    }),
  ).toBe('removed');
  // No original payload exists from which to recover old semantic evidence. Exact-key protection is unchanged.
  expect(await library.add(nearby)).toBe('added');
});
it('rejects damaged/future semantic markers without overwriting the marker or adding a file', async () => {
  const name = crypto.randomUUID(),
    library = db(name);
  await library.add(original);
  await library.remove(original.entry.key);
  await editLibraryStore(factory, name, 'removed', (s) => {
    const r = s.get(original.entry.key);
    r.onsuccess = () =>
      s.put({
        ...r.result,
        classicProof: { ...r.result.classicProof, version: 2 },
      });
  });
  await expect(library.add(nearby)).rejects.toThrow('删除标记');
  expect(await library.list()).toHaveLength(0);
});
it('rechecks changed candidate payloads before duplicate commit and refuses a newly corrupt source', async () => {
  const name = crypto.randomUUID(),
    library = db(name);
  await library.add(original);
  const originalPayloadRead = (
    library as unknown as { payloadSource: (key: string) => Promise<unknown> }
  ).payloadSource.bind(library);
  const spy = vi
    .spyOn(
      library as unknown as {
        payloadSource: (key: string) => Promise<unknown>;
      },
      'payloadSource',
    )
    .mockImplementation(async (key) => {
      const source = await originalPayloadRead(key);
      await editLibraryStore(factory, name, 'payload', (s) =>
        s.put({ key, source: 'changed-during-check' }),
      );
      return source;
    });
  try {
    await expect(library.add(nearby)).rejects.toThrow('损坏');
  } finally {
    spy.mockRestore();
  }
  expect(await library.list()).toHaveLength(1);
});
it('rolls back deletion and its semantic witness when the marker transaction fails', async () => {
  const library = db();
  await library.add(original);
  const put = Reflect.get(
    IDBObjectStore.prototype,
    'put',
  ) as IDBObjectStore['put'];
  const spy = vi
    .spyOn(IDBObjectStore.prototype, 'put')
    .mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      if (this.name === 'removed') throw Error('quota');
      return put.apply(this, args);
    });
  try {
    await expect(library.remove(original.entry.key)).rejects.toThrow('quota');
  } finally {
    spy.mockRestore();
  }
  expect((await library.read(original.entry.key)).source).toBe(original.source);
  expect(await library.add(nearby)).toBe('duplicate');
});
it('rechecks a concurrent deletion before an equivalent automatic add and never resurrects it', async () => {
  const name = crypto.randomUUID(),
    a = db(name),
    b = db(name);
  await a.add(original);
  let release!: () => void, observed!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    started = new Promise<void>((resolve) => {
      observed = resolve;
    });
  const sourceMethod = (
    a as unknown as { payloadSource: (key: string) => Promise<unknown> }
  ).payloadSource.bind(a);
  const spy = vi
    .spyOn(
      a as unknown as { payloadSource: (key: string) => Promise<unknown> },
      'payloadSource',
    )
    .mockImplementation(async (key) => {
      const source = await sourceMethod(key);
      observed();
      await gate;
      return source;
    });
  const adding = a.add({
    ...nearby,
    entry: { ...nearby.entry, origin: 'automatic' },
  });
  await started;
  await b.remove(original.entry.key);
  release();
  try {
    expect(await adding).toBe('removed');
  } finally {
    spy.mockRestore();
  }
  expect(await a.list()).toHaveLength(0);
});
it('does not normalize even one-ULP changes to any other numeric fact', async () => {
  const doc = classicEquivalentFixture(),
    r = doc.replay.rooms[11]!;
  const v = new DataView(new ArrayBuffer(8));
  v.setFloat64(0, r.settlement.scoreBreakdowns.human!.multiplier);
  v.setBigUint64(0, v.getBigUint64(0) + 1n);
  r.settlement.scoreBreakdowns.human!.multiplier = v.getFloat64(0);
  r.locator = undefined;
  const { replayRoomLocator } = await import('./replay-record');
  r.locator = replayRoomLocator(doc.replay, r);
  const changed = await prepareLibraryReplay(replaySource(doc)),
    library = db();
  await library.add(original);
  expect(await library.add(changed)).toBe('added');
  expect(await library.list()).toHaveLength(2);
});
it('refuses a false prepared index even if its transport hash and semantic facts are intact', async () => {
  const library = db();
  await expect(
    library.add({ ...original, entry: { ...original.entry, score: 12345 } }),
  ).rejects.toThrow('索引与实际事实');
  expect(await library.list()).toHaveLength(0);
});
it('does not invoke either engine during add, semantic audit, delete or equivalent automatic protection', async () => {
  const library = db();
  const c = vi.spyOn(engine, 'reduceGameSession'),
    cs = vi.spyOn(engine, 'createGameSession'),
    s = vi.spyOn(survivalEngine, 'survivalGameReducer'),
    ss = vi.spyOn(survivalEngine, 'startSurvivalGame');
  try {
    await library.add(original);
    await library.add(nearby);
    await library.classicEquivalentGroups();
    await library.remove(original.entry.key);
    await library.add({
      ...nearby,
      entry: { ...nearby.entry, origin: 'automatic' },
    });
    expect(c).not.toHaveBeenCalled();
    expect(cs).not.toHaveBeenCalled();
    expect(s).not.toHaveBeenCalled();
    expect(ss).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
  }
});
it('leaves survival identities, source preservation and deletion behavior unchanged', async () => {
  const doc = newLibraryDocument({
      mode: 'survival',
      replay: createSurvivalReplay(playLongRun(3).game),
    }),
    p = await prepareLibraryReplay(replaySource(doc)),
    library = db();
  await library.add(p);
  await library.remove(p.entry.key);
  expect(
    await library.add({ ...p, entry: { ...p.entry, origin: 'automatic' } }),
  ).toBe('removed');
  expect(await library.add(p)).toBe('added');
  expect((await library.read(p.entry.key)).source).toBe(p.source);
});
it('preserves original/copy/restored fixture files and a raw-key/semantic-proof report', async () => {
  const root = resolve('work/classic-library-equivalence');
  await mkdir(root, { recursive: true });
  const library = db();
  await library.add(original);
  await library.add(nearby);
  const restored = (await library.read(original.entry.key)).source;
  for (const [name, source] of Object.entries({
    original: original.source,
    equivalent: nearby.source,
    restored,
  }))
    await writeFile(resolve(root, `${name}.json`), source);
  const raw = (await unpackDataFile(original.source)).source,
    doc = parseReplay(raw),
    p = await classicLibraryProof(doc.replay, digest);
  expect(restored).toBe(original.source);
  await writeFile(
    resolve(root, 'report.json'),
    JSON.stringify(
      {
        rawKeys: [original.entry.key, nearby.entry.key],
        rawKeysDistinct: original.entry.key !== nearby.entry.key,
        semanticBase: p.base,
        firstSourceExact: true,
        libraryRecords: (await library.list()).length,
        sha256: createHash('sha256').update(original.source).digest('hex'),
        restoredSha256: createHash('sha256').update(restored).digest('hex'),
        fixtures:
          'one deterministic complete game and synthetic 1-ULP explanation copy, not two independent plays',
      },
      null,
      2,
    ),
  );
});
