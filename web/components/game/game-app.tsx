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
import {
  playerProfileKey,
  readPlayerProfile,
  type PlayerProfile,
} from '@/lib/ui/player-profile';
import type { ReplayDocument } from '@/lib/ui/game-replay';
import type { ModeDataCandidate } from '@/lib/ui/mode-data';
import {
  defaultSurvivalDifficulty,
  type SurvivalDifficulty,
} from '@/lib/game/survival-difficulty';

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
  const [preferences, setPreferences] = useState(() =>
    loadGamePreferences(getPreferenceStorage()),
  );
  const [status, setStatus] = useState<PreferenceSaveStatus>('unchanged');
  const select = useCallback((mode: 'classic' | 'survival') => {
    setScreen(mode);
    try {
      getPreferenceStorage()?.setItem(activeModeKey, mode);
    } catch {
      /* in-memory session remains usable */
    }
  }, []);
  const activateClassic = useCallback(() => select('classic'), [select]);
  function changePreferences(next: GamePreferences) {
    setPreferences(next);
    setStatus(
      saveGamePreferences(getPreferenceStorage(), next) ? 'saved' : 'session',
    );
  }
  function restoreSurvival(doc: SurvivalSaveDocument, profile?: PlayerProfile) {
    if (profile) {
      const validated = readPlayerProfile(profile);
      const storage = getPreferenceStorage();
      if (!storage) throw new Error('存储不可用，未覆盖玩家进度。');
      storage.setItem(playerProfileKey, JSON.stringify(validated));
    }
    setSelectedDifficulty(doc.game.aiDifficulty ?? 'highest');
    setSurvival({
      game: withSurvivalBuild(doc.game, readBuildVersion()),
      draft: doc.draft ?? survivalDraft(doc.game),
    });
    setImportedSurvival(null);
    setSurvivalMessage('已载入生存对局。经典存档保留。');
    select('survival');
  }
  function replaySurvival(doc: SurvivalReplayDocument | null) {
    setImportedSurvival(doc);
    if (doc) setScreen('survival');
  }
  function importCandidate(
    candidate: ModeDataCandidate,
    restoreProfile: boolean,
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
      );
      return;
    }
    if (candidate.kind === 'replay') {
      setClassicReplay(candidate.document);
      setScreen('classic');
      return;
    }
    if (restoreProfile && candidate.document.profile) {
      const profile = readPlayerProfile(candidate.document.profile);
      const storage = getPreferenceStorage();
      if (!storage) throw new Error('存储不可用，未覆盖玩家进度。');
      storage.setItem(playerProfileKey, JSON.stringify(profile));
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
    <>
      <ClassicGameApp
        inactive={screen === 'survival'}
        menu={screen === 'menu'}
        menuContent={menu}
        onReturnMenu={() => setScreen('menu')}
        onActivateClassic={activateClassic}
        onSurvivalRestore={restoreSurvival}
        onSurvivalReplayImport={replaySurvival}
        incoming={classicIncoming}
        externalReplay={classicReplay}
        onCloseExternalReplay={() => setClassicReplay(null)}
        preferences={preferences}
        preferenceStatus={status}
        onSharedPreferencesChange={changePreferences}
      />
      <SurvivalGameApp
        selectedDifficulty={selectedDifficulty}
        onDifficultyChange={setSelectedDifficulty}
        key={survival?.game.seed ?? 'selection'}
        inactive={screen !== 'survival'}
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
            /* only current session cleared */
          }
          setSurvival(null);
          setImportedSurvival(null);
          setSurvivalMessage('');
          select('survival');
        }}
        onReturnMenu={() => setScreen('menu')}
        preferences={preferences}
        status={status}
        onPreferencesChange={changePreferences}
        imported={importedSurvival}
        onReplay={replaySurvival}
        onImport={importCandidate}
        restoreMessage={survivalMessage}
      />
    </>
  );
}
