import { describe, expect, it, vi } from 'vitest';
import { characterCatalog } from '../game/characters';
import { defaultRules } from '../game/config';
import { validateTurn } from '../game/turns';
import * as client from '../game/client-session';
import type { CharacterId, PlayerTurn } from '../game/item-types';
import {
  createGameSession,
  reduceGameSession,
  type GameSession,
} from './game-session';
import { parseGameSave, maxSaveBytes } from './game-save';
import { serializeSessionFixture as serializeGameSave } from './save-fixture.test-helper';
import {
  maxReplayBytes,
  parseReplay,
  serializeReplay,
  type ReplayDocument,
} from './game-replay';
import { canonicalJson, replayRoomLocator } from './replay-record';
import { packReplay } from './replay-codec';
import { serializeGameCheckpoint } from './game-save';
import { replayOutcomeLabels, replayPlayerRows } from './replay-display';

function start(characterId: CharacterId = 'lost', seed = 20261011) {
  return reduceGameSession(createGameSession(seed), {
    type: 'start_game',
    characterId,
  });
}
function submit(session: GameSession, n = 0) {
  if (session.game.phase === 'character_selection')
    throw new Error('not started');
  const p = session.game.players.find((p) => p.isHuman)!;
  let turn: PlayerTurn = {
    playerId: 'human',
    actions: [
      {
        type: n % 2 ? 'disrupt' : 'bid',
        group: n % 2 ? 'B' : 'A',
        amount: Math.max(1, Math.floor(p.money * 0.15)),
      },
    ],
  };
  if (validateTurn(p, turn, defaultRules).length)
    turn = { playerId: 'human', actions: [{ type: 'withdraw' }] };
  return reduceGameSession(session, { type: 'submit_player_turn', turn });
}
function fullGame(characterId: CharacterId) {
  let session = start(characterId);
  for (let i = 0; i < 15; i++) {
    session = submit(session, i);
    session = reduceGameSession(session, { type: 'advance_room' });
  }
  return session;
}
function edited(doc: ReplayDocument, update: (doc: ReplayDocument) => void) {
  const clone = JSON.parse(JSON.stringify(doc)) as ReplayDocument;
  update(clone);
  return serializeReplay(
    clone.replay,
    clone.exportedBuild,
    new Date(clone.exportedAt),
  );
}

