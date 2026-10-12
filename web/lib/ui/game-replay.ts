import { characterCatalog } from '../game/characters';
import type { CharacterId, PlayerTurn } from '../game/item-types';
import { createGameSession, reduceGameSession } from './game-session';
import { canonicalJson, copySnapshot, type ReplayLog } from './replay-record';
import { saveCompatibility } from './game-version';
import { packReplay, unpackReplay } from './replay-codec';

export const maxReplayBytes = 8 * 1024 * 1024;
export interface ReplayDocument {
  format: 'the-bidding-of-isaac-replay';
  version: 1 | 2;
  exportedAt: string;
  exportedBuild: string;
  replay: ReplayLog;
}
function fail(message = '回放记录损坏或与实际结算不一致。'): never {
  throw new Error(message);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function build(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 160)
    fail('回放构建标识无效。');
  return value;
}
function humanTurn(value: unknown): PlayerTurn {
  const turn = record(value);
  if (
    turn.playerId !== 'human' ||
    !Array.isArray(turn.actions) ||
    turn.actions.length < 1 ||
    turn.actions.length > 2
  )
    fail();
  return {
    playerId: 'human',
    actions: turn.actions.map((value) => {
      const action = record(value);
      if (action.type === 'withdraw') return { type: 'withdraw' as const };
      if (
        (action.type !== 'bid' && action.type !== 'disrupt') ||
        (action.group !== 'A' && action.group !== 'B') ||
        typeof action.amount !== 'number' ||
        !Number.isInteger(action.amount) ||
        action.amount < 1 ||
        action.amount > 1e9
      )
        fail('回放包含非法行动。');
      return { type: action.type, group: action.group, amount: action.amount };
    }),
  };
}

/** Verify compatible files in a detached session; rendering always uses the recorded snapshots. */
export function verifyReplayLog(
  value: unknown,
  alreadyVerified?: ReplayLog,
): ReplayLog {
  const input = record(value);
  if (input.rulesVersion !== saveCompatibility)
    fail('回放规则版本不兼容，不能用当前算法解释此文件。');
  if (
    typeof input.seed !== 'number' ||
    !Number.isInteger(input.seed) ||
    input.seed < 0 ||
    input.seed > 0xffffffff ||
    !characterCatalog.some((c) => c.id === input.characterId)
  )
    fail();
  if (!Array.isArray(input.rooms) || input.rooms.length > 15)
    fail('回放房间数量无效。');
  let expected = alreadyVerified;
  if (!expected) {
    let session = reduceGameSession(createGameSession(input.seed), {
      type: 'start_game',
      characterId: input.characterId as CharacterId,
    });
    for (let i = 0; i < input.rooms.length; i++) {
      const room = record(input.rooms[i]);
      const settlement = record(room.settlement);
      if (!Array.isArray(settlement.turns)) fail();
      const turn = settlement.turns.find(
        (t: unknown) => record(t).playerId === 'human',
      );
      const next = reduceGameSession(session, {
        type: 'submit_player_turn',
        turn: humanTurn(turn),
      });
      if (next === session) fail('回放包含非法行动。');
      session = next;
      if (i < input.rooms.length - 1)
        session = reduceGameSession(session, { type: 'advance_room' });
    }
    if (input.final !== null) {
      if (input.rooms.length !== 15) fail('未完成十五房不能包含终局结果。');
      session = reduceGameSession(session, { type: 'advance_room' });
    }
    expected = session.replay!;
  }
  const normalized = copySnapshot(expected);
  normalized.startedBuild = build(input.startedBuild);
  if (normalized.rooms.length !== input.rooms.length) fail();
  for (let i = 0; i < normalized.rooms.length; i++) {
    const room = record(input.rooms[i]);
    normalized.rooms[i]!.build = build(room.build);
    if (
      room.source !== 'live' &&
      room.source !== 'save-reconstruction' &&
      room.source !== 'checkpoint-reconstruction'
    )
      fail();
    normalized.rooms[i]!.source = room.source;
  }
  if (normalized.final)
    normalized.final.build = build(record(input.final).build);
  if (canonicalJson(normalized) !== canonicalJson(input)) fail();
  return normalized;
}
export function serializeReplay(
  replay: ReplayLog,
  exportedBuild: string,
  now = new Date(),
  version: 1 | 2 = 2,
): string {
  const source = JSON.stringify({
    format: 'the-bidding-of-isaac-replay',
    version,
    exportedAt: now.toISOString(),
    exportedBuild,
    replay: version === 2 ? packReplay(replay) : replay,
  });
  if (new TextEncoder().encode(source).length > maxReplayBytes)
    fail('回放文件超过8 MiB，不能导出。');
  return source;
}
export function parseReplay(source: string): ReplayDocument {
  if (new TextEncoder().encode(source).length > maxReplayBytes)
    fail('回放文件超过8 MiB，不能读取。');
  let value: unknown;
  try {
    value = JSON.parse(source.replace(/^\uFEFF/, ''));
  } catch {
    fail('不是有效的JSON回放文件。');
  }
  const doc = record(value);
  if (
    doc.format !== 'the-bidding-of-isaac-replay' ||
    (doc.version !== 1 && doc.version !== 2)
  )
    fail('不支持的回放格式或版本；存档与回放是不同文件。');
  if (
    typeof doc.exportedAt !== 'string' ||
    !Number.isFinite(Date.parse(doc.exportedAt))
  )
    fail('回放导出时间无效。');
  return {
    format: 'the-bidding-of-isaac-replay',
    version: doc.version,
    exportedAt: doc.exportedAt,
    exportedBuild: build(doc.exportedBuild),
    replay: verifyReplayLog(
      doc.version === 2 ? unpackReplay(doc.replay) : doc.replay,
    ),
  };
}
