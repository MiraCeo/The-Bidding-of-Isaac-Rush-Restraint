import { currentFileVersion, assertCurrentFileHeader } from './file-protocol';
import { resetLegacyGrowthContext, beginSurvivalGrowth, observeSurvivalGrowth, restoreGrowthContext, validateGrowthContext,
  survivalGrowthOrder, validateGrowthProfilePair, type GrowthContext } from './achievements/lifecycle';
import { playerProfileKey, readPlayerProfile } from './player-profile';
import { measurePersistence } from './persistence-metrics';
import { characterCatalog } from '../game/characters';
import type { CharacterId, PlayerTurn } from '../game/item-types';
import {
  startSurvivalGame,
  survivalGameReducer,
  withSurvivalBuild,
  type SurvivalGameState,
  type SurvivalCommandRecord,
  type SurvivalGameAction,
} from '../game/survival-session';
import { maximumSurvivalFloors } from '../game/survival-rules';
import { hasItem } from '../game/runtime';
import type { RoomDraft } from './game-session';
import type { SaveStorage } from './game-save';
import { readBuildVersion } from './game-version';
import {
  createSurvivalReplay,
  createSurvivalRuleFacts,
  survivalCompatibility,
  survivalParameters,
  type SurvivalReplayLog,
  type SurvivalRuleFacts,
} from './survival-record';
import {
  validateSurvivalReplayFacts,
  validateSurvivalRuleFacts,
} from './survival-facts-validation';
import {
  canonicalJson,
  copySnapshot,
  assertFiniteJsonNumbers,
} from '../shared/json-facts';
import {
  array,
  checkChecksum,
  checkedJson,
  date,
  equal,
  fail,
  integer,
  keys,
  object,
  stringifyChecked,
  text,
} from './file-json';

export const survivalSaveKey = 'bidding-survival-checkpoint-v5';
export const survivalLastCompletedKey = 'bidding-survival-last-completed-v5';

