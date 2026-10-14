/** Deterministic performance/stability harness; no client imports or browser storage. */
import {
  startSurvivalGame,
  survivalGameReducer,
  type SurvivalGameState,
  type SurvivalGameAction,
} from '../game/survival-session';
import {
  currentSurvivalAiPolicy,
  type SurvivalDifficulty,
} from '../game/survival-difficulty';
import { survivalOfficialCutLines } from '../game/survival-rules';
import type { CharacterId } from '../game/item-types';
export function longRunAction(
  game: SurvivalGameState,
  policy: 'withdraw' | 'pace' = 'withdraw',
): SurvivalGameAction {
  if (game.phase !== 'room_action')
    return {
      type: game.phase === 'room_result' ? 'advance_room' : 'advance_floor',
    };
  if (!game.activePlayerIds.includes('human'))
    return { type: 'submit_ai_room' };
  const human = game.players[0]!,
    amount = Math.floor(human.money / (5 - game.roomIndex));
  return {
    type: 'submit_player_turn',
    turn: {
      playerId: 'human',
      actions:
        policy === 'withdraw' || amount < 1
          ? [{ type: 'withdraw' }]
          : [{ type: 'bid', group: game.roomIndex % 2 ? 'B' : 'A', amount }],
    },
  };
}
export function playLongRun(
  seed: number,
  characterId: CharacterId = 'isaac',
  difficulty: SurvivalDifficulty = 'highest',
  policy: 'withdraw' | 'pace' = 'withdraw',
  structural = false,
) {
  let game = startSurvivalGame({
    seed,
    characterId,
    aiDifficulty: difficulty,
    aiPolicy: currentSurvivalAiPolicy,
    cutLines: structural ? Array(7).fill(0) : survivalOfficialCutLines,
    buildId: 'long-run-measurement',
  });
  const states = [game],
    steps: { action: SurvivalGameAction; ms: number }[] = [];
  while (game.phase !== 'competition_complete') {
    if (steps.length >= 77) throw new Error('Long-run command bound exceeded');
    const action = longRunAction(game, policy),
      started = performance.now();
    game = survivalGameReducer(game, action);
    steps.push({ action, ms: performance.now() - started });
    states.push(game);
  }
  return {
    game,
    states,
    steps,
    seed,
    characterId,
    difficulty,
    policy,
    structural,
  };
}
