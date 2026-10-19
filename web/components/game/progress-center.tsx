import { SurvivalRecordCard } from './survival-record-card';
import { BackupLibrarySection } from './backup-library-section';
import { ProgressOverview } from './progress-overview';
import { CompletionHistoryPanel } from './completion-history-panel';
import { AchievementProgress } from './achievement-progress';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { GameHeader } from './game-header';
import { UtilityPageHeading } from './utility-page-heading';
import { GameNavigation } from './game-navigation';
import { useSessionTools } from './session-context';
import { useDataManagement } from './use-data-management';
import { DataManagement, dataTaskTitle } from './data-management';
import { SurvivalDataManagement } from './survival-data-management';
import { loadPlayerProfile } from '@/lib/ui/game-save';
import { getPreferenceStorage } from '@/lib/ui/game-preferences';
import type { SurvivalClientSession } from '@/lib/ui/survival-client';
import type { ReplayDocument } from '@/lib/ui/game-replay';
import {
  parseSurvivalReplay,
  survivalLastCompletedKey,
  type SurvivalReplayDocument,
} from '@/lib/ui/survival-persistence';
import { createSurvivalReplay } from '@/lib/ui/survival-record';
import type { ModeDataCandidate } from '@/lib/ui/mode-data';
import type { RoomUtilityPanel } from './room-utilities';
import { StorageDiagnostics } from './storage-diagnostics';
import {
  ReplayLibraryPanel,
  type LibraryFilters,
} from './replay-library-panel';
import { newLibraryDocument } from '@/lib/ui/replay-library';
import { lastCompletedKey } from '@/lib/ui/game-save';
import { parseReplay } from '@/lib/ui/game-replay';
import { PlayerProfileManagement } from './player-profile-management';
import { subscribePlayerProfileChanges } from '@/lib/ui/profile-events';
import { PlayerStatistics, type StatisticsFilters } from './player-statistics';
export { progressChangedEvent } from '@/lib/ui/profile-events';

type ProgressTab =
  | 'overview'
  | 'records'
  | 'statistics'
  | 'achievements'
  | 'files';