export interface SurvivalSaveDocument {
  growth?: GrowthContext;
  format: 'the-bidding-of-isaac-save';
  version: typeof currentFileVersion;
  mode: 'survival';
  kind: 'checkpoint';
  savedAt: string;
  compatibility: string;
  game: SurvivalGameState;
  draft: RoomDraft | null;
}
export interface SurvivalReplayDocument {
  format: 'the-bidding-of-isaac-replay';
  kind: 'replay';
  version: typeof currentFileVersion;
  mode: 'survival';
  exportedAt: string;
  exportedBuild: string;
  replay: SurvivalReplayLog;
}
/** Large room facts and debug decisions are reconstructed for continuation, not duplicated in a checkpoint. */
function checkpointSnapshot(game: SurvivalGameState) {
  assertFiniteJsonNumbers(game); // Validate excluded diagnostics too, without allocating their canonical JSON.
  const {
    roomRecords: _rooms,
    roomSettlement: _settlement,
    revealedAiDecisions: _decisions,
    commandLog: _commands,
    ...snapshot
  } = game;
  return copySnapshot(snapshot);
}
function turn(value: unknown): PlayerTurn {
  keys(value, ['playerId', 'actions']);
  const input = object(value);
  if (input.playerId !== 'human') fail('生存检查点的真人行动身份无效。');
  array(input.actions, 2);
  if (!input.actions.length) fail();
  const result: PlayerTurn = {
    playerId: 'human',
    actions: input.actions.map((value) => {
      const action = object(value);
      if (action.type === 'withdraw') {
        keys(action, ['type']);
        return { type: 'withdraw' as const };
      }
      keys(action, ['type', 'group', 'amount']);
      if (
        !['bid', 'disrupt'].includes(String(action.type)) ||
        !['A', 'B'].includes(String(action.group))
      )
        fail();
      integer(action.amount, 1);
      return {
        type: action.type as 'bid' | 'disrupt',
        group: action.group as 'A' | 'B',
        amount: action.amount,
      };
    }),
  };
  return result;
}
function command(value: unknown): SurvivalCommandRecord {
  keys(value, ['build', 'action']);
  const input = object(value);
  text(input.build);
  const action = object(input.action);
  let clean: SurvivalGameAction;
  if (action.type === 'submit_player_turn') {
    keys(action, ['type', 'turn']);
    clean = { type: 'submit_player_turn', turn: turn(action.turn) };
  } else {
    keys(action, ['type']);
    if (
      !['submit_ai_room', 'advance_room', 'advance_floor'].includes(
        String(action.type),
      )
    )
      fail('生存检查点包含未知命令。');
    clean = {
      type: action.type as 'submit_ai_room' | 'advance_room' | 'advance_floor',
    };
  }
  return { build: input.build, action: clean };
}
function readDraft(value: unknown, game: SurvivalGameState): RoomDraft | null {
  const humanActive = game.activePlayerIds.includes('human');
  if (value === null) return null;
  if (game.phase !== 'room_action' || !humanActive)
    fail('当前生存阶段不能包含真人报价草稿。');
  keys(value, ['selectedAction', 'amounts']);
  const draft = object(value),
    selected = object(draft.selectedAction);
  keys(selected, ['kind', 'groups']);
  array(selected.groups, 2);
  const groups = selected.groups as ('A' | 'B')[];
  if (
    !['bid', 'disrupt', 'withdraw'].includes(String(selected.kind)) ||
    (selected.kind === 'withdraw'
      ? groups.length !== 0
      : groups.length === 0) ||
    new Set(groups).size !== groups.length ||
    groups.some((group) => !['A', 'B'].includes(group))
  )
    fail();
  const human = game.players.find((player) => player.id === 'human')!;
  if (
    groups.length === 2 &&
    !hasItem(
      human,
      selected.kind === 'bid' ? 'more_options' : 'more_options_question',
    )
  )
    fail();
  keys(draft.amounts, ['A', 'B']);
  const amounts = object(draft.amounts);
  const readAmount = (group: 'A' | 'B') => {
    const entry = object(amounts[group]);
    keys(entry, ['bid', 'disrupt']);
    integer(entry.bid, 1);
    integer(entry.disrupt, 1);
    if (
      entry.bid > Math.max(1, human.money) ||
      entry.disrupt > Math.max(1, Math.floor(human.money * 0.5))
    )
      fail();
    return { bid: entry.bid, disrupt: entry.disrupt };
  };
  const clean: RoomDraft = {
    selectedAction:
      selected.kind === 'withdraw'
        ? { kind: 'withdraw', groups: [] }
        : { kind: selected.kind as 'bid' | 'disrupt', groups },
    amounts: { A: readAmount('A'), B: readAmount('B') },
  };
  if (
    selected.kind === 'bid' &&
    groups.length === 2 &&
    clean.amounts.A.bid + clean.amounts.B.bid > Math.floor(human.money * 0.5)
  )
    fail();
  equal(clean, draft);
  return copySnapshot(clean);
}

export function serializeSurvivalCheckpoint(
  game: SurvivalGameState,
  draft: RoomDraft | null = null,
  now = new Date(),
  growth?: GrowthContext,
): string {
  if (growth) growth = resetLegacyGrowthContext(growth, survivalGrowthOrder(game));
  const facts = createSurvivalRuleFacts(survivalParameters(game));
  return stringifyChecked({
    format: 'the-bidding-of-isaac-save',
    version: currentFileVersion,
    mode: 'survival',
    kind: 'checkpoint',
    savedAt: now.toISOString(),
    compatibility: survivalCompatibility(facts),
    ruleFacts: facts,
    seed: game.seed,
    characterId: game.selectedCharacter,
    startedBuild: game.startedBuild,
    currentBuild: game.currentBuild,
    commands: game.commandLog,
    snapshot: checkpointSnapshot(game),
    draft: readDraft(draft, game),
    ...(growth ? { growth: validateGrowthContext(growth, 'survival') } : {}),
  });
}

