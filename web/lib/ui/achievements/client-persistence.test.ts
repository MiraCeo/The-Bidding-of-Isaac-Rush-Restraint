import { expect, it } from 'vitest';
import {
  createGameSession,
  reduceGameSession,
  type GameSession,
} from '../game-session';
import { startSurvivalClient, reduceSurvivalClient } from '../survival-client';
import { longRunAction } from '../survival-long-run';
import { createSurvivalReplay } from '../survival-record';
import {
  beginClassicGrowth,
  beginSurvivalGrowth,
  bindGrowthEpoch,
  applyGrowthContext,
  validateGrowthContext,
} from './lifecycle';
import {
  saveClassicClient,
  saveSurvivalClient,
  mergeSavedGrowth,
} from './client-persistence';
import {
  gameSaveKey,
  parseGameSave,
  serializeGameCheckpoint,
  loadAutoSave,
} from '../game-save';
import {
  survivalSaveKey,
  survivalLastCompletedKey,
  parseSurvivalCheckpoint,
} from '../survival-persistence';
import {
  createPlayerProfile,
  playerProfileKey,
  readPlayerProfile,
} from '../player-profile';
import {
  readAchievementRegistry,
  manuallyUnlockAchievementCharacters,
} from './registry';
import { readCompletionRegistry, sumCounters } from '../completion-registry';
import {
  restoreClassicCoordinated,
  restoreSurvivalCoordinated,
  replacePlayerProfileCoordinated,
} from '../profile-operations';
import {
  profileWriteLockName,
  profileReplacementEpochKey,
  type ProfileWriteCoordinator,
} from '../profile-write-coordinator';
import { canonicalJson } from '../../shared/json-facts';
import { sha256Hex } from '../../shared/sha256';

function memory() {
  const entries = new Map<string, string>(),
    writes: string[] = [];
  return {
    entries,
    writes,
    getItem: (k: string) => entries.get(k) ?? null,
    setItem: (k: string, v: string) => {
      entries.set(k, v);
      writes.push(k);
    },
    removeItem: (k: string) => {
      entries.delete(k);
    },
  };
}
function locks(): ProfileWriteCoordinator {
  let tail = Promise.resolve<unknown>(undefined);
  return {
    exclusive: (name, work) => {
      expect(name).toBe(profileWriteLockName);
      const next = tail.then(work);
      tail = next.catch(() => {});
      return next;
    },
  };
}
function start(seed = 42) {
  return beginClassicGrowth(
    reduceGameSession(createGameSession(seed), {
      type: 'start_game',
      characterId: 'lost',
    }),
  );
}
function submit(s: GameSession) {
  return reduceGameSession(s, {
    type: 'submit_player_turn',
    turn: {
      playerId: 'human',
      actions: [{ type: 'bid', group: 'A', amount: 1 }],
    },
  });
}
function profile(store: ReturnType<typeof memory>) {
  return readPlayerProfile(JSON.parse(store.getItem(playerProfileKey)!));
}
const options = (
  store: ReturnType<typeof memory>,
  key = gameSaveKey,
  coordinator = locks(),
) => ({ expectedSource: store.getItem(key), coordinator });

