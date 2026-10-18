import { prepareAchievementBaseline, withAchievementVerificationScope } from './achievements/registry';
import { characterCatalog, characterNames } from '../game/characters';
import { defaultRules } from '../game/config';
import { parseReplay, serializeReplay, verifyReplayLog } from './game-replay';
import { currentFileVersion, assertCurrentFileHeader } from './file-protocol';
import {
  checkedJson,
  keys,
  checkChecksum,
  stringifyChecked,
} from './file-json';
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
import { measurePersistence } from './persistence-metrics';
import type { CompletionOrigin } from './completion-registry';
import { resetLegacyGrowthContext, beginClassicGrowth, restoreGrowthContext, validateGrowthContext, classicGrowthOrder, validateGrowthProfilePair } from './achievements/lifecycle';
import { persistCompletionProfile } from './completion-persistence';
import {
  preserveKnifeExplanationTails,
  restoreClassicRoomLocator,
} from './classic-runtime-facts';
import {
  createGameSession,
  reduceGameSession,
  type GameSession,
  type RoomDraft,
} from './game-session';

// Isolated current-protocol keys. Old development caches are never read, migrated or removed.
export const gameSaveKey = 'bidding-classic-checkpoint-v5';
export const activeReplayKey = 'bidding-classic-active-replay-v5';
export const lastCompletedKey = 'bidding-classic-last-completed-v5';
export const draftSaveKey = 'bidding-classic-draft-v5';
export const maxSaveBytes = 8 * 1024 * 1024;
const format = 'the-bidding-of-isaac-save';

