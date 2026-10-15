import { expect, it } from 'vitest';
import {
  beginClassicGrowth,
  beginSurvivalGrowth,
  classicGrowthOrder,
  survivalGrowthOrder,
  applyGrowthContext,
  validateGrowthContext,
} from './lifecycle';
import {
  createGameSession,
  reduceGameSession,
  type GameSession,
} from '../game-session';
import {
  startSurvivalClient,
  reduceSurvivalClient,
  type SurvivalClientSession,
} from '../survival-client';
import {
  serializeGameCheckpoint,
  parseGameSave,
  serializeGameBackup,
  persistGameSession,
  loadAutoSave,
  gameSaveKey,
} from '../game-save';
import {
  serializeSurvivalCheckpoint,
  parseSurvivalCheckpoint,
} from '../survival-persistence';
import {
  serializeSurvivalBackup,
  parseSurvivalBackup,
} from '../survival-backup';
import {
  createPlayerProfile,
  readPlayerProfile,
  playerProfileKey,
  recordCompletedMatch,
} from '../player-profile';
import {
  readAchievementRegistry,
  projectAchievementRegistry,
  appendAchievementEvent,
} from './registry';
import { decodeAchievementEvent } from './event-codec';
import {
  persistGrowthContext,
  type AchievementWriteCoordinator,
} from './persistence';
import { longRunAction } from '../survival-long-run';
import { canonicalJson } from '../../shared/json-facts';
import { stringifyChecked } from '../file-json';
import { sha256Hex } from '../../shared/sha256';
import { replayRoomLocator } from '../replay-record';
import { readCompletionRegistry } from '../completion-registry';

function start(growth = true): GameSession {
  const s = reduceGameSession(createGameSession(42), {
    type: 'start_game',
    characterId: 'lost',
  });
  return growth ? beginClassicGrowth(s) : s;
}
function submit(s: GameSession, bid = false): GameSession {
  if (s.game.phase === 'character_selection') throw Error('missing game');
  const money = s.game.players[0]!.money;
  return reduceGameSession(s, {
    type: 'submit_player_turn',
    turn: {
      playerId: 'human',
      actions:
        bid && money > 0
          ? [{ type: 'bid', group: 'A', amount: 1 }]
          : [{ type: 'withdraw' }],
    },
  });
}
function checkpoint(s: SurvivalClientSession) {
  return serializeSurvivalCheckpoint(
    s.game,
    s.draft,
    new Date('2026-10-15T00:00:00.000Z'),
    s.growth,
  );
}
function coordinator(): AchievementWriteCoordinator {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    exclusive: (_name, work) => {
      const next = tail.then(work);
      tail = next.catch(() => {});
      return next;
    },
  };
}
function memory() {
  const entries = new Map<string, string>();
  const writes: string[] = [];
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
      writes.push(key);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
    writes,
    entries,
  };
}

