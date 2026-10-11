import { ItemIcon } from './item-icon';
import {
  itemPresentations,
  type ActiveClientGameState,
  type PlayerTurn,
} from '@/lib/game';
import { getBuildSummary, getQuotePreviews } from '@/lib/ui/player-build';
import { ItemBadges } from './item-badges';

export function BuildStatus({
  game,
  onOpen,
}: {
  game: ActiveClientGameState;
  onOpen: () => void;
}) {
  const summary = getBuildSummary(game);
  return (
    <button
      type="button"
      className="build-status-strip"
      onClick={onOpen}
      aria-label="查看构筑与当前状态"
    >
      <span className="item-badge item-badge-sky">
        临时屏障 <b>{summary.temporaryShields}</b>
      </span>
      <span className="item-badge item-badge-blue">
        持久屏障 <b>{summary.persistentShields}</b>
      </span>
      <span className="item-badge item-badge-steel">
        {summary.canDoubleBid || summary.canDoubleDisrupt
          ? `双行动：${[summary.canDoubleBid && '竞拍', summary.canDoubleDisrupt && '扰乱'].filter(Boolean).join(' / ')}`
          : '单行动'}
      </span>
      <span className="item-badge item-badge-neutral">
        道具 <b>{summary.itemCount}</b> ›
      </span>
    </button>
  );
}
export function QuotePreview({
  game,
  turn,
}: {
  game: ActiveClientGameState;
  turn: PlayerTurn;
}) {
  const player = game.players.find((p) => p.id === game.humanPlayerId)!;
  const previews = getQuotePreviews(player, turn);
  return (
    <div className="quote-preview" aria-label="当前报价的四种数值">
      <div className="quote-preview-heading">
        <strong>
          {game.phase === 'room_action' ? '当前报价预览' : '提交时报价'}
        </strong>
        <small>不预测秘密市场与最终积分</small>
      </div>
      {previews.map((preview, index) => (
        <div className="quote-preview-row" key={index}>
          <strong>
            {preview.action.type === 'withdraw'
              ? '观望'
              : `${preview.action.group} · ${preview.action.type === 'bid' ? '竞拍' : '扰乱'}`}
          </strong>
          <dl>
            {[
              ['名义报价', preview.nominal],
              ['实际扣款', preview.actualCost],
              ['市场等价', preview.marketEquivalent],
              ['计分等价', preview.scoringEquivalent],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  {value === null
                    ? '—'
                    : typeof value === 'number'
                      ? Number(value.toFixed(4))
                      : value}
                </dd>
              </div>
            ))}
          </dl>
          {preview.scoringRange && (
            <small>
              计分调整区间 {Number(preview.scoringRange[0]!.toFixed(4))} –{' '}
              {Number(preview.scoringRange[1]!.toFixed(4))}
              ；基准线公开后才确定实际取值，不改变合作资格。
            </small>
          )}
        </div>
      ))}
    </div>
  );
}
export function PlayerBuild({
  game,
  turn,
}: {
  game: ActiveClientGameState;
  turn?: PlayerTurn;
}) {
  const summary = getBuildSummary(game);
  return (
    <div className="player-build-content">
      <p className="utility-notice">
        这里仅展示你已持有的道具与真实状态，不包含本房间尚未获得的奖励或其他玩家的秘密行动。
      </p>
      <div className="build-summary-grid">
        <article>
          <span>临时屏障</span>
          <strong>{summary.temporaryShields}</strong>
          <small>剩余次数；换层按神圣屏障份数重置。</small>
        </article>
        <article>
          <span>持久屏障</span>
          <strong>{summary.persistentShields}</strong>
          <small>跨层保留，消耗后不自动恢复。</small>
        </article>
        <article>
          <span>可用双行动</span>
          <strong>
            {[
              summary.canDoubleBid && '竞拍',
              summary.canDoubleDisrupt && '扰乱',
            ]
              .filter(Boolean)
              .join(' / ') || '无'}
          </strong>
          <small>
            双竞拍名义总额 ≤ 当前资金 50%；双扰乱每笔 ≤ 50%。双行动积分 ×
            {summary.doubleMultiplier}。
          </small>
        </article>
        <article>
          <span>库存总份数</span>
          <strong>{summary.itemCount}</strong>
          <small>
            {summary.inventory.length} 类道具；非叠加副本仍是独立库存。
          </small>
        </article>
      </div>
      <section className="build-effects" aria-labelledby="build-effects-title">
        <h3 id="build-effects-title">当前生效效果</h3>
        <div className="build-effect-grid">
          {summary.effects.map((effect) => (
            <article key={effect.label}>
              <span>{effect.label}</span>
              <strong>{effect.value}</strong>
              <p>{effect.note}</p>
            </article>
          ))}
        </div>
      </section>
      {turn && <QuotePreview game={game} turn={turn} />}
      <section aria-labelledby="build-inventory-title">
        <div className="build-inventory-heading">
          <h3 id="build-inventory-title">已持有道具</h3>
          <span>
            {summary.itemCount} 份 · {summary.inventory.length} 类
          </span>
        </div>
        {summary.inventory.length === 0 ? (
          <p className="utility-notice">当前未持有道具。</p>
        ) : (
          <div className="build-inventory-grid">
            {summary.inventory.map(({ item, count, effectiveCopies }) => (
              <article className="build-item" key={item.id}>
                <div className="build-item-heading">
                  <ItemIcon itemId={item.id} size="medium" />
                  <h4>{item.name}</h4>
                  <b>×{count}</b>
                </div>
                <p>{itemPresentations[item.id].description}</p>
                <ItemBadges item={item} />
                <small>
                  {item.effectStacks
                    ? `${effectiveCopies} 份参与叠加。`
                    : `效果只生效一次；${count} 份均保留在库存。`}
                </small>
                {item.id === 'guppys_collar' && (
                  <small>
                    本层已检查 {summary.human.triggeredCollarsThisFloor.length}{' '}
                    份项圈；进入下一房间才检查触发条件。
                  </small>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
      <p className="build-footnote">
        显示的是当前阶段状态。条件触发、随机倍率、屏障返款与奖励变化以结算记录为准。
      </p>
    </div>
  );
}
