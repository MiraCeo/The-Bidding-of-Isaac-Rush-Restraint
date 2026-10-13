import type { GameMode } from '../game/game-mode';
import type { ClientGameAction } from '../game/client-session';
import {
  startSurvivalPrototype,
  survivalGameReducer,
  type SurvivalGameState,
  type SurvivalGameAction,
  type SurvivalPrototypeOptions,
} from '../game/survival-session';
import {
  createGameSession,
  reduceGameSession,
  type GameSession,
} from './game-session';
import { readBuildVersion } from './game-version';

/** Internal dispatch boundary only; the production UI still opens the legacy classic session. */
export type ModeSession =
  | { mode: 'classic'; session: GameSession }
  | { mode: 'survival'; game: SurvivalGameState };

export type ModeSessionAction =
  | { mode: 'classic'; action: ClientGameAction }
  | { mode: 'survival'; action: SurvivalGameAction };

export function createModeSession(
  options:
    | { mode: 'classic'; seed?: number }
    | ({ mode: 'survival' } & SurvivalPrototypeOptions),
): ModeSession {
  return options.mode === 'classic'
    ? { mode: 'classic', session: createGameSession(options.seed) }
    : {
        mode: 'survival',
        game: startSurvivalPrototype({
          ...options,
          buildId: options.buildId ?? readBuildVersion(),
        }),
      };
}

export function reduceModeSession(
  state: ModeSession,
  action: ModeSessionAction,
): ModeSession {
  if (state.mode === 'classic' && action.mode === 'classic') {
    const session = reduceGameSession(state.session, action.action);
    return session === state.session ? state : { ...state, session };
  }
  if (state.mode === 'survival' && action.mode === 'survival') {
    const game = survivalGameReducer(state.game, action.action);
    return game === state.game ? state : { ...state, game };
  }
  return state;
}

export function getModeSessionIdentity(session: ModeSession): GameMode {
  return session.mode;
}
