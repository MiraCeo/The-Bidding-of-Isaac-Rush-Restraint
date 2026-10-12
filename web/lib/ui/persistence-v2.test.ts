import { describe, expect, it, vi } from 'vitest';
import {
  createGameSession,
  reduceGameSession,
  type GameSession,
} from './game-session';
import {
  activeReplayKey,
  draftSaveKey,
  gameSaveKey,
  lastCompletedKey,
  loadAutoSave,
  loadPlayerProfile,
  parseGameSave,
  persistGameSession,
  serializeGameBackup,
  serializeGameCheckpoint,
  type SaveStorage,
} from './game-save';
import { serializeSessionFixture as serializeGameSave } from './save-fixture.test-helper';
import { parseReplay, serializeReplay } from './game-replay';
import { packReplay, unpackReplay } from './replay-codec';
import { canonicalJson, replayRoomLocator } from './replay-record';
import {
  createPlayerProfile,
  playerProfileKey,
  readPlayerProfile,
} from './player-profile';
import { replayMarketModel } from './replay-market';
import { replayEventRelatedTo, replayEventText } from './replay-display';
import type { CharacterId } from '../game/item-types';
const now = new Date('2026-10-12T00:00:00Z');
function game(count = 0, role: CharacterId = 'lost', seed = 42): GameSession {
  let s = reduceGameSession(createGameSession(seed), {
    type: 'start_game',
    characterId: role,
  });
  for (let i = 0; i < count; i++) {
    s = reduceGameSession(s, {
      type: 'submit_player_turn',
      turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
    });
    s = reduceGameSession(s, { type: 'advance_room' });
  }
  return s;
}
function store() {
  const data = new Map<string, string>();
  const writes: string[] = [];
  const storage: SaveStorage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      writes.push(k);
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
  return { data, writes, storage };
}
describe('v2 checkpoint, replay and extensible profile separation', () => {
  it('shows both sides of recorded legacy transfers without changing the underlying event', () => {
    const e = {
      type: 'money' as const,
      playerId: 'ai-1',
      itemId: 'money_bag' as const,
      amount: 5,
      message: '偷钱袋从 human 窃取 5 资金。',
    };
    expect(replayEventRelatedTo(e, 'human')).toBe(true);
    expect(replayEventRelatedTo(e, 'ai-1')).toBe(true);
    expect(replayEventRelatedTo(e, 'ai-2')).toBe(false);
    expect(
      replayEventText(e, (id) => (id === 'human' ? '你' : '守夜人')),
    ).toContain('你 → 守夜人');
    expect(e.message).toBe('偷钱袋从 human 窃取 5 资金。');
  });
  it.each(['isaac', 'lost', 'azazel', 'eden', 'jacob_esau'] as const)(
    'continues %s identically at each room and phase',
    (role) => {
      let s = game(0, role);
      for (let i = 0; i < 15; i++) {
        const action = {
          type: 'submit_player_turn' as const,
          turn: { playerId: 'human', actions: [{ type: 'withdraw' as const }] },
        };
        const recovered = parseGameSave(
          serializeGameCheckpoint(s, now),
        ).session;
        expect(recovered.game).toEqual(s.game);
        expect(recovered.draft).toEqual(s.draft);
        const uninterrupted = reduceGameSession(s, action),
          resumed = reduceGameSession(recovered, action);
        expect(resumed.game).toEqual(uninterrupted.game);
        const ranking = reduceGameSession(uninterrupted, {
          type: 'show_room_ranking',
          view: 'contest',
        });
        expect(
          parseGameSave(serializeGameCheckpoint(ranking)).session.game,
        ).toEqual(ranking.game);
        s = reduceGameSession(uninterrupted, { type: 'advance_room' });
      }
      expect(parseGameSave(serializeGameCheckpoint(s)).session.game).toEqual(
        s.game,
      );
    },
    20000,
  );
  it('excludes historical snapshots and derived AI diagnostics from the continuation file', () => {
    const s = game(12);
    const doc = JSON.parse(serializeGameCheckpoint(s));
    expect(doc.version).toBe(2);
    expect(doc.kind).toBe('checkpoint');
    expect(doc).not.toHaveProperty('replay');
    expect(doc).not.toHaveProperty('profile');
    expect(doc.checkpoint.game).not.toHaveProperty('revealedAiDecisions');
    expect(doc.checkpoint.game).not.toHaveProperty('pendingRoomTurns');
    expect(doc.checkpoint.metadata.rooms).toHaveLength(12);
    expect(Buffer.byteLength(JSON.stringify(doc))).toBeLessThan(100000);
    const restored = parseGameSave(JSON.stringify(doc)).session;
    expect(restored.replay!.rooms[0]!.source).toBe('checkpoint-reconstruction');
    expect(
      replayRoomLocator(restored.replay!, restored.replay!.rooms[0]!),
    ).toBe(replayRoomLocator(s.replay!, s.replay!.rooms[0]!));
  });
  it.each(['isaac', 'lost', 'azazel', 'eden', 'jacob_esau'] as const)(
    'losslessly encodes all %s results, inventory, events and locations',
    (role) => {
      const s = game(15, role);
      const packed = packReplay(s.replay!);
      expect(unpackReplay(packed)).toEqual(s.replay);
      expect(packed.rooms.filter((r) => r.checkpoint)).toHaveLength(3);
      expect(packed.rooms[0]).not.toHaveProperty('previousPlayers');
      expect(packed.rooms[0]!.settlement).not.toHaveProperty('players');
      expect(packed.rooms[0]!.settlement).not.toHaveProperty('playersBefore');
      const v2 = serializeReplay(s.replay!, 'origin-build', now);
      const v1 = JSON.stringify({
        format: 'the-bidding-of-isaac-replay',
        version: 1,
        exportedAt: now.toISOString(),
        exportedBuild: 'origin-build',
        replay: s.replay,
      });
      expect(Buffer.byteLength(v2)).toBeLessThan(Buffer.byteLength(v1) * 0.55);
      expect(parseReplay(v2).replay).toEqual(s.replay);
      expect(() => parseReplay(v1)).toThrow('v2');
    },
  );
  it('preserves v2 original build identity and independent profile version', () => {
    const s = game(3);
    s.replay!.startedBuild = 'old-origin';
    s.replay!.rooms[0]!.build = 'old-room';
    expect(parseGameSave(serializeGameSave(s)).session).toEqual(s);
    const backup = parseGameSave(
      serializeGameBackup(s, createPlayerProfile(now), now),
    );
    expect(backup.session).toEqual(s);
    expect(backup.profile!.version).toBe(1);
    expect(
      JSON.parse(serializeGameBackup(s, createPlayerProfile(now))).checkpoint,
    ).not.toHaveProperty('replay');
  });
  it.each(['money', 'turn', 'draft', 'metadata', 'kind'] as const)(
    'rejects corrupted checkpoint %s before replacing a session',
    (field) => {
      const doc = JSON.parse(serializeGameCheckpoint(game(1)));
      if (field === 'money') doc.checkpoint.game.players[0].money++;
      if (field === 'turn')
        doc.checkpoint.turns[0].actions = [
          { type: 'bid', group: 'A', amount: 1 },
        ];
      if (field === 'draft') doc.checkpoint.draft.amounts.A.bid = Infinity;
      if (field === 'metadata')
        doc.checkpoint.metadata.rooms[0].locator = 'fake';
      if (field === 'kind') doc.kind = 'other';
      expect(() => parseGameSave(JSON.stringify(doc))).toThrow();
    },
  );
  it.each([
    'cash',
    'checkpoint',
    'unknown',
    'dictionary',
    'duplicate',
    'source',
    'event',
    'final',
  ] as const)('rejects corrupted v2 replay %s', (field) => {
    const doc = JSON.parse(serializeReplay(game(15).replay!, 'build'));
    const r = doc.replay.rooms[0];
    if (field === 'cash') doc.replay.initialPlayers[0].money++;
    if (field === 'checkpoint') r.checkpoint[0].score++;
    if (field === 'unknown')
      r.resultChanges.push({ id: 'human', fields: { injected: true } });
    if (field === 'dictionary')
      doc.replay.items.fake = {
        instanceId: 'fake',
        itemId: 'd6',
        acquiredOrder: 3,
      };
    if (field === 'duplicate')
      r.resultChanges.push(...structuredClone(r.resultChanges));
    if (field === 'source') r.source = 'invented';
    if (field === 'event') r.entryEvents[0].message = 'fake';
    if (field === 'final') doc.replay.final.ranking[0].finalScore++;
    expect(() => parseReplay(JSON.stringify(doc))).toThrow();
  });
  it('roundtrips empty partial replays without invented players or final results', () => {
    const log = game().replay!;
    expect(parseReplay(serializeReplay(log, 'build')).replay).toEqual(log);
  });
  it('writes only a small draft envelope during quote edits, not the core or replay', () => {
    const { storage, writes } = store();
    const s = game(12);
    expect(persistGameSession(storage, s)).toBe(true);
    writes.length = 0;
    const draft = structuredClone(s.draft!);
    draft.amounts.A.bid = 7;
    expect(persistGameSession(storage, { ...s, draft })).toBe(true);
    expect(writes).toEqual([draftSaveKey]);
    const loaded = loadAutoSave(storage).session!;
    expect(loaded.draft!.amounts.A.bid).toBe(7);
    expect(loaded.replay).toEqual(s.replay);
  });
  it('rebuilds missing browser records instead of reporting a stale in-memory cache as saved', () => {
    const { storage, data } = store();
    const s = game(2);
    persistGameSession(storage, s);
    data.clear();
    expect(persistGameSession(storage, s)).toBe(true);
    expect(data.has(gameSaveKey)).toBe(true);
    expect(data.has(activeReplayKey)).toBe(true);
    expect(data.has(draftSaveKey)).toBe(true);
    expect(loadAutoSave(storage).session!.game).toEqual(s.game);
  });
  it('does not discard an old checkpoint when the new replay write fails', () => {
    const { storage, data } = store();
    const s = game(1);
    persistGameSession(storage, s);
    const original = data.get(gameSaveKey);
    const failing = {
      ...storage,
      setItem: (key: string, value: string) => {
        if (key === activeReplayKey) throw new Error('quota');
        storage.setItem(key, value);
      },
    };
    expect(persistGameSession(failing, game(2))).toBe(false);
    expect(data.get(gameSaveKey)).toBe(original);
    expect(loadAutoSave(storage).session!.game).toEqual(s.game);
  });
  it('archives completion before cleanup, preserves progression on restart, and does not count the same match twice', () => {
    const { storage, data } = store();
    const p = createPlayerProfile(now);
    p.progression.modules.future = { tree: [1, { unlocked: true }] };
    p.progression.characterUnlocks.future_role = {
      unlockedAt: now.toISOString(),
      conditionId: 'future-condition',
    };
    p.progression.achievements.future_badge = {
      achievedAt: now.toISOString(),
      progress: 1,
    };
    data.set(playerProfileKey, JSON.stringify(p));
    persistGameSession(storage, game(14));
    const complete = game(15);
    expect(persistGameSession(storage, complete)).toBe(true);
    expect(data.has(gameSaveKey)).toBe(false);
    expect(data.has(activeReplayKey)).toBe(false);
    expect(data.has(lastCompletedKey)).toBe(true);
    expect(loadAutoSave(storage).session).toBeNull();
    expect(loadPlayerProfile(storage).profile.history).toHaveLength(1);
    persistGameSession(storage, complete);
    expect(loadPlayerProfile(storage).profile.history).toHaveLength(1);
    persistGameSession(storage, createGameSession(22));
    expect(loadPlayerProfile(storage).profile.progression).toEqual(
      p.progression,
    );
    expect(parseReplay(data.get(lastCompletedKey)!).replay).toEqual(
      complete.replay,
    );
  });
  it('retains the active checkpoint when completed archival or profile persistence fails', () => {
    for (const failure of [lastCompletedKey, playerProfileKey]) {
      const { storage, data } = store();
      persistGameSession(storage, game(14));
      const original = data.get(gameSaveKey);
      const failing = {
        ...storage,
        setItem: (key: string, value: string) => {
          if (key === failure) throw new Error('quota');
          storage.setItem(key, value);
        },
      };
      expect(persistGameSession(failing, game(15))).toBe(false);
      expect(data.get(gameSaveKey)).toBe(original);
      expect(loadAutoSave(storage).session!.game).toEqual(game(14).game);
    }
  });
  it('recovers the last committed checkpoint when the replay write succeeds but checkpoint commit fails', () => {
    const { storage } = store();
    const s = game(1);
    persistGameSession(storage, s);
    const failing = {
      ...storage,
      setItem: (k: string, v: string) => {
        if (k === gameSaveKey) throw new Error('quota');
        storage.setItem(k, v);
      },
    };
    expect(persistGameSession(failing, game(2))).toBe(false);
    const recovered = loadAutoSave(storage);
    expect(recovered.session!.game).toEqual(s.game);
    expect(recovered.message).toContain('未同步');
    expect(recovered.session!.replay!.rooms).toHaveLength(1);
  });
  it('preserves reserved namespaces through full backup and does not attach them to lightweight checkpoints', () => {
    const p = createPlayerProfile(now);
    p.progression.modules['achievements.vNext'] = {
      rules: ['new'],
      progress: 0.5,
    };
    p.progression.statistics.futureCounter = 19;
    expect(parseGameSave(serializeGameBackup(game(1), p)).profile).toEqual(p);
    expect(
      parseGameSave(serializeGameCheckpoint(game(1))).profile,
    ).toBeUndefined();
    expect(() => readPlayerProfile({ ...p, version: 999 })).toThrow();
    expect(() =>
      readPlayerProfile({
        ...p,
        progression: { ...p.progression, statistics: { bad: Infinity } },
      }),
    ).toThrow();
  });
  it('retains unreadable player profiles without silently resetting future progress', () => {
    const { storage, data } = store();
    data.set(playerProfileKey, 'broken');
    expect(loadPlayerProfile(storage).message).toContain('原数据保留');
    expect(persistGameSession(storage, game(15))).toBe(false);
    expect(data.get(playerProfileKey)).toBe('broken');
  });
  it('keeps event ordering, exact float values and room locators after decoding without RNG calls', () => {
    const s = game(15);
    const original = canonicalJson(s.replay);
    const random = vi.spyOn(Math, 'random');
    const decoded = unpackReplay(packReplay(s.replay!));
    expect(canonicalJson(decoded)).toBe(original);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
    for (let i = 0; i < 15; i++)
      expect(replayRoomLocator(decoded, decoded.rooms[i]!)).toBe(
        replayRoomLocator(s.replay!, s.replay!.rooms[i]!),
      );
  });
  it('plots a double turn as two actual market samples and uses recorded high placements', () => {
    let s = game(0, 'jacob_esau');
    s = reduceGameSession(s, {
      type: 'submit_player_turn',
      turn: {
        playerId: 'human',
        actions: [
          { type: 'bid', group: 'A', amount: 10 },
          { type: 'bid', group: 'B', amount: 11 },
        ],
      },
    });
    const model = replayMarketModel(s.replay!.rooms[0]!, 10)!;
    expect(
      model.groups
        .flatMap((g) => g.points)
        .filter((p) => p.playerId === 'human'),
    ).toHaveLength(2);
    expect(model.upper - model.target).toBe(10);
    expect(model.groups.flatMap((g) => g.points)).toHaveLength(
      s.game.phase !== 'character_selection'
        ? s.game.roomSettlement!.baseline!.participantCount
        : 0,
    );
  });
});
