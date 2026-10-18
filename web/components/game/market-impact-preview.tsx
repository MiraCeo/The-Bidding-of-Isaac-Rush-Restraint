import { getRuntimeActionAmounts } from '@/lib/game/turns';
import type { RuntimePlayerState, PlayerTurn } from '@/lib/game/item-types';
import type { RulesConfig } from '@/lib/game/types';
import {
  formatMarketAmount,
  type QuoteCapacity,
} from '@/lib/ui/quote-capacity';

/** Own draft only: this component does not receive the roster or secret turns. */
export function MarketImpactPreview({
  player,
  turn,
  kind,
  capacity,
  rules,
}: {
  player: RuntimePlayerState;
  turn: PlayerTurn;
  kind: 'bid' | 'disrupt';
  capacity: QuoteCapacity;
  rules: RulesConfig;
}) {
  const actions = turn.actions.filter((action) => action.type !== 'withdraw');
  const maximum = capacity[kind].marketEquivalent;
  const pair = kind === 'bid' ? capacity.doubleBid : capacity.doubleDisrupt;
  return (
    <div className="market-impact-preview">
      <p className="drawer-description">
        只展示你的报价及市场等价；他人行动与共同基准线在结算后公开。
      </p>
      <div className="market-impact-limit">
        <span>{kind === 'bid' ? '竞拍' : '扰乱'} · 单目标理论上限</span>
        <strong title={String(maximum)}>{formatMarketAmount(maximum)}</strong>
      </div>
      {actions.length === 0 ? (
        <p className="market-impact-empty">
          {turn.actions.some((action) => action.type === 'withdraw')
            ? '静观其变，不产生市场样本。'
            : '当前没有可用报价。'}
        </p>
      ) : (
        actions.map((action) => {
          const resolved = getRuntimeActionAmounts(player, action, rules);
          const market = resolved.marketEquivalent ?? 0;
          const ratio =
            maximum > 0
              ? Math.min(100, Math.max(0, (market / maximum) * 100))
              : 0;
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
                  {formatMarketAmount(market)}
                </strong>
              </div>
              <div className="market-impact-track" aria-hidden="true">
                <i style={{ width: `${ratio}%` }} />
              </div>
              <p>
                名义 {action.amount} × 市场倍率{' '}
                {formatMarketAmount(market / action.amount)}
              </p>
            </section>
          );
        })
      )}
      {actions.length === 2 && pair && (
        <p className="market-impact-pair">
          双行动名义总额上限 {pair.nominal}
          ；两份样本分别参与名额排序，不合并为一笔。
        </p>
      )}
      <details className="market-impact-help">
        <summary>数值口径</summary>
        <p>
          进度条只比较你的报价与单目标理论上限，不表示竞争力或获奖概率。市场等价不等于计分等价，合作距离按计分等价判断。
        </p>
      </details>
    </div>
  );
}
