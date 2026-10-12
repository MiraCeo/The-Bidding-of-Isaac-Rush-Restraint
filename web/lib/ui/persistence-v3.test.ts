import { describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import original from './fixtures/replay-v2-lost-20261012.json';
import originalCheckpoint from './fixtures/checkpoint-v2-lost-20261012.json';
import * as ai from '../game/ai-decision';
import * as room from '../game/room-engine';
import * as client from '../game/client-session';
import { parseReplay, serializeReplay } from './game-replay';
import { packReplay, unpackReplay } from './replay-codec';
import {
  packReplayFacts,
  unpackReplayFacts,
  replayFactsIdentity,
  replayRuleFacts,
} from './replay-facts-codec';
import { toEventFact, fromEventFact } from './replay-event-facts';
import {
  canonicalJson,
  copySnapshot,
  replayRoomLocator,
  type ReplayLog,
} from './replay-record';
import { shortHash } from './game-version';
import {
  replaySelectedResult,
  replayRewardVerdict,
  replayOverview,
} from './replay-view-model';
import {
  parseGameSave,
  serializeGameCheckpoint,
  serializeGameBackup,
  persistGameSession,
  gameSaveKey,
  activeReplayKey,
  lastCompletedKey,
  loadAutoSave,
} from './game-save';
import { createPlayerProfile } from './player-profile';
import {
  parseDataFile,
  sameReplayResults,
  completedReplaySession,
  previewCompletedReplay,
} from './data-management';
import { createGameSession, reduceGameSession } from './game-session';
const oldSource = JSON.stringify(original);
const now = new Date('2026-10-12T00:00:00Z');
function legacyLog() {
  return unpackReplay(copySnapshot(original.replay));
}
function alteredWire(
  update: (wire: ReturnType<typeof packReplayFacts>) => void,
) {
  const doc = JSON.parse(serializeReplay(legacyLog(), 'test', now));
  update(doc.replay);
  const { checksum: _checksum, ...facts } = doc.replay;
  doc.replay.checksum = shortHash(canonicalJson(facts));
  return JSON.stringify(doc);
}
function futureLog(): ReplayLog {
  const l = legacyLog();
  l.ruleFacts = replayRuleFacts(l);
  l.ruleFacts.cooperationRadii = [17, 61, 113];
  l.rulesVersion = 'historical-test-engine-a1b2c3d4';
  l.id = l.id.replace(/-[^-]+$/, '-a1b2c3d4');
  return l;
}
describe('v3 factual persistence and genuine pre-upgrade fixtures', () => {
  it.each([42, 87, 128, 20261011])(
    'roundtrips a further naturally generated complete match: seed %s',
    (seed) => {
      let session = reduceGameSession(createGameSession(seed), {
        type: 'start_game',
        characterId: 'lost',
      });
      for (let i = 0; i < 15; i++) {
        if (session.game.phase === 'character_selection')
          throw new Error('not started');
        const money = session.game.players.find((p) => p.isHuman)!.money;
        session = reduceGameSession(session, {
          type: 'submit_player_turn',
          turn: {
            playerId: 'human',
            actions:
              money < 1 || i % 4 === 3
                ? [{ type: 'withdraw' }]
                : [
                    {
                      type: i % 2 ? 'disrupt' : 'bid',
                      group: i % 2 ? 'B' : 'A',
                      amount: Math.max(1, Math.floor(money * 0.2)),
                    },
                  ],
          },
        });
        session = reduceGameSession(session, { type: 'advance_room' });
      }
      expect(
        parseReplay(serializeReplay(session.replay!, 'additional-seed')).replay,
      ).toEqual(session.replay);
    },
  );
  it('reads genuine v2 and v3 without invoking AI, RNG-driven startup or settlement', () => {
    const old = legacyLog(),
      newSource = serializeReplay(old, 'v3-test', now);
    const decide = vi.spyOn(ai, 'decideAiTurn'),
      settle = vi.spyOn(room, 'settleRuntimeRoom'),
      start = vi.spyOn(client, 'startClientGame');
    const v2 = parseReplay(oldSource),
      v3 = parseReplay(newSource);
    expect(v2.version).toBe(2);
    expect(v3.version).toBe(3);
    expect(decide).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    decide.mockRestore();
    settle.mockRestore();
    start.mockRestore();
    expect(replayFactsIdentity(v2.replay)).toBe(replayFactsIdentity(v3.replay));
    expect(sameReplayResults(v2.replay, v3.replay)).toBe(true);
  });
  it('preserves all 300 player-room results, 600 reward verdicts and original room identities exactly', () => {
    const old = legacyLog(),
      next = parseReplay(serializeReplay(old, 'v3-test', now)).replay;
    expect(next.final).toEqual(old.final);
    next.rooms.forEach((r, i) => {
      const before = old.rooms[i]!;
      expect(r.settlement).toEqual(before.settlement);
      expect(r.entryEvents).toEqual(before.entryEvents);
      expect(r.aiChoices).toEqual(before.aiChoices);
      expect(r.previousPlayers).toEqual(before.previousPlayers);
      expect(replayRoomLocator(next, r)).toBe(replayRoomLocator(old, before));
      r.settlement.players.forEach((p) => {
        expect(replaySelectedResult(r, p.id)).toEqual(
          replaySelectedResult(before, p.id),
        );
        for (const group of ['A', 'B'] as const)
          expect(replayRewardVerdict(r, p.id, group)).toEqual(
            replayRewardVerdict(before, p.id, group),
          );
      });
    });
    next.final!.players.forEach((p) =>
      expect(replayOverview(next, p.id)).toEqual(replayOverview(old, p.id)),
    );
  });
  it('removes generated wording and repeated action/score containers without rounding factual numbers', () => {
    const old = legacyLog(),
      packed = packReplayFacts(old),
      source = JSON.stringify(packed);
    expect(source).not.toContain('"message":');
    expect(source).not.toContain('"legacyText":');
    expect(source).not.toContain('"resolvedActions":');
    expect(source).not.toContain('"scoreBreakdowns":');
    expect(source).not.toContain('"roomScoreSummaries":');
    expect(packed.rooms.filter((r) => r.checkpoint)).toHaveLength(3);
    expect(packed.rooms[0]).not.toHaveProperty('seed');
    expect(packed.rooms[0]!.settlement.turns).toHaveLength(20);
    expect(
      unpackReplayFacts(packed).rooms.map((r) => r.settlement.scoreBreakdowns),
    ).toEqual(old.rooms.map((r) => r.settlement.scoreBreakdowns));
    const newSource = serializeReplay(
      old,
      original.exportedBuild,
      new Date(original.exportedAt),
    );
    expect(Buffer.byteLength(newSource)).toBeLessThan(
      Buffer.byteLength(oldSource) * 0.85,
    );
    expect(gzipSync(newSource).length).toBeLessThan(gzipSync(oldSource).length);
  });
  it('retains actual non-deterministic outcomes including four double turns and post-award scores', () => {
    const l = parseReplay(serializeReplay(legacyLog(), 'v3-test')).replay;
    expect(
      l.rooms
        .flatMap((r) => r.settlement.turns)
        .filter((t) => t.actions.length === 2),
    ).toHaveLength(4);
    const events = l.rooms.flatMap((r) => r.settlement.events);
    expect(events.filter((e) => e.type === 'duplicate')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'destroy')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'refund')).toHaveLength(36);
    expect(
      events.filter((e) => e.type === 'score' && e.itemId === 'moms_heart'),
    ).toHaveLength(4);
  });
  it('records both transfer parties, rather than guessing a target from aggregate balance changes', () => {
    const event = {
      type: 'money' as const,
      playerId: 'ai-5',
      amount: 27,
      itemId: 'money_bag' as const,
      effectItemId: 'money_bag' as const,
      message: '偷钱袋从 human 窃取 27 资金。',
    };
    const fact = toEventFact(event);
    expect(fact.targetPlayerId).toBe('human');
    expect(fact.reason).toBe('bag_transfer');
    expect(fact).not.toHaveProperty('message');
    expect(fromEventFact(fact)).toEqual(event);
  });
  it('distinguishes savings, room interest, floor interest and actual refunds', () => {
    const examples = [
      {
        type: 'money' as const,
        playerId: 'human',
        amount: 6,
        itemId: 'steam_sale' as const,
        message: 'Steam大促节省 6 资金。',
      },
      {
        type: 'money' as const,
        playerId: 'human',
        amount: 5,
        itemId: 'interest' as const,
        message: '利息增加 5 资金。',
      },
      {
        type: 'money' as const,
        playerId: 'human',
        amount: 10,
        itemId: 'interest' as const,
        message: '利息提高本层初始资金 10。',
      },
      {
        type: 'refund' as const,
        playerId: 'human',
        amount: 27,
        itemId: 'holy_mantle' as const,
        message: '屏障退回 27 实际扣款。',
      },
    ];
    expect(examples.map((e) => toEventFact(e).reason)).toEqual([
      'sale_saving',
      'interest_room',
      'interest_floor',
      'shield_refund',
    ]);
    examples.forEach((e) => expect(fromEventFact(toEventFact(e))).toEqual(e));
  });
  it('reads a different historical rule context without invoking current rules and blocks restoration', () => {
    const l = futureLog(),
      source = serializeReplay(l, 'historical-export');
    const start = vi.spyOn(client, 'startClientGame');
    const doc = parseReplay(source);
    expect(replayRuleFacts(doc.replay).cooperationRadii).toEqual([17, 61, 113]);
    expect(doc.replay.final).toEqual(l.final);
    expect(previewCompletedReplay(source).replay.rulesVersion).toBe(
      l.rulesVersion,
    );
    expect(() => completedReplaySession(doc)).toThrow('只读');
    expect(start).not.toHaveBeenCalled();
    start.mockRestore();
  });
  it('does not discard the sole text evidence of an unknown historical effect', () => {
    const l = futureLog();
    l.rooms[0]!.settlement.events.push({
      type: 'trigger',
      playerId: 'human',
      itemId: 'd6',
      message: '旧规则特殊触发：不能从最终状态反推。',
    });
    const packed = packReplayFacts(l);
    const event = packed.rooms[0]!.settlement.events.at(-1)!;
    expect(event).toMatchObject({
      reason: 'legacy',
      legacyText: '旧规则特殊触发：不能从最终状态反推。',
    });
    expect(
      parseReplay(
        serializeReplay(l, 'test'),
      ).replay.rooms[0]!.settlement.events.at(-1),
    ).toEqual(l.rooms[0]!.settlement.events.at(-1));
  });
  it('rejects accidental body edits with a checksum, without claiming cryptographic authenticity', () => {
    const doc = JSON.parse(serializeReplay(legacyLog(), 'test'));
    doc.replay.initialPlayers[0].money++;
    expect(() => parseReplay(JSON.stringify(doc))).toThrow();
  });
  it.each([
    'cash',
    'unused-trigger',
    'action-reference',
    'score',
    'final',
    'locator',
    'huge-copies',
    'extra-field',
  ] as const)(
    'checks structural and accounting consistency even with a regenerated checksum: %s',
    (field) => {
      const source = alteredWire((w) => {
        if (field === 'cash')
          w.rooms[1]!.resultChanges.find((p) => p.id === 'human')!.fields
            .money!++;
        if (field === 'unused-trigger')
          w.triggerCatalog.push({ itemId: 'd6', kind: 'unused' });
        if (field === 'action-reference')
          w.rooms[0]!.settlement.turns[0]!.resolutions.pop();
        if (field === 'score') w.rooms[0]!.settlement.scores.human!.score!++;
        if (field === 'final') w.final!.ranking[0]!.finalScore++;
        if (field === 'locator') w.rooms[0]!.locator = `${w.id}/F1-R1#00000000`;
        if (field === 'huge-copies')
          w.rooms[0]!.settlement.awards[0]!.copies = 100000000;
        if (field === 'extra-field') Object.assign(w, { unrecognized: true });
      });
      expect(() => parseReplay(source)).toThrow();
    },
  );
  it('continues the genuine v2 checkpoint with identical outcomes after a v3 re-export', () => {
    const old = parseGameSave(JSON.stringify(originalCheckpoint));
    const source = serializeGameCheckpoint(old.session, now);
    expect(JSON.parse(source).version).toBe(3);
    let resumed = parseGameSave(source).session;
    const l = legacyLog();
    for (let i = 11; i < 15; i++) {
      const turn = l.rooms[i]!.settlement.turns.find(
        (t) => t.playerId === 'human',
      )!;
      resumed = reduceGameSession(resumed, {
        type: 'submit_player_turn',
        turn,
      });
      resumed = reduceGameSession(resumed, { type: 'advance_room' });
    }
    expect(resumed.game.phase).toBe('game_result');
    expect(resumed.replay!.final!.ranking).toEqual(l.final!.ranking);
    resumed.replay!.rooms.forEach((r, i) =>
      expect(r.settlement).toEqual(l.rooms[i]!.settlement),
    );
  });
  it('restores v2 and v3 complete backups while preserving independent player profile namespaces', () => {
    const s = parseGameSave(JSON.stringify(originalCheckpoint)).session;
    const p = createPlayerProfile(now);
    p.progression.modules.future = {
      unlocked: ['example'],
      nested: { value: 0.25 },
    };
    const source = serializeGameBackup(s, p, now);
    const v3 = parseGameSave(source);
    expect(v3.version).toBe(3);
    expect(v3.session).toEqual(s);
    expect(v3.profile).toEqual(p);
    const oldLog = copySnapshot(s.replay!);
    delete oldLog.ruleFacts;
    oldLog.rooms.forEach((r) => delete r.locator);
    const v2 = {
      ...originalCheckpoint,
      kind: 'backup',
      replay: packReplay(oldLog),
      profile: p,
    };
    const recovered = parseGameSave(JSON.stringify(v2));
    expect(recovered.version).toBe(2);
    expect(recovered.session.game).toEqual(s.game);
    expect(recovered.profile).toEqual(p);
    expect(sameReplayResults(recovered.session.replay, s.replay)).toBe(true);
  });
  it('does not weaken backup restoration to the read-only replay validator', () => {
    const s = parseGameSave(JSON.stringify(originalCheckpoint)).session;
    const doc = JSON.parse(
      serializeGameBackup(s, createPlayerProfile(now), now),
    );
    doc.checkpoint.game.players[0].money++;
    expect(() => parseGameSave(JSON.stringify(doc))).toThrow();
    doc.compatibility = 'different-engine';
    const start = vi.spyOn(client, 'startClientGame');
    expect(() => parseGameSave(JSON.stringify(doc))).toThrow('不兼容');
    expect(start).not.toHaveBeenCalled();
    start.mockRestore();
  });
  it('retains old browser keys and upgrades bytes only on a successful game save', () => {
    const source = JSON.stringify(originalCheckpoint),
      storageData = new Map([[gameSaveKey, source]]);
    const storage = {
      getItem: (k: string) => storageData.get(k) ?? null,
      setItem: (k: string, v: string) => storageData.set(k, v),
      removeItem: (k: string) => storageData.delete(k),
    };
    const s = loadAutoSave(storage).session!;
    expect(storageData.get(gameSaveKey)).toBe(source);
    expect(persistGameSession(storage, s)).toBe(true);
    expect(JSON.parse(storageData.get(gameSaveKey)!).version).toBe(3);
    expect(JSON.parse(storageData.get(activeReplayKey)!).version).toBe(3);
    expect(storageData.has(lastCompletedKey)).toBe(false);
    expect(
      parseDataFile(storageData.get(activeReplayKey)!, 'not-a-replay-name.txt')
        .kind,
    ).toBe('replay');
  });
});