export interface SaveDocument {
  format: typeof format;
  version: typeof currentFileVersion;
  mode: 'classic';
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
  keys(value, ['startedBuild', 'rooms', 'finalBuild']);
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
      keys(m, ['build', 'locator']);
      if (
        typeof m.build !== 'string' ||
        !m.build.trim() ||
        m.build.length > 160
      )
        fail('检查点的历史定位损坏。');
      return {
        ...restoreClassicRoomLocator(expected, r, m.locator),
        build: m.build,
        source: 'checkpoint-reconstruction',
      };
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
function encodeCurrent(
  session: GameSession,
  now: Date,
  profile?: PlayerProfile,
): string {
  if ('mode' in session.game)
    fail('不能将带生存模式身份的状态导出为经典存档。');
  if (profile) {
    profile = readPlayerProfile(profile);
    if (session.growth && !session.growthIssue) validateGrowthProfilePair(profile, session.growth);
    profile = prepareAchievementBaseline(profile, now);
  }
  if (session.growth && !session.growthIssue) session = { ...session, growth: resetLegacyGrowthContext(session.growth, classicGrowthOrder(session)) };
  const doc = {
    format,
    version: currentFileVersion,
    mode: 'classic',
    kind: profile ? 'backup' : 'checkpoint',
    compatibility: saveCompatibility,
    savedAt: now.toISOString(),
    checkpoint: {
      game: checkpointGame(session.game),
      draft: session.draft,
      turns: session.turns,
      metadata: checkpointMetadata(session.replay),
    },
    ...(session.growth && !session.growthIssue ? { growth: validateGrowthContext(session.growth, 'classic') } : {}),
    ...(profile
      ? {
          replay: packReplayFacts(session.replay!),
          profile: readPlayerProfile(profile),
        }
      : {}),
  };
  const source = stringifyChecked(doc);
  if (profile && session.growth && !session.growthIssue) validateGrowthProfilePair(profile, session.growth);
  if (new TextEncoder().encode(source).length > maxSaveBytes)
    fail('存档文件超过8 MiB，不能导出。');
  return source;
}
export function serializeGameCheckpoint(
  session: GameSession,
  now = new Date(),
): string {
  return encodeCurrent(session, now);
}
export function serializeGameBackup(
  session: GameSession,
  profile: PlayerProfile,
  now = new Date(),
): string {
  // All raw/profile/pair checks remain in encodeCurrent. The private scan cache
  // lasts only through this pure synchronous export, never download/storage work.
  return withAchievementVerificationScope(() => encodeCurrent(session, now, profile));
}

/** Validate on a detached state; never mutate or dispatch into the live game. */
export function parseGameSave(source: string): SaveDocument {
  const doc = checkedJson(source);
  assertCurrentFileHeader(doc, 'classic');
  if (doc.kind !== 'checkpoint' && doc.kind !== 'backup')
    fail('不是当前经典存档或备份。');
  keys(doc, [
    'format',
    'version',
    'mode',
    'kind',
    'compatibility',
    'savedAt',
    'checkpoint',
    'checksum',
    ...(doc.kind === 'backup' ? ['replay', 'profile'] : []),
    ...(Object.hasOwn(doc, 'growth') ? ['growth'] : []),
  ]);
  checkChecksum(doc);
  if (doc.compatibility !== saveCompatibility)
    fail('存档的规则／数据版本与当前游戏不兼容。');
  if (
    typeof doc.savedAt !== 'string' ||
    !Number.isFinite(Date.parse(doc.savedAt))
  )
    fail('存档时间无效。');
  keys(doc.checkpoint, ['game', 'draft', 'turns', 'metadata']);
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
  const growth = Object.hasOwn(doc, 'growth') ? validateGrowthContext(doc.growth, 'classic') : undefined;
  if (growth) verified = beginClassicGrowth(verified, growth.excludedThrough, growth.expansionFrom ?? 34, growth.milestonesFrom ?? 34, growth.revisionsFrom ?? 34, growth.cfFrom ?? 34);
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
  if (verified.game.phase === 'character_selection') fail();
  const verifiedGame = {
    ...verified.game,
    roomSettlement: verified.game.roomSettlement
      ? preserveKnifeExplanationTails(
          verified.game.roomSettlement,
          game.roomSettlement,
        )
      : null,
  };
  if (
    canonical(JSON.parse(JSON.stringify(checkpointGame(verifiedGame)))) !==
    canonical(game)
  )
    fail();
  if (canonical(turns) !== canonical(saved.turns)) fail();
  const session = {
    game: verifiedGame,
    turns,
    draft: readDraft(saved.draft, verified),
    replay:
      doc.kind === 'backup'
        ? verifyReplayLog(unpackReplayFacts(doc.replay), verified.replay!)
        : restoreMetadata(saved.metadata, verified.replay!),
    ...(growth ? { growth: restoreGrowthContext(growth, verified.growth!, classicGrowthOrder(verified)) } : {}),
  };
  if (
    doc.kind === 'backup' &&
    canonical(checkpointMetadata(session.replay)) !== canonical(saved.metadata)
  )
    fail('完整备份的检查点与回放来源不一致。');
  if (doc.kind === 'backup' && session.growth) validateGrowthProfilePair(readPlayerProfile(doc.profile), session.growth);
  return {
    format,
    version: currentFileVersion,
    mode: 'classic',
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
    growth?: GameSession['growth'];
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
  if (!storage)
    return {
      profile: createPlayerProfile(),
      message: '玩家档案存储不可读取，不能将未知资料当作空档案。',
    };
  try {
    const value = storage?.getItem(playerProfileKey);
    return {
      profile:
        value !== null
          ? readPlayerProfile(JSON.parse(value))
          : createPlayerProfile(),
      message: '',
    };
  } catch {
    return {
      profile: createPlayerProfile(),
      message: '玩家档案未读取：原数据保留；可从玩家档案备份或完整备份恢复。',
    };
  }
}
export function persistGameSession(
  storage: SaveStorage | null,
  session: GameSession,
  origin: CompletionOrigin = 'live',
): boolean {
  return measurePersistence(
    { mode: 'classic', operation: 'save', phase: session.game.phase },
    () => persistClassicSession(storage, session, origin),
    (result) => result,
  );
}
function persistClassicSession(
  storage: SaveStorage | null,
  session: GameSession,
  origin: CompletionOrigin,
): boolean {
  try {
    if (!storage) return false;
    if (session.growth && !session.growthIssue && session.growth.acknowledged > 0) {
      const local = loadPlayerProfile(storage);
      if (local.message) return false;
      validateGrowthProfilePair(local.profile, session.growth);
    }
    if (session.game.phase === 'character_selection') {
      storage.removeItem(gameSaveKey);
      storage.removeItem(draftSaveKey);
      storage.removeItem(activeReplayKey);
      storageCache.delete(storage);
      return true;
    }
    const cached = storageCache.get(storage);
    const needsCore =
      cached?.game !== session.game || cached?.growth !== session.growth || storage.getItem(gameSaveKey) === null;
    const core =
      !needsCore && cached ? cached.core : serializeGameCheckpoint(session);
    // Draft edits never rewrite the replay or core snapshot.
    if (session.game.phase === 'game_result') {
      const loaded = loadPlayerProfile(storage);
      if (loaded.message) return false;
      const log = session.replay!;
      const key = replayRoomLocator(log, log.rooms.at(-1)!);
      storage.setItem(
        lastCompletedKey,
        serializeReplay(log, readBuildVersion()),
      );
      persistCompletionProfile(storage, (profile) =>
        recordCompletedMatch(profile, log, key, new Date(), origin),
      );
      // Only remove the active checkpoint after both completed archive and profile succeeded.
      if (session.growth && session.growth.acknowledged < session.growth.units.length)
        storage.setItem(gameSaveKey, core);
      else storage.removeItem(gameSaveKey);
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
      growth: session.growth,
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
  return measurePersistence(
    { mode: 'classic', operation: 'load', phase: 'startup' },
    () => loadClassicAutoSave(storage),
    (result) => result.message === '' || !!result.session,
  );
}
function loadClassicAutoSave(storage: Pick<SaveStorage, 'getItem'> | null): {
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
