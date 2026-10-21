import type { RuntimePlayerState, PlayerTurn } from '@/lib/game/item-types';
import type { RulesConfig } from '@/lib/game/types';
import { getQuotePreviews } from '@/lib/ui/player-build';
import type { HistoricalMarket } from '@/lib/ui/market-history';
import { missingMarketLabel } from '@/lib/ui/market-history';
import {
  marketOverview,
  marketDifference,
} from '@/lib/ui/market-reference-display';
import { MarketHistory } from './market-history';
import {
  formatMarketAmount,
  type QuoteCapacity,
} from '@/lib/ui/quote-capacity';

/** Own draft and projected public history only. No roster/private turns. */
export function MarketImpactPreview({
  player,
  turn,
  kind,
  capacity,
  rules,
  history = [],
  onViewReplay,
}: {
  player: RuntimePlayerState;
  turn: PlayerTurn;
  kind: 'bid' | 'disrupt';
  capacity: QuoteCapacity;
  rules: RulesConfig;
  history?: readonly HistoricalMarket[];
  onViewReplay?: () => void;
}) {
  const actions = getQuotePreviews(player, turn, rules).filter(
    (p) => p.action.type !== 'withdraw',
  );
  const maximum = capacity[kind].marketEquivalent;
  const pair = kind === 'bid' ? capacity.doubleBid : capacity.doubleDisrupt;
  const last = history[0];
  const activeGroups = actions.flatMap((p) =>
    p.action.type === 'withdraw' ? [] : [p.action.group],
  );
  return (
    <div className="market-impact-preview">
      <MarketHistory
        rows={history}
        activeGroups={activeGroups}
        onViewReplay={onViewReplay}
      />
      <section className="market-own-summary" aria-label="我的市场影响">
        <h3>我的报价对照</h3>
        <p className="drawer-description">
          {last
            ? `参照第${last.floorIndex + 1}层第${last.roomIndex + 1}房；不预测本房结果。`
            : '本层首房，结算后开始显示历史参考。'}
        </p>
        {actions.length === 0 ? (
          <p className="market-impact-empty">
            {turn.actions.some((a) => a.type === 'withdraw')
              ? '静观其变，不产生市场样本。'
              : '当前没有可用报价。'}
          </p>
        ) : (
          <table
            className="market-quote-comparison"
            aria-label="当前报价与最近历史对照"
          >
            <thead>
              <tr>
                <th scope="col">对照项</th>
                {actions.map(
                  (p) =>
                    p.action.type !== 'withdraw' && (
                      <th scope="col" key={p.action.group}>
                        目标 {p.action.group}
                        <small>
                          {p.action.type === 'bid' ? '竞拍' : '扰乱'}
                        </small>
                      </th>
                    ),
                )}
              </tr>
            </thead>
            <tbody>
              <tr className="market-current-value">
                <th scope="row">当前市场</th>
                {actions.map(
                  (p) =>
                    p.action.type !== 'withdraw' && (
                      <td
                        key={p.action.group}
                        title={String(p.marketEquivalent)}
                      >
                        {marketOverview(p.marketEquivalent!)}
                      </td>
                    ),
                )}
              </tr>
              {last && (
                <>
                  <tr>
                    <th scope="row">历史高价线</th>
                    {actions.map((p) => {
                      if (p.action.type === 'withdraw') return null;
                      const group = p.action.group;
                      const previous = last.groups.find(
                        (g) => g.group === group,
                      );
                      return (
                        <td
                          key={p.action.group}
                          title={
                            previous?.cutoff == null
                              ? undefined
                              : String(previous.cutoff)
                          }
                        >
                          {previous?.cutoff == null ? (
                            <span
                              aria-label={
                                previous
                                  ? missingMarketLabel(previous)
                                  : '无记录'
                              }
                            >
                              —
                            </span>
                          ) : (
                            marketOverview(previous.cutoff)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <th scope="row">市场差值</th>
                    {actions.map((p) => {
                      if (p.action.type === 'withdraw') return null;
                      const group = p.action.group;
                      const cutoff = last.groups.find(
                        (g) => g.group === group,
                      )?.cutoff;
                      const difference =
                        cutoff == null ? null : p.marketEquivalent! - cutoff;
                      return (
                        <td
                          key={p.action.group}
                          title={
                            difference == null
                              ? '无历史高价线，不能计算差值'
                              : String(difference)
                          }
                        >
                          {difference == null
                            ? '—'
                            : marketDifference(difference)}
                        </td>
                      );
                    })}
                  </tr>
                </>
              )}
              <tr>
                <th scope="row">计分等价</th>
                {actions.map(
                  (p) =>
                    p.action.type !== 'withdraw' && (
                      <td
                        key={p.action.group}
                        title={String(p.scoringRange ?? p.scoringEquivalent)}
                      >
                        {p.scoringRange ? (
                          <>
                            <span className="market-score-range">
                              {p.scoringRange.map(marketOverview).join(' – ')}
                            </span>
                            <small>区间</small>
                          </>
                        ) : (
                          marketOverview(p.scoringEquivalent!)
                        )}
                      </td>
                    ),
                )}
              </tr>
            </tbody>
          </table>
        )}
        {last && (
          <p className="market-shared-zone">
            历史合作区{' '}
            <strong title={`${last.lower} – ${last.upper}`}>
              {last.lower === null || last.upper === null
                ? '无市场基准'
                : `${marketOverview(last.lower)} – ${marketOverview(last.upper)}`}
            </strong>
          </p>
        )}
        {actions.length === 2 && pair && (
          <p className="market-impact-pair">
            双行动名义总额上限 {pair.nominal}；A／B分别对照。
          </p>
        )}
      </section>
      <details className="market-impact-help">
        <summary>精确数值与口径</summary>
        <p>
          概览最多显示2位小数，以下保留原始精度。市场差值＝当前市场等价－历史对应组高价线，不表示胜率或推荐报价。
        </p>
        {last && (
          <dl className="market-exact-values" aria-label="历史市场精确数值">
            <div>
              <dt>参照房基准</dt>
              <dd>{last.target ?? '无市场基准'}</dd>
            </div>
            <div>
              <dt>历史合作区</dt>
              <dd>
                {last.lower === null || last.upper === null
                  ? '无市场基准'
                  : `${last.lower} – ${last.upper}`}
              </dd>
            </div>
            {last.groups.map((g) => (
              <div key={g.group}>
                <dt>{g.group}高价线</dt>
                <dd>{g.cutoff ?? missingMarketLabel(g)}</dd>
              </div>
            ))}
          </dl>
        )}
        {actions.map((p) => {
          if (p.action.type === 'withdraw') return null;
          const group = p.action.group;
          const cutoff = last?.groups.find((g) => g.group === group)?.cutoff;
          return (
            <dl
              key={p.action.group}
              className="market-exact-values"
              aria-label={`目标 ${p.action.group} 精确数值`}
            >
              <div>
                <dt>目标 {p.action.group} 名义报价</dt>
                <dd>{p.action.amount}</dd>
              </div>
              <div>
                <dt>市场等价</dt>
                <dd>{p.marketEquivalent}</dd>
              </div>
              {cutoff != null && (
                <div>
                  <dt>市场差值</dt>
                  <dd>{p.marketEquivalent! - cutoff}</dd>
                </div>
              )}
              <div>
                <dt>{p.scoringRange ? '计分区间' : '计分等价'}</dt>
                <dd>
                  {p.scoringRange
                    ? p.scoringRange.join(' – ')
                    : p.scoringEquivalent}
                </dd>
              </div>
            </dl>
          );
        })}
        <div className="market-impact-limit">
          <span>
            {kind === 'bid' ? '竞拍' : '扰乱'} · 单目标理论市场等价上限
          </span>
          <strong title={String(maximum)}>{formatMarketAmount(maximum)}</strong>
        </div>
        <p>
          市场等价对照历史高价线，计分等价／区间对照历史合作区。高价名额包含扰乱占位，不等于最低获奖价。基准线相关道具的实际计分值仍由本房结算确定。
        </p>
      </details>
    </div>
  );
}
