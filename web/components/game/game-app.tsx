import { useState, useCallback } from 'react';
import { ClassicGameApp, type ClassicGameAppProps } from './classic-game-app';
import { SurvivalGameApp } from './survival-game-app';
import { GameModeMenu } from './game-mode-menu';
import type { PreferenceSaveStatus } from './game-settings';
import {
  getPreferenceStorage,
  loadGamePreferences,
  saveGamePreferences,
  type GamePreferences,
} from '@/lib/ui/game-preferences';
import { loadAutoSave } from '@/lib/ui/game-save';
import {
  activeModeKey,
  survivalDraft,
  startSurvivalClient,
  type SurvivalClientSession,
} from '@/lib/ui/survival-client';
import {
  loadSurvivalCheckpoint,
  survivalSaveKey,
  type SurvivalSaveDocument,
  type SurvivalReplayDocument,
} from '@/lib/ui/survival-persistence';
import { withSurvivalBuild } from '@/lib/game/survival-session';
import { readBuildVersion } from '@/lib/ui/game-version';
import { type PlayerProfile } from '@/lib/ui/player-profile';
import type { ReplayDocument } from '@/lib/ui/game-replay';
import type { ModeDataCandidate } from '@/lib/ui/mode-data';
import {
  defaultSurvivalDifficulty,
  type SurvivalDifficulty,
} from '@/lib/game/survival-difficulty';
import { restoreSurvivalBackupProgress } from '@/lib/ui/survival-restore';
import { SessionContext, type SessionTools } from './session-context';
import { ProgressNavigationContext } from './progress-navigation';
import { ProgressCenter, type ProgressSelection } from './progress-center';
import type { RoomUtilityPanel } from './room-utilities';
import { useReplayArchive } from './use-replay-archive';
import { restoreClassicBackupProgress } from '@/lib/ui/backup-restore';

