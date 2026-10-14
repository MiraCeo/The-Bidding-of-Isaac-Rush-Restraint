import { describe, expect, it, vi } from 'vitest';
import * as ai from '../game/ai-decision';
import * as random from '../game/random';
import * as room from '../game/room-engine';
import * as survival from '../game/survival-session';
import { characterOrder } from '../game/characters';
import type {
  SurvivalGameState,
  SurvivalCommandRecord,
} from '../game/survival-session';
import type { SurvivalRuleFacts, SurvivalReplayLog } from './survival-record';
import {
  createSurvivalReplay,
  survivalCompatibility,
  survivalMatchId,
} from './survival-record';
import {
  serializeSurvivalCheckpoint,
  parseSurvivalCheckpoint,
  serializeSurvivalReplay,
  parseSurvivalReplay,
  persistSurvivalCheckpoint,
  loadSurvivalCheckpoint,
  survivalSaveKey,
  survivalLastCompletedKey,
} from './survival-persistence';
import { parseModeDataFile } from './mode-data';
import { withChecksum } from './file-json';
import { canonicalJson, copySnapshot } from '../shared/json-facts';
import { gameSaveKey } from './game-save';
import { playerProfileKey } from './player-profile';
import oldReplay from './fixtures/replay-v2-lost-20261012.json';
import oldCheckpoint from './fixtures/checkpoint-v2-lost-20261012.json';
import type { RoomDraft } from './game-session';

const now = new Date('2026-10-13T00:00:00Z');
function start(
  characterId = 'isaac' as (typeof characterOrder)[number],
  seed = 42,
  cut = 0,
) {
  return survival.startSurvivalGame({
    characterId,
    seed,
    cutLines: Array(7).fill(cut),
    buildId: 'step3-original',
  });
}
function step(game: SurvivalGameState): SurvivalGameState {
  if (game.phase === 'room_action')
    return survival.survivalGameReducer(
      game,
      game.activePlayerIds.includes('human')
        ? {
            type: 'submit_player_turn',
            turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
          }
        : { type: 'submit_ai_room' },
    );
  return survival.survivalGameReducer(
    game,
    game.phase === 'room_result'
      ? { type: 'advance_room' }
      : { type: 'advance_floor' },
  );
}
function complete(game = start()): SurvivalGameState {
  let current = game,
    n = 0;
  while (current.phase !== 'competition_complete') {
    if (n++ > 80) throw new Error('Not bounded');
    current = step(current);
  }
  return current;
}
function checkpoint(game: SurvivalGameState, draft: RoomDraft | null = null) {
  return serializeSurvivalCheckpoint(game, draft, now);
}
function replay(game: SurvivalGameState) {
  return serializeSurvivalReplay(
    createSurvivalReplay(game),
    'step3-export',
    now,
  );
}
interface TamperDocument {
  checksum: string;
  mode?: string;
  version: number;
  compatibility: string;
  ruleFacts: SurvivalRuleFacts;
  snapshot: SurvivalGameState & { extra?: string };
  commands: SurvivalCommandRecord[];
  replay: SurvivalReplayLog & { extra?: boolean };
}
function alter(source: string, update: (doc: TamperDocument) => void): string {
  const doc = JSON.parse(source) as TamperDocument;
  update(doc);
  const { checksum: _checksum, ...payload } = doc;
  return JSON.stringify(withChecksum(payload));
}

