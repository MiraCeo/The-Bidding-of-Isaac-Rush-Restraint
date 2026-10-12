import { describe, expect, it } from 'vitest';
import { characterCatalog } from '../game/characters';
import { defaultRules } from '../game/config';
import { validateTurn } from '../game/turns';
import type { CharacterId, PlayerTurn } from '../game/item-types';
import {
  createGameSession,
  reduceGameSession,
  type GameSession,
} from './game-session';
import {
  gameSaveKey,
  loadAutoSave,
  maxSaveBytes,
  parseGameSave,
  persistGameSession,
  type SaveDocument,
  type SaveStorage,
} from './game-save';
import { serializeSessionFixture as serializeGameSave } from './save-fixture.test-helper';

function start(characterId: CharacterId = 'lost', seed = 42) {
  return reduceGameSession(createGameSession(seed), {
    type: 'start_game',
    characterId,
  });
}
function action(session: GameSession, index: number): PlayerTurn {
  if (session.game.phase === 'character_selection')
    throw new Error('Not started');
  const human = session.game.players.find((p) => p.isHuman)!;
  const amount = Math.max(1, Math.floor(human.money * 0.17));
  const turn: PlayerTurn = {
    playerId: 'human',
    actions: [
      {
        type: index % 3 === 1 ? 'disrupt' : 'bid',
        group: index % 2 === 0 ? 'A' : 'B',
        amount,
      },
    ],
  };
  if (validateTurn(human, turn, defaultRules).length)
    return { playerId: 'human', actions: [{ type: 'withdraw' }] };
  return turn;
}
function roundTrip(session: GameSession) {
  const restored = parseGameSave(serializeGameSave(session)).session;
  expect(JSON.parse(JSON.stringify(restored))).toEqual(
    JSON.parse(JSON.stringify(session)),
  );
  return restored;
}
function change(save: string, update: (doc: SaveDocument) => void) {
  const doc = parseGameSave(save);
  update(doc);
  const wire = JSON.parse(
    serializeGameSave(doc.session, new Date(doc.savedAt)),
  );
  wire.version = doc.version;
  wire.compatibility = doc.compatibility;
  return JSON.stringify(wire);
}
function storage(): SaveStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe('versioned complete-game saves', () => {
  it('does not export an unstarted game or create one during load', () => {
    expect(() => serializeGameSave(createGameSession(42))).toThrow('尚未开始');
    expect(loadAutoSave(null)).toEqual({ session: null, message: '' });
  });
  it.each(characterCatalog.map((c) => c.id))(
    'preserves role %s, rooms, AI and unsubmitted draft',
    (id) => {
      const session = start(id);
      session.draft!.selectedAction = { kind: 'disrupt', groups: ['B'] };
      session.draft!.amounts.B.disrupt = 13;
      roundTrip(session);
    },
  );
  it('preserves double-action amounts and their order', () => {
    const session = start('jacob_esau');
    session.draft!.selectedAction = { kind: 'bid', groups: ['B', 'A'] };
    session.draft!.amounts.A.bid = 19;
    session.draft!.amounts.B.bid = 21;
    roundTrip(session);
  });
  it.each(characterCatalog.map((c) => c.id))(
    'matches uninterrupted %s across every phase and all 15 rooms',
    (id) => {
      let baseline = start(id, 20261011);
      let resumed = roundTrip(baseline);
      for (let i = 0; i < 15; i++) {
        const turn = action(baseline, i);
        baseline = reduceGameSession(baseline, {
          type: 'submit_player_turn',
          turn,
        });
        resumed = reduceGameSession(roundTrip(resumed), {
          type: 'submit_player_turn',
          turn,
        });
        expect(resumed).toEqual(baseline); // Includes AI decisions, outcomes, shields, grants, refunds and history.
        resumed = roundTrip(resumed);
        baseline = reduceGameSession(baseline, {
          type: 'show_room_ranking',
          view: 'contest',
        });
        resumed = reduceGameSession(resumed, {
          type: 'show_room_ranking',
          view: 'contest',
        });
        resumed = roundTrip(resumed);
        baseline = reduceGameSession(baseline, { type: 'advance_room' });
        resumed = reduceGameSession(resumed, { type: 'advance_room' });
        expect(resumed).toEqual(baseline);
        resumed = roundTrip(resumed);
      }
      expect(resumed.game.phase).toBe('game_result');
      expect(resumed.turns).toHaveLength(15);
    },
    // Every restore verifies all preceding rooms; keep assertions intact under parallel release load.
    20_000,
  );
  it.each([
    [
      'unknown version',
      (d: SaveDocument) => {
        (d as unknown as Record<string, unknown>).version = 999;
      },
    ],
    [
      'incompatible rules',
      (d: SaveDocument) => {
        d.compatibility = 'old';
      },
    ],
    [
      'missing character',
      (d: SaveDocument) => {
        if (d.session.game.phase !== 'character_selection')
          d.session.game.selectedCharacter = 'no-such-role' as CharacterId;
      },
    ],
    [
      'illegal money',
      (d: SaveDocument) => {
        if (d.session.game.phase !== 'character_selection')
          d.session.game.players[0]!.money = -1;
      },
    ],
    [
      'missing AI',
      (d: SaveDocument) => {
        if (d.session.game.phase !== 'character_selection')
          delete d.session.game.aiProfiles['ai-1'];
      },
    ],
    [
      'extra item',
      (d: SaveDocument) => {
        if (d.session.game.phase !== 'character_selection')
          d.session.game.players[0]!.items[0]!.itemId = 'deleted-item' as never;
      },
    ],
    [
      'changed reward',
      (d: SaveDocument) => {
        if (d.session.game.phase !== 'character_selection')
          d.session.game.rooms[0]![0]!.kind = 'boss';
      },
    ],
    [
      'missing draft',
      (d: SaveDocument) => {
        d.session.draft = null;
      },
    ],
    [
      'bad draft amount',
      (d: SaveDocument) => {
        d.session.draft!.amounts.A.bid = NaN;
      },
    ],
    [
      'unearned double action',
      (d: SaveDocument) => {
        d.session.draft!.selectedAction = { kind: 'bid', groups: ['A', 'B'] };
      },
    ],
    [
      'wrong progress',
      (d: SaveDocument) => {
        if (d.session.game.phase !== 'character_selection')
          d.session.game.roomIndex = 3;
      },
    ],
  ])('rejects %s without changing the live session', (_label, update) => {
    const session = start();
    const save = serializeGameSave(session);
    expect(() => parseGameSave(change(save, update))).toThrow();
    expect(serializeGameSave(session, new Date('2026-10-11'))).toBe(
      serializeGameSave(start(), new Date('2026-10-11')),
    );
  });
  it('rejects malformed, oversized and illegal submitted actions', () => {
    expect(() => parseGameSave('{no')).toThrow('JSON');
    expect(() => parseGameSave(' '.repeat(maxSaveBytes + 1))).toThrow('过大');
    const session = reduceGameSession(start(), {
      type: 'submit_player_turn',
      turn: {
        playerId: 'human',
        actions: [{ type: 'bid', group: 'A', amount: 10 }],
      },
    });
    const save = serializeGameSave(session);
    expect(() =>
      parseGameSave(
        change(save, (d) => {
          d.session.turns[0]!.actions = [
            { type: 'bid', group: 'C' as never, amount: 10 },
          ];
        }),
      ),
    ).toThrow();
    expect(() =>
      parseGameSave(
        change(save, (d) => {
          d.session.turns[0]!.actions = [
            { type: 'bid', group: 'A', amount: 1000 },
          ];
        }),
      ),
    ).toThrow('非法');
  });
  it('accepts a UTF-8 BOM and different JSON property order', () => {
    const doc = JSON.parse(serializeGameSave(start()));
    doc.checkpoint.game = Object.fromEntries(
      Object.entries(doc.checkpoint.game).reverse(),
    );
    expect(parseGameSave('\uFEFF' + JSON.stringify(doc)).session.game).toEqual(
      start().game,
    );
  });
  it('fails harmlessly when browser read/write/removal is blocked', () => {
    const blocked: SaveStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(persistGameSession(blocked, start())).toBe(false);
    expect(persistGameSession(blocked, createGameSession(3))).toBe(false);
    expect(loadAutoSave(blocked).session).toBeNull();
    expect(() => serializeGameSave(start())).not.toThrow();
  });
  it('refreshes from autosave and removes only the old game after restart', () => {
    const store = storage();
    store.setItem('bidding-ui-preferences-v1', 'preferences');
    expect(persistGameSession(store, start())).toBe(true);
    expect(loadAutoSave(store).session).toEqual(start());
    expect(persistGameSession(store, createGameSession(9))).toBe(true);
    expect(store.getItem(gameSaveKey)).toBeNull();
    expect(store.getItem('bidding-ui-preferences-v1')).toBe('preferences');
  });
  it('retains corrupted auto-save data instead of removing it during a failed load', () => {
    const store = storage();
    store.setItem(gameSaveKey, 'broken');
    expect(loadAutoSave(store).message).toContain('未读取');
    expect(store.getItem(gameSaveKey)).toBe('broken');
  });
});