export function GameApp() {
  const [initial] = useState(() => {
    const storage = getPreferenceStorage();
    const survival = loadSurvivalCheckpoint(storage);
    let marker: string | null = null;
    try {
      marker = storage?.getItem(activeModeKey) ?? null;
    } catch {
      /* unavailable storage */
    }
    const screen: 'menu' | 'classic' | 'survival' =
      marker === 'survival' && survival.document
        ? 'survival'
        : marker === 'classic'
          ? 'classic'
          : !marker && loadAutoSave(storage).session
            ? 'classic'
            : 'menu';
    return { survival, screen };
  });
  const [screen, setScreen] = useState(initial.screen);
  const [progressOpen, setProgressOpen] = useState(false);
  const [progressOrigin, setProgressOrigin] = useState(initial.screen);
  const [progressSelection, setProgressSelection] =
    useState<ProgressSelection>();
  const [replayReturnToProgress, setReplayReturnToProgress] = useState(false);
  const [pendingPage, setPendingPage] = useState<
    RoomUtilityPanel | null | undefined
  >();
  const [classicTools, setClassicTools] = useState<SessionTools | null>(null);
  const [survivalStatus, setSurvivalStatus] = useState('');
  const [replayOrigin, setReplayOrigin] = useState<
    'menu' | 'classic' | 'survival' | 'progress'
  >('survival');
  const [survivalRevision, setSurvivalRevision] = useState(0);
  const [selectedDifficulty, setSelectedDifficulty] =
    useState<SurvivalDifficulty>(() =>
      initial.survival.document
        ? (initial.survival.document.game.aiDifficulty ?? 'highest')
        : defaultSurvivalDifficulty,
    );
  const [survival, setSurvival] = useState<SurvivalClientSession | null>(() =>
    initial.survival.document
      ? {
          game: withSurvivalBuild(
            initial.survival.document.game,
            readBuildVersion(),
          ),
          draft:
            initial.survival.document.draft ??
            survivalDraft(initial.survival.document.game),
        }
      : null,
  );
  const [survivalMessage, setSurvivalMessage] = useState(
    initial.survival.message,
  );
  const [importedSurvival, setImportedSurvival] =
    useState<SurvivalReplayDocument | null>(null);
  const [classicIncoming, setClassicIncoming] =
    useState<ClassicGameAppProps['incoming']>();
  const [classicReplay, setClassicReplay] = useState<ReplayDocument | null>(
    null,
  );
  const archiveStatus = useReplayArchive(classicTools?.session, survival?.game);
  const [preferences, setPreferences] = useState(() =>
    loadGamePreferences(getPreferenceStorage()),
  );
  const [status, setStatus] = useState<PreferenceSaveStatus>('unchanged');
  const select = useCallback((mode: 'classic' | 'survival') => {
    setScreen(mode);
    setProgressOpen(false);
    setReplayReturnToProgress(false);
    setPendingPage(null);
    try {
      getPreferenceStorage()?.setItem(activeModeKey, mode);
    } catch {
      /* in-memory session remains usable */
    }
  }, []);
  const activateClassic = useCallback(() => select('classic'), [select]);
  const returnMenu = useCallback(() => setScreen('menu'), []);
  const changePreferences = useCallback((next: GamePreferences) => {
    setPreferences(next);
    setStatus(
      saveGamePreferences(getPreferenceStorage(), next) ? 'saved' : 'session',
    );
  }, []);
  const restoreSurvival = useCallback(
    (
      doc: SurvivalSaveDocument,
      profile?: PlayerProfile,
      expectedProfileSource?: string | null,
    ) => {
      if (profile) {
        const storage = getPreferenceStorage();
        restoreSurvivalBackupProgress(
          storage,
          doc.game,
          doc.draft,
          profile,
          expectedProfileSource,
        );
      }
      setSelectedDifficulty(doc.game.aiDifficulty ?? 'highest');
      setSurvivalRevision((value) => value + 1);
      setSurvival({
        game: withSurvivalBuild(doc.game, readBuildVersion()),
        draft: doc.draft ?? survivalDraft(doc.game),
      });
      setImportedSurvival(null);
      setSurvivalMessage('已载入生存对局。经典存档保留。');
      select('survival');
    },
    [select],
  );
  const replaySurvival = useCallback(
    (doc: SurvivalReplayDocument | null) => {
      if (doc && (!importedSurvival || screen !== 'survival'))
        setReplayOrigin(progressOpen ? 'progress' : screen);
      setImportedSurvival(doc);
      if (doc) {
        setScreen('survival');
        setProgressOpen(false);
      }
    },
    [importedSurvival, screen, progressOpen],
  );
  function returnReplay() {
    if (replayOrigin === 'progress') {
      setScreen(progressOrigin);
      setProgressOpen(true);
    } else setScreen(replayOrigin);
  }
  function replayClassic(doc: ReplayDocument) {
    if (progressOpen && classicTools) {
      classicTools.onReplayImport(doc);
      currentClassicReplay(false);
      return;
    }
    setReplayOrigin(progressOpen ? 'progress' : screen);
    setClassicReplay(doc);
    setScreen('classic');
    setProgressOpen(false);
  }
  function currentClassicReplay(current = true) {
    if (current) classicTools?.onReplaySourceChange('current');
    setScreen('classic');
    setProgressOpen(false);
    setReplayReturnToProgress(true);
    setPendingPage('replay');
  }
  function openProgress() {
    if (replayReturnToProgress) {
      setScreen(progressOrigin);
      setReplayReturnToProgress(false);
    } else if (!progressOpen) setProgressOrigin(screen);
    setProgressOpen(true);
  }
  function importCandidate(
    candidate: ModeDataCandidate,
    restoreProfile: boolean,
    expectedProfileSource?: string | null,
  ) {
    if (candidate.kind === 'survival-replay') {
      replaySurvival(candidate.document);
      return;
    }
    if (candidate.kind === 'survival-checkpoint') {
      restoreSurvival(candidate.document);
      return;
    }
    if (candidate.kind === 'survival-backup') {
      restoreSurvival(
        candidate.document.checkpoint,
        restoreProfile ? candidate.document.profile : undefined,
        expectedProfileSource,
      );
      return;
    }
    if (candidate.kind === 'replay') {
      replayClassic(candidate.document);
      return;
    }
    if (restoreProfile && candidate.document.profile) {
      restoreClassicBackupProgress(
        getPreferenceStorage(),
        candidate.document.session,
        candidate.document.profile,
        expectedProfileSource,
      );
    }
    setClassicReplay(null);
    setClassicIncoming({
      session: candidate.document.session,
      revision: Date.now(),
    });
    select('classic');
  }
  const menu = (
    <GameModeMenu
      onClassic={() => {
        setClassicReplay(null);
        select('classic');
      }}
      onSurvival={() => {
        setImportedSurvival(null);
        select('survival');
      }}
      hasSurvival={!!survival}
      survivalNotice={survivalMessage}
      preferences={preferences}
      status={status}
      onPreferencesChange={changePreferences}
    />
  );
  return (
    <ProgressNavigationContext.Provider
      value={{
        openProgress,
        replayReturnToProgress,
        pendingPage,
        consumePage: () => setPendingPage(undefined),
      }}
    >
      <ClassicGameApp
        inactive={screen === 'survival' || progressOpen}
        onToolsChange={setClassicTools}
        menu={screen === 'menu'}
        menuContent={menu}
        onReturnMenu={returnMenu}
        onActivateClassic={activateClassic}
        onSurvivalRestore={restoreSurvival}
        onSurvivalReplayImport={replaySurvival}
        incoming={classicIncoming}
        externalReplay={classicReplay}
        onCloseExternalReplay={() => {
          setClassicReplay(null);
          returnReplay();
        }}
        externalReplayReturnLabel={
          replayOrigin === 'progress'
            ? '返回进度'
            : replayOrigin === 'survival'
              ? '返回生存对局'
              : '返回经典对局'
        }
        preferences={preferences}
        preferenceStatus={status}
        onSharedPreferencesChange={changePreferences}
      />
      <SurvivalGameApp
        selectedDifficulty={selectedDifficulty}
        onDifficultyChange={setSelectedDifficulty}
        key={`${survival?.game.seed ?? 'selection'}:${survivalRevision}`}
        inactive={screen !== 'survival' || progressOpen}
        onSaveStatusChange={setSurvivalStatus}
        session={survival}
        setSession={setSurvival}
        onStart={(character) => {
          setSurvival(
            startSurvivalClient(character, undefined, selectedDifficulty),
          );
          setImportedSurvival(null);
          setSurvivalMessage('');
          select('survival');
        }}
        onNew={() => {
          try {
            getPreferenceStorage()?.removeItem(survivalSaveKey);
          } catch {
            setSurvivalMessage(
              '无法清除旧生存检查点，未放弃当前局。请先导出存档，再重试。',
            );
            return;
          }
          setSurvival(null);
          setImportedSurvival(null);
          setSurvivalMessage('');
          select('survival');
        }}
        onReturnMenu={returnMenu}
        preferences={preferences}
        status={status}
        onPreferencesChange={changePreferences}
        imported={importedSurvival}
        onReplay={replaySurvival}
        onReturnImported={() => {
          setImportedSurvival(null);
          returnReplay();
        }}
        importedReturnLabel={
          replayOrigin === 'progress'
            ? '返回进度'
            : replayOrigin === 'classic'
              ? '返回经典对局'
              : '返回生存对局'
        }
        onImport={importCandidate}
        restoreMessage={survivalMessage}
      />
      {progressOpen && classicTools && (
        <SessionContext.Provider value={classicTools}>
          <ProgressCenter
            initialSelection={progressSelection}
            onSelectionChange={setProgressSelection}
            onCurrentClassicReplay={currentClassicReplay}
            survival={survival}
            survivalStatus={survivalStatus}
            archiveStatus={archiveStatus}
            origin={progressOrigin}
            onNavigate={(page) => {
              setPendingPage(page);
              setProgressOpen(false);
            }}
            onClassic={() => select('classic')}
            onSurvival={() => select('survival')}
            onClassicReplay={replayClassic}
            onSurvivalReplay={replaySurvival}
            onImport={importCandidate}
          />
        </SessionContext.Provider>
      )}
    </ProgressNavigationContext.Provider>
  );
}
