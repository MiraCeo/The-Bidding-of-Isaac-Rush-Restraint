import { useMemo, useState } from 'react';
import { CharacterArt } from './character-art';
import { RankingScrollArea } from './ranking-self-summary';
import { characterNames } from '@/lib/game';
import { survivalDifficultyLabel } from '@/lib/game/survival-difficulty';
import { classicDifficultyLabel } from '@/lib/game/classic-difficulty';
import type { PlayerProfile } from '@/lib/ui/player-profile';
import {
  completionReceiptLimit,
  historyCounters,
  readCompletionRegistry,
  statisticCharacters,
  statisticDifficulties,
  sumCounters,
  type CompletionCounters,
} from '@/lib/ui/completion-registry';

export interface StatisticsFilters {
  scope: 'registered' | 'history';
  role: string;
  difficulty: string;
}
const percent = (value: number, total: number) =>
  total ? `${((value * 100) / total).toFixed(1)}%` : '—';
function select(
  groups: Record<string, CompletionCounters>,
  mode: 'classic' | 'survival',
  role = 'all',
  difficulty = 'all',
) {
  return sumCounters(
    Object.entries(groups)
      .filter(([key]) => {
        const [m, r, d] = key.split('/');
        return (
          m === mode &&
          (role === 'all' || r === role) &&
          (difficulty === 'all' || (d ?? 'ungraded') === difficulty)
        );
      })
      .map(([, c]) => c),
  );
}
export function PlayerStatistics({
  profile,
  message,
  mode,
  decimals,
  initialFilters,
  onFiltersChange,
}: {
  profile: PlayerProfile;
  message: string;
  mode: 'classic' | 'survival';
  decimals: 2 | 4;
  initialFilters?: StatisticsFilters;
  onFiltersChange: (filters: StatisticsFilters) => void;
}) {
  const [filters, setFilters] = useState<StatisticsFilters>(
    initialFilters ?? { scope: 'registered', role: 'all', difficulty: 'all' },
  );
  const [distribution, setDistribution] = useState<'roles' | 'difficulties'>(
    'roles',
  );
  const data = useMemo(() => {
    try {
      return {
        registry: readCompletionRegistry(profile),
        history: filters.scope === 'history' ? historyCounters(profile) : {},
        error: '',
      };
    } catch (error) {
      return {
        registry: null,
        history: {},
        error:
          error instanceof Error ? error.message : '统计不可核验，原档案保留。',
      };
    }
  }, [profile, filters.scope]);
  function filter(field: keyof StatisticsFilters, value: string) {
    const next = { ...filters, [field]: value } as StatisticsFilters;
    setFilters(next);
    onFiltersChange(next);
  }
  const error = message || data.error;
  if (error)
    return (
      <section
        className="settings-group player-statistics"
        aria-labelledby="player-statistics-title"
      >
        <h3 id="player-statistics-title">对局统计</h3>
        {!message && data.error && (
          <label className="statistics-filters">
            数据范围
            <select
              aria-label="统计数据范围"
              value={filters.scope}
              onChange={(e) => filter('scope', e.target.value)}
            >
              <option value="registered">统一登记累计</option>
              <option value="history">已保留历史（最近200条）</option>
            </select>
          </label>
        )}
        <output className="save-message">{error}</output>
        <p>资料无法核验，不将读取失败显示为零局。</p>
      </section>
    );
  const registry = data.registry,
    groups =
      filters.scope === 'registered' ? (registry?.groups ?? {}) : data.history;
  const selected = select(groups, mode, filters.role, filters.difficulty);
  const roles = statisticCharacters
    .filter((id) => filters.role === 'all' || id === filters.role)
    .map((id) => ({ id, count: select(groups, mode, id, filters.difficulty) }))
    .filter((row) => row.count.completed > 0);
  const difficulties = statisticDifficulties
    .filter((id) => filters.difficulty === 'all' || id === filters.difficulty)
    .map((id) => ({ id, count: select(groups, 'survival', filters.role, id) }))
    .filter((row) => row.count.completed > 0);
  const allCount = sumCounters(Object.values(groups)).completed;
  const score = (units: number | null) =>
    units === null ? '—' : (units / 10000).toFixed(decimals);
  const difficultyName = (id: (typeof statisticDifficulties)[number]) =>
    id === 'ungraded'
      ? mode === 'classic'
        ? '原版（未分档）'
        : '未分层'
      : mode === 'classic'
        ? classicDifficultyLabel(id)
        : survivalDifficultyLabel(id);
  const scopeName =
    filters.scope === 'registered' ? '统一登记累计' : '已保留历史';
  const showingRoles = mode === 'classic' || distribution === 'roles';
  const rows = showingRoles ? roles : difficulties;
  const distributionName = showingRoles ? '角色统计' : '难度统计';
  const metrics = [
    {
      key: 'completed',
      label: '完成局数',
      value: selected.completed,
      unit: '局',
      note: '当前模式与筛选',
    },
    {
      key: 'champions',
      label: '冠军次数',
      value: selected.champions,
      unit: '次',
      note: `冠军率 ${percent(selected.champions, selected.completed)}`,
    },
    {
      key: 'best-score',
      label: '最佳成绩',
      value: score(selected.bestScoreUnits),
      unit: '分',
      note: '单局最高最终积分',
    },
    {
      key: 'best-rank',
      label: '最佳名次',
      value: selected.bestRank === null ? '—' : `#${selected.bestRank}`,
      unit: '',
      note: '与最佳成绩独立统计',
    },
    {
      key: 'average-score',
      label: '平均成绩',
      value: selected.completed
        ? score(selected.scoreSumUnits / selected.completed)
        : '—',
      unit: '分',
      note: `${selected.completed} 局样本`,
    },
    {
      key: 'average-rank',
      label: '平均名次',
      value: selected.completed
        ? (selected.rankSum / selected.completed).toFixed(2)
        : '—',
      unit: '名',
      note: '越低越靠前',
    },
  ];
  const metricGroups = [
    { title: '参赛表现', primary: metrics[0]!, secondary: metrics[1]! },
    { title: '积分表现', primary: metrics[2]!, secondary: metrics[4]! },
    { title: '名次表现', primary: metrics[3]!, secondary: metrics[5]! },
  ];
  return (
    <section
      className="player-statistics"
      aria-labelledby="player-statistics-title"
    >
      <header className="statistics-heading">
        <div>
          <p className="eyebrow">MATCH STATISTICS</p>
          <h3 id="player-statistics-title">对局统计</h3>
        </div>
        <span>
          当前{mode === 'classic' ? '经典' : '生存'}筛选 {selected.completed} 局
          <small>
            {scopeName} · 两模式共 {allCount} 局
          </small>
        </span>
      </header>
      <div className="statistics-toolbar">
        <div className="statistics-filters">
          <label>
            数据范围
            <select
              aria-label="统计数据范围"
              value={filters.scope}
              onChange={(e) => filter('scope', e.target.value)}
            >
              <option value="registered">统一登记累计</option>
              <option value="history">已保留历史（最近200条）</option>
            </select>
          </label>
          <label>
            角色
            <select
              aria-label="统计角色"
              value={filters.role}
              onChange={(e) => filter('role', e.target.value)}
            >
              <option value="all">全部角色</option>
              {statisticCharacters.map((id) => (
                <option key={id} value={id}>
                  {characterNames[id]}
                </option>
              ))}
            </select>
          </label>
          <label>
            难度
            <select
              aria-label="统计难度"
              value={filters.difficulty}
              onChange={(e) => filter('difficulty', e.target.value)}
            >
              <option value="all">全部难度</option>
              {statisticDifficulties.map((id) => (
                <option key={id} value={id}>
                  {difficultyName(id)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {(filters.role !== 'all' || filters.difficulty !== 'all') && (
          <button
            type="button"
            className="statistics-reset"
            onClick={() => {
              const next = { ...filters, role: 'all', difficulty: 'all' };
              setFilters(next);
              onFiltersChange(next);
            }}
          >
            清除筛选
          </button>
        )}
        <p className="statistics-scope-note">
          {filters.scope === 'history'
            ? `当前仅统计档案中保留的 ${profile.history.length} 条历史；删除或截断的旧记录无法反推，这不是终身累计。`
            : registry
              ? `自 ${new Date(registry.startedAt).toLocaleString('zh-CN')} 启用统一登记；旧档案保留的 ${registry.baselineHistoryCount} 条为历史基线，不自动补成终身总数。`
              : `尚未启用统一登记累计。首次登记权威终局时建立；已有 ${profile.history.length} 条历史可切换到“已保留历史”查看，不自动写入占位统计。`}
        </p>
      </div>
      <div
        className="statistics-cards"
        aria-label="当前筛选统计摘要"
        aria-live="polite"
        aria-atomic="true"
      >
        {metricGroups.map(({ title, primary, secondary }) => (
          <article key={title} className="statistics-metric-group">
            <h4>{title}</h4>
            <div className="statistics-group-values">
              <div className="statistics-primary" data-metric={primary.key}>
                <span>{primary.label}</span>
                <div className="statistics-value">
                  <strong>{primary.value}</strong>
                  {primary.unit && <span>{primary.unit}</span>}
                </div>
              </div>
              <div className="statistics-secondary" data-metric={secondary.key}>
                <span>{secondary.label}</span>
                <div className="statistics-value">
                  <strong>{secondary.value}</strong>
                  {secondary.unit && <span>{secondary.unit}</span>}
                </div>
                <small>{secondary.note}</small>
              </div>
            </div>
          </article>
        ))}
      </div>
      <div
        className={`statistics-breakdowns ${mode === 'survival' ? 'statistics-breakdowns-survival' : ''}`}
      >
        <section
          className="statistics-distribution"
          aria-labelledby="statistics-distribution-title"
        >
          <header className="statistics-panel-heading">
            <h4 id="statistics-distribution-title">
              {showingRoles ? '角色分布' : '难度分布'}
            </h4>
            {mode === 'survival' && (
              <nav
                className="statistics-distribution-tabs"
                aria-label="统计分布"
              >
                <button
                  type="button"
                  aria-pressed={showingRoles}
                  onClick={() => setDistribution('roles')}
                >
                  按角色
                </button>
                <button
                  type="button"
                  aria-pressed={!showingRoles}
                  onClick={() => setDistribution('difficulties')}
                >
                  按难度
                </button>
              </nav>
            )}
          </header>
          <RankingScrollArea
            className="statistics-table-wrap"
            label={`${distributionName}，可横向滚动`}
          >
            <table className="survival-table">
              <caption className="sr-only">{distributionName}</caption>
              <thead>
                <tr>
                  <th>{showingRoles ? '角色' : '难度'}</th>
                  <th>完成局数</th>
                  <th>冠军次数</th>
                  {mode === 'survival' && <th>存活／存活率</th>}
                  <th>平均名次</th>
                  <th>最佳成绩</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ id, count }) => (
                  <tr key={id}>
                    <th scope="row">
                      <div className="statistics-row-name">
                        {showingRoles && (
                          <CharacterArt
                            characterId={
                              id as (typeof statisticCharacters)[number]
                            }
                          />
                        )}
                        <span>
                          {showingRoles
                            ? characterNames[
                                id as (typeof statisticCharacters)[number]
                              ]
                            : difficultyName(
                                id as (typeof statisticDifficulties)[number],
                              )}
                        </span>
                      </div>
                    </th>
                    <td>
                      {count.completed}
                      <div
                        className="statistics-count-track"
                        aria-hidden="true"
                      >
                        <i
                          style={{
                            width: `${selected.completed ? (count.completed * 100) / selected.completed : 0}%`,
                          }}
                        />
                      </div>
                    </td>
                    <td className="statistics-champions">{count.champions}</td>
                    {mode === 'survival' && (
                      <td
                        className={
                          count.survived
                            ? 'statistics-positive'
                            : 'statistics-neutral'
                        }
                      >
                        {count.survived} ·{' '}
                        {percent(count.survived, count.completed)}
                      </td>
                    )}
                    <td>{(count.rankSum / count.completed).toFixed(2)}</td>
                    <td className="statistics-score">
                      {score(count.bestScoreUnits)} <small>分</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </RankingScrollArea>
          {!rows.length && (
            <p className="statistics-empty">此范围与筛选暂无完成记录。</p>
          )}
        </section>
        {mode === 'survival' && (
          <section
            className="statistics-survival"
            aria-labelledby="statistics-survival-title"
          >
            <header className="statistics-panel-heading">
              <h4 id="statistics-survival-title">存活与淘汰</h4>
              <span>{selected.completed} 局样本</span>
            </header>
            <div
              className={`statistics-survival-rate ${selected.survived ? 'statistics-positive' : 'statistics-neutral'}`}
            >
              <span>存活率</span>
              <strong>{percent(selected.survived, selected.completed)}</strong>
            </div>
            <div className="statistics-outcomes">
              <span>
                存活{' '}
                <strong
                  className={
                    selected.survived
                      ? 'statistics-positive'
                      : 'statistics-neutral'
                  }
                >
                  {selected.survived}
                </strong>{' '}
                局
              </span>
              <span>
                淘汰{' '}
                <strong
                  className={
                    selected.eliminated
                      ? 'statistics-negative'
                      : 'statistics-neutral'
                  }
                >
                  {selected.eliminated}
                </strong>{' '}
                局
              </span>
            </div>
          </section>
        )}
      </div>
      {mode === 'survival' && (
        <section
          className="statistics-elimination"
          aria-labelledby="statistics-elimination-title"
        >
          <h5 id="statistics-elimination-title">
            淘汰层分布 <span>仅含 {selected.eliminated} 局淘汰记录</span>
          </h5>
          <div className="statistics-floors">
            {selected.eliminationFloors.map((n, i) => (
              <div key={i} data-has-value={n > 0}>
                <span>
                  第{i + 1}层 <strong>{n}</strong>
                </span>
                <div className="statistics-floor-track" aria-hidden="true">
                  <i
                    style={{
                      width: `${selected.eliminated ? (n * 100) / selected.eliminated : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <details className="statistics-methodology">
        <summary>
          统计口径与数据说明 <span>登记范围、成绩与备份</span>
        </summary>
        <p>
          只计权威终局，不计未完成局、放弃选角或只读回放。经典同分第1名按原竞争排名记冠军；生存团灭时第1名不算冠军。两种模式成绩分开，生存沿用权威累计，不重复加入继承分。
        </p>
        <p>
          最佳成绩与最佳名次分别取当前筛选内的最优值，不代表来自同一局。平均值按当前筛选内的完成局数计算。分布表受同一组筛选约束，完成局数条形表示其占当前筛选样本的比例。
        </p>
        {registry && (
          <p>
            去重凭据 {Object.keys(registry.receipts).length} /{' '}
            {completionReceiptLimit}{' '}
            条，独立于最近200条历史。删除完整回放不减累计；档案备份保存累计与凭据，恢复为替换而非相加。达到凭据／档案大小上限会停止新增登记，保留旧数据。
          </p>
        )}
        <p>
          旧历史若缺完整事实，同ID同结果的历史恢复不自动补计；不同新分支按完整事实分别登记。
        </p>
      </details>
    </section>
  );
}
