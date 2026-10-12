import { characterCatalog, characterNames } from '../game/characters';
import { defaultRules } from '../game/config';
import { parseReplay, serializeReplay, verifyReplayLog } from './game-replay';
import { unpackReplay } from './replay-codec';
import { packReplayFacts, unpackReplayFacts } from './replay-facts-codec';
import { replayRoomLocator, type ReplayLog } from './replay-record';
import { readBuildVersion, saveCompatibility, shortHash } from './game-version';
import {
  createPlayerProfile,
  readPlayerProfile,
  recordCompletedMatch,
  playerProfileKey,
  type PlayerProfile,
} from './player-profile';
export { saveCompatibility } from './game-version';
import type { CharacterId, PlayerTurn } from '../game/item-types';
import { hasItem } from '../game/runtime';
import {
  createGameSession,
  reduceGameSession,
  type GameSession,
  type RoomDraft,
} from './game-session';

// Keep existing keys so already-written v2 saves survive; new content uses v3.
export const gameSaveKey = 'bidding-game-save-v1';
export const activeReplayKey = 'bidding-active-replay-v2';
export const lastCompletedKey = 'bidding-last-completed-v2';
export const draftSaveKey = 'bidding-game-draft-v2';
export const maxSaveBytes = 8 * 1024 * 1024;
const format = 'the-bidding-of-isaac-save';

