import { useReducer } from 'react';

import { CharacterSelection } from './character-selection';
import { GameResult } from './game-result';
import { RoomResult } from './room-result';
import { RoomPrototype } from './room-prototype';
import {
  clientGameReducer,
  createCharacterSelectionState,
  createSessionSeed,
} from '@/lib/game/client-session';

export function GameApp() {
  const [game, dispatch] = useReducer(
    clientGameReducer,
    undefined,
    () => createCharacterSelectionState(),
  );

  if (game.phase === 'character_selection') {
    return (
      <CharacterSelection
        onStart={(characterId) => dispatch({ type: 'start_game', characterId })}
      />
    );
  }

  if (game.phase === 'room_result') {
    return <RoomResult game={game} onAdvance={() => dispatch({ type: 'advance_room' })} />;
  }

  if (game.phase === 'game_result') {
    return (
      <GameResult
        game={game}
        onRestart={() => dispatch({ type: 'restart_game', seed: createSessionSeed() })}
      />
    );
  }

  return (
    <RoomPrototype
      key={`${game.floorIndex}:${game.roomIndex}`}
      game={game}
      onSubmit={(turn) => dispatch({ type: 'submit_player_turn', turn })}
      onSettle={() => dispatch({ type: 'settle_room' })}
    />
  );
}
