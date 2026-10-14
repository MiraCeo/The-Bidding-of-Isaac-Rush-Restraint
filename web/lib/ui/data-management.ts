import { parseGameSave, maxSaveBytes, type SaveDocument } from './game-save';
import {
  parseReplay,
  maxReplayBytes,
  type ReplayDocument,
} from './game-replay';
import { type ReplayLog } from './replay-record';
import { replayFactsIdentity } from './replay-facts-codec';
import {
  createGameSession,
  reduceGameSession,
  type GameSession,
} from './game-session';
import { saveCompatibility } from './game-version';
import { assertCurrentFileHeader } from './file-protocol';
import { checkedJson } from './file-json';

export type DataCandidate =
  | { kind: 'replay'; document: ReplayDocument; filename: string }
  | { kind: 'checkpoint' | 'backup'; document: SaveDocument; filename: string };
export const maxDataBytes = Math.max(maxSaveBytes, maxReplayBytes);
export function describeDataProgress(session: GameSession): string {
  const g = session.game;
  if (g.phase === 'character_selection') return '尚未开始';
  const phases = {
    room_action: '行动待提交',
    room_result: '房间已结算',
    room_ranking: '房间排行',
    game_result: '对局已结束',
  };
  return (
    '第' +
    (g.floorIndex + 1) +
    '层 · 房间' +
    (g.roomIndex + 1) +
    '/5 · ' +
    phases[g.phase]
  );
}
export function parseDataFile(source: string, filename: string): DataCandidate {
  if (new TextEncoder().encode(source).length > maxDataBytes)
    throw new Error('文件超过8 MiB，不能读取。');
  const header = checkedJson(source);
  assertCurrentFileHeader(header, 'classic');
  const format = header.format;
  if (format === 'the-bidding-of-isaac-replay')
    return { kind: 'replay', document: parseReplay(source), filename };
  if (format === 'the-bidding-of-isaac-save') {
    const document = parseGameSave(source);
    return { kind: document.kind, document, filename };
  }
  throw new Error('无法识别文件；请选择当前v5存档、回放或完整备份。');
}
/** Read-only factual validation, without running AI or changing storage. */
export function previewCompletedReplay(source: string): ReplayDocument {
  const doc = parseReplay(source);
  if (!doc.replay.final || doc.replay.rooms.length !== 15)
    throw new Error('最近对局记录无效，尚未完成。');
  return doc;
}
/** Exact result equality, not just seed/role/id or a short hash. Compatible provenance may differ. */
export function sameReplayResults(
  a: ReplayLog | null | undefined,
  b: ReplayLog | null | undefined,
): boolean {
  if (
    !a ||
    !b ||
    a.id !== b.id ||
    a.rulesVersion !== b.rulesVersion ||
    a.rooms.length !== b.rooms.length ||
    !!a.final !== !!b.final
  )
    return false;
  try {
    return replayFactsIdentity(a) === replayFactsIdentity(b);
  } catch {
    return false;
  }
}
/** Used only for a user-requested backup of an already-verified completed archive. */
export function completedReplaySession(document: ReplayDocument): GameSession {
  const log = document.replay;
  if (!log.final || log.rooms.length !== 15)
    throw new Error('只有已完成的对局可作为最近对局备份。');
  if (log.rulesVersion !== saveCompatibility)
    throw new Error('此历史回放可只读查看，但不能用当前规则恢复为完整备份。');
  let session = reduceGameSession(createGameSession(log.seed), {
    type: 'start_game',
    characterId: log.characterId,
  });
  for (const room of log.rooms) {
    const turn = room.settlement.turns.find((t) => t.playerId === 'human');
    if (!turn) throw new Error('最近对局缺少真人记录。');
    session = reduceGameSession(session, { type: 'submit_player_turn', turn });
    session = reduceGameSession(session, { type: 'advance_room' });
  }
  if (
    session.game.phase !== 'game_result' ||
    !sameReplayResults(session.replay, log)
  )
    throw new Error('最近对局与可恢复结果不一致。');
  return { ...session, replay: log };
}
