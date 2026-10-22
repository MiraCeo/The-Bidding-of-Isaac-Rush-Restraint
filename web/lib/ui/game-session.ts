import {
  clientGameReducer,
  createCharacterSelectionState,
  type ClientGameAction,
  type ClientGameState,
} from '../game/client-session';
import { defaultRules } from '../game/config';
import type { RewardGroup } from '../game/types';
import type { RulesConfig } from '../game/types';
import type { PlayerTurn } from '../game/item-types';
import {
  appendReplayRoom,
  createReplayLog,
  finalizeReplay,
  type ReplayLog,
} from './replay-record';
import { observeClassicGrowth, type GrowthContext } from './achievements/lifecycle';

export type SelectedAction =
  | { kind: 'bid' | 'disrupt'; groups: RewardGroup[] }
  | { kind: 'withdraw'; groups: [] };
export interface RoomDraft {
  selectedAction: SelectedAction;
  amounts: Record<RewardGroup, { bid: number; disrupt: number }>;
}
export interface GameSession {
  growth?: GrowthContext;
  /** Observational capture failure never rolls back an already-settled game. */
  growthIssue?: string;
  game: ClientGameState;
  draft: RoomDraft | null;
  /** Human submissions are retained for bounded integrity verification, not for UI playback. */
  turns: PlayerTurn[];
  replay: ReplayLog | null;
}

export function createRoomDraft(game: ClientGameState, rules: RulesConfig = defaultRules): RoomDraft | null {
  if (game.phase !== 'room_action') return null;
  const floorMoney = rules.floorStartingMoney[game.floorIndex]!;
  const money = game.players.find((p) => p.isHuman)!.money;
  const amounts = {
    bid: Math.max(1, Math.min(money, Math.round(floorMoney * 0.25))),
    disrupt: Math.max(
      1,
      Math.min(Math.floor(money * 0.5), Math.round(floorMoney * 0.2)),
    ),
  };
  return {
    selectedAction: { kind: 'bid', groups: ['A'] },
    amounts: { A: { ...amounts }, B: { ...amounts } },
  };
}

export function createGameSession(seed?: number): GameSession {
  return {
    game: createCharacterSelectionState(seed),
    draft: null,
    turns: [],
    replay: null,
  };
}

export function reduceGameSession(
  session: GameSession,
  action: ClientGameAction,
): GameSession {
  const game = clientGameReducer(session.game, action);
  if (game === session.game) return session;
  const newRoom =
    action.type === 'start_game' ||
    action.type === 'advance_room' ||
    action.type === 'restart_game';
  let replay = session.replay;
  if (game.phase === 'character_selection') replay = null;
  else if (action.type === 'start_game') replay = createReplayLog(game);
  else if (replay && action.type === 'submit_player_turn')
    replay = appendReplayRoom(replay, game);
  else if (replay && game.phase === 'game_result')
    replay = finalizeReplay(replay, game);
  const next: GameSession = {
    game,
    replay,
    draft: newRoom
      ? createRoomDraft(game)
      : game.phase === 'room_action'
        ? session.draft
        : null,
    turns:
      action.type === 'restart_game' || action.type === 'start_game'
        ? []
        : action.type === 'submit_player_turn'
          ? [...session.turns, action.turn]
          : session.turns,
  };
  if (session.growth && game.phase !== 'character_selection' && action.type !== 'start_game') {
    next.growth = session.growth;
    next.growthIssue = session.growthIssue;
    if (!session.growthIssue) {
      try { next.growth = observeClassicGrowth(session, next, session.growth); }
      catch (error) { next.growthIssue = error instanceof Error ? error.message : '成长捕获失败。'; }
    }
  }
  return next;
}
