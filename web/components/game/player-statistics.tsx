import { useMemo, useState } from 'react';
import { characterNames } from '@/lib/game';
import { survivalDifficultyLabel } from '@/lib/game/survival-difficulty';
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
          (mode === 'classic' || difficulty === 'all' || d === difficulty)
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
        <h3 id="player-statistics-title">信息统计</h3>
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
  return (
    <section
      className="settings-group player-statistics"
      aria-labelledby="player-statistics-title"
    >
      <div className="statistics-heading">
        <div>
          <p className="eyebrow">MATCH INFORMATION</p>
          <h3 id="player-statistics-title">基础登记与信息统计</h3>
        </div>
        <span>
          {filters.scope === 'registered' ? '统一登记累计' : '已保留历史'} ·
          两模式共 {allCount} 局
        </span>
      </div>
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
        {mode === 'survival' && (
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
                  {id === 'ungraded' ? '未分层' : survivalDifficultyLabel(id)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="utility-notice">
        {filters.scope === 'history'
          ? `当前仅统计档案中保留的 ${profile.history.length} 条历史；删除或截断的旧记录无法反推，这不是终身累计。`
          : registry
            ? `自 ${new Date(registry.startedAt).toLocaleString('zh-CN')} 启用统一登记；旧档案保留的 ${registry.baselineHistoryCount} 条为历史基线，不自动补成终身总数。`
            : `尚未启用统一登记累计。首次登记权威终局时建立；已有 ${profile.history.length} 条历史可切换到“已保留历史”查看，不自动写入占位统计。`}
      </p>
      <div className="statistics-cards">
        <article>
          <span>完成局数</span>
          <strong>{selected.completed}</strong>
          <small>{mode === 'classic' ? '经典' : '生存'} · 当前筛选</small>
        </article>
        <article>
          <span>冠军次数</span>
          <strong>{selected.champions}</strong>
          <small>
            冠军率 {percent(selected.champions, selected.completed)}
          </small>
        </article>
        {mode === 'survival' && (
          <article>
            <span>存活次数／存活率</span>
            <strong>
              {selected.survived} ·{' '}
              {percent(selected.survived, selected.completed)}
            </strong>
            <small>淘汰 {selected.eliminated} 局</small>
          </article>
        )}
        <article>
          <span>最佳成绩／最佳名次</span>
          <strong>{score(selected.bestScoreUnits)}</strong>
          <small>
            {selected.bestRank === null
              ? '尚无名次'
              : `第 ${selected.bestRank} 名`}
          </small>
        </article>
        <article>
          <span>平均名次／平均成绩</span>
          <strong>
            {selected.completed
              ? (selected.rankSum / selected.completed).toFixed(2)
              : '—'}
          </strong>
          <small>
            {selected.completed
              ? score(selected.scoreSumUnits / selected.completed)
              : '—'}{' '}
            分
          </small>
        </article>
      </div>
      <p className="statistics-note">
        只计权威终局，不计未完成局、放弃选角或只读回放。经典同分第1名按原竞争排名记冠军；生存团灭时第1名不算冠军。两种模式成绩分开，生存沿用权威累计，不重复加入继承分。
      </p>
      <div className="statistics-table-wrap">
        <table className="survival-table">
          <caption className="sr-only">角色统计</caption>
          <thead>
            <tr>
              <th>角色</th>
              <th>完成</th>
              <th>冠军</th>
              {mode === 'survival' && <th>存活／存活率</th>}
              <th>平均名次</th>
              <th>最佳成绩</th>
            </tr>
          </thead>
          <tbody>
            {roles.map(({ id, count }) => (
              <tr key={id}>
                <td>{characterNames[id]}</td>
                <td>{count.completed}</td>
                <td>{count.champions}</td>
                {mode === 'survival' && (
                  <td>
                    {count.survived} ·{' '}
                    {percent(count.survived, count.completed)}
                  </td>
                )}
                <td>{(count.rankSum / count.completed).toFixed(2)}</td>
                <td>{score(count.bestScoreUnits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!roles.length && (
        <p className="statistics-empty">此范围与筛选暂无完成记录。</p>
      )}
      {mode === 'survival' && (
        <>
          <div className="statistics-table-wrap">
            <table className="survival-table">
              <caption className="sr-only">难度统计</caption>
              <thead>
                <tr>
                  <th>难度</th>
                  <th>完成</th>
                  <th>冠军</th>
                  <th>存活／存活率</th>
                  <th>平均名次</th>
                  <th>最佳成绩</th>
                </tr>
              </thead>
              <tbody>
                {difficulties.map(({ id, count }) => (
                  <tr key={id}>
                    <td>
                      {id === 'ungraded'
                        ? '未分层'
                        : survivalDifficultyLabel(id)}
                    </td>
                    <td>{count.completed}</td>
                    <td>{count.champions}</td>
                    <td>
                      {count.survived} ·{' '}
                      {percent(count.survived, count.completed)}
                    </td>
                    <td>{(count.rankSum / count.completed).toFixed(2)}</td>
                    <td>{score(count.bestScoreUnits)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="statistics-elimination">
            <summary>
              淘汰层分布 · {selected.eliminated} 局（不含存活者）
            </summary>
            <div className="statistics-floors">
              {selected.eliminationFloors.map((n, i) => (
                <span key={i}>
                  第{i + 1}层 <strong>{n}</strong>
                </span>
              ))}
            </div>
          </details>
        </>
      )}
      {registry && (
        <p className="statistics-note">
          去重凭据 {Object.keys(registry.receipts).length} /{' '}
          {completionReceiptLimit}{' '}
          条，独立于最近200条历史。删除完整回放不减累计；档案备份保存累计与凭据，恢复为替换而非相加。达到凭据／档案大小上限会停止新增登记，保留旧数据。
        </p>
      )}
      <p className="statistics-note">
        旧历史若缺完整事实，同ID同结果的历史恢复不自动补计；不同新分支按完整事实分别登记。成就、解锁与大型统计看板不在本轮接入。
      </p>
    </section>
  );
}
