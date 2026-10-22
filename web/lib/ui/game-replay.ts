import { characterCatalog } from '../game/characters';
import { readClassicAiSettings } from '../game/classic-difficulty';
import type { CharacterId, PlayerTurn } from '../game/item-types';
import { createGameSession, reduceGameSession } from './game-session';
import {
  canonicalJson,
  copySnapshot,
  replayRoomLocator,
  type ReplayLog,
} from './replay-record';
import { preserveKnifeExplanationTails } from './classic-runtime-facts';
import { saveCompatibility } from './game-version';
import { currentFileVersion, assertCurrentFileHeader } from './file-protocol';
import {
  checkedJson,
  keys,
  checkChecksum,
  stringifyChecked,
} from './file-json';
import { packReplayFacts, unpackReplayFacts } from './replay-facts-codec';
import { validateReplayFacts } from './replay-facts-validation';

export const maxReplayBytes = 8 * 1024 * 1024;
export interface ReplayDocument {
  format: 'the-bidding-of-isaac-replay';
  version: typeof currentFileVersion;
  mode: 'classic';
  kind: 'replay';
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

/** Strict current-engine verification for continuation/backup only, not read-only imports. */
export function verifyReplayLog(
  value: unknown,
  alreadyVerified?: ReplayLog,
): ReplayLog {
  const input = record(value);
  const classicAi = Object.hasOwn(input, 'classicAi') ? readClassicAiSettings(input.classicAi) : undefined;
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
      ...(classicAi ? { classicAi } : {}),
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
  if (canonicalJson(input.ruleFacts) !== canonicalJson(normalized.ruleFacts))
    fail();
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
    normalized.rooms[i]!.settlement = preserveKnifeExplanationTails(
      normalized.rooms[i]!.settlement,
      room.settlement,
    );
    if (
      room.locator !==
      replayRoomLocator(normalized, {
        ...normalized.rooms[i]!,
        locator: undefined,
      })
    )
      fail();
    normalized.rooms[i]!.locator = room.locator as string;
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
): string {
  const source = stringifyChecked({
    format: 'the-bidding-of-isaac-replay',
    version: currentFileVersion,
    mode: 'classic',
    kind: 'replay',
    exportedAt: now.toISOString(),
    exportedBuild,
    replay: packReplayFacts(replay),
  });
  if (new TextEncoder().encode(source).length > maxReplayBytes)
    fail('回放文件超过8 MiB，不能导出。');
  return source;
}
export function parseReplay(source: string): ReplayDocument {
  const doc = checkedJson(source);
  assertCurrentFileHeader(doc, 'classic', 'replay');
  keys(doc, [
    'format',
    'version',
    'mode',
    'kind',
    'exportedAt',
    'exportedBuild',
    'replay',
    'checksum',
  ]);
  checkChecksum(doc);
  if (
    typeof doc.exportedAt !== 'string' ||
    !Number.isFinite(Date.parse(doc.exportedAt))
  )
    fail('回放导出时间无效。');
  const exportedBuild = build(doc.exportedBuild);
  let replay: ReplayLog;
  try {
    replay = validateReplayFacts(unpackReplayFacts(doc.replay));
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) fail();
    throw error;
  }
  return {
    format: 'the-bidding-of-isaac-replay',
    version: currentFileVersion,
    mode: 'classic',
    kind: 'replay',
    exportedAt: doc.exportedAt,
    exportedBuild,
    replay,
  };
}
