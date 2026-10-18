import type { HistoricalMarket } from '@/lib/ui/market-history';
import { missingMarketLabel } from '@/lib/ui/market-history';
import { formatMarketAmount } from '@/lib/ui/quote-capacity';

export function MarketHistory({
  rows,
  onViewReplay,
}: {
  rows: readonly HistoricalMarket[];
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
                    基准
                  </th>
                  <th scope="col" title="A组历史高价名额边界">
                    A高价
                  </th>
                  <th scope="col" title="B组历史高价名额边界">
                    B高价
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
                      {row.roomIndex + 1}
                      <small>{row.playerCount}人</small>
                    </th>
                    {row.target === null ? (
                      <td colSpan={3}>全场观望</td>
                    ) : (
                      <>
                        <td title={String(row.target)}>
                          {formatMarketAmount(row.target)}
                        </td>
                        {row.groups.map((group) => (
                          <td key={group.group}>
                            {group.cutoff === null ? (
                              <span
                                title={missingMarketLabel(group)}
                                aria-label={missingMarketLabel(group)}
                              >
                                —
                              </span>
                            ) : (
                              <span title={String(group.cutoff)}>
                                {formatMarketAmount(group.cutoff)}
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
            高价边界含扰乱占位，不等于获奖价。
          </p>
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
