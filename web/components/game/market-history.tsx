import type { HistoricalMarket } from '@/lib/ui/market-history';
import { missingMarketLabel } from '@/lib/ui/market-history';
import { marketOverview } from '@/lib/ui/market-reference-display';
import type { RewardGroup } from '@/lib/game/types';

export function MarketHistory({
  rows,
  activeGroups = [],
  onViewReplay,
}: {
  rows: readonly HistoricalMarket[];
  activeGroups?: readonly RewardGroup[];
  onViewReplay?: () => void;
}) {
  return (
    <section className="market-history" aria-label="本层历史市场">
      <header>
        <h3>本层最近三房</h3>
        <span>近 → 远</span>
      </header>
      {rows.length === 0 ? (
        <p className="market-history-empty">本层尚无已结算市场。</p>
      ) : (
        <>
          <div className="market-history-table-wrap">
            <table aria-label="本层最近已结算市场">
              <thead>
                <tr>
                  <th scope="col">房间</th>
                  <th scope="col" title="历史共同基准线">
                    基准线
                  </th>
                  <th
                    scope="col"
                    title="A组历史高价名额边界"
                    data-active={activeGroups.includes('A')}
                  >
                    A高价线
                  </th>
                  <th
                    scope="col"
                    title="B组历史高价名额边界"
                    data-active={activeGroups.includes('B')}
                  >
                    B高价线
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr
                    key={`${row.floorIndex}:${row.roomIndex}`}
                    data-latest={index === 0}
                  >
                    <th
                      scope="row"
                      title={`第${row.floorIndex + 1}层第${row.roomIndex + 1}房 · ${row.playerCount}人`}
                    >
                      {row.roomIndex + 1} <small>{row.playerCount}人</small>
                    </th>
                    {row.target === null ? (
                      <td colSpan={3}>全场观望</td>
                    ) : (
                      <>
                        <td title={String(row.target)}>
                          {marketOverview(row.target)}
                        </td>
                        {row.groups.map((group) => (
                          <td
                            key={group.group}
                            data-active={activeGroups.includes(group.group)}
                          >
                            {group.cutoff === null ? (
                              <span
                                title={missingMarketLabel(group)}
                                aria-label={missingMarketLabel(group)}
                              >
                                —
                              </span>
                            ) : (
                              <span title={String(group.cutoff)}>
                                {marketOverview(group.cutoff)}
                              </span>
                            )}
                          </td>
                        ))}
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="market-history-note">
            高价线为名额边界，含扰乱占位，不等于获奖价。概览最多2位小数。
          </p>
          <details className="market-history-exact">
            <summary>历史原始数值</summary>
            {rows.map((row) => (
              <div key={`${row.floorIndex}:${row.roomIndex}`}>
                <h4>
                  第{row.floorIndex + 1}层第{row.roomIndex + 1}房 ·{' '}
                  {row.playerCount}人
                </h4>
                <dl className="market-exact-values">
                  <div>
                    <dt>基准线</dt>
                    <dd>{row.target ?? '全场观望'}</dd>
                  </div>
                  <div>
                    <dt>合作区</dt>
                    <dd>
                      {row.lower === null || row.upper === null
                        ? '无市场基准'
                        : `${row.lower} – ${row.upper}`}
                    </dd>
                  </div>
                  {row.groups.map((g) => (
                    <div key={g.group}>
                      <dt>{g.group}高价线</dt>
                      <dd>{g.cutoff ?? missingMarketLabel(g)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </details>
          {onViewReplay && (
            <button
              className="market-history-replay"
              type="button"
              onClick={onViewReplay}
            >
              查看已结算回放
            </button>
          )}
        </>
      )}
    </section>
  );
}
