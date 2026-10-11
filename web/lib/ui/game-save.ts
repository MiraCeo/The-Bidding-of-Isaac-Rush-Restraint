import { characterCatalog, characterNames } from '../game/characters';
import { defaultRules } from '../game/config';
import { verifyReplayLog } from './game-replay';
import { reconstructLegacyReplay } from './replay-record';
import { saveCompatibility } from './game-version';
export { saveCompatibility } from './game-version';
import type { CharacterId, PlayerTurn } from '../game/item-types';
import { hasItem } from '../game/runtime';
import {
  createGameSession,
  reduceGameSession,
  type GameSession,
  type RoomDraft,
} from './game-session';

export const gameSaveKey = 'bidding-game-save-v1';
export const maxSaveBytes = 8 * 1024 * 1024;
const format = 'the-bidding-of-isaac-save';

export interface SaveDocument {
  format: typeof format;
  version: 1;
  compatibility: string;
  savedAt: string;
  session: GameSession;
}
export type SaveStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function fail(message = '存档状态损坏或与当前规则不一致。'): never {
  throw new Error(message);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    fail();
  return value;
}
function canonical(value: unknown): string {
  if (typeof value === 'number' && !Number.isFinite(value))
    fail('存档包含非法数值。');
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
function readTurn(value: unknown): PlayerTurn {
  const turn = object(value);
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
      const action = object(value);
      if (action.type === 'withdraw') return { type: 'withdraw' as const };
      if (
        (action.type !== 'bid' && action.type !== 'disrupt') ||
        (action.group !== 'A' && action.group !== 'B')
      )
        fail();
      return {
        type: action.type,
        group: action.group,
        amount: integer(action.amount, 1, 1_000_000_000),
      };
    }),
  };
}
function readDraft(value: unknown, session: GameSession): RoomDraft | null {
  if (session.game.phase !== 'room_action') {
    if (value !== null) fail();
    return null;
  }
  const draft = object(value);
  const selected = object(draft.selectedAction);
  if (
    !['bid', 'disrupt', 'withdraw'].includes(String(selected.kind)) ||
    !Array.isArray(selected.groups)
  )
    fail();
  const groups = selected.groups;
  if (
    selected.kind === 'withdraw'
      ? groups.length !== 0
      : groups.length < 1 ||
        groups.length > 2 ||
        new Set(groups).size !== groups.length ||
        groups.some((g) => g !== 'A' && g !== 'B')
  )
    fail();
  const human = session.game.players.find((p) => p.isHuman)!;
  if (
    groups.length === 2 &&
    !hasItem(
      human,
      selected.kind === 'bid' ? 'more_options' : 'more_options_question',
    )
  )
    fail();
  const amounts = object(draft.amounts);
  const readAmounts = (group: 'A' | 'B') => {
    const entry = object(amounts[group]);
    return {
      bid: integer(entry.bid, 1, Math.max(1, human.money)),
      disrupt: integer(
        entry.disrupt,
        1,
        Math.max(
          1,
          Math.floor(human.money * defaultRules.disruptionMaxMoneyRatio),
        ),
      ),
    };
  };
  const clean: RoomDraft = {
    selectedAction:
      selected.kind === 'withdraw'
        ? { kind: 'withdraw', groups: [] }
        : {
            kind: selected.kind as 'bid' | 'disrupt',
            groups: groups as ('A' | 'B')[],
          },
    amounts: { A: readAmounts('A'), B: readAmounts('B') },
  };
  if (
    clean.selectedAction.kind === 'bid' &&
    groups.length === 2 &&
    clean.amounts.A.bid + clean.amounts.B.bid > Math.floor(human.money * 0.5)
  )
    fail('存档的双竞拍草稿超过资金上限。');
  if (canonical(clean) !== canonical(draft)) fail();
  return clean;
}

export function serializeGameSave(
  session: GameSession,
  now = new Date(),
): string {
  if (session.game.phase === 'character_selection')
    fail('尚未开始对局，无需导出存档。');
  const source = JSON.stringify(
    {
      format,
      version: 1,
      compatibility: saveCompatibility,
      savedAt: now.toISOString(),
      session,
    } satisfies SaveDocument,
    null,
    2,
  );
  if (new TextEncoder().encode(source).length > maxSaveBytes)
    fail('存档文件超过8 MiB，不能导出。');
  return source;
}