describe('v4 survival continuation and recorded-fact replay', () => {
  it.each(characterOrder)(
    'roundtrips all phases and resumes identically for %s',
    (characterId) => {
      let original = start(characterId),
        restored = parseSurvivalCheckpoint(checkpoint(original)).game;
      let commands = 0;
      while (original.phase !== 'competition_complete') {
        original = step(original);
        restored = step(restored);
        expect(restored).toEqual(original);
        restored = parseSurvivalCheckpoint(checkpoint(restored)).game;
        expect(restored).toEqual(original);
        if (++commands > 80) throw new Error('Exceeded preset');
      }
      expect(parseSurvivalReplay(replay(original)).replay).toEqual(
        createSurvivalReplay(original),
      );
    },
    30_000,
  );

  it.each([0, 1, 2, 9, 10, 11, 12])(
    'exports only completed factual history at progress command %s',
    (count) => {
      let game = start();
      for (let i = 0; i < count; i++) game = step(game);
      const result = parseSurvivalReplay(replay(game)).replay;
      expect(result.rooms).toHaveLength(game.roomRecords.length);
      expect(result.floors).toHaveLength(game.floorRecords.length);
      expect(result.final).toBeNull();
      expect(result).not.toHaveProperty('commandLog');
      expect(result).not.toHaveProperty('aiProfiles');
      expect(result).not.toHaveProperty('roomsFuture');
      expect(result.initialPlayers).toHaveLength(20);
    },
  );

  it('imports a replay without executing startup, AI, RNG, room settlement, continuation or localStorage', () => {
    const source = replay(complete(start('lost', 87)));
    const spies = [
      vi.spyOn(ai, 'decideAiTurn'),
      vi.spyOn(random, 'createSeededRandom'),
      vi.spyOn(room, 'settleRuntimeRoom'),
      vi.spyOn(survival, 'startSurvivalGame'),
      vi.spyOn(survival, 'survivalGameReducer'),
    ];
    try {
      const result = parseSurvivalReplay(source);
      expect(result.replay.final!.ranking).toHaveLength(20);
      spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });

  it('restores after human elimination, then runs AI-only commands without fake human turns', () => {
    let game = start();
    const group =
      game.rooms[0]![0]!.rewards[0].itemId === 'grab_bag' ||
      game.rooms[0]![0]!.rewards[0].itemId === 'guppys_collar'
        ? 'B'
        : 'A';
    game = survival.survivalGameReducer(game, {
      type: 'submit_player_turn',
      turn: {
        playerId: 'human',
        actions: [{ type: 'bid', group, amount: game.players[0]!.money }],
      },
    });
    while (game.phase !== 'floor_result') game = step(game);
    expect(game.activePlayerIds).not.toContain('human');
    const original = survival.continueSurvivalAfterHumanElimination(game);
    const restored = survival.continueSurvivalAfterHumanElimination(
      parseSurvivalCheckpoint(checkpoint(game)).game,
    );
    expect(restored).toEqual(original);
    expect(
      restored.commandLog
        .slice(game.commandLog.length)
        .some((entry) => entry.action.type === 'submit_ai_room'),
    ).toBe(true);
    expect(
      restored.commandLog
        .slice(game.commandLog.length)
        .every((entry) => entry.action.type !== 'submit_player_turn'),
    ).toBe(true);
  });

  it('preserves total elimination, every rank and a null champion across files', () => {
    const game = complete(start('isaac', 42, 1_000_000));
    expect(game.completionReason).toBe('all_eliminated');
    expect(parseSurvivalCheckpoint(checkpoint(game)).game).toEqual(game);
    const final = parseSurvivalReplay(replay(game)).replay.final!;
    expect(final.activePlayerIds).toEqual([]);
    expect(final.championId).toBeNull();
    expect(final.ranking).toHaveLength(20);
    expect(final.ranking.every((entry) => !entry.isChampion)).toBe(true);
  });

  it('does not repeat inherited score in final cumulative totals', () => {
    const game = complete();
    for (const entry of game.finalRanking) {
      const sum = game.floorRecords.reduce(
        (total, layer) => total + (layer.scores[entry.playerId]?.newScore ?? 0),
        0,
      );
      expect(entry.finalScore).toBeCloseTo(sum, 4);
    }
    expect(
      parseSurvivalReplay(replay(game)).replay.final!.cumulativeScores,
    ).toEqual(game.cumulativeScores);
  });

  it('preserves original room and floor builds when resumed using a newer build', () => {
    let game = step(start());
    game = survival.withSurvivalBuild(game, 'step3-newer');
    game = step(game);
    game = step(game);
    const restored = parseSurvivalCheckpoint(checkpoint(game)).game;
    expect(restored).toEqual(game);
    expect(restored.startedBuild).toBe('step3-original');
    expect(restored.roomRecords[0]!.build).toBe('step3-original');
    expect(restored.roomRecords[1]!.build).toBe('step3-newer');
    expect(
      parseSurvivalReplay(replay(restored)).replay.rooms.map(
        (record) => record.build,
      ),
    ).toEqual(['step3-original', 'step3-newer']);
  });

  it('reads a historical engine identity from stored facts, without allowing current-engine continuation', () => {
    const log = createSurvivalReplay(complete());
    log.ruleFacts.engineVersion = 'historical-survival-client';
    log.compatibility = survivalCompatibility(log.ruleFacts);
    log.id = survivalMatchId(log.seed, log.characterId, log.compatibility);
    expect(
      parseSurvivalReplay(serializeSurvivalReplay(log, 'historic', now)).replay,
    ).toEqual(log);
    const changed = alter(checkpoint(start()), (doc) => {
      doc.ruleFacts.engineVersion = 'historical-survival-client';
      doc.compatibility = survivalCompatibility(doc.ruleFacts);
    });
    expect(() => parseSurvivalCheckpoint(changed)).toThrow('不兼容');
  });

  it('preserves the original final-settlement build when an already completed game is viewed or exported in a newer build', () => {
    const original = complete();
    const changed = survival.withSurvivalBuild(original, 'new-view-only-build');
    expect(changed.completedBuild).toBe('step3-original');
    expect(changed.currentBuild).toBe('new-view-only-build');
    const restored = parseSurvivalCheckpoint(checkpoint(changed)).game;
    expect(restored).toEqual(changed);
    expect(parseSurvivalReplay(replay(restored)).replay.final!.build).toBe(
      'step3-original',
    );
    expect(restored.finalRanking).toEqual(original.finalRanking);
  });

  it('keeps mode, parameters and rule identities distinct for equal seed/character games', () => {
    const a = createSurvivalReplay(start()),
      b = createSurvivalReplay(start('isaac', 42, 100));
    expect(a.id).not.toBe(b.id);
    expect(a.compatibility).not.toBe(b.compatibility);
    expect(a.id).toContain('SURVIVAL');
    expect(a.ruleFacts.mechanics.excludedItems).toEqual(['dark_princes_crown']);
    expect(
      a.ruleFacts.items.some((item) => item.id === 'dark_princes_crown'),
    ).toBe(false);
  });

  it('copies replay facts rather than aliasing mutable game history', () => {
    const game = step(start());
    const source = createSurvivalReplay(game);
    source.rooms[0]!.players[0]!.money = 999999;
    expect(game.roomRecords[0]!.players[0]!.money).not.toBe(999999);
  });

  it('roundtrips a valid draft without submitting, registering completion or changing game facts', () => {
    const game = start('jacob_esau');
    const draft: RoomDraft = {
      selectedAction: { kind: 'bid', groups: ['A', 'B'] },
      amounts: { A: { bid: 100, disrupt: 20 }, B: { bid: 101, disrupt: 21 } },
    };
    const restored = parseSurvivalCheckpoint(checkpoint(game, draft));
    expect(restored.game).toEqual(game);
    expect(restored.draft).toEqual(draft);
    expect(restored.game.commandLog).toEqual([]);
  });

  it.each([
    {
      selectedAction: { kind: 'bid', groups: ['A', 'A'] },
      amounts: { A: { bid: 10, disrupt: 10 }, B: { bid: 10, disrupt: 10 } },
    },
    {
      selectedAction: { kind: 'bid', groups: ['A', 'B'] },
      amounts: { A: { bid: 700, disrupt: 10 }, B: { bid: 700, disrupt: 10 } },
    },
    {
      selectedAction: { kind: 'withdraw', groups: ['A'] },
      amounts: { A: { bid: 10, disrupt: 10 }, B: { bid: 10, disrupt: 10 } },
    },
  ])('rejects an illegal draft %j', (draft) => {
    expect(() => checkpoint(start('jacob_esau'), draft as RoomDraft)).toThrow();
  });

  it('uses new storage keys without deleting classic data or touching the independent profile', () => {
    const values = new Map([
      [gameSaveKey, 'original-classic'],
      [playerProfileKey, 'original-profile'],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    const game = complete();
    expect(persistSurvivalCheckpoint(storage, game)).toBe(true);
    expect(values.get(gameSaveKey)).toBe('original-classic');
    expect(values.get(playerProfileKey)).toBe('original-profile');
    expect(values.has(survivalLastCompletedKey)).toBe(true);
    expect(loadSurvivalCheckpoint(storage).document!.game).toEqual(game);
    values.set(survivalSaveKey, 'corrupted');
    expect(loadSurvivalCheckpoint(storage)).toMatchObject({ document: null });
    expect(values.get(survivalSaveKey)).toBe('corrupted');
  });

  it('handles unavailable or failing storage without partial in-memory mutation', () => {
    const game = start(),
      before = canonicalJson(game);
    expect(persistSurvivalCheckpoint(null, game)).toBe(false);
    expect(
      persistSurvivalCheckpoint(
        {
          getItem: () => null,
          setItem: () => {
            throw new Error('blocked');
          },
          removeItem: () => {},
        },
        game,
      ),
    ).toBe(false);
    expect(canonicalJson(game)).toBe(before);
    expect(loadSurvivalCheckpoint(null).document).toBeNull();
  });

  it('rejects old v2 samples and dispatches current survival files without conversion', () => {
    expect(()=>parseModeDataFile(JSON.stringify(oldReplay),'old.json')).toThrow('v5');
    expect(()=>parseModeDataFile(JSON.stringify(oldCheckpoint),'old-save.json')).toThrow('v5');
    expect(
      parseModeDataFile(checkpoint(start()), 'survival-save.json').kind,
    ).toBe('survival-checkpoint');
    expect(
      parseModeDataFile(replay(start()), 'survival-replay.json').kind,
    ).toBe('survival-replay');
  });

  it('accepts a UTF-8 BOM and property-order differences without changing the factual identity', () => {
    const game = step(start());
    const document = JSON.parse(replay(game));
    const reordered = Object.fromEntries(Object.entries(document).reverse());
    expect(
      parseSurvivalReplay('\uFEFF' + JSON.stringify(reordered)).replay,
    ).toEqual(createSurvivalReplay(game));
    expect(parseSurvivalCheckpoint('\uFEFF' + checkpoint(game)).game).toEqual(
      game,
    );
  });

  it.each([
    (doc: TamperDocument) => {
      doc.snapshot.players[0].money += 1;
    },
    (doc: TamperDocument) => {
      doc.snapshot.cumulativeScores.human = 999;
    },
    (doc: TamperDocument) => {
      doc.commands.push(copySnapshot(doc.commands[0]));
    },
    (doc: TamperDocument) => {
      const action = doc.commands[0]!.action;
      if (action.type !== 'submit_player_turn')
        throw new Error('Expected human action');
      action.turn.playerId = 'ai-1';
    },
    (doc: TamperDocument) => {
      const action = doc.commands[0]!.action;
      if (action.type !== 'submit_player_turn')
        throw new Error('Expected human action');
      action.turn.actions[0] = {
        type: 'bid',
        group: 'A',
        amount: -1,
      };
    },
    (doc: TamperDocument) => {
      doc.snapshot.extra = 'unknown';
    },
    (doc: TamperDocument) => {
      doc.mode = 'classic';
    },
    (doc: TamperDocument) => {
      doc.version = 3;
    },
  ])(
    'rejects a modified checkpoint even with a recomputed checksum: %s',
    (update) => {
      expect(() =>
        parseSurvivalCheckpoint(alter(checkpoint(step(start())), update)),
      ).toThrow();
    },
  );

  it.each([
    (doc: TamperDocument) => {
      doc.replay.rooms[0].players[0].money += 1;
    },
    (doc: TamperDocument) => {
      doc.replay.rooms[0].roomScoreSummaries.human.finalScore += 0.0001;
    },
    (doc: TamperDocument) => {
      doc.replay.floors[0].scores.human.inheritedScore += 1;
    },
    (doc: TamperDocument) => {
      doc.replay.floors[0].plan.survivorIds.push('human');
    },
    (doc: TamperDocument) => {
      doc.replay.final!.ranking.reverse();
    },
    (doc: TamperDocument) => {
      doc.replay.final!.cumulativeScores.human += 1;
    },
    (doc: TamperDocument) => {
      doc.replay.final!.championId = 'unknown';
    },
    (doc: TamperDocument) => {
      doc.replay.rooms[0].aiChoices[0].playerId = 'human';
    },
    (doc: TamperDocument) => {
      doc.replay.rooms[0].players[0].items[0].itemId = 'dark_princes_crown';
    },
    (doc: TamperDocument) => {
      doc.replay.floors.push(copySnapshot(doc.replay.floors[0]));
    },
    (doc: TamperDocument) => {
      const room = doc.replay.rooms[0].room;
      room.rewards = [room.rewards[0], { ...room.rewards[0], group: 'B' }];
    },
    (doc: TamperDocument) => {
      doc.replay.extra = true;
    },
  ])(
    'rejects inconsistent replay facts even with a recomputed checksum: %s',
    (update) => {
      expect(() =>
        parseSurvivalReplay(alter(replay(complete()), update)),
      ).toThrow();
    },
  );

  it('does not accept a removed mode field as a legacy classic default in a v4 file', () => {
    const changed = alter(checkpoint(start()), (doc) => {
      delete doc.mode;
    });
    expect(() => parseModeDataFile(changed, 'unknown.json')).toThrow();
  });

  it('keeps recorded layer decisions with an explicit internal exchange experiment across both protocols', () => {
    // Explicitly changing the exchange ratio must remain part of the stored rules and identity.
    const options = {
      characterId: 'isaac' as const,
      seed: 42,
      cutLines: Array(7).fill(0),
      rules: { ...start().rules, moneyExchangeRatio: 0 },
    };
    let game = survival.startSurvivalGame(options);
    while (game.phase !== 'floor_result') game = step(game);
    const roundtripped = parseSurvivalCheckpoint(checkpoint(game)).game;
    expect(roundtripped.floorRecords[0]!.resolution).toEqual(
      game.floorRecords[0]!.resolution,
    );
    expect(
      parseSurvivalReplay(replay(game)).replay.floors[0]!.resolution,
    ).toEqual(game.floorRecords[0]!.resolution);
  });

  it('rejects a mode checkpoint used as a replay or a factual replay used for continuation', () => {
    expect(() => parseSurvivalReplay(checkpoint(start()))).toThrow();
    expect(() => parseSurvivalCheckpoint(replay(start()))).toThrow();
  });

  it('reads historical all-withdrawal tie evidence without rerolling, but refuses research AI continuation', () => {
    const initial = survival.startSurvivalGame({
      characterId: 'isaac',
      seed: 42,
      cutLines: Array(7).fill(0),
      rules: { ...start().rules, moneyExchangeRatio: 0 },
    });
    const reducer = survival.createSurvivalResearchReducer(
      (player, floor, rules, random, options) =>
        ai.decideAiTurn(player, floor, rules, random, {
          ...options,
          strategyMultipliers: {
            high_bid: 0,
            cooperate: 0,
            disrupt_high: 0,
            disrupt_cooperate: 0,
            withdraw: 1,
          },
        }),
    );
    let game = initial;
    for (let i = 0; i < 5; i += 1) {
      game = reducer(game, {
        type: 'submit_player_turn',
        turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
      });
      game = reducer(game, { type: 'advance_room' });
    }
    expect(game.floorRecords[0]!.resolution.reason).toBe('random_tie');
    expect(game.floorRecords[0]!.resolution.tieBreaks).toHaveLength(20);
    const log = createSurvivalReplay(game);
    log.ruleFacts.engineVersion = 'historical-survival-tie-study';
    log.compatibility = survivalCompatibility(log.ruleFacts);
    log.id = survivalMatchId(log.seed, log.characterId, log.compatibility);
    const source = serializeSurvivalReplay(log, 'historical-study', now);
    const draw = vi.spyOn(random, 'createSeededRandom');
    try {
      expect(parseSurvivalReplay(source).replay.floors[0]!.resolution).toEqual(
        game.floorRecords[0]!.resolution,
      );
      expect(draw).not.toHaveBeenCalled();
    } finally {
      draw.mockRestore();
    }
    expect(() => parseSurvivalCheckpoint(checkpoint(game))).toThrow();
  });

  it('rejects non-finite exports before normalization can silently erase their values', () => {
    const game = start();
    game.players[0]!.money = Infinity;
    expect(() => checkpoint(game)).toThrow('非法数值');
  });

  it.each([
    'not JSON',
    '{"version":4}',
    JSON.stringify({ value: 'x'.repeat(8 * 1024 * 1024) }),
    '{"format":"the-bidding-of-isaac-save","version":4,"mode":"survival","bad":1e999}',
    '{"__proto__":{"polluted":true}}',
    '['.repeat(40) + '0' + ']'.repeat(40),
  ])('rejects malformed, oversized or unsafe structures', (source) => {
    expect(() => parseSurvivalCheckpoint(source)).toThrow();
    expect(() => parseSurvivalReplay(source)).toThrow();
  });
});