/** Replay accepted commands on detached state. Includes AI-only rooms after the human exits. */
export function parseSurvivalCheckpoint(source: string): SurvivalSaveDocument {
  const doc = checkedJson(source);
  assertCurrentFileHeader(doc, 'survival');
  keys(doc, [
    'format',
    'version',
    'mode',
    'kind',
    'savedAt',
    'compatibility',
    'ruleFacts',
    'seed',
    'characterId',
    'startedBuild',
    'currentBuild',
    'commands',
    'snapshot',
    'draft',
    'checksum',
    ...(Object.hasOwn(doc, 'growth') ? ['growth'] : []),
  ]);
  if (
    doc.format !== 'the-bidding-of-isaac-save' ||
    doc.version !== currentFileVersion ||
    doc.mode !== 'survival' ||
    doc.kind !== 'checkpoint'
  )
    fail('这不是v5生存续玩检查点。');
  checkChecksum(doc);
  date(doc.savedAt);
  integer(doc.seed);
  if (doc.seed > 0xffffffff) fail();
  if (!characterCatalog.some((character) => character.id === doc.characterId))
    fail();
  text(doc.startedBuild);
  text(doc.currentBuild);
  text(doc.compatibility);
  const facts = doc.ruleFacts as SurvivalRuleFacts;
  validateSurvivalRuleFacts(facts);
  const currentFacts = createSurvivalRuleFacts(facts.parameters);
  if (
    doc.compatibility !== survivalCompatibility(currentFacts) ||
    canonicalJson(facts) !== canonicalJson(currentFacts)
  )
    fail('生存规则版本不兼容；历史回放可只读，不能用当前引擎续玩。');
  const maximumCommands =
    maximumSurvivalFloors(facts.parameters.rules) *
    (2 * facts.parameters.rules.roomsPerFloor + 1);
  array(doc.commands, maximumCommands);
  let game = startSurvivalGame({
    ...facts.parameters,
    seed: doc.seed,
    characterId: doc.characterId as CharacterId,
    buildId: doc.startedBuild,
  });
  const recordedGrowth = Object.hasOwn(doc, 'growth') ? validateGrowthContext(doc.growth, 'survival') : undefined;
  let growth = recordedGrowth ? beginSurvivalGrowth({ game, draft: null }, recordedGrowth.excludedThrough, recordedGrowth.expansionFrom ?? 78, recordedGrowth.milestonesFrom ?? 78, recordedGrowth.revisionsFrom ?? 78, recordedGrowth.cfFrom ?? 78).growth! : undefined;
  const commands = doc.commands.map(command);
  for (const entry of commands) {
    game = withSurvivalBuild(game, entry.build);
    const next = survivalGameReducer(game, entry.action);
    if (next === game) fail('生存检查点包含非法或重复阶段命令。');
    if (growth) growth = observeSurvivalGrowth(game, next, growth);
    game = next;
  }
  game = withSurvivalBuild(game, doc.currentBuild);
  equal(game.commandLog, doc.commands);
  equal(checkpointSnapshot(game), doc.snapshot);
  return {
    format: 'the-bidding-of-isaac-save',
    version: currentFileVersion,
    mode: 'survival',
    kind: 'checkpoint',
    savedAt: doc.savedAt as string,
    compatibility: doc.compatibility,
    game,
    draft: readDraft(doc.draft, game),
    ...(recordedGrowth ? { growth: restoreGrowthContext(recordedGrowth, growth!, survivalGrowthOrder(game)) } : {}),
  };
}

export function serializeSurvivalReplay(
  replay: SurvivalReplayLog,
  exportedBuild = readBuildVersion(),
  now = new Date(),
): string {
  text(exportedBuild);
  validateSurvivalReplayFacts(replay);
  return stringifyChecked({
    format: 'the-bidding-of-isaac-replay',
    kind: 'replay',
    version: currentFileVersion,
    mode: 'survival',
    exportedAt: now.toISOString(),
    exportedBuild,
    replay,
  });
}
/** No startup, AI, random draws, scoring engine, continuation or localStorage writes. */
export function parseSurvivalReplay(source: string): SurvivalReplayDocument {
  const doc = checkedJson(source);
  assertCurrentFileHeader(doc, 'survival');
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
  if (
    doc.kind !== 'replay' ||
    doc.format !== 'the-bidding-of-isaac-replay' ||
    doc.version !== currentFileVersion ||
    doc.mode !== 'survival'
  )
    fail('这不是v5生存事实回放。');
  checkChecksum(doc);
  date(doc.exportedAt);
  text(doc.exportedBuild);
  let replay: SurvivalReplayLog;
  try {
    replay = validateSurvivalReplayFacts(doc.replay as SurvivalReplayLog);
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) fail();
    throw error;
  }
  return {
    format: 'the-bidding-of-isaac-replay',
    kind: 'replay',
    version: currentFileVersion,
    mode: 'survival',
    exportedAt: doc.exportedAt as string,
    exportedBuild: doc.exportedBuild,
    replay,
  };
}

