import { AchievementNotice } from './achievement-notice';
import { GameHeader } from './game-header';
import {
  useCallback,
  useEffect,
  useRef,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { requireCharacterAccess } from '@/lib/ui/achievements/character-access';
import { SessionContext, type SessionTools } from './session-context';
import { SettledGameFrame } from './settled-game-frame';
import { ItemArtProvider } from './item-icon';
import {
  createGameSession,
  reduceGameSession,
  type GameSession,
} from '@/lib/ui/game-session';
import {
  gameSaveKey,
  loadAutoSave,
  loadPlayerProfile,
} from '@/lib/ui/game-save';
import { readPlayerProfile, type PlayerProfile } from '@/lib/ui/player-profile';
import type { ReplayDocument } from '@/lib/ui/game-replay';
import type { CharacterId } from '@/lib/game/item-types';
import { ReplayArchive } from './replay-viewer';
import { subscribePlayerProfileChanges } from '@/lib/ui/profile-events';
import { restoreClassicCoordinated } from '@/lib/ui/profile-operations';
import { useLivePersistence, currentGrowthEpoch } from './use-live-persistence';
import { mergeSavedGrowth } from '@/lib/ui/achievements/client-persistence';
import {
  beginClassicGrowth,
  bindGrowthEpoch,
  classicGrowthOrder,
} from '@/lib/ui/achievements/lifecycle';

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

export interface ClassicGameAppProps {
  onToolsChange?: (tools: SessionTools) => void;
  inactive?: boolean;
  menu?: boolean;
  menuContent?: ReactNode;
  onReturnMenu?: () => void;
  onActivateClassic?: () => void;
  onSurvivalRestore?: import('./session-context').SessionTools['onSurvivalRestore'];
  onSurvivalReplayImport?: import('./session-context').SessionTools['onSurvivalReplayImport'];
  incoming?: {
    session: GameSession;
    profile?: PlayerProfile;
    revision: number;
    source?: string | null;
  };
  externalReplay?: ReplayDocument | null;
  onCloseExternalReplay?: () => void;
  externalReplayReturnLabel?: string;
  preferences?: GamePreferences;
  preferenceStatus?: PreferenceSaveStatus;
  onSharedPreferencesChange?: (next: GamePreferences) => void;
}
export function ClassicGameApp(props: ClassicGameAppProps = {}) {
  const [selectedCharacter, setSelectedCharacter] =
    useState<CharacterId | null>(null);
  const [initial] = useState(() => loadAutoSave(getPreferenceStorage()));
  const [session, setSession] = useState(
    () => initial.session ?? createGameSession(),
  );
  const [restoreMessage, setRestoreMessage] = useState(initial.message);
  const [initialProfile] = useState(() =>
    loadPlayerProfile(getPreferenceStorage()),
  );
  const [profile, setProfile] = useState(initialProfile.profile);
  const [profileMessage, setProfileMessage] = useState(initialProfile.message);
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribePlayerProfileChanges(() =>
      queueMicrotask(() => {
        if (cancelled) return;
        const loaded = loadPlayerProfile(getPreferenceStorage());
        if (!loaded.message) setProfile(loaded.profile);
        setProfileMessage(loaded.message);
      }),
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
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
  const restoredTerminal = useRef(
    initial.session?.game.phase === 'game_result',
  );
  const game = session.game;
  const liveSave = useLivePersistence({
    mode: 'classic',
    session,
    revision: restoreRevision,
    origin: () => (restoredTerminal.current ? 'restored' : 'live'),
    enabled: () => {
      if (game.phase !== 'character_selection') hasActiveSession.current = true;
      return !(
        game.phase === 'character_selection' &&
        initial.message &&
        !hasActiveSession.current &&
        restoreRevision === 0
      );
    },
    onAcknowledged: (snapshot, context) =>
      setSession((current) => {
        if (!current.growth || !snapshot.growth) return current;
        const growth = mergeSavedGrowth(
          current.growth,
          snapshot.growth,
          context,
        );
        return growth === current.growth ? current : { ...current, growth };
      }),
  });
  const invalidateSave = liveSave.invalidate;
  const acceptSaveSource = liveSave.acceptSource;
  const dispatch = (action: ClientGameAction) => {
    if (action.type === 'start_game') {
      try {
        requireCharacterAccess(getPreferenceStorage(), action.characterId);
      } catch (error) {
        setRestoreMessage(
          error instanceof Error ? error.message : '角色权限未核验。',
        );
        return;
      }
    }
    if (action.type === 'restart_game') setSelectedCharacter(null);
    if (action.type === 'start_game' || action.type === 'restart_game')
      restoredTerminal.current = false;
    if (action.type === 'start_game' || action.type === 'restart_game')
      setRestoreMessage('');
    setSession((current) => {
      let source =
        !current.growth &&
        current.game.phase !== 'character_selection' &&
        current.game.phase !== 'game_result' &&
        action.type !== 'restart_game'
          ? beginClassicGrowth(current, classicGrowthOrder(current))
          : current;
      const epoch = currentGrowthEpoch();
      if (source.growth && epoch !== undefined)
        source = { ...source, growth: bindGrowthEpoch(source.growth, epoch) };
      const next = reduceGameSession(source, action);
      if (action.type !== 'start_game' || next === source) return next;
      const tracked = beginClassicGrowth(next);
      return epoch === undefined
        ? tracked
        : {
            ...tracked,
            growth: bindGrowthEpoch(tracked.growth!, epoch, { fresh: true }),
          };
    });
  };
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setAutoSaveStatus(
        liveSave.saved
          ? game.phase === 'character_selection'
            ? 'idle'
            : 'saved'
          : 'session',
      );
      if (liveSave.saved && game.phase === 'game_result')
        setProfile(loadPlayerProfile(getPreferenceStorage()).profile);
    });
    return () => {
      cancelled = true;
    };
  }, [liveSave.saved, game.phase]);
  const onActivateClassic = props.onActivateClassic;
  const restore = useCallback(
    async (
      next: GameSession,
      incomingProfile?: PlayerProfile,
      expectedProfileSource?: string | null,
      signal?: AbortSignal,
      restoredSource?: string | null,
    ) => {
      invalidateSave();
      let source =
        restoredSource === undefined
          ? (getPreferenceStorage()?.getItem(gameSaveKey) ?? null)
          : restoredSource;
      if (incomingProfile) {
        const validated = readPlayerProfile(incomingProfile);
        const storage = getPreferenceStorage();
        const committed = await restoreClassicCoordinated(
          storage,
          next,
          validated,
          expectedProfileSource,
          { signal },
        );
        source = committed.source;
        const committedProfile = loadPlayerProfile(storage);
        setProfile(committedProfile.profile);
        setProfileMessage(committedProfile.message);
      }
      if (signal?.aborted) return;
      acceptSaveSource(source);
      const epoch = currentGrowthEpoch();
      if (next.growth)
        next = {
          ...next,
          growth: bindGrowthEpoch(
            next.growth,
            epoch === undefined ? (next.growth.profileEpoch ?? null) : epoch,
            { imported: true },
          ),
        };
      restoredTerminal.current = next.game.phase === 'game_result';
      setSession(next);
      onActivateClassic?.();
      setRestoreMessage(
        next.game.phase === 'game_result'
          ? '已载入已结束的对局，可查看原结果与回放。'
          : '已载入文件存档，继续同一局。',
      );
      setRestoreRevision((current) => current + 1);
      window.scrollTo(0, 0);
    },
    [onActivateClassic, invalidateSave, acceptSaveSource],
  );
  const activate = props.onActivateClassic;
  const newGame = useCallback(() => {
    invalidateSave();
    restoredTerminal.current = false;
    setSelectedCharacter(null);
    setSession(createGameSession());
    activate?.();
    setRestoreMessage('已返回选角；玩家进度、最近完成记录及原有导出文件保留。');
    setRestoreRevision((current) => current + 1);
    window.scrollTo(0, 0);
  }, [activate, invalidateSave]);
  const [storedPreferences, setPreferences] = useState(() =>
    loadGamePreferences(getPreferenceStorage()),
  );
  const [storedPreferenceStatus, setPreferenceSaveStatus] =
    useState<PreferenceSaveStatus>('unchanged');
  const preferences = props.preferences ?? storedPreferences;
  const preferenceSaveStatus = props.preferenceStatus ?? storedPreferenceStatus;
  const sharedPreferences = props.onSharedPreferencesChange;
  const changePreferences = useCallback(
    (next: GamePreferences) => {
      sharedPreferences?.(next);
      setPreferences(next);
      setPreferenceSaveStatus(
        saveGamePreferences(getPreferenceStorage(), next) ? 'saved' : 'session',
      );
    },
    [sharedPreferences],
  );
  useEffect(() => {
    let cancelled = false;
    if (props.incoming)
      queueMicrotask(() => {
        if (!cancelled) {
          void restore(
            props.incoming!.session,
            props.incoming!.profile,
            undefined,
            undefined,
            props.incoming!.source,
          ).catch((error) =>
            setRestoreMessage(
              error instanceof Error ? error.message : '载入失败。',
            ),
          );
          if (!props.incoming!.profile) {
            const loaded = loadPlayerProfile(getPreferenceStorage());
            if (!loaded.message) setProfile(loaded.profile);
            setProfileMessage(loaded.message);
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.incoming, restore]);
  useEffect(() => {
    let cancelled = false;
    if (props.menu) {
      const loaded = loadPlayerProfile(getPreferenceStorage());
      if (!loaded.message)
        queueMicrotask(() => {
          if (!cancelled) setProfile(loaded.profile);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [props.menu]);
  let page: ReactNode;

  if (props.menu) {
    page = props.menuContent;
  } else if (game.phase === 'character_selection') {
    page = (
      <CharacterSelection
        startMessage={restoreMessage}
        selected={selectedCharacter}
        onSelect={setSelectedCharacter}
        onReturnMenu={props.onReturnMenu}
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
        extraStatus={
          props.onReturnMenu && (
            <button
              type="button"
              className="survival-menu-return"
              onClick={props.onReturnMenu}
            >
              返回主菜单
            </button>
          )
        }
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
  if (
    !props.menu &&
    game.phase !== 'character_selection' &&
    game.phase !== 'room_action'
  )
    page = (
      <SettledGameFrame game={game}>
        {props.onReturnMenu && (
          <button
            type="button"
            className="survival-menu-return"
            onClick={props.onReturnMenu}
          >
            返回主菜单
          </button>
        )}
        {page}
      </SettledGameFrame>
    );
  if (props.externalReplay && !props.menu)
    page = (
      <main className="ranking-page">
        <GameHeader
          navigation={<span className="header-location">经典只读回放</span>}
          context={
            <div className="readonly-return-actions">
              <button type="button" onClick={props.onCloseExternalReplay}>
                {props.externalReplayReturnLabel ?? '返回经典对局'}
              </button>
              <button type="button" onClick={props.onReturnMenu}>
                返回主菜单
              </button>
            </div>
          }
        />
        <section className="ranking-stage">
          <p>文件只读查看，不替换当前对局，不登记玩家进度。</p>
          <ReplayArchive
            key={props.externalReplay.exportedAt}
            log={props.externalReplay.replay}
            scoreDecimals={preferences.scoreDecimals}
          />
        </section>
      </main>
    );
  const {
    onReturnMenu,
    onSurvivalRestore,
    onSurvivalReplayImport,
    externalReplay,
    onToolsChange,
  } = props;
  const tools = useMemo<SessionTools>(
    () => ({
      session,
      onReturnMenu,
      onSurvivalRestore,
      onSurvivalReplayImport,
      autoSaveStatus,
      restoreMessage,
      profile,
      profileMessage,
      onRestore: restore,
      onNewGame: newGame,
      importedReplay: externalReplay ?? importedReplay,
      onReplayImport: (replay) => {
        setImportedReplay(replay);
        setReplaySource('file');
      },
      replaySource: externalReplay ? 'file' : replaySource,
      onReplaySourceChange: setReplaySource,
      preferences,
      preferenceSaveStatus,
      onPreferencesChange: changePreferences,
    }),
    [
      session,
      autoSaveStatus,
      restoreMessage,
      profile,
      profileMessage,
      restore,
      newGame,
      importedReplay,
      replaySource,
      preferences,
      preferenceSaveStatus,
      externalReplay,
      changePreferences,
      onReturnMenu,
      onSurvivalRestore,
      onSurvivalReplayImport,
    ],
  );
  useEffect(() => {
    onToolsChange?.(tools);
  }, [onToolsChange, tools]);
  if (props.inactive) return null;
  return (
    <SessionContext.Provider value={tools}>
      <ItemArtProvider>
        <div
          key={restoreRevision}
          className="game-client"
          data-reduce-motion={preferences.reduceMotion}
        >
          {page}
          <AchievementNotice
            ids={liveSave.achievementNotice}
            onDismiss={liveSave.dismissNotice}
          />
          {liveSave.message && (
            <output className="survival-save-message">
              {liveSave.message}
              <button
                type="button"
                disabled={liveSave.busy}
                onClick={liveSave.retry}
              >
                重试保存
              </button>
            </output>
          )}
        </div>
      </ItemArtProvider>
    </SessionContext.Provider>
  );
}
