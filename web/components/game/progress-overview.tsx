import { useMemo } from 'react';
import { ArrowRight, Clock3, ShieldCheck, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { characterNames } from '@/lib/game';
import { classicDifficultyLabel } from '@/lib/game/classic-difficulty';
import { survivalDifficultyLabel } from '@/lib/game/survival-difficulty';
import type { GameSession } from '@/lib/ui/game-session';
import type { SurvivalClientSession } from '@/lib/ui/survival-client';
import type { PlayerProfile } from '@/lib/ui/player-profile';
import {
  overviewMatches,
  overviewProfile,
  type OverviewMode,
  type OverviewMatch,
} from '@/lib/ui/progress-overview';
import { CharacterArt } from './character-art';

const modeName = (mode: OverviewMode) => (mode === 'classic' ? '经典' : '生存');
const formatMetric = (
  metric: OverviewMatch['metrics'][number],
  decimals: 2 | 4,
) =>
  metric.value === null
    ? '—'
    : metric.kind === 'rank'
      ? `#${metric.value}`
      : metric.kind === 'score'
        ? metric.value.toFixed(decimals)
        : metric.value;

export function ProgressOverview({
  classic,
  survival,
  profile,
  profileMessage,
  classicSaveMessage,
  survivalSaveMessage,
  decimals,
  onClassic,
  onSurvival,
  onOpen,
}: {
  classic: GameSession;
  survival: SurvivalClientSession | null;
  profile: PlayerProfile;
  profileMessage: string;
  classicSaveMessage: string;
  survivalSaveMessage: string;
  decimals: 2 | 4;
  onClassic: () => void;
  onSurvival: () => void;
  onOpen: (
    tab: 'records' | 'statistics' | 'files',
    mode?: OverviewMode,
  ) => void;
}) {
  const matches = useMemo(
    () => overviewMatches(classic, survival),
    [classic, survival],
  );
  const archive = useMemo(
    () => overviewProfile(profile, profileMessage),
    [profile, profileMessage],
  );
  return (
    <div className="progress-overview" data-overview>
      <header className="overview-section-heading">
        <div>
          <h3>对局与续玩</h3>
          <p>两种模式独立保存，随时接着上次的进度。</p>
        </div>
        <button
          type="button"
          className="overview-text-link"
          onClick={() => onOpen('files')}
        >
          管理存档 <ArrowRight size={14} aria-hidden="true" />
        </button>
      </header>
      <div className="overview-matches">
        {matches.map((match) => (
          <article
            className="overview-match"
            key={match.mode}
            data-overview-mode={match.mode}
            data-state={match.state}
          >
            <header>
              <div>
                <span className="eyebrow">
                  {match.mode === 'classic' ? 'CLASSIC' : 'SURVIVAL'}
                </span>
                <h4>{modeName(match.mode)}模式</h4>
              </div>
              <span className="overview-status">{match.status}</span>
            </header>
            <div className="overview-match-body">
              <div className="overview-character">
                {match.characterId ? (
                  <CharacterArt characterId={match.characterId} />
                ) : (
                  <span className="overview-character-empty" aria-hidden="true">
                    ?
                  </span>
                )}
              </div>
              <div className="overview-match-info">
                <div className="overview-role">
                  <strong>
                    {match.characterId
                      ? characterNames[match.characterId]
                      : '等待下一场竞合'}
                  </strong>
                  <span>{match.difficulty}</span>
                </div>
                <p className="overview-location">{match.location}</p>
                {match.metrics.length > 0 ? (
                  <dl className="overview-match-metrics">
                    {match.metrics.map((metric) => (
                      <div key={metric.label}>
                        <dt>{metric.label}</dt>
                        <dd data-overview-metric={metric.kind}>
                          {formatMetric(metric, decimals)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="overview-empty-detail">{match.detail}</p>
                )}
                {match.progress && (
                  <div className="overview-room-progress">
                    <span>{match.progress.label}</span>
                    <progress
                      max={match.progress.max}
                      value={match.progress.value}
                      aria-label={`${modeName(match.mode)}${match.progress.label}`}
                    />
                  </div>
                )}
                {match.metrics.length > 0 && !match.progress && (
                  <p className="overview-result-note">{match.detail}</p>
                )}
              </div>
            </div>
            <footer className="overview-match-footer">
              <p className="overview-save-message">
                {match.mode === 'classic'
                  ? classicSaveMessage
                  : survivalSaveMessage}
              </p>
              <Button
                onClick={match.mode === 'classic' ? onClassic : onSurvival}
              >
                {match.action}
                <ArrowRight size={15} aria-hidden="true" />
              </Button>
            </footer>
          </article>
        ))}
      </div>
      <div className="overview-bottom">
        <section
          className="overview-recent"
          aria-labelledby="overview-recent-title"
        >
          <header className="overview-panel-heading">
            <h3 id="overview-recent-title">
              <Clock3 size={17} aria-hidden="true" />
              最近结果
            </h3>
            <button
              type="button"
              className="overview-text-link"
              onClick={() => onOpen('records')}
            >
              全部记录 <ArrowRight size={14} aria-hidden="true" />
            </button>
          </header>
          {archive.error ? (
            <p className="overview-empty">记录暂不可核验，原档案保留。</p>
          ) : archive.recent.length ? (
            <ol className="overview-recent-list">
              {archive.recent.map((row) => {
                const mode = row.mode ?? 'classic';
                const verdict =
                  mode === 'classic'
                    ? '已完成'
                    : row.status === 'survived'
                      ? '存活'
                      : row.eliminationFloorIndex != null
                        ? `第${row.eliminationFloorIndex + 1}层淘汰`
                        : '已完成';
                return (
                  <li key={row.key} data-overview-result={row.key}>
                    <CharacterArt characterId={row.characterId} />
                    <div className="overview-recent-info">
                      <strong>
                        {characterNames[row.characterId]}
                        <span>{modeName(mode)}</span>
                      </strong>
                      <small>
                        {mode === 'classic'
                          ? classicDifficultyLabel(row.aiDifficulty)
                          : survivalDifficultyLabel(row.aiDifficulty)}{' '}
                        ·{' '}
                        <time
                          dateTime={row.completedAt}
                          title={new Date(row.completedAt).toLocaleString(
                            'zh-CN',
                          )}
                        >
                          {new Date(row.completedAt).toLocaleDateString(
                            'zh-CN',
                          )}
                        </time>
                      </small>
                    </div>
                    <div className="overview-recent-result">
                      <strong>
                        第 {row.rank} 名{' '}
                        <span data-verdict={row.status ?? 'complete'}>
                          {verdict}
                        </span>
                      </strong>
                      <small>{row.finalScore.toFixed(decimals)} 分</small>
                    </div>
                    <button
                      type="button"
                      className="overview-record-link"
                      aria-label={`查看${modeName(mode)}对局记录`}
                      onClick={() => onOpen('records', mode)}
                    >
                      <ArrowRight size={17} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="overview-empty">
              <Clock3 size={25} aria-hidden="true" />
              <strong>还没有完成记录</strong>
              <p>完成一局后，在这里回顾最近的结果。</p>
            </div>
          )}
          <p className="overview-source-note">
            来自已保留的完成记录，不代表每局都有完整回放。
          </p>
        </section>
        <section
          className="overview-profile"
          aria-labelledby="overview-profile-title"
        >
          <header className="overview-panel-heading">
            <h3 id="overview-profile-title">
              <ShieldCheck size={17} aria-hidden="true" />
              玩家档案
            </h3>
            <span className="overview-scope">{archive.scope}</span>
          </header>
          {archive.error ? (
            <output className="overview-profile-error">{archive.error}</output>
          ) : (
            <div className="overview-profile-metrics">
              <div>
                <span>完成局数</span>
                <strong>{archive.total}</strong>
                <small>
                  经典 {archive.classic} · 生存 {archive.survival}
                </small>
              </div>
              <div>
                <span>
                  <Trophy size={13} aria-hidden="true" />
                  冠军次数
                </span>
                <strong>{archive.champions}</strong>
                <small>与所示范围一致</small>
              </div>
              <div>
                <span>已保留记录</span>
                <strong>{archive.historyCount}</strong>
                <small>最近最多200条</small>
              </div>
            </div>
          )}
          <p className="overview-profile-note">{archive.note}</p>
          <button
            type="button"
            className="overview-text-link"
            onClick={() => onOpen('statistics')}
          >
            查看详细统计 <ArrowRight size={14} aria-hidden="true" />
          </button>
        </section>
      </div>
    </div>
  );
}