export interface SaveDocument {
  format: typeof format;
  version: 2 | 3;
  compatibility: string;
  savedAt: string;
  session: GameSession;
  kind: 'checkpoint' | 'backup';
  profile?: PlayerProfile;
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

function checkpointGame(game: GameSession['game']) {
  if (game.phase === 'character_selection')
    fail('尚未开始对局，无需导出存档。');
  const {
    revealedAiDecisions: _decisions,
    pendingRoomTurns: _pending,
    ...state
  } = game;
  return state;
}
function checkpointMetadata(log: ReplayLog | null) {
  if (!log) fail();
  return {
    startedBuild: log.startedBuild,
    rooms: log.rooms.map((r) => ({
      build: r.build,
      locator: replayRoomLocator(log, r),
    })),
    finalBuild: log.final?.build ?? null,
  };
}
function restoreMetadata(value: unknown, expected: ReplayLog): ReplayLog {
  const meta = object(value);
  if (
    typeof meta.startedBuild !== 'string' ||
    !meta.startedBuild.trim() ||
    meta.startedBuild.length > 160 ||
    !Array.isArray(meta.rooms) ||
    meta.rooms.length !== expected.rooms.length
  )
    fail('检查点的历史定位损坏。');
  const log: ReplayLog = {
    ...expected,
    startedBuild: meta.startedBuild,
    rooms: expected.rooms.map((r, i) => {
      const m = object((meta.rooms as unknown[])[i]);
      if (
        typeof m.build !== 'string' ||
        !m.build.trim() ||
        m.build.length > 160 ||
        m.locator !== replayRoomLocator(expected, r)
      )
        fail('检查点的历史定位损坏。');
      return { ...r, build: m.build, source: 'checkpoint-reconstruction' };
    }),
  };
  if (expected.final) {
    if (
      typeof meta.finalBuild !== 'string' ||
      !meta.finalBuild.trim() ||
      meta.finalBuild.length > 160
    )
      fail();
    log.final = { ...expected.final, build: meta.finalBuild };
  } else if (meta.finalBuild !== null) fail();
  return log;
}
function encodeV3(
  session: GameSession,
  now: Date,
  profile?: PlayerProfile,
): string {
  const doc = {
    format,
    version: 3,
    kind: profile ? 'backup' : 'checkpoint',
    compatibility: saveCompatibility,
    savedAt: now.toISOString(),
    checkpoint: {
      game: checkpointGame(session.game),
      draft: session.draft,
      turns: session.turns,
      metadata: checkpointMetadata(session.replay),
    },
    ...(profile
      ? {
          replay: packReplayFacts(session.replay!),
          profile: readPlayerProfile(profile),
        }
      : {}),
  };
  const source = JSON.stringify(doc);
  if (new TextEncoder().encode(source).length > maxSaveBytes)
    fail('存档文件超过8 MiB，不能导出。');
  return source;
}
export function serializeGameCheckpoint(
  session: GameSession,
  now = new Date(),
): string {
  return encodeV3(session, now);
}
export function serializeGameBackup(
  session: GameSession,
  profile: PlayerProfile,
  now = new Date(),
): string {
  return encodeV3(session, now, profile);
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
  if (doc.format !== format || (doc.version !== 2 && doc.version !== 3))
    fail('支持v3与v2存档，不读取v1或未知版本。');
  if (doc.compatibility !== saveCompatibility)
    fail('存档的规则／数据版本与当前游戏不兼容。');
  if (
    typeof doc.savedAt !== 'string' ||
    !Number.isFinite(Date.parse(doc.savedAt))
  )
    fail('存档时间无效。');
  if (doc.kind !== 'checkpoint' && doc.kind !== 'backup')
    fail('检查点类型无效。');
  if (
    doc.kind === 'checkpoint' &&
    (doc.replay !== undefined || doc.profile !== undefined)
  )
    fail();
  const saved = object(doc.checkpoint);
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
  if (
    canonical(JSON.parse(JSON.stringify(checkpointGame(verified.game)))) !==
    canonical(game)
  )
    fail();
  if (canonical(turns) !== canonical(saved.turns)) fail();
  const session = {
    game: verified.game,
    turns,
    draft: readDraft(saved.draft, verified),
    replay:
      doc.kind === 'backup'
        ? verifyReplayLog(
            doc.version === 3
              ? unpackReplayFacts(doc.replay)
              : unpackReplay(doc.replay),
            verified.replay!,
          )
        : restoreMetadata(saved.metadata, verified.replay!),
  };
  if (
    doc.kind === 'backup' &&
    canonical(checkpointMetadata(session.replay)) !== canonical(saved.metadata)
  )
    fail('完整备份的检查点与回放来源不一致。');
  return {
    format,
    version: doc.version,
    compatibility: saveCompatibility,
    savedAt: doc.savedAt,
    session,
    kind: doc.kind,
    ...(doc.kind === 'backup'
      ? { profile: readPlayerProfile(doc.profile) }
      : {}),
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
const storageCache = new WeakMap<
  SaveStorage,
  {
    game: GameSession['game'];
    replay: ReplayLog | null;
    core: string;
    draft: RoomDraft | null;
  }
>();
export function loadPlayerProfile(
  storage: Pick<SaveStorage, 'getItem'> | null,
): {
  profile: PlayerProfile;
  message: string;
} {
  try {
    const value = storage?.getItem(playerProfileKey);
    return {
      profile: value
        ? readPlayerProfile(JSON.parse(value))
        : createPlayerProfile(),
      message: '',
    };
  } catch {
    return {
      profile: createPlayerProfile(),
      message: '玩家档案未读取：原数据保留；可从完整备份恢复。',
    };
  }
}
export function persistGameSession(
  storage: SaveStorage | null,
  session: GameSession,
): boolean {
  try {
    if (!storage) return false;
    if (session.game.phase === 'character_selection') {
      storage.removeItem(gameSaveKey);
      storage.removeItem(draftSaveKey);
      storage.removeItem(activeReplayKey);
      storageCache.delete(storage);
      return true;
    }
    const cached = storageCache.get(storage);
    const needsCore =
      cached?.game !== session.game || storage.getItem(gameSaveKey) === null;
    const core =
      !needsCore && cached ? cached.core : serializeGameCheckpoint(session);
    // Draft edits never rewrite the replay or core snapshot.
    if (session.game.phase === 'game_result') {
      const loaded = loadPlayerProfile(storage);
      if (loaded.message) return false;
      const log = session.replay!;
      const key = replayRoomLocator(log, log.rooms.at(-1)!);
      const profile = recordCompletedMatch(loaded.profile, log, key);
      storage.setItem(
        lastCompletedKey,
        serializeReplay(log, readBuildVersion()),
      );
      if (profile !== loaded.profile)
        storage.setItem(playerProfileKey, JSON.stringify(profile));
      // Only remove the active checkpoint after both completed archive and profile succeeded.
      storage.removeItem(gameSaveKey);
      storage.removeItem(draftSaveKey);
      storage.removeItem(activeReplayKey);
    } else {
      if (
        cached?.replay !== session.replay ||
        storage.getItem(activeReplayKey) === null
      )
        storage.setItem(
          activeReplayKey,
          serializeReplay(session.replay!, readBuildVersion()),
        );
      if (needsCore) storage.setItem(gameSaveKey, core);
      if (
        cached?.draft !== session.draft ||
        cached?.core !== core ||
        storage.getItem(draftSaveKey) === null
      )
        storage.setItem(
          draftSaveKey,
          JSON.stringify({ token: shortHash(core), draft: session.draft }),
        );
    }
    storageCache.set(storage, {
      game: session.game,
      replay: session.replay,
      core,
      draft: session.draft,
    });
    return true;
  } catch {
    return false;
  }
}
export function loadAutoSave(storage: Pick<SaveStorage, 'getItem'> | null): {
  session: GameSession | null;
  message: string;
} {
  try {
    const source = storage?.getItem(gameSaveKey);
    if (!source) return { session: null, message: '' };
    const session = parseGameSave(source).session;
    const draftSource = storage?.getItem(draftSaveKey);
    if (draftSource) {
      const draft = object(JSON.parse(draftSource));
      if (draft.token === shortHash(source))
        session.draft = readDraft(draft.draft, session);
    }
    const archive = storage?.getItem(activeReplayKey);
    let archiveMessage = '';
    if (archive) {
      try {
        session.replay = verifyReplayLog(
          parseReplay(archive).replay,
          session.replay!,
        );
      } catch {
        archiveMessage = ' 独立回放损坏或未同步，已按有效检查点核验重建历史。';
      }
    }
    return {
      session,
      message: `已恢复浏览器中的对局存档。${archiveMessage}`,
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
