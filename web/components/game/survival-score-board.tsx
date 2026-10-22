import type { SurvivalBoardModel } from '@/lib/ui/survival-board';
import {
  LocateSelfButton,
  RankingSelfSummary,
  RankingScrollArea,
} from './ranking-self-summary';

export function SurvivalScoreBoard({
  model,
  decimals = 2,
  embedded = false,
  selfSummaryOutside = false,
}: {
  model: SurvivalBoardModel;
  decimals?: 2 | 4;
  embedded?: boolean;
  selfSummaryOutside?: boolean;
}) {
  const human = model.rows.find((row) => row.playerId === 'human');
  return (
    <section
      className="survival-score-board"
      aria-label={model.final ? '生存总榜' : '实时生存榜'}
      data-ranking-polish="survival"
      data-embedded-board={embedded || undefined}
      data-floor-count={model.floorCount}
      data-ranking-scope
    >
      {!embedded && (
        <div className="survival-board-heading">
          <div>
            <p className="eyebrow">SURVIVAL LEADERBOARD</p>
            <h2>{model.final ? '生存总榜' : '实时生存榜'}</h2>
          </div>
          <span className="survival-board-summary">
            {model.rows.filter((row) => row.active).length} 人存活 ·{' '}
            {model.rows.length} 人参赛
          </span>
        </div>
      )}
      <div className="survival-board-tools">
        {!selfSummaryOutside && (
          <RankingSelfSummary
            label={model.final ? '你的最终名次' : '你的当前顺位'}
            rank={human?.rank}
          >
            {human &&
              `${human.statusLabel} · 累计 ${human.total.toFixed(decimals)} 分`}
          </RankingSelfSummary>
        )}
        {embedded && (
          <span className="survival-board-summary">
            {model.rows.filter((row) => row.active).length} 人存活 ·{' '}
            {model.rows.length} 人参赛
          </span>
        )}
        {selfSummaryOutside && human && <LocateSelfButton />}
        <details className="ranking-reading-help">
          <summary>积分口径</summary>
          <dl>
            <div>
              <dt>本层新增</dt>
              <dd>房间分＋层末余额兑换；进行中只含已结算房间分。</dd>
            </div>
            <div>
              <dt>生存分 S</dt>
              <dd>本层新增＋继承分，用于层末淘汰；各层单独标注。</dd>
            </div>
            <div>
              <dt>累计分数</dt>
              <dd>各层新增之和，不重复计入继承分，不等同于生存分 S。</dd>
            </div>
          </dl>
        </details>
      </div>
      <p className="survival-board-note">
        {model.final
          ? '按已记录的最终名次展示，保留同分裁定。存活者优先；淘汰越晚名次越靠前，同层再比较累计分数。'
          : '存活优先，再按淘汰层数、累计分数排序；当前顺位不是最终名次。'}
        各层主值为本层新增，不含继承。
      </p>
      <RankingScrollArea
        className="survival-board-scroll"
        label="生存榜分层积分表"
      >
        <table
          className="survival-board-table"
          style={
            embedded
              ? { minWidth: Math.max(620, 490 + model.floorCount * 150) }
              : undefined
          }
        >
          <caption className="sr-only">
            {model.final ? '生存总榜' : '实时生存榜'} ·
            {model.final
              ? '保留记录的最终顺序'
              : '存活优先，淘汰层数优先，再按累计分数排序'}
            {!model.final ? '（当前顺位，非最终名次）' : ''}
          </caption>
          {embedded && (
            <colgroup>
              <col className="board-col-player" />
              <col className="board-col-status" />
              <col className="board-col-total" />
              {Array.from({ length: model.floorCount }, (_, i) => (
                <col key={i} className="board-col-floor" />
              ))}
            </colgroup>
          )}
          <thead>
            <tr>
              <th scope="col">玩家</th>
              <th scope="col">状态</th>
              <th scope="col" className="survival-board-total">
                累计分数
              </th>
              {Array.from({ length: model.floorCount }, (_, i) => (
                <th
                  scope="col"
                  key={i}
                  className={
                    model.liveFloorIndex === i
                      ? 'survival-board-live-column'
                      : ''
                  }
                >
                  第 {i + 1} 层
                  <small>
                    {model.final && embedded
                      ? '新增积分'
                      : model.liveFloorIndex === i
                        ? '进行中'
                        : '已结算'}
                  </small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row) => (
              <tr
                key={row.playerId}
                data-player-id={row.playerId}
                data-rank={row.rank}
                data-human={row.playerId === 'human'}
                data-eliminated={!row.active}
                data-ranking-self={row.playerId === 'human'}
                tabIndex={row.playerId === 'human' ? -1 : undefined}
              >
                <th
                  scope="row"
                  aria-label={`${row.rank} · ${row.name} · ${row.characterName}`}
                >
                  <div className="survival-board-player">
                    <span className="survival-board-position">{row.rank}</span>
                    <div>
                      <strong>{row.name}</strong>
                      {row.playerId === 'human' && (
                        <em className="ranking-self-badge">本人</em>
                      )}
                      <small>{row.characterName}</small>
                    </div>
                  </div>
                </th>
                <td>
                  <span
                    className={`survival-board-status ${row.active ? 'is-alive' : 'is-out'}`}
                  >
                    {row.statusLabel}
                  </span>
                </td>
                <td
                  className="survival-board-total"
                  data-total
                  title={String(row.total)}
                >
                  <strong>{row.total.toFixed(decimals)}</strong>
                </td>
                {row.floors.map((cell, i) => (
                  <td
                    key={i}
                    className={
                      cell?.kind === 'live' ? 'survival-board-live-column' : ''
                    }
                    data-floor={i}
                  >
                    <strong title={cell ? `本层新增 ${cell.score}` : undefined}>
                      {cell ? cell.score.toFixed(decimals) : '—'}
                    </strong>
                    <small
                      title={
                        cell?.kind === 'live'
                          ? `已结算 ${cell.rooms}/5 房`
                          : undefined
                      }
                    >
                      {cell ? (
                        cell.kind === 'live' ? (
                          embedded ? (
                            <>
                              房间分
                              <span className="sr-only">
                                {' '}
                                · {cell.rooms}/5 房
                              </span>
                            </>
                          ) : (
                            `房间分 · ${cell.rooms}/5 房`
                          )
                        ) : (
                          `生存分 S ${cell.survivalScore!.toFixed(decimals)}`
                        )
                      ) : (
                        '未参与'
                      )}
                    </small>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </RankingScrollArea>
    </section>
  );
}