it('captures entry before quotation and room after settlement, not draft edits or ranking navigation', () => {
  let s = start();
  expect(s.growth!.units.map((u) => u.stage)).toEqual(['entry']);
  s = submit(s, true);
  expect(s.growth!.units.map((u) => u.stage)).toEqual(['entry', 'room']);
  const before = canonicalJson(s.growth);
  s = reduceGameSession(s, { type: 'show_room_ranking', view: 'contest' });
  expect(canonicalJson(s.growth)).toBe(before);
  s = reduceGameSession(s, { type: 'advance_room' });
  expect(s.growth!.units.map((u) => u.stage)).toEqual([
    'entry',
    'room',
    'entry',
  ]);
});
it('keeps legacy helper/tutorial simulations without growth unless explicitly enabled', () => {
  expect(start(false).growth).toBeUndefined();
  expect(submit(start(false)).growth).toBeUndefined();
  expect(startSurvivalClient('isaac', 42).growth).toBeUndefined();
});
it('does not change classic settlement or prevent further gameplay when observational growth capture fails', () => {
  const plain = start(false),
    tracked = beginClassicGrowth(plain),
    result = submit(tracked, true);
  tracked.growth = { ...tracked.growth!, units: result.growth!.units };
  const failed = submit(tracked, true);
  expect(failed.growthIssue).toBeDefined();
  expect(failed.game).toEqual(submit(plain, true).game);
  const continued = reduceGameSession(failed, { type: 'advance_room' });
  expect(continued.game.phase).toBe('room_action');
  expect(continued.growthIssue).toBe(failed.growthIssue);
  expect(
    parseGameSave(serializeGameCheckpoint(continued)).session.growth,
  ).toBeUndefined();
});
it('does not roll back survival gameplay when a damaged growth observer is suspended', () => {
  const plain = startSurvivalClient('isaac', 42),
    tracked = beginSurvivalGrowth(plain);
  const command = longRunAction(plain.game),
    result = reduceSurvivalClient(tracked, command);
  tracked.growth = { ...tracked.growth!, units: result.growth!.units };
  const failed = reduceSurvivalClient(tracked, command);
  expect(failed.growthIssue).toBeDefined();
  expect(failed.game).toEqual(reduceSurvivalClient(plain, command).game);
  const next = reduceSurvivalClient(failed, { type: 'advance_room' });
  expect(next.game.phase).toBe('room_action');
  expect(next.growthIssue).toBe(failed.growthIssue);
});
it('excludes already prepared entry money in an old room_action while including its new quotation', () => {
  let old = start(false);
  for (let i = 0; i < 4; i++)
    old = reduceGameSession(submit(old, true), { type: 'advance_room' });
  const resumed = beginClassicGrowth(old, classicGrowthOrder(old));
  expect(resumed.growth!.units).toEqual([]);
  const next = submit(resumed, true);
  expect(next.growth!.units.map((u) => u.stage)).toEqual(['room']);
  expect(next.growth!.units[0]!.position).toBe(4);
  const profile = applyGrowthContext(
    createPlayerProfile(),
    next.growth!,
  ).profile;
  expect(readAchievementRegistry(profile)!.receipts).toHaveLength(1);
  expect(projectAchievementRegistry(profile)!.progress.A03).toBeLessThan(5);
});
it('excludes an old settled room and captures only the next new entry', () => {
  const old = submit(start(false));
  const migrated = beginClassicGrowth(old, classicGrowthOrder(old));
  expect(migrated.growth!.units).toEqual([]);
  const next = reduceGameSession(migrated, { type: 'advance_room' });
  expect(next.growth!.units.map((u) => [u.stage, u.position])).toEqual([
    ['entry', 1],
  ]);
});
it('roundtrips the optional classic v5 extension with exact E01 values, without any profile write while parsing', () => {
  const s = submit(start(), true);
  const profile = createPlayerProfile(),
    before = canonicalJson(profile);
  const restored = parseGameSave(serializeGameBackup(s, profile)).session;
  expect(restored.growth).toEqual(s.growth);
  expect(restored.game).toEqual(s.game);
  const room = decodeAchievementEvent(s.growth!.units[1]!);
  if (room.stage !== 'room') throw Error('missing room');
  expect(room.facts.scoreBeforeClear).toBeDefined();
  expect(canonicalJson(profile)).toBe(before);
  expect(readAchievementRegistry(profile)).toBeNull();
});
it('accepts old v5 with absent metadata but rejects known/unknown or tampered extension fields after checksum recomputation', () => {
  const old = parseGameSave(serializeGameCheckpoint(submit(start(false))));
  expect(old.session.growth).toBeUndefined();
  const source = JSON.parse(serializeGameCheckpoint(submit(start())));
  for (const mutate of [
    (d: typeof source) => {
      d.growth.version = 2;
    },
    (d: typeof source) => {
      d.growth.root = sha256Hex('wrong-match');
    },
    (d: typeof source) => {
      d.growth.units[1].values[0] = 6;
    },
    (d: typeof source) => {
      d.growth.units[1].authorityHash = sha256Hex('fake-authority');
    },
    (d: typeof source) => {
      d.growth.acknowledged = 999;
    },
    (d: typeof source) => {
      d.growth.excludedThrough = 31;
    },
    (d: typeof source) => {
      d.growth.extra = true;
    },
    (d: typeof source) => {
      d.other = true;
    },
  ]) {
    const doc = structuredClone(source);
    delete doc.checksum;
    mutate(doc);
    expect(() => parseGameSave(stringifyChecked(doc))).toThrow();
  }
});
it('captures 30 classic room units plus the new formal completion and preserves the same gameplay facts through intermediate file roundtrips', () => {
  let s = start(),
    control = start(false);
  for (let i = 0; i < 15; i++) {
    s = submit(s, true);
    control = submit(control, true);
    expect(s.game).toEqual(control.game);
    if (i === 5 || i === 11)
      s = parseGameSave(serializeGameCheckpoint(s)).session;
    s = reduceGameSession(s, { type: 'advance_room' });
    control = reduceGameSession(control, { type: 'advance_room' });
  }
  expect(s.growth!.units).toHaveLength(31);
  expect(s.game).toEqual(control.game);
  expect(parseGameSave(serializeGameCheckpoint(s)).session.growth).toEqual(
    s.growth,
  );
  expect(
    reduceGameSession(s, { type: 'restart_game', seed: 90 }).growth,
  ).toBeUndefined();
}, 20000);
it('never re-awards the same authority unit when local predecessor metadata differs', () => {
  const s = submit(start(), true),
    ctx = s.growth!;
  const first = applyGrowthContext(createPlayerProfile(), ctx).profile;
  const unit = ctx.units[1]!;
  const repeat = appendAchievementEvent(first, {
    source: 'live',
    mode: 'classic',
    root: ctx.root,
    parent: null,
    authorityHash: unit.authorityHash,
    event: decodeAchievementEvent(unit),
  });
  expect(repeat).toBe(first);
});
it('commits a batch atomically, advances acknowledgements after success, and leaves no half-batch on quota failure', async () => {
  const s = submit(start(), true),
    store = memory(),
    locks = coordinator();
  await expect(
    persistGrowthContext(
      {
        ...store,
        setItem: () => {
          throw Error('quota');
        },
      },
      s.growth!,
      locks,
    ),
  ).rejects.toThrow('quota');
  expect(store.entries.size).toBe(0);
  expect(s.growth!.acknowledged).toBe(0);
  const saved = await persistGrowthContext(store, s.growth!, locks);
  expect(saved.context.acknowledged).toBe(2);
  expect(store.writes).toEqual([playerProfileKey]);
  const repeated = await persistGrowthContext(store, s.growth!, locks);
  expect(repeated.changed).toBe(false);
  expect(store.writes).toHaveLength(1);
  const refreshed = parseGameSave(
    serializeGameCheckpoint({ ...s, growth: saved.context }),
  ).session;
  expect(refreshed.growth!.acknowledged).toBe(2);
  expect(applyGrowthContext(saved.profile, refreshed.growth!).profile).toBe(
    saved.profile,
  );
});
it('does not recreate acknowledged rewards removed by an explicit older-profile replacement', () => {
  const s = submit(start(), true),
    saved = applyGrowthContext(createPlayerProfile(), s.growth!);
  expect(() =>
    applyGrowthContext(createPlayerProfile(), saved.context),
  ).toThrow('已确认成长凭据');
});
it('rewrites a metadata-only acknowledgement despite unchanged game identity and preserves an unacknowledged terminal checkpoint', () => {
  let s = submit(start()),
    store = memory();
  expect(persistGameSession(store, s)).toBe(true);
  const saved = applyGrowthContext(createPlayerProfile(), s.growth!);
  s = { ...s, growth: saved.context };
  expect(persistGameSession(store, s)).toBe(false);
  store.setItem(playerProfileKey, JSON.stringify(saved.profile));
  expect(persistGameSession(store, s)).toBe(true);
  expect(loadAutoSave(store).session!.growth!.acknowledged).toBe(2);
  s = start();
  store = memory();
  for (let i = 0; i < 15; i++)
    s = reduceGameSession(submit(s), { type: 'advance_room' });
  expect(persistGameSession(store, s)).toBe(true);
  expect(store.getItem(gameSaveKey)).not.toBeNull();
  expect(loadAutoSave(store).session!.growth!.units).toHaveLength(31);
  const committed = applyGrowthContext(
    readPlayerProfile(JSON.parse(store.getItem(playerProfileKey)!)),
    s.growth!,
  );
  store.setItem(playerProfileKey, JSON.stringify(committed.profile));
  const ack = committed.context;
  expect(persistGameSession(store, { ...s, growth: ack })).toBe(true);
  expect(store.getItem(gameSaveKey)).toBeNull();
}, 20000);
it('rejects paired acknowledged metadata with a missing or conflicting profile, while standalone continuations remain readable', () => {
  const s = submit(start(), true),
    result = applyGrowthContext(createPlayerProfile(), s.growth!);
  const acknowledged = { ...s, growth: result.context };
  expect(
    parseGameSave(serializeGameCheckpoint(acknowledged)).session.growth,
  ).toEqual(result.context);
  expect(() =>
    serializeGameBackup(acknowledged, createPlayerProfile()),
  ).toThrow('配套档案');
  const doc = JSON.parse(serializeGameBackup(acknowledged, result.profile));
  doc.profile = createPlayerProfile();
  delete doc.checksum;
  expect(() => parseGameSave(stringifyChecked(doc))).toThrow('配套档案');
});
it('uses one profile candidate for final completion statistics and growth', async () => {
  let s = start();
  for (let i = 0; i < 15; i++)
    s = reduceGameSession(submit(s), { type: 'advance_room' });
  const store = memory();
  const result = await persistGrowthContext(
    store,
    s.growth!,
    coordinator(),
    undefined,
    (profile) =>
      recordCompletedMatch(
        profile,
        s.replay!,
        replayRoomLocator(s.replay!, s.replay!.rooms.at(-1)!),
      ),
  );
  expect(store.writes).toHaveLength(1);
  expect(readCompletionRegistry(result.profile)).not.toBeNull();
  expect(readAchievementRegistry(result.profile)!.receipts).toHaveLength(31);
  const restored = parseGameSave(
    serializeGameBackup({ ...s, growth: result.context }, result.profile),
  );
  expect(restored.session.growth!.acknowledged).toBe(31);
  expect(projectAchievementRegistry(restored.profile!)!.counters).toEqual(
    projectAchievementRegistry(result.profile)!.counters,
  );
}, 20000);
it('captures survival entry/room/floor/terminal, freezes human scope after elimination and validates command reconstruction', () => {
  let s = beginSurvivalGrowth(startSurvivalClient('lost', 3, 'highest'));
  while (s.game.phase !== 'competition_complete') {
    s = reduceSurvivalClient(s, longRunAction(s.game));
    if (s.game.floorIndex === 0 && s.game.phase === 'floor_result') {
      const doc = parseSurvivalCheckpoint(checkpoint(s));
      expect(doc.growth).toEqual(s.growth);
      s = { game: doc.game, draft: doc.draft, growth: doc.growth };
    }
  }
  expect(s.growth!.units.map((u) => u.stage)).toContain('floor');
  expect(s.growth!.units.at(-1)!.stage).toBe('complete');
  expect(s.growth!.units.at(-2)!.stage).toBe('final');
  const humanLast = s.game.humanEliminatedAt;
  if (humanLast !== null)
    expect(
      s
        .growth!.units.filter((u) => u.stage === 'room')
        .every((u) => Math.floor(u.position / 5) <= humanLast),
    ).toBe(true);
  expect(parseSurvivalCheckpoint(checkpoint(s)).growth).toEqual(s.growth);
  const profile = applyGrowthContext(createPlayerProfile(), s.growth!).profile;
  const backup = parseSurvivalBackup(
    serializeSurvivalBackup(s.game, s.draft, profile, new Date(), s.growth),
  );
  expect(backup.checkpoint.growth).toEqual(s.growth);
  expect(backup.profile).toEqual(profile);
}, 20000);
it('does not borrow an old human elimination when only the later AI terminal is newly produced', () => {
  let s = startSurvivalClient('isaac', 3, 'highest');
  while (
    s.game.humanEliminatedAt === null &&
    s.game.phase !== 'competition_complete'
  )
    s = reduceSurvivalClient(s, longRunAction(s.game));
  s = beginSurvivalGrowth(s, survivalGrowthOrder(s.game));
  while (s.game.phase !== 'competition_complete')
    s = reduceSurvivalClient(s, longRunAction(s.game));
  const profile = applyGrowthContext(createPlayerProfile(), s.growth!).profile;
  expect(projectAchievementRegistry(profile)!.achievedAt.F05).toBeUndefined();
  expect(s.growth!.units.some((u) => u.stage === 'floor')).toBe(false);
}, 20000);
it('rejects unknown modes, duplicate stages and future exclusion boundaries, retaining the source', () => {
  const s = submit(start()),
    before = canonicalJson(s.growth);
  expect(() =>
    validateGrowthContext({ ...s.growth, mode: 'survival' }, 'classic'),
  ).toThrow();
  expect(() =>
    validateGrowthContext(
      { ...s.growth, units: [...s.growth!.units, s.growth!.units[1]!] },
      'classic',
    ),
  ).toThrow();
  expect(canonicalJson(s.growth)).toBe(before);
});
