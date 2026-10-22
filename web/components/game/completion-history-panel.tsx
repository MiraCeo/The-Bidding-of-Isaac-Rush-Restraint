import { characterNames } from '@/lib/game';
import { classicDifficultyLabel } from '@/lib/game/classic-difficulty';
import { survivalDifficultyLabel } from '@/lib/game/survival-difficulty';
import type { PlayerProfile } from '@/lib/ui/player-profile';
import type { LibraryFilters } from './replay-library-panel';
import { RecordFilters } from './record-filters';
import { CharacterArt } from './character-art';
import { RankingScrollArea } from './ranking-self-summary';

export function CompletionHistoryPanel({
  profile,
  message,
  mode,
  filters,
  onFiltersChange,
  decimals,
}: {
  profile: PlayerProfile;
  message: string;
  mode: 'classic' | 'survival';
  filters: LibraryFilters;
  onFiltersChange: (filters: LibraryFilters) => void;
  decimals: 2 | 4;
}) {
  const rows = message
    ? []
    : profile.history
        .filter(
          (row) =>
            (row.mode ?? 'classic') === mode &&
            (filters.role === 'all' || row.characterId === filters.role) &&
            (filters.difficulty === 'all' ||
              (row.aiDifficulty ?? 'ungraded') === filters.difficulty) &&
            filters.completion !== 'partial',
        )
        .slice()
        .reverse();
  return (
    <section
      className="records-history"
      aria-labelledby="records-history-title"
    >
      <header className="records-list-heading">
        <div>
          <h3 id="records-history-title">已登记的完成记录</h3>
          <p>仅保存最终结果，不承诺每条记录都保留完整回放。</p>
        </div>
        <span className="records-source-badge">完成结果</span>
      </header>
      <RecordFilters
        mode={mode}
        filters={filters}
        count={message ? null : rows.length}
        label="完成记录"
        onChange={(field, value) =>
          onFiltersChange({ ...filters, [field]: value })
        }
      />
      {message ? (
        <output className="records-error">
          {message} 完成记录暂不可核验，原档案保留。
        </output>
      ) : (
        <>
          <RankingScrollArea
            className="progress-history-wrap"
            label="完成结果列表"
          >
            <table className="survival-table records-history-table">
              <caption className="sr-only">玩家完成记录</caption>
              <thead>
                <tr>
                  <th>角色／模式</th>
                  <th>难度</th>
                  <th>结果</th>
                  <th>名次</th>
                  <th>累计分数</th>
                  <th>完成时间</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} data-history-key={row.key}>
                    <td>
                      <div className="records-player">
                        <CharacterArt characterId={row.characterId} />
                        <div>
                          <strong>{characterNames[row.characterId]}</strong>
                          <small>{mode === 'classic' ? '经典' : '生存'}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      {mode === 'classic'
                        ? classicDifficultyLabel(row.aiDifficulty)
                        : survivalDifficultyLabel(row.aiDifficulty)}
                    </td>
                    <td>
                      <span
                        className="records-state"
                        data-status={
                          mode === 'classic' ? 'complete' : row.status
                        }
                      >
                        {mode === 'classic'
                          ? '已完成'
                          : row.status === 'survived'
                            ? '存活'
                            : row.eliminationFloorIndex != null
                              ? `第${row.eliminationFloorIndex + 1}层淘汰`
                              : '已完成'}
                      </span>
                    </td>
                    <td className="records-rank">#{row.rank}</td>
                    <td className="records-score">
                      {row.finalScore.toFixed(decimals)}
                    </td>
                    <td>
                      <time dateTime={row.completedAt}>
                        {new Date(row.completedAt).toLocaleString('zh-CN')}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </RankingScrollArea>
          {!rows.length && (
            <p className="records-empty">
              暂无此模式下符合筛选的完成记录。进行中片段请在“完整回放”查看。
            </p>
          )}
          <p className="records-footnote">
            档案最多保留最近200条完成记录；这里的条数不是终身累计，也不是完整回放库。
          </p>
        </>
      )}
    </section>
  );
}
