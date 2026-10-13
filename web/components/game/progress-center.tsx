import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { GameNavigation } from './game-navigation';
import { useSessionTools } from './session-context';
import { useDataManagement } from './use-data-management';
import { DataManagement, dataTaskTitle } from './data-management';
import { SurvivalDataManagement } from './survival-data-management';
import { characterNames } from '@/lib/game';
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
import { readBuildVersion } from '@/lib/ui/game-version';
import { survivalDifficultyLabel } from '@/lib/game/survival-difficulty';
import type { ModeDataCandidate } from '@/lib/ui/mode-data';
import type { RoomUtilityPanel } from './room-utilities';

type ProgressTab = 'overview' | 'records' | 'files';
export interface ProgressSelection {
  tab: ProgressTab;
  mode: 'classic' | 'survival';
}
export const progressChangedEvent = 'bidding-progress-changed';
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
export function ProgressCenter({
  initialSelection,
  onSelectionChange,
  onCurrentClassicReplay,
  survival,
  survivalStatus,
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
  origin: 'menu' | 'classic' | 'survival';
  onNavigate: (page: RoomUtilityPanel | null) => void;
  onClassic: () => void;
  onSurvival: () => void;
  onClassicReplay: (document: ReplayDocument) => void;
  onSurvivalReplay: (document: SurvivalReplayDocument) => void;
  onImport: (candidate: ModeDataCandidate, profile: boolean) => void;
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
  const [profile, setProfile] = useState(() =>
    loadPlayerProfile(getPreferenceStorage()),
  );
  const [recent, setRecent] = useState(recentSurvival);
  const data = useDataManagement(onClassic, onClassic, {
    onImport,
    onReplay: onClassicReplay,
    onCurrentReplay: onCurrentClassicReplay,
    profile,
  });
  const survivalGame = survival?.game;
  useEffect(() => {
    onSelectionChange({ tab, mode });
  }, [tab, mode, onSelectionChange]);
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
      });
    refresh();
    window.addEventListener(progressChangedEvent, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(progressChangedEvent, refresh);
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
  const classic = tools.session.game;
  const classicActive = classic.phase !== 'character_selection';
  const aiRunning =
    !!survivalGame &&
    !survivalGame.activePlayerIds.includes('human') &&
    survivalGame.phase !== 'competition_complete';
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
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-block">
            <p className="eyebrow">PLAYER PROGRESS</p>
            <h1>以撒的竞合 · 进度</h1>
          </div>
          <GameNavigation page="progress" onPageChange={onNavigate} />
          <Button
            variant="secondary"
            onClick={() =>
              data.task !== 'settings' ? data.cancel() : onNavigate(null)
            }
          >
            {data.task !== 'settings'
              ? '返回进度'
              : origin === 'menu'
                ? '返回主菜单'
                : '返回游戏'}
          </Button>
        </div>
      </header>
      <section className="progress-stage" aria-labelledby="progress-title">
        <div className="progress-heading">
          <div>
            <p className="eyebrow">YOUR JOURNEY</p>
            <h2 id="progress-title" tabIndex={-1}>
              {data.task === 'settings' ? '进度' : dataTaskTitle(data)}
            </h2>
          </div>
          <p>对局与玩家档案分别保存 · 回放只读</p>
        </div>
        <nav className="progress-tabs" aria-label="进度分类">
          {(
            [
              ['overview', '总览'],
              ['records', '对局记录'],
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
          <>
            <div className="progress-overview-cards">
              <article className="progress-match-card">
                <p className="eyebrow">CLASSIC</p>
                <h3>经典模式</h3>
                <strong>
                  {classicActive
                    ? `${characterNames[classic.selectedCharacter]} · ${classic.phase === 'game_result' ? '已结束' : '进行中'}`
                    : '尚未开始对局'}
                </strong>
                <p>
                  {classicActive
                    ? `第 ${classic.floorIndex + 1} 层 · 房间 ${classic.roomIndex + 1}/5 · 已结算 ${tools.session.replay?.rooms.length ?? 0}/15 房`
                    : '每种模式各保留一份自动续玩存档。'}
                </p>
                <small>
                  {tools.restoreMessage ||
                    (tools.autoSaveStatus === 'saved'
                      ? '当前对局已自动保存'
                      : tools.autoSaveStatus === 'session'
                        ? '自动保存未完成，可导出文件保留进度。'
                        : '暂无需要保存的对局')}
                </small>
                <Button onClick={onClassic}>
                  {classicActive
                    ? classic.phase === 'game_result'
                      ? '查看经典结果'
                      : '继续经典对局'
                    : '进入经典模式'}
                </Button>
              </article>
              <article className="progress-match-card">
                <p className="eyebrow">SURVIVAL</p>
                <h3>生存模式</h3>
                <strong>
                  {survivalGame
                    ? `${characterNames[survivalGame.selectedCharacter]} · ${survivalGame.phase === 'competition_complete' ? '已结束' : aiRunning ? 'AI续赛中' : '进行中'}`
                    : '尚未开始对局'}
                </strong>
                <p>
                  {survivalGame
                    ? `第 ${survivalGame.floorIndex + 1} 层 · 房间 ${survivalGame.roomIndex + 1}/5 · ${survivalGame.activePlayerIds.length} 人存活 · ${survivalDifficultyLabel(survivalGame.aiDifficulty)}`
                    : '逐层淘汰，真人出局后由AI完成整局。'}
                </p>
                <small>
                  {survivalStatus ||
                    (survivalGame
                      ? '当前对局保留在会话中'
                      : '暂无需要保存的对局')}
                </small>
                <Button onClick={onSurvival}>
                  {survivalGame
                    ? survivalGame.phase === 'competition_complete'
                      ? '查看生存结果'
                      : '继续生存对局'
                    : '进入生存模式'}
                </Button>
              </article>
            </div>
            <section className="settings-group progress-profile">
              <h3>玩家档案</h3>
              <p>
                已保留 {profile.profile.history.length}{' '}
                条完成记录，最多保留最近200条。这不是完整回放库。
              </p>
              {profile.message && (
                <output className="save-message">{profile.message}</output>
              )}
              <p className="utility-notice">
                成就与角色解锁将在规则确定、功能实现后开放，当前不发放成就或限制角色。
              </p>
            </section>
          </>
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
              <>
                <p className="progress-intro">
                  续玩保留当前位置与草稿；回放保留过程；完整备份包含玩家档案。导入先预览，确认后才载入。
                </p>
                <div className="progress-data-content">
                  {mode === 'classic' ? (
                    <DataManagement data={data} />
                  ) : (
                    <SurvivalDataManagement
                      recentOverride={{
                        doc: recent.document,
                        error: recent.message,
                      }}
                      session={survival}
                      imported={null}
                      onImport={onImport}
                      onReplay={onSurvivalReplay}
                    />
                  )}
                </div>
              </>
            ) : (
              <>
                {mode === 'classic' ? (
                  <DataManagement data={data} scope="records" />
                ) : (
                  <section className="settings-group progress-replays">
                    <h3>生存对局与回放</h3>
                    {survivalLog?.rooms.length ? (
                      <div className="data-record-row">
                        <div className="data-record-info">
                          <strong>
                            本局 · {characterNames[survivalLog.characterId]}
                          </strong>
                          <small>
                            已结算 {survivalLog.rooms.length} 房 ·{' '}
                            {survivalLog.final ? '已结束' : '进行中'}
                          </small>
                        </div>
                        <Button
                          onClick={() =>
                            onSurvivalReplay({
                              format: 'the-bidding-of-isaac-replay',
                              version: 4,
                              mode: 'survival',
                              exportedAt: new Date().toISOString(),
                              exportedBuild: readBuildVersion(),
                              replay: survivalLog,
                            })
                          }
                        >
                          查看本局生存回放
                        </Button>
                      </div>
                    ) : (
                      <p>本局尚无已结算房间。</p>
                    )}
                    {recent.document &&
                      (recent.document.replay.id !== survivalLog?.id ||
                        recent.document.replay.rooms.length !==
                          survivalLog?.rooms.length ||
                        !!recent.document.replay.final !==
                          !!survivalLog?.final) && (
                        <div className="data-record-row">
                          <div className="data-record-info">
                            <strong>
                              最近完成 ·{' '}
                              {
                                characterNames[
                                  recent.document.replay.characterId
                                ]
                              }
                            </strong>
                            <small>
                              {recent.document.replay.rooms.length} 房 ·
                              只读查看
                            </small>
                          </div>
                          <Button
                            variant="secondary"
                            onClick={() => onSurvivalReplay(recent.document!)}
                          >
                            查看最近完成的生存回放
                          </Button>
                        </div>
                      )}
                    {recent.message && (
                      <output className="save-message">{recent.message}</output>
                    )}
                    {survivalStatus && (
                      <output className="save-message">{survivalStatus}</output>
                    )}
                  </section>
                )}
                <section className="settings-group">
                  <h3>已登记的完成记录</h3>
                  <p>这里只记录结果，不承诺每条记录都保留完整回放。</p>
                  <div className="progress-history-wrap">
                    <table className="survival-table">
                      <caption className="sr-only">玩家完成记录</caption>
                      <thead>
                        <tr>
                          <th>模式</th>
                          <th>角色</th>
                          <th>难度</th>
                          <th>结果</th>
                          <th>名次</th>
                          <th>累计分数</th>
                          <th>完成时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profile.profile.history
                          .filter((row) => (row.mode ?? 'classic') === mode)
                          .slice()
                          .reverse()
                          .map((row) => (
                            <tr key={row.key}>
                              <td>{mode === 'classic' ? '经典' : '生存'}</td>
                              <td>{characterNames[row.characterId]}</td>
                              <td>
                                {mode === 'survival'
                                  ? survivalDifficultyLabel(row.aiDifficulty)
                                  : '—'}
                              </td>
                              <td>
                                {mode === 'classic'
                                  ? '已完成'
                                  : row.status === 'survived'
                                    ? '存活'
                                    : row.eliminationFloorIndex != null
                                      ? `第${row.eliminationFloorIndex + 1}层淘汰`
                                      : '已完成'}
                              </td>
                              <td>{row.rank}</td>
                              <td>
                                {row.finalScore.toFixed(
                                  tools.preferences.scoreDecimals,
                                )}
                              </td>
                              <td>
                                {new Date(row.completedAt).toLocaleString(
                                  'zh-CN',
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  {!profile.profile.history.some(
                    (row) => (row.mode ?? 'classic') === mode,
                  ) && <p className="utility-notice">暂无此模式的完成记录。</p>}
                  {profile.message && (
                    <output className="save-message">{profile.message}</output>
                  )}
                </section>
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}