describe('recorded read-only replays', () => {
  it('records no future room or unsubmitted action, and stays empty before the first settlement', () => {
    expect(createGameSession(42).replay).toBeNull();
    const session = start();
    expect(session.replay!.rooms).toHaveLength(0);
    expect(Object.keys(session.replay!.playerNames)).toHaveLength(20);
    const file = JSON.parse(serializeReplay(session.replay!, 'build-1'));
    expect(file.replay.rooms).toHaveLength(0);
    expect(file.replay).not.toHaveProperty('draft');
    expect(file.replay).not.toHaveProperty('aiProfiles');
    expect(parseReplay(JSON.stringify(file)).replay).toEqual(session.replay);
  });
  it('captures actual actions, AI choices, events and independent before/after snapshots exactly once', () => {
    const before = start();
    const settled = submit(before);
    if (settled.game.phase === 'character_selection') throw new Error();
    const log = settled.replay!;
    const record = log.rooms[0]!;
    expect(record.settlement).toEqual(
      JSON.parse(JSON.stringify(settled.game.roomSettlement)),
    );
    expect(record.entryEvents).toEqual(settled.game.roomEntryEvents);
    expect(record.aiChoices).toHaveLength(19);
    expect(record.settlement.turns).toHaveLength(20);
    expect(record.previousPlayers).toBeNull();
    expect(record.seed).toBe(settled.game.seed);
    expect(
      reduceGameSession(settled, {
        type: 'submit_player_turn',
        turn: settled.turns[0]!,
      }),
    ).toBe(settled);
    const ranked = reduceGameSession(settled, {
      type: 'show_room_ranking',
      view: 'contest',
    });
    expect(ranked.replay).toBe(log);
    const next = submit(reduceGameSession(ranked, { type: 'advance_room' }), 1);
    expect(next.replay!.rooms).toHaveLength(2);
    expect(next.replay!.rooms[1]!.previousPlayers).toEqual(
      record.settlement.players,
    );
    const snapshot = JSON.stringify(record);
    settled.game.players[0]!.money += 99;
    expect(JSON.stringify(record)).toBe(snapshot);
  });
  it.each(characterCatalog.map((c) => c.id))(
    'exports and verifies all 15 actual %s rooms and final multipliers',
    (id) => {
      const session = fullGame(id);
      const log = session.replay!;
      expect(log.rooms).toHaveLength(15);
      expect(log.rooms[5]!.location).toBe('F2-R1');
      expect(log.rooms[5]!.previousPlayers).toEqual(
        log.rooms[4]!.settlement.players,
      );
      expect(log.final!.ranking).toEqual(
        session.game.phase !== 'character_selection'
          ? session.game.finalRanking
          : [],
      );
      for (const room of log.rooms)
        for (const row of replayPlayerRows(room)) {
          expect(row.after.score - row.before.score).toBeCloseTo(
            row.score.finalScore,
            3,
          );
          expect(row.moneyDelta).toBe(row.after.money - row.before.money);
        }
      for (const entry of log.final!.ranking) {
        const p = log.final!.players.find((p) => p.id === entry.playerId)!;
        expect(entry.finalScore).toBeCloseTo(
          p.score * log.final!.crownMultipliers[p.id]!,
          3,
        );
      }
      const source = serializeReplay(log, 'export-build');
      expect(new TextEncoder().encode(source).length).toBeLessThan(
        maxReplayBytes,
      );
      expect(
        new TextEncoder().encode(serializeGameSave(session)).length,
      ).toBeLessThan(maxSaveBytes);
      expect(parseReplay(source).replay).toEqual(log);
    },
  );
  it('preserves recorded build identities across compatible UI releases and later save resumes', () => {
    const session = submit(start());
    session.replay!.startedBuild = 'origin-build';
    session.replay!.rooms[0]!.build = 'room-build';
    const restored = parseGameSave(serializeGameSave(session)).session;
    expect(restored.replay).toEqual(session.replay);
    const next = submit(
      reduceGameSession(restored, { type: 'advance_room' }),
      1,
    );
    expect(next.replay!.rooms[0]!.build).toBe('room-build');
    expect(next.replay!.rooms[1]!.build).toBe('test-or-unbundled');
    expect(
      parseReplay(serializeReplay(next.replay!, 'new-export-build'))
        .exportedBuild,
    ).toBe('new-export-build');
  });
  it('restores lightweight v2 history with its recorded build and explicit reconstruction source', () => {
    const session = submit(start());
    const old = JSON.parse(serializeGameCheckpoint(session));
    const restored = parseGameSave(JSON.stringify(old)).session;
    expect(restored.game).toEqual(session.game);
    expect(restored.replay!.rooms[0]!.source).toBe('checkpoint-reconstruction');
    expect(restored.replay!.startedBuild).toBe(session.replay!.startedBuild);
    const next = submit(
      reduceGameSession(restored, { type: 'advance_room' }),
      1,
    );
    expect(next.replay!.rooms.map((r) => r.source)).toEqual([
      'checkpoint-reconstruction',
      'live',
    ]);
    expect(
      parseReplay(serializeReplay(next.replay!, 'current')).replay,
    ).toEqual(next.replay);
  });
  it('keeps feedback locators stable across UI versions, with a fingerprint for branch differences', () => {
    const first = submit(start());
    const second = submit(start());
    expect(replayRoomLocator(first.replay!, first.replay!.rooms[0]!)).toBe(
      replayRoomLocator(second.replay!, second.replay!.rooms[0]!),
    );
    second.replay!.rooms[0]!.build = 'different-ui';
    expect(replayRoomLocator(first.replay!, first.replay!.rooms[0]!)).toBe(
      replayRoomLocator(second.replay!, second.replay!.rooms[0]!),
    );
    const branch = reduceGameSession(start(), {
      type: 'submit_player_turn',
      turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
    });
    expect(branch.replay!.id).toBe(first.replay!.id);
    expect(
      replayRoomLocator(branch.replay!, branch.replay!.rooms[0]!),
    ).not.toBe(replayRoomLocator(first.replay!, first.replay!.rooms[0]!));
  });
  it('rejects incompatible rules before invoking current algorithms', () => {
    const log = JSON.parse(JSON.stringify(submit(start()).replay!));
    log.rulesVersion = 'older-rules';
    log.id = log.id.replace(/-[^-]+$/, '-rules');
    delete log.ruleFacts;
    log.rooms.forEach((r: { locator?: string }) => delete r.locator);
    const doc = {
      format: 'the-bidding-of-isaac-replay',
      version: 2,
      exportedAt: new Date().toISOString(),
      exportedBuild: 'current',
      replay: packReplay(log),
    };
    const generate = vi.spyOn(client, 'startClientGame');
    expect(() => parseReplay(JSON.stringify(doc))).toThrow('不兼容');
    expect(generate).not.toHaveBeenCalled();
    generate.mockRestore();
  });
  it.each([
    [
      'missing players',
      (d: ReplayDocument) => {
        d.replay.rooms[0]!.settlement.players = [];
      },
    ],
    [
      'altered cash',
      (d: ReplayDocument) => {
        d.replay.rooms[0]!.settlement.players[0]!.money += 1;
      },
    ],
    [
      'altered score',
      (d: ReplayDocument) => {
        d.replay.rooms[0]!.settlement.roomScoreSummaries.human!.finalScore += 1;
      },
    ],
    [
      'altered entry event',
      (d: ReplayDocument) => {
        d.replay.rooms[0]!.entryEvents[0]!.message = 'fake';
      },
    ],
    [
      'altered AI action',
      (d: ReplayDocument) => {
        d.replay.rooms[0]!.settlement.turns[1]!.actions = [
          { type: 'withdraw' },
        ];
      },
    ],
    [
      'altered reward',
      (d: ReplayDocument) => {
        d.replay.rooms[0]!.settlement.room.rewards[0].itemId =
          'removed' as never;
      },
    ],
    [
      'altered random result',
      (d: ReplayDocument) => {
        d.replay.rooms[0]!.settlement.events.push({
          type: 'duplicate',
          playerId: 'human',
          message: 'fake',
        });
      },
    ],
    [
      'wrong location',
      (d: ReplayDocument) => {
        d.replay.rooms[0]!.location = 'F3-R5';
      },
    ],
    [
      'wrong room seed',
      (d: ReplayDocument) => {
        d.replay.rooms[0]!.seed = 1;
      },
    ],
    [
      'duplicate room',
      (d: ReplayDocument) => {
        d.replay.rooms.push(d.replay.rooms[0]!);
      },
    ],
    [
      'invalid names',
      (d: ReplayDocument) => {
        d.replay.playerNames.human = '';
      },
    ],
    [
      'wrong id',
      (d: ReplayDocument) => {
        d.replay.id = 'fake';
      },
    ],
  ])('rejects %s', (_label, update) => {
    const doc = parseReplay(
      serializeReplay(submit(start()).replay!, 'current'),
    );
    expect(() => parseReplay(edited(doc, update))).toThrow();
  });
  it('rejects invalid JSON, excessive size, future schema versions, missing metadata and save files', () => {
    expect(() => parseReplay('broken')).toThrow('JSON');
    expect(() => parseReplay(' '.repeat(maxReplayBytes + 1))).toThrow('8 MiB');
    expect(() => parseReplay(serializeGameSave(start()))).toThrow('不同文件');
    const doc = JSON.parse(serializeReplay(submit(start()).replay!, 'current'));
    doc.version = 999;
    expect(() => parseReplay(JSON.stringify(doc))).toThrow('版本');
    doc.version = 3;
    doc.exportedBuild = '';
    expect(() => parseReplay(JSON.stringify(doc))).toThrow('标识');
    expect(
      parseReplay(
        '\uFEFF' + serializeReplay(submit(start()).replay!, 'current'),
      ).replay.rooms,
    ).toHaveLength(1);
  });
  it('rejects non-finite JSON exponents instead of treating them like a null field', () => {
    const session = reduceGameSession(start(), {
      type: 'submit_player_turn',
      turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
    });
    const source = serializeReplay(session.replay!, 'build').replace(
      '"marketEquivalent":null',
      '"marketEquivalent":1e999',
    );
    expect(() => parseReplay(source)).toThrow('非法数值');
  });
  it('preserves observed triggers and actual outcome labels, without consuming random draws while viewing', () => {
    const session = fullGame('lost');
    const before = canonicalJson(session.replay);
    const outcome = session.replay!.rooms.flatMap((r) =>
      replayOutcomeLabels(r, 'human'),
    );
    expect(outcome.some((v) => v.includes('永恒六面骰'))).toBe(true);
    expect(canonicalJson(session.replay)).toBe(before);
  });
});
