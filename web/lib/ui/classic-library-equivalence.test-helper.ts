import { IDBFactory, type IDBObjectStore } from 'fake-indexeddb';
import { classicCompletionFixture } from './completion-registry.test-helper';
import {
  newLibraryDocument,
  prepareLibraryReplay,
  replaySource,
  type PreparedReplay,
} from './replay-library';
import { replayRoomLocator } from './replay-record';
import type { ReplayDocument } from './game-replay';
export function classicEquivalentFixture(
  offset = 0,
  bid = false,
): ReplayDocument {
  const replay = classicCompletionFixture(42, bid).replay!;
  const view = new DataView(new ArrayBuffer(8));
  if (offset)
    for (const i of [11, 13]) {
      const room = replay.rooms[i]!;
      const t = Object.values(room.settlement.scoreBreakdowns)
        .flatMap((b) => b.triggers)
        .find((t) => t.itemId === 'moms_knife' && t.kind === 'additive_score')!;
      view.setFloat64(0, t.amount!);
      view.setBigUint64(0, view.getBigUint64(0) + BigInt(offset));
      t.amount = view.getFloat64(0);
      room.locator = replayRoomLocator(replay, { ...room, locator: undefined });
    }
  return newLibraryDocument({ mode: 'classic', replay }) as ReplayDocument;
}
export const equivalentPreparedFixture = async (offset = 0, bid = false) =>
  prepareLibraryReplay(replaySource(classicEquivalentFixture(offset, bid)));
export async function editLibraryStore(
  factory: IDBFactory,
  name: string,
  store: string,
  action: (s: IDBObjectStore) => void,
) {
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onsuccess = () => {
      const db = request.result,
        tx = db.transaction(store, 'readwrite');
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
      action(tx.objectStore(store));
    };
    request.onerror = () => reject(request.error);
  });
}
/** Seed actual schema1 legacy rows without calling the upgraded deduplication path. */
export async function seedLegacyLibrary(
  factory: IDBFactory,
  name: string,
  prepared: PreparedReplay[],
) {
  // The library is initialized separately by list(). No schema changes or synthetic bypass in production.
  await editLibraryStore(factory, name, 'index', (s) => {
    for (const p of prepared) s.add(p.entry);
  });
  await editLibraryStore(factory, name, 'payload', (s) => {
    for (const p of prepared) s.add({ key: p.entry.key, source: p.source });
  });
}
