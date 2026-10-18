import type { RuntimePlayerState, PlayerTurn } from '@/lib/game/item-types';
import type { RulesConfig } from '@/lib/game/types';
import { getQuotePreviews } from '@/lib/ui/player-build';
import type { HistoricalMarket } from '@/lib/ui/market-history';
import { missingMarketLabel } from '@/lib/ui/market-history';
import { MarketHistory } from './market-history';
import {
  formatMarketAmount,
  type QuoteCapacity,
} from '@/lib/ui/quote-capacity';

/** Own draft plus explicitly projected public history only. No roster/private turns. */
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
  return (
    <div className="market-impact-preview">
      <MarketHistory rows={history} onViewReplay={onViewReplay} />
      <section className="market-own-summary" aria-label="我的市场影响">
        <h3>我的报价对照</h3>
        <p className="drawer-description">
          {last
            ? `参照第${last.floorIndex + 1}层第${last.roomIndex + 1}房；不预测本房结果。`
            : '仅预览本人报价；首房不填虚构参照。'}
        </p>
        {actions.length === 0 ? (
          <p className="market-impact-empty">
            {turn.actions.some((a) => a.type === 'withdraw')
              ? '静观其变，不产生市场样本。'
              : '当前没有可用报价。'}
          </p>
        ) : (
          actions.map((preview) => {
            const action = preview.action;
            if (action.type === 'withdraw') return null;
            const market = preview.marketEquivalent!;
            const previous = last?.groups.find((g) => g.group === action.group);
            const difference =
              previous?.cutoff === null || previous?.cutoff === undefined
                ? null
                : market - previous.cutoff;
            const scoring = preview.scoringRange
              ? preview.scoringRange.map(formatMarketAmount).join(' – ')
              : formatMarketAmount(preview.scoringEquivalent!);
            return (
              <section
                className="market-impact-action"
                key={action.group}
                aria-label={`你的目标 ${action.group} 市场影响`}
              >
                <div>
                  <span>
                    目标 {action.group} ·{' '}
                    {action.type === 'bid' ? '竞拍' : '扰乱'}
                  </span>
                  <strong title={String(market)}>
                    市场 {formatMarketAmount(market)}
                  </strong>
                </div>
                <p>
                  名义 {action.amount} × 市场倍率{' '}
                  {formatMarketAmount(market / action.amount)}
                  <br />
                  {preview.scoringRange ? '计分区间' : '计分等价'}{' '}
                  <span
                    title={String(
                      preview.scoringRange ?? preview.scoringEquivalent,
                    )}
                  >
                    {scoring}
                  </span>
                </p>
                {last && (
                  <dl
                    className="market-reference-comparison"
                    aria-label={`目标 ${action.group} 与最近历史房间对照`}
                  >
                    <div>
                      <dt>历史{action.group}高价线</dt>
                      <dd>
                        {previous?.cutoff === null ||
                        previous?.cutoff === undefined ? (
                          <span>
                            {previous ? missingMarketLabel(previous) : '无记录'}
                          </span>
                        ) : (
                          <>
                            <span title={String(previous.cutoff)}>
                              {formatMarketAmount(previous.cutoff)}
                            </span>
                            <small title={String(difference)}>
                              差{' '}
                              {difference === 0
                                ? '0'
                                : `${difference! < 0 ? '−' : '+'}${formatMarketAmount(Math.abs(difference!))}`}
                            </small>
                          </>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>历史合作区</dt>
                      <dd>
                        {last.lower === null || last.upper === null ? (
                          '无市场基准'
                        ) : (
                          <span title={`${last.lower} – ${last.upper}`}>
                            {formatMarketAmount(last.lower)} –{' '}
                            {formatMarketAmount(last.upper)}
                          </span>
                        )}
                      </dd>
                    </div>
                  </dl>
                )}
              </section>
            );
          })
        )}
        {actions.length === 2 && pair && (
          <p className="market-impact-pair">
            双行动名义总额上限 {pair.nominal}；A／B分别对照，不合并成一笔。
          </p>
        )}
      </section>
      <details className="market-impact-help">
        <summary>数值口径与能力上限</summary>
        <div className="market-impact-limit">
          <span>{kind === 'bid' ? '竞拍' : '扰乱'} · 单目标理论上限</span>
          <strong title={String(maximum)}>{formatMarketAmount(maximum)}</strong>
        </div>
        <p>
          市场等价对照对应组历史高价边界，计分等价／区间对照历史合作区。历史高价名额包含扰乱占位，不等于最低获奖价。基准线相关道具仍需按本房结算确定实际计分值；历史差值不表示胜率、推荐报价或最终积分。
        </p>
      </details>
    </div>
  );
}