export interface ProgressSelection {
  tab: ProgressTab;
  mode: 'classic' | 'survival';
  libraryFilters?: Partial<Record<'classic' | 'survival', LibraryFilters>>;
  statisticsFilters?: Partial<
    Record<'classic' | 'survival', StatisticsFilters>
  >;
  recordSources?: Partial<
    Record<'classic' | 'survival', 'replays' | 'results'>
  >;
}
function recentSurvival() {
  try {
    const source = getPreferenceStorage()?.getItem(survivalLastCompletedKey);
    const document = source ? parseSurvivalReplay(source) : null;
    if (document && !document.replay.final)
      throw new Error('最近生存记录未完成。');
    return { document, message: '' };
  } catch (error) {
    return {
      document: null,
      message:
        error instanceof Error
          ? error.message
          : '最近生存回放未能读取，原记录保留。',
    };
  }
}
function recentClassicReplay() {
  try {
    const source = getPreferenceStorage()?.getItem(lastCompletedKey);
    return source ? parseReplay(source) : null;
  } catch {
    return null;
  }
}
export function ProgressCenter({
  initialSelection,
  onSelectionChange,
  onCurrentClassicReplay,
  survival,
  survivalStatus,
  archiveStatus,
  origin,
  onNavigate,
  onClassic,
  onSurvival,
  onClassicReplay,
  onSurvivalReplay,
  onImport,
}: {
  initialSelection?: ProgressSelection;
  onSelectionChange: (selection: ProgressSelection) => void;
  onCurrentClassicReplay: () => void;
  survival: SurvivalClientSession | null;
  survivalStatus: string;
  archiveStatus: { classic: string; survival: string };
  origin: 'menu' | 'classic' | 'survival';
  onNavigate: (page: RoomUtilityPanel | null) => void;
  onClassic: () => void;
  onSurvival: () => void;
  onClassicReplay: (document: ReplayDocument) => void;
  onSurvivalReplay: (document: SurvivalReplayDocument) => void;
  onImport: (
    candidate: ModeDataCandidate,
    profile: boolean,
    expectedProfileSource?: string | null,
    signal?: AbortSignal,
  ) => void | Promise<void>;
}) {
  const tools = useSessionTools()!;
  const [tab, setTab] = useState<ProgressTab>(
    initialSelection?.tab ?? 'overview',
  );
  const [mode, setMode] = useState<'classic' | 'survival'>(
    () =>
      initialSelection?.mode ??
      (origin === 'survival' ||
      (origin === 'menu' &&
        survival &&
        tools.session.game.phase === 'character_selection')
        ? 'survival'
        : 'classic'),
  );
  const [libraryFilters, setLibraryFilters] = useState(
    initialSelection?.libraryFilters ?? {},
  );
  const [statisticsFilters, setStatisticsFilters] = useState(
    initialSelection?.statisticsFilters ?? {},
  );
  const [recordSources, setRecordSources] = useState(
    initialSelection?.recordSources ?? {},
  );
  const recordSource = recordSources[mode] ?? 'replays';
  const recordFilters = libraryFilters[mode] ?? {
    role: 'all',
    difficulty: 'all',
    completion: 'all',
  };
  const [profile, setProfile] = useState(() =>
    loadPlayerProfile(getPreferenceStorage()),
  );
  const [recent, setRecent] = useState(recentSurvival);
  const [recentClassic, setRecentClassic] = useState(recentClassicReplay);
  const data = useDataManagement(onClassic, onClassic, {
    onImport,
    onReplay: onClassicReplay,
    onCurrentReplay: onCurrentClassicReplay,
    profile,
  });
  const survivalGame = survival?.game;
  useEffect(() => {
    onSelectionChange({
      tab,
      mode,
      libraryFilters,
      statisticsFilters,
      recordSources,
    });
  }, [
    tab,
    mode,
    libraryFilters,
    statisticsFilters,
    recordSources,
    onSelectionChange,
  ]);
  const survivalLog = useMemo(
    () => (survivalGame ? createSurvivalReplay(survivalGame) : null),
    [survivalGame],
  );
  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      queueMicrotask(() => {
        if (cancelled) return;
        setProfile(loadPlayerProfile(getPreferenceStorage()));
        setRecent(recentSurvival());
        setRecentClassic(recentClassicReplay());
      });
    refresh();
    const unsubscribe = subscribePlayerProfileChanges(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [tools.profile, survival?.game.phase]);
  useEffect(() => {
    document.getElementById('progress-title')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [tab, mode, data.task]);
  const { task, cancel } = data;
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (task !== 'settings') {
        event.stopImmediatePropagation();
        cancel();
      } else onNavigate(null);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [task, cancel, onNavigate]);
  function chooseTab(next: ProgressTab) {
    data.cancel();
    setTab(next);
  }
  function chooseMode(next: 'classic' | 'survival') {
    data.cancel();
    setMode(next);
  }
  return (
    <main className="ranking-page progress-page">
      <GameHeader
        navigation={
          <GameNavigation page="progress" onPageChange={onNavigate} />
        }
      />
      <section
        className="ranking-stage game-tools-stage progress-stage"
        aria-labelledby="progress-title"
      >
        <UtilityPageHeading
          inlineDescription
          eyebrow="PLAYER PROGRESS"
          title={data.task === 'settings' ? '进度' : dataTaskTitle(data)}
          titleId="progress-title"
          description="对局与玩家档案分别保存 · 回放只读"
        >
          <Button
            variant="secondary"
            onClick={() =>
              data.task !== 'settings' ? data.cancel() : onNavigate(null)
            }
          >
            <ArrowLeft aria-hidden="true" />
            {data.task !== 'settings'
              ? '返回进度'
              : origin === 'menu'
                ? '返回主菜单'
                : '返回游戏'}
          </Button>
        </UtilityPageHeading>
        <nav className="progress-tabs" aria-label="进度分类">
          {(
            [
              ['overview', '总览'],
              ['records', '对局记录'],
              ['statistics', '统计'],
              ['achievements', '成就'],
              ['files', '存档与备份'],
            ] as const
          ).map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={tab === key ? 'progress-tab-active' : ''}
              aria-current={tab === key ? 'page' : undefined}
              onClick={() => chooseTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        {tab === 'overview' ? (
          <ProgressOverview
            classic={tools.session}
            survival={survival}
            profile={profile.profile}
            profileMessage={profile.message}
            classicSaveMessage={
              tools.restoreMessage ||
              (tools.autoSaveStatus === 'saved'
                ? '当前对局已自动保存'
                : tools.autoSaveStatus === 'session'
                  ? '自动保存未完成，可导出文件保留进度。'
                  : '暂无需要保存的对局')
            }
            survivalSaveMessage={
              (!survivalGame && survivalStatus === '生存进度待保存。'
                ? ''
                : survivalStatus) ||
              (survivalGame ? '当前对局保留在会话中' : '暂无需要保存的对局')
            }
            decimals={tools.preferences.scoreDecimals}
            onClassic={onClassic}
            onSurvival={onSurvival}
            onOpen={(next, nextMode) => {
              if (nextMode) setMode(nextMode);
              chooseTab(next);
            }}
          />
        ) : tab === 'achievements' ? (
          <AchievementProgress
            profile={profile.profile}
            message={profile.message}
          />
        ) : (
          <>
            <div className="progress-mode-tabs" aria-label="记录与存档模式">
              <Button
                variant={mode === 'classic' ? 'default' : 'secondary'}
                onClick={() => chooseMode('classic')}
              >
                经典
              </Button>
              <Button
                variant={mode === 'survival' ? 'default' : 'secondary'}
                onClick={() => chooseMode('survival')}
              >
                生存
              </Button>
            </div>
            {tab === 'files' ? (
              <section className="files-dashboard" aria-label="存档与备份管理">
                <div className="backup-page-heading">
                  <div>
                    <p className="eyebrow">SAVES &amp; BACKUPS</p>
                    <h3>存档与备份</h3>
                  </div>
                  <span>对局按模式保存 · 档案与回放库两模式共用</span>
                </div>
                <div className="backup-page-note">
                  读取文件先预览，确认后才写入；续玩存档、玩家档案与整库备份保存不同内容。
                </div>
                <div className="backup-files-grid">
                  <div
                    className={`progress-data-content ${data.task !== 'settings' ? 'backup-task-active' : ''}`}
                  >
                    {mode === 'classic' ? (
                      <DataManagement data={data} />
                    ) : (
                      <SurvivalDataManagement
                        recentOverride={{
                          doc: recent.document,
                          error: recent.message,
                        }}
                        session={survival}
                        saveStatus={survivalStatus}
                        imported={null}
                        onImport={onImport}
                        onReplay={onSurvivalReplay}
                      />
                    )}
                  </div>
                  {(mode === 'survival' || data.task === 'settings') && (
                    <PlayerProfileManagement key={mode} />
                  )}
                </div>
                {(mode === 'survival' || data.task === 'settings') && (
                  <BackupLibrarySection
                    key={mode}
                    onRecords={() => chooseTab('records')}
                  />
                )}
                <StorageDiagnostics />
              </section>
            ) : tab === 'statistics' ? (
              <PlayerStatistics
                key={mode}
                profile={profile.profile}
                message={profile.message}
                mode={mode}
                decimals={tools.preferences.scoreDecimals}
                initialFilters={statisticsFilters[mode]}
                onFiltersChange={(filters) =>
                  setStatisticsFilters((old) => ({ ...old, [mode]: filters }))
                }
              />
            ) : (
              <section className="progress-records" aria-label="对局记录列表">
                {mode === 'classic' ? (
                  <DataManagement data={data} scope="records" />
                ) : (
                  <SurvivalRecordCard
                    log={survivalLog}
                    recent={recent.document}
                    error={recent.message}
                    saveStatus={survivalStatus}
                    onReplay={onSurvivalReplay}
                    onReturnGame={onSurvival}
                  />
                )}
                <nav className="records-sources" aria-label="记录来源">
                  <button
                    type="button"
                    aria-label="完整回放"
                    aria-pressed={recordSource === 'replays'}
                    onClick={() =>
                      setRecordSources((old) => ({ ...old, [mode]: 'replays' }))
                    }
                  >
                    完整回放 <span>过程与逐房复盘</span>
                  </button>
                  <button
                    type="button"
                    aria-label="完成结果"
                    aria-pressed={recordSource === 'results'}
                    onClick={() =>
                      setRecordSources((old) => ({ ...old, [mode]: 'results' }))
                    }
                  >
                    完成结果 <span>档案中保留的最终成绩</span>
                  </button>
                </nav>
                <div
                  className="records-source-panel"
                  hidden={recordSource !== 'results'}
                  inert={recordSource !== 'results'}
                >
                  <CompletionHistoryPanel
                    profile={profile.profile}
                    message={profile.message}
                    mode={mode}
                    filters={recordFilters}
                    decimals={tools.preferences.scoreDecimals}
                    onFiltersChange={(filters) =>
                      setLibraryFilters((old) => ({ ...old, [mode]: filters }))
                    }
                  />
                </div>
                <div
                  className="records-source-panel"
                  hidden={recordSource !== 'replays'}
                  inert={recordSource !== 'replays'}
                >
                  {recordSource === 'replays' && (
                    <ReplayLibraryPanel
                      presentation="records"
                      filters={recordFilters}
                      key={mode}
                      mode={mode}
                      current={
                        mode === 'classic'
                          ? tools.session.replay
                            ? newLibraryDocument({
                                mode: 'classic',
                                replay: tools.session.replay,
                              })
                            : null
                          : survivalLog
                            ? newLibraryDocument({
                                mode: 'survival',
                                replay: survivalLog,
                              })
                            : null
                      }
                      recent={
                        mode === 'classic' ? recentClassic : recent.document
                      }
                      archiveStatus={archiveStatus[mode]}
                      scoreDecimals={tools.preferences.scoreDecimals}
                      initialFilters={libraryFilters[mode]}
                      onFiltersChange={(filters) =>
                        setLibraryFilters((old) => ({
                          ...old,
                          [mode]: filters,
                        }))
                      }
                      onReplay={(doc) =>
                        doc.mode === 'classic'
                          ? onClassicReplay(doc)
                          : onSurvivalReplay(doc)
                      }
                    />
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </section>
    </main>
  );
}