/** Validate on a detached state; never mutate or dispatch into the live game. */
export function parseGameSave(source: string): SaveDocument {
  if (new TextEncoder().encode(source).length > maxSaveBytes)
    fail('存档文件过大，不能读取。');
  let value: unknown;
  try {
    value = JSON.parse(source.replace(/^\uFEFF/, ''));
  } catch {
    fail('不是有效的 JSON 存档。');
  }
  const doc = object(value);
  if (doc.format !== format || doc.version !== 1)
    fail('不支持的存档格式或版本。');
  if (doc.compatibility !== saveCompatibility)
    fail('存档的规则／数据版本与当前游戏不兼容。');
  if (
    typeof doc.savedAt !== 'string' ||
    !Number.isFinite(Date.parse(doc.savedAt))
  )
    fail('存档时间无效。');
  const saved = object(doc.session);
  const game = object(saved.game);
  const seed = integer(game.seed, 0, 0xffffffff);
  if (!characterCatalog.some((c) => c.id === game.selectedCharacter))
    fail('存档角色不存在。');
  const floor = integer(game.floorIndex, 0, 2),
    room = integer(game.roomIndex, 0, 4);
  if (
    !['room_action', 'room_result', 'room_ranking', 'game_result'].includes(
      String(game.phase),
    )
  )
    fail();
  if (game.roomRankingView !== 'score' && game.roomRankingView !== 'contest')
    fail();
  const completed = floor * 5 + room + (game.phase === 'room_action' ? 0 : 1);
  if (!Array.isArray(saved.turns) || saved.turns.length !== completed)
    fail('存档的行动记录与房间进度不一致。');
  // At most 15 rooms: verifying a bounded transcript also covers every nested role,
  // item, AI history, random outcome and settlement field without trusting a cast.
  let verified = reduceGameSession(createGameSession(seed), {
    type: 'start_game',
    characterId: game.selectedCharacter as CharacterId,
  });
  const turns = saved.turns.map(readTurn);
  for (let i = 0; i < turns.length; i++) {
    const next = reduceGameSession(verified, {
      type: 'submit_player_turn',
      turn: turns[i]!,
    });
    if (next === verified) fail('存档包含非法行动。');
    verified = next;
    if (i < turns.length - 1 || game.phase === 'room_action')
      verified = reduceGameSession(verified, { type: 'advance_room' });
  }
  if (game.phase === 'room_ranking' || game.roomRankingView === 'contest')
    verified = reduceGameSession(verified, {
      type: 'show_room_ranking',
      view: game.roomRankingView,
    });
  if (game.phase === 'game_result') {
    if (completed !== 15) fail();
    verified = reduceGameSession(verified, { type: 'advance_room' });
  }
  // JSON removes optional undefined properties; compare JSON-normalized snapshots.
  if (canonical(JSON.parse(JSON.stringify(verified.game))) !== canonical(game))
    fail();
  if (canonical(turns) !== canonical(saved.turns)) fail();
  const session = {
    game: verified.game,
    turns,
    draft: readDraft(saved.draft, verified),
    replay:
      saved.replay === undefined
        ? reconstructLegacyReplay(verified.replay!)
        : verifyReplayLog(saved.replay, verified.replay!),
  };
  return {
    format,
    version: 1,
    compatibility: saveCompatibility,
    savedAt: doc.savedAt,
    session,
  };
}

export function describeSave(session: GameSession): string {
  const game = session.game;
  if (game.phase === 'character_selection') return '尚未开始对局';
  const phases = {
    room_action: '行动未提交',
    room_result: '房间已结算',
    room_ranking: '房间排行',
    game_result: '对局已结束',
  };
  return `${characterNames[game.selectedCharacter]} · 第 ${game.floorIndex + 1} 层 / 房间 ${game.roomIndex + 1} · ${phases[game.phase]}`;
}
export function persistGameSession(
  storage: SaveStorage | null,
  session: GameSession,
): boolean {
  try {
    if (!storage) return false;
    if (session.game.phase === 'character_selection')
      storage.removeItem(gameSaveKey);
    else storage.setItem(gameSaveKey, serializeGameSave(session));
    return true;
  } catch {
    return false;
  }
}
export function loadAutoSave(storage: SaveStorage | null): {
  session: GameSession | null;
  message: string;
} {
  try {
    const source = storage?.getItem(gameSaveKey);
    if (!source) return { session: null, message: '' };
    return {
      session: parseGameSave(source).session,
      message: '已恢复浏览器中的对局存档。',
    };
  } catch (error) {
    return {
      session: null,
      message:
        error instanceof Error
          ? `自动存档未读取：${error.message}`
          : '当前浏览器无法读取自动存档。',
    };
  }
}