it('commits real classic entry and settlement with paired acknowledgement and no draft/ranking awards', async () => {
  const store = memory(),
    coordinator = locks();
  let s = start();
  const entry = await saveClassicClient(
    store,
    s,
    options(store, gameSaveKey, coordinator),
  );
  s = entry.session;
  expect(s.growth!.acknowledged).toBe(1);
  expect(readAchievementRegistry(profile(store))!.receipts).toHaveLength(1);
  s = submit(s);
  const settled = await saveClassicClient(
    store,
    s,
    options(store, gameSaveKey, coordinator),
  );
  expect(settled.session.growth!.acknowledged).toBe(2);
  expect(loadAutoSave(store).session!.growth).toEqual(settled.session.growth);
  const originalProfile = store.getItem(playerProfileKey);
  const navigated = reduceGameSession(settled.session, {
    type: 'show_room_ranking',
    view: 'score',
  });
  await saveClassicClient(
    store,
    navigated,
    options(store, gameSaveKey, coordinator),
  );
  expect(store.getItem(playerProfileKey)).toBe(originalProfile);
  expect(store.writes.filter((k) => k === playerProfileKey)).toHaveLength(2);
});
it('uses committed cursor metadata only; identical acknowledgement merge keeps object identity', async () => {
  const store = memory(),
    s = submit(start());
  const saved = await saveClassicClient(store, s, options(store));
  const first = mergeSavedGrowth(s.growth!, s.growth!, saved.session.growth!);
  expect(first.acknowledged).toBe(2);
  expect(mergeSavedGrowth(first, first, first)).toBe(first);
  const alien = submit(start(90));
  expect(
    mergeSavedGrowth(alien.growth!, s.growth!, saved.session.growth!),
  ).toBe(alien.growth);
  const rolled = bindGrowthEpoch(s.growth!, sha256Hex('rollback'));
  expect(mergeSavedGrowth(rolled, s.growth!, saved.session.growth!)).toBe(
    rolled,
  );
});
it('reloads pending automatic local checkpoints once, but file import skips every pending prefix', async () => {
  const store = memory(),
    s = submit(start());
  store.setItem(gameSaveKey, serializeGameCheckpoint(s));
  const local = loadAutoSave(store).session!;
  await saveClassicClient(store, local, options(store));
  expect(readAchievementRegistry(profile(store))!.receipts).toHaveLength(2);
  const importedStore = memory();
  const imported = {
    ...local,
    growth: bindGrowthEpoch(local.growth!, null, { imported: true }),
  };
  const loaded = await saveClassicClient(
    importedStore,
    imported,
    options(importedStore),
  );
  expect(importedStore.getItem(playerProfileKey)).toBeNull();
  expect(loaded.session.growth!.ignoredThrough).toBe(2);
  expect(parseGameSave(loaded.source!).session.growth).toEqual(
    loaded.session.growth,
  );
  const next = reduceGameSession(loaded.session, { type: 'advance_room' });
  await saveClassicClient(importedStore, submit(next), options(importedStore));
  expect(
    readAchievementRegistry(profile(importedStore))!.receipts,
  ).toHaveLength(2);
});
it('preserves existing credited imported prefix instead of double-counting or borrowing missing facts', () => {
  const s = submit(start()),
    saved = applyGrowthContext(createPlayerProfile(), s.growth!);
  const imported = bindGrowthEpoch(saved.context, null, { imported: true });
  expect(applyGrowthContext(saved.profile, imported).profile).toBe(
    saved.profile,
  );
  const empty = createPlayerProfile();
  expect(applyGrowthContext(empty, imported).profile).toBe(empty);
});
it('same-authority repeated pending submission changes neither counters nor timestamps', async () => {
  const store = memory(),
    s = submit(start());
  await saveClassicClient(store, s, options(store));
  const before = store.getItem(playerProfileKey);
  const repeat = await saveClassicClient(store, s, options(store));
  expect(repeat.newlyAchieved).toEqual([]);
  expect(store.getItem(playerProfileKey)).toBe(before);
});
it('without Web Locks saves pending continuation but never awards growth', async () => {
  const store = memory(),
    s = submit(start());
  const saved = await saveClassicClient(store, s, {
    expectedSource: null,
    coordinator: null,
  });
  expect(saved.message).toContain('协调能力不可用');
  expect(saved.session.growth!.acknowledged).toBe(0);
  expect(store.getItem(playerProfileKey)).toBeNull();
  const retry = await saveClassicClient(
    store,
    loadAutoSave(store).session!,
    options(store),
  );
  expect(retry.session.growth!.acknowledged).toBe(2);
});
it('transaction quota failure rolls back companion writes and leaves only pending checkpoint; retry grants once', async () => {
  const store = memory(),
    s = submit(start()),
    baseSet = store.setItem;
  let quota = true;
  store.setItem = (k, v) => {
    if (quota && k === playerProfileKey) throw Error('quota');
    baseSet(k, v);
  };
  const saved = await saveClassicClient(store, s, options(store));
  expect(saved.message).toContain('待重试');
  expect(store.getItem(playerProfileKey)).toBeNull();
  expect([...store.entries.keys()]).toEqual([gameSaveKey]);
  expect(loadAutoSave(store).session!.growth!.acknowledged).toBe(0);
  quota = false;
  await saveClassicClient(store, s, options(store));
  expect(readAchievementRegistry(profile(store))!.receipts).toHaveLength(2);
});
it('mode source changed by another tab refuses both main transaction and pending fallback', async () => {
  const store = memory();
  store.setItem(gameSaveKey, 'foreign-tab');
  await expect(
    saveClassicClient(store, submit(start()), {
      expectedSource: null,
      coordinator: locks(),
    }),
  ).rejects.toThrow('其他页面');
  expect(store.getItem(gameSaveKey)).toBe('foreign-tab');
  expect(store.getItem(playerProfileKey)).toBeNull();
});
it('synchronous postcommit notification updates owned source before the save promise resolves', async () => {
  const store = memory();
  let notified: string | null = null;
  await saveClassicClient(store, start(), {
    ...options(store),
    onCommitted: (source) => {
      notified = source;
      expect(store.getItem(gameSaveKey)).toBe(source);
    },
  });
  expect(notified).toBe(store.getItem(gameSaveKey));
});
it('aborted lock-wait callback never writes and never invokes checkpoint fallback', async () => {
  const store = memory(),
    abort = new AbortController();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const coordinator: ProfileWriteCoordinator = {
    exclusive: async (_name, work) => {
      await gate;
      return work();
    },
  };
  const job = saveClassicClient(store, submit(start()), {
    expectedSource: null,
    coordinator,
    signal: abort.signal,
  });
  abort.abort();
  release();
  await expect(job).rejects.toMatchObject({ name: 'AbortError' });
  expect(store.entries.size).toBe(0);
});
it('corrupt current profile remains byte-exact while pending checkpoint may be retained', async () => {
  const store = memory();
  store.setItem(playerProfileKey, '{broken');
  const saved = await saveClassicClient(store, submit(start()), options(store));
  expect(saved.message).toContain('待重试');
  expect(store.getItem(playerProfileKey)).toBe('{broken');
  expect(saved.session.growth!.acknowledged).toBe(0);
});
it('explicit older standalone profile replacement rolls back growth/manual permissions, then only newly produced units count', async () => {
  const store = memory(),
    s = submit(start()),
    old = createPlayerProfile(new Date('2026-01-01'));
  const first = await saveClassicClient(store, s, options(store));
  const granted = manuallyUnlockAchievementCharacters(profile(store));
  store.setItem(playerProfileKey, JSON.stringify(granted));
  await replacePlayerProfileCoordinated(
    store,
    old,
    store.getItem(playerProfileKey),
    { coordinator: locks() },
  );
  expect(store.getItem(profileReplacementEpochKey)).toMatch(/^[a-f0-9]{64}$/);
  const unchanged = await saveClassicClient(
    store,
    first.session,
    options(store),
  );
  expect(store.getItem(playerProfileKey)).toBe(JSON.stringify(old));
  expect(unchanged.session.growth!.ignoredThrough).toBe(2);
  let next = reduceGameSession(unchanged.session, { type: 'advance_room' });
  next = submit(next);
  await saveClassicClient(store, next, options(store));
  expect(readAchievementRegistry(profile(store))!.receipts).toHaveLength(2);
  expect(readAchievementRegistry(profile(store))!.manualUnlockAllAt).toBeNull();
});
it('epoch replacement while writer waits ignores old unacknowledged prefix rather than re-awarding rollback', async () => {
  const store = memory(),
    coordinator = locks();
  const old = createPlayerProfile(new Date('2026-01-01'));
  store.setItem(playerProfileKey, JSON.stringify(createPlayerProfile()));
  const restore = replacePlayerProfileCoordinated(
    store,
    old,
    store.getItem(playerProfileKey),
    { coordinator },
  );
  const save = saveClassicClient(
    store,
    submit(start()),
    options(store, gameSaveKey, coordinator),
  );
  await restore;
  expect((await save).session.growth!.ignoredThrough).toBe(2);
  expect(store.getItem(playerProfileKey)).toBe(JSON.stringify(old));
});
it('failed epoch stamp rolls back both exact profile and paired match before publishing anything', async () => {
  const store = memory(),
    s = submit(start()),
    original = JSON.stringify(createPlayerProfile());
  store.setItem(playerProfileKey, original);
  const base = store.setItem;
  store.setItem = (k, v) => {
    if (k === profileReplacementEpochKey) throw Error('quota');
    base(k, v);
  };
  await expect(
    restoreClassicCoordinated(store, s, createPlayerProfile(), original, {
      coordinator: locks(),
    }),
  ).rejects.toThrow('已恢复原存储');
  expect(store.getItem(playerProfileKey)).toBe(original);
  expect(store.getItem(gameSaveKey)).toBeNull();
});
it('stale standalone restore expected profile fails inside common lock without epoch writes', async () => {
  const store = memory();
  store.setItem(playerProfileKey, JSON.stringify(createPlayerProfile()));
  await expect(
    replacePlayerProfileCoordinated(store, createPlayerProfile(), null, {
      coordinator: locks(),
    }),
  ).rejects.toThrow('本机');
  expect(store.getItem(profileReplacementEpochKey)).toBeNull();
});
it('matching standalone restore is a no-op and does not rotate replacement epoch', async () => {
  const store = memory(),
    p = createPlayerProfile();
  store.setItem(playerProfileKey, JSON.stringify(p));
  const result = await replacePlayerProfileCoordinated(
    store,
    p,
    store.getItem(playerProfileKey),
    { coordinator: locks() },
  );
  expect(result.changed).toBe(false);
  expect(store.getItem(profileReplacementEpochKey)).toBeNull();
});
it('validates bounded optional operational stamps and keeps gameplay identity untouched', () => {
  const ctx = submit(start()).growth!,
    marked = bindGrowthEpoch(ctx, sha256Hex('epoch'), { imported: true });
  expect(marked.root).toBe(ctx.root);
  expect(marked.units).toBe(ctx.units);
  expect(validateGrowthContext(marked, 'classic')).toEqual(marked);
  for (const bad of [
    { profileEpoch: 'bad' },
    { ignoredThrough: -1 },
    { ignoredThrough: 3 },
    { units: null },
  ])
    expect(() =>
      validateGrowthContext({ ...marked, ...bad }, 'classic'),
    ).toThrow();
});
it('new live capture after replacement explicitly stamped fresh keeps its entry eligible', async () => {
  const store = memory(),
    epoch = sha256Hex('fresh');
  store.setItem(profileReplacementEpochKey, epoch);
  const s = start(),
    fresh = {
      ...s,
      growth: bindGrowthEpoch(s.growth!, epoch, { fresh: true }),
    };
  await saveClassicClient(store, fresh, options(store));
  expect(readAchievementRegistry(profile(store))!.receipts).toHaveLength(1);
});
it('classic terminal transaction combines actual growth, completion and replay; retries stay idempotent', async () => {
  let s = start();
  for (let i = 0; i < 15; i++)
    s = reduceGameSession(submit(s), { type: 'advance_room' });
  const store = memory(),
    saved = await saveClassicClient(store, s, options(store));
  expect(saved.message).toBe('');
  const p = profile(store);
  expect(readAchievementRegistry(p)!.receipts).toHaveLength(30);
  expect(
    sumCounters(Object.values(readCompletionRegistry(p)!.groups)).completed,
  ).toBe(1);
  expect(store.writes.filter((k) => k === playerProfileKey)).toHaveLength(1);
  expect(loadAutoSave(store).session!.game.phase).toBe('game_result');
  await saveClassicClient(store, saved.session, options(store));
  expect(store.getItem(playerProfileKey)).toBe(JSON.stringify(p));
}, 20000);
it('cross-mode current writers re-read profile under same lock and preserve both receipt roots', async () => {
  const store = memory(),
    coordinator = locks();
  const a = submit(start()),
    b = beginSurvivalGrowth(startSurvivalClient('isaac', 90));
  await Promise.all([
    saveClassicClient(store, a, options(store, gameSaveKey, coordinator)),
    saveSurvivalClient(store, b, options(store, survivalSaveKey, coordinator)),
  ]);
  expect(readAchievementRegistry(profile(store))!.receipts).toHaveLength(3);
  expect(
    new Set(
      readAchievementRegistry(profile(store))!.receipts.map((r) => r.mode),
    ),
  ).toEqual(new Set(['classic', 'survival']));
});
it('survival actual entry/room/layer/terminal is saved paired once and does not change gameplay', async () => {
  const store = memory();
  let s = beginSurvivalGrowth(startSurvivalClient('lost', 3, 'highest'));
  while (s.game.phase !== 'competition_complete')
    s = reduceSurvivalClient(s, longRunAction(s.game));
  const before = canonicalJson(s.game),
    log = createSurvivalReplay(s.game);
  const saved = await saveSurvivalClient(store, s, {
    ...options(store, survivalSaveKey),
    survivalLog: log,
  });
  expect(saved.message).toBe('');
  expect(canonicalJson(saved.session.game)).toBe(before);
  expect(saved.session.growth!.acknowledged).toBe(s.growth!.units.length);
  expect(parseSurvivalCheckpoint(saved.source!).growth).toEqual(
    saved.session.growth,
  );
  expect(store.getItem(survivalLastCompletedKey)).not.toBeNull();
  expect(
    readAchievementRegistry(profile(store))!.receipts.map((r) => r.stage),
  ).toContain('floor');
  expect(
    sumCounters(Object.values(readCompletionRegistry(profile(store))!.groups))
      .completed,
  ).toBe(1);
  const p = store.getItem(playerProfileKey);
  await saveSurvivalClient(
    store,
    saved.session,
    options(store, survivalSaveKey),
  );
  expect(store.getItem(playerProfileKey)).toBe(p);
}, 20000);
it('survival file paired restore stamps replacement but never dispatches a growth write', async () => {
  const store = memory(),
    s = beginSurvivalGrowth(startSurvivalClient('isaac', 42));
  const doc = parseSurvivalCheckpoint(
    JSON.stringify(
      JSON.parse(
        (
          await saveSurvivalClient(memory(), s, {
            expectedSource: null,
            coordinator: locks(),
          })
        ).source!,
      ),
    ),
  );
  // Use a pending file for a profile with no acknowledged units.
  doc.growth = s.growth;
  await restoreSurvivalCoordinated(store, doc, createPlayerProfile(), null, {
    coordinator: locks(),
  });
  expect(readAchievementRegistry(profile(store))).toBeNull();
  expect(store.getItem(profileReplacementEpochKey)).not.toBeNull();
});
import { coordinateProfileWrite } from '../profile-write-coordinator';
it('a synchronous Web Locks rejection is surfaced as a promise rejection, never mistaken for acquired coordination', async () => {
  const store = memory();
  const coordinator: ProfileWriteCoordinator = {
    exclusive: () => {
      throw new DOMException('unavailable', 'SecurityError');
    },
  };
  await expect(
    coordinateProfileWrite(() => store.setItem(playerProfileKey, 'bad'), {
      coordinator,
    }),
  ).rejects.toThrow('unavailable');
  await expect(
    saveClassicClient(store, start(), { expectedSource: null, coordinator }),
  ).rejects.toThrow('unavailable');
  expect(store.entries.size).toBe(0);
});
import { draftSaveKey, activeReplayKey } from '../game-save';
it('acknowledgement renders and draft-only changes reuse classic core/replay bytes, without redundant profile writes', async () => {
  const store = memory(),
    first = await saveClassicClient(store, start(), options(store));
  const source = store.getItem(gameSaveKey),
    replay = store.getItem(activeReplayKey),
    count = store.writes.length;
  const draft = structuredClone(first.session.draft)!;
  draft.amounts.A.bid = 7;
  await saveClassicClient(store, { ...first.session, draft }, options(store));
  expect(store.getItem(gameSaveKey)).toBe(source);
  expect(store.getItem(activeReplayKey)).toBe(replay);
  expect(store.writes.slice(count)).toEqual([draftSaveKey]);
});
