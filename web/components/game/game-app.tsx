import { useReducer, useState, type ReactNode } from 'react';

import { CharacterSelection } from './character-selection';
import { GameResult } from './game-result';
import { RoomRanking } from './room-ranking';
import { RoomResult } from './room-result';
import { RoomPrototype } from './room-prototype';
import type { PreferenceSaveStatus } from './game-settings';
import {
  getPreferenceStorage,
  loadGamePreferences,
  saveGamePreferences,
  type GamePreferences,
} from '@/lib/ui/game-preferences';
import {
  clientGameReducer,
  createCharacterSelectionState,
  createSessionSeed,
} from '@/lib/game/client-session';

export function GameApp() {
  const [game, dispatch] = useReducer(clientGameReducer, undefined, () =>
    createCharacterSelectionState(),
  );
  const [preferences, setPreferences] = useState(() =>
    loadGamePreferences(getPreferenceStorage()),
  );
  const [preferenceSaveStatus, setPreferenceSaveStatus] =
    useState<PreferenceSaveStatus>('unchanged');
  const changePreferences = (next: GamePreferences) => {
    setPreferences(next);
    setPreferenceSaveStatus(
      saveGamePreferences(getPreferenceStorage(), next) ? 'saved' : 'session',
    );
  };
  let page: ReactNode;

  if (game.phase === 'character_selection') {
    page = (
      <CharacterSelection
        onStart={(characterId) => dispatch({ type: 'start_game', characterId })}
        preferences={preferences}
        preferenceSaveStatus={preferenceSaveStatus}
        onPreferencesChange={changePreferences}
      />
    );
  } else if (game.phase === 'room_result') {
    page = (
      <RoomResult
        game={game}
        onShowRanking={(view) => dispatch({ type: 'show_room_ranking', view })}
        onAdvance={() => dispatch({ type: 'advance_room' })}
        scoreDecimals={preferences.scoreDecimals}
      />
    );
  } else if (game.phase === 'room_ranking') {
    page = (
      <RoomRanking
        game={game}
        onSwitch={(view) => dispatch({ type: 'switch_room_ranking', view })}
        onAdvance={() => dispatch({ type: 'advance_room' })}
        scoreDecimals={preferences.scoreDecimals}
      />
    );
  } else if (game.phase === 'game_result') {
    page = (
      <GameResult
        game={game}
        onRestart={() =>
          dispatch({ type: 'restart_game', seed: createSessionSeed() })
        }
        scoreDecimals={preferences.scoreDecimals}
      />
    );
  } else {
    page = (
      <RoomPrototype
        key={`${game.floorIndex}:${game.roomIndex}`}
        game={game}
        onSubmit={(turn) => dispatch({ type: 'submit_player_turn', turn })}
        preferences={preferences}
        preferenceSaveStatus={preferenceSaveStatus}
        onPreferencesChange={changePreferences}
      />
    );
  }
  return (
    <div className="game-client" data-reduce-motion={preferences.reduceMotion}>
      {page}
    </div>
  );
}
