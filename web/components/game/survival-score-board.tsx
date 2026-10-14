import type { SurvivalBoardModel } from '@/lib/ui/survival-board';

export function SurvivalScoreBoard({
  model,
  decimals = 2,
}: {
  model: SurvivalBoardModel;
  decimals?: 2 | 4;
}) {
  return (
    <section
      className="survival-score-board"
      aria-label={model.final ? '生存总榜' : '实时生存榜'}
    >
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
      <p className="survival-board-note">
        各层分数为新增积分：房间分＋层末余额兑换，不含继承。进行中的层每房更新已结算房间分，余额尚未兑换。累计分数为各层之和；生存分
        S 单独标注，用于层末淘汰。
      </p>
      <section className="survival-board-scroll" aria-label="生存榜分层积分表">
        <table className="survival-board-table">
          <caption className="sr-only">
            {model.final ? '生存总榜' : '实时生存榜'} ·
            存活优先，淘汰层数优先，再按累计分数排序
            {!model.final ? '（当前顺位，非最终名次）' : ''}
          </caption>
          <thead>
            <tr>
              <th scope="col">玩家</th>
              <th scope="col">状态</th>
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
                    {model.liveFloorIndex === i ? '进行中' : '已结算'}
                  </small>
                </th>
              ))}
              <th scope="col" className="survival-board-total">
                累计分数
              </th>
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row) => (
              <tr
                key={row.playerId}
                data-player-id={row.playerId}
                data-human={row.playerId === 'human'}
                data-eliminated={!row.active}
              >
                <th
                  scope="row"
                  aria-label={`${row.rank} · ${row.name} · ${row.characterName}`}
                >
                  <div className="survival-board-player">
                    <span className="survival-board-position">{row.rank}</span>
                    <div>
                      <strong>{row.name}</strong>
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
                {row.floors.map((cell, i) => (
                  <td
                    key={i}
                    className={
                      cell?.kind === 'live' ? 'survival-board-live-column' : ''
                    }
                    data-floor={i}
                  >
                    <strong>{cell ? cell.score.toFixed(decimals) : '—'}</strong>
                    <small>
                      {cell
                        ? cell.kind === 'live'
                          ? `房间分 · ${cell.rooms}/5 房`
                          : `S ${cell.survivalScore!.toFixed(decimals)}`
                        : '未参与'}
                    </small>
                  </td>
                ))}
                <td className="survival-board-total" data-total>
                  <strong>{row.total.toFixed(decimals)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </section>
  );
}