export interface SurvivalSaveResult {
  checkpointSaved: boolean;
  archiveSaved: boolean | null;
}
/** The small continuation checkpoint must survive a separate, larger archive quota failure. */
export function saveSurvivalProgress(
  storage: SaveStorage | null,
  game: SurvivalGameState,
  draft: RoomDraft | null = null,
  growth?: GrowthContext,
): SurvivalSaveResult {
  return measurePersistence(
    { mode: 'survival', operation: 'save', phase: game.phase },
    () => writeSurvivalProgress(storage, game, draft, growth),
    (result) => result.checkpointSaved && result.archiveSaved !== false,
  );
}
function writeSurvivalProgress(
  storage: SaveStorage | null,
  game: SurvivalGameState,
  draft: RoomDraft | null,
  growth?: GrowthContext,
): SurvivalSaveResult {
  const failed = { checkpointSaved: false, archiveSaved: null };
  if (!storage) return failed;
  try {
    if (growth && growth.acknowledged > 0) {
      const source = storage.getItem(playerProfileKey);
      if (source === null) return failed;
      validateGrowthProfilePair(readPlayerProfile(checkedJson(source)), growth);
    }
    const source = serializeSurvivalCheckpoint(game, draft, new Date(), growth);
    storage.setItem(survivalSaveKey, source);
  } catch {
    return failed;
  }
  if (game.phase === 'competition_complete') {
    try {
      storage.setItem(
        survivalLastCompletedKey,
        serializeSurvivalReplay(createSurvivalReplay(game)),
      );
      return { checkpointSaved: true, archiveSaved: true };
    } catch {
      return { checkpointSaved: true, archiveSaved: false };
    }
  }
  return { checkpointSaved: true, archiveSaved: null };
}
export function persistSurvivalCheckpoint(
  storage: SaveStorage | null,
  game: SurvivalGameState,
  draft: RoomDraft | null = null,
): boolean {
  const result = saveSurvivalProgress(storage, game, draft);
  return result.checkpointSaved && result.archiveSaved !== false;
}
export function survivalSaveMessage(result: SurvivalSaveResult): string {
  if (!result.checkpointSaved)
    return '生存自动保存失败，当前仅在本页运行，请导出存档；浏览器中可能仍是较早的进度。';
  if (result.archiveSaved === false)
    return '生存检查点已保存；最近完成回放未保存，请导出回放。原最近回放保留。';
  return result.archiveSaved
    ? '生存检查点与完成回放已保存'
    : '生存检查点已保存';
}
export function loadSurvivalCheckpoint(
  storage: Pick<SaveStorage, 'getItem'> | null,
): { document: SurvivalSaveDocument | null; message: string } {
  return measurePersistence(
    { mode: 'survival', operation: 'load', phase: 'startup' },
    () => readSurvivalCheckpoint(storage),
    (result) => result.message === '',
  );
}
function readSurvivalCheckpoint(storage: Pick<SaveStorage, 'getItem'> | null): {
  document: SurvivalSaveDocument | null;
  message: string;
} {
  try {
    const source = storage?.getItem(survivalSaveKey);
    return {
      document: source ? parseSurvivalCheckpoint(source) : null,
      message: '',
    };
  } catch (error) {
    return {
      document: null,
      message: `生存检查点未读取，原数据保留：${error instanceof Error ? error.message : '读取失败'}`,
    };
  }
}
