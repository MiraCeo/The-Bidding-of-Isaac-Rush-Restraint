import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SessionContext } from './session-context';
import { SettledGameFrame } from './settled-game-frame';
import { ItemArtProvider } from './item-icon';
import {
  createGameSession,
  reduceGameSession,
  type GameSession,
} from '@/lib/ui/game-session';
import { loadAutoSave, persistGameSession } from '@/lib/ui/game-save';
import type { ReplayDocument } from '@/lib/ui/game-replay';

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
  type ClientGameAction,
  createSessionSeed,
} from '@/lib/game/client-session';

export function GameApp() {
  const [initial] = useState(() => loadAutoSave(getPreferenceStorage()));
  const [session, setSession] = useState(
    () => initial.session ?? createGameSession(),
  );
  const [restoreMessage, setRestoreMessage] = useState(initial.message);
  const [autoSaveStatus, setAutoSaveStatus] = useState<
    'idle' | 'saved' | 'session'
  >('idle');
  const [restoreRevision, setRestoreRevision] = useState(0);
  const [importedReplay, setImportedReplay] = useState<ReplayDocument | null>(
    null,
  );
  const [replaySource, setReplaySource] = useState<'current' | 'file'>(
    'current',
  );
  const hasActiveSession = useRef(initial.session !== null);
  const game = session.game;
  const dispatch = (action: ClientGameAction) => {
    if (action.type === 'start_game' || action.type === 'restart_game')
      setRestoreMessage('');
    setSession((current) => reduceGameSession(current, action));
  };
  useEffect(() => {
    // Retain unreadable automatic files until the user starts/imports a valid game.
    if (game.phase !== 'character_selection') hasActiveSession.current = true;
    if (
      game.phase === 'character_selection' &&
      initial.message &&
      !hasActiveSession.current &&
      restoreRevision === 0
    )
      return;
    const saved = persistGameSession(getPreferenceStorage(), session);
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled)
        setAutoSaveStatus(
          saved
            ? game.phase === 'character_selection'
              ? 'idle'
              : 'saved'
            : 'session',
        );
    });
    return () => {
      cancelled = true;
    };
  }, [session, game.phase, initial, restoreRevision]);
  const restore = (next: GameSession) => {
    setSession(next);
    setRestoreMessage('已载入文件存档，继续同一局。');
    setRestoreRevision((current) => current + 1);
    window.scrollTo(0, 0);
  };
  const newGame = () => {
    setSession(createGameSession());
    setRestoreMessage('已开始新对局；原有导出文件仍可读取。');
    setRestoreRevision((current) => current + 1);
    window.scrollTo(0, 0);
  };
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
        embedded
        game={game}
        onShowRanking={(view) => dispatch({ type: 'show_room_ranking', view })}
        onAdvance={() => dispatch({ type: 'advance_room' })}
        scoreDecimals={preferences.scoreDecimals}
      />
    );
  } else if (game.phase === 'room_ranking') {
    page = (
      <RoomRanking
        embedded
        game={game}
        onSwitch={(view) => dispatch({ type: 'switch_room_ranking', view })}
        onAdvance={() => dispatch({ type: 'advance_room' })}
        scoreDecimals={preferences.scoreDecimals}
      />
    );
  } else if (game.phase === 'game_result') {
    page = (
      <GameResult
        embedded
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
        draft={session.draft!}
        onDraftChange={(update) =>
          setSession((current) =>
            current.draft
              ? { ...current, draft: update(current.draft) }
              : current,
          )
        }
        onSubmit={(turn) => dispatch({ type: 'submit_player_turn', turn })}
        preferences={preferences}
        preferenceSaveStatus={preferenceSaveStatus}
        onPreferencesChange={changePreferences}
      />
    );
  }
  if (game.phase !== 'character_selection' && game.phase !== 'room_action')
    page = <SettledGameFrame game={game}>{page}</SettledGameFrame>;
  return (
    <SessionContext.Provider
      value={{
        session,
        autoSaveStatus,
        restoreMessage,
        onRestore: restore,
        onNewGame: newGame,
        importedReplay,
        onReplayImport: (replay) => {
          setImportedReplay(replay);
          setReplaySource('file');
        },
        replaySource,
        onReplaySourceChange: setReplaySource,
        preferences,
        preferenceSaveStatus,
        onPreferencesChange: changePreferences,
      }}
    >
      <ItemArtProvider>
        <div
          key={restoreRevision}
          className="game-client"
          data-reduce-motion={preferences.reduceMotion}
        >
          {page}
        </div>
      </ItemArtProvider>
    </SessionContext.Provider>
  );
}
