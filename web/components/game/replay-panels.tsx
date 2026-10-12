import { useState } from 'react';
import { getItemDefinition } from '@/lib/game';
import { defaultRules } from '@/lib/game/config';
import { ItemIcon } from './item-icon';
import { ReplayMarket } from './replay-market';
import type { ReplayLog, ReplayRoomRecord } from '@/lib/ui/replay-record';
import {
  replayPlayerRows,
  replayOutcomeLabels,
  replayEventText,
  entitlementNames,
} from '@/lib/ui/replay-display';
import {
  replaySelectedResult,
  replayRewardVerdict,
  replayEventStages,
  replayOverview,
} from '@/lib/ui/replay-view-model';

export type ReplayPanelProps = {
  record: ReplayRoomRecord;
  playerId: string;
  name: (id: string) => string;
  score: (v: number) => string;
};
const number = (v: number | null | undefined) =>
  v == null ? '—' : Number(v.toFixed(4));
const signed = (v: number) => (v > 0 ? '+' : '') + number(v);
export const actionText = (
  a: ReplayRoomRecord['settlement']['resolvedActions'][number]['action'],
) =>
  a.type === 'withdraw'
    ? '观望'
    : a.group + ' · ' + (a.type === 'bid' ? '竞拍 ' : '扰乱 ') + a.amount;

export function ReplayRoomPanel(props: ReplayPanelProps) {
  const { record, playerId, name, score } = props;
  const row = replaySelectedResult(record, playerId);
  const b = row.breakdown;
  const special = replayOutcomeLabels(record, playerId);
  return (
    <div className="replay-room-panel">
      <div className="replay-action-summary">
        {row.actions.map((a) => (
          <span
            className={'replay-action-chip action-' + a.action.type}
            key={a.actionIndex}
          >
            {actionText(a.action)}
          </span>
        ))}
        <span>实际提交 · {row.actions.length}个行动</span>
      </div>
      <div className="replay-summary-grid">
        <article className="replay-score-hero">
          <span>最终房间积分</span>
          <strong>{score(row.score.finalScore)}</strong>
          <small>
            累计 {score(row.after.score)} · 原始 {score(row.score.initialScore)}{' '}
            ＋ 追溯 {score(row.score.retroactiveScore)}
          </small>
        </article>
        <article className="replay-cash-hero">
          <span>资金变化</span>
          <strong
            className={row.moneyDelta < 0 ? 'value-negative' : 'value-positive'}
          >
            {signed(row.moneyDelta)}
          </strong>
          <small>
            入房 {row.before.money} → 结算 {row.after.money}
          </small>
          <div className="replay-cash-breakdown">
            <span>
              扣款 <b>−{row.cost}</b>
            </span>
            <span>
              返款 <b>+{row.refund}</b>
            </span>
            {row.otherMoneyChange !== 0 && (
              <span>
                其他结算变化 <b>{signed(row.otherMoneyChange)}</b>
              </span>
            )}
          </div>
          <small>
            {row.previous
              ? (row.floorReset ? '换层资金重置／入房效果：' : '入房变化：') +
                row.previous.money +
                ' → ' +
                row.before.money
              : '首房初始资金；不存在上一房'}
          </small>
        </article>
        <article className="replay-award-hero">
          <span>实际获得</span>
          <div className="replay-award-icons">
            {row.awards.length ? (
              row.awards.map((a) => (
                <span key={a.group}>
                  <ItemIcon itemId={a.itemId} size="small" />
                  <b>
                    {getItemDefinition(a.itemId).name} ×{a.copies}
                  </b>
                </span>
              ))
            ) : (
              <strong>未获得道具</strong>
            )}
          </div>
          <small>
            库存 {row.before.items.length} → {row.after.items.length} · 临时屏障{' '}
            {row.before.temporaryShields} → {row.after.temporaryShields} ·
            持久屏障 {row.before.persistentShields} →{' '}
            {row.after.persistentShields}
          </small>
        </article>
      </div>
      <section className="replay-score-section">
        <div className="replay-section-heading">
          <h3>这笔分数怎么来的</h3>
          <span>记录中的计分过程</span>
        </div>
        <ol className="replay-score-chain" aria-label="本房计分过程">
          {[
            [
              '行动小计',
              score(b?.actions.reduce((sum, a) => sum + a.subtotal, 0) ?? 0),
            ],
            [
              '综合倍率',
              '×' + number(b?.multiplier) + (b?.cleared ? ' · 清零' : ''),
            ],
            ['原始房分', score(row.score.initialScore)],
            ['追溯追加', '+' + score(row.score.retroactiveScore)],
            ['最终房分', score(row.score.finalScore)],
          ].map(([label, value], i) => (
            <li key={label}>
              <span className="replay-step-number">{i + 1}</span>
              <span>
                {label}
                <b>{value}</b>
              </span>
            </li>
          ))}
        </ol>
        <details className="replay-calculation-details">
          <summary>展开实际行动与计分明细</summary>
          <div className="replay-actions">
            {row.actions.map((a) => {
              const detail = b?.actions.find(
                (v) => v.actionIndex === a.actionIndex,
              );
              return (
                <article key={a.actionIndex}>
                  <h4>{actionText(a.action)}</h4>
                  <dl>
                    {[
                      [
                        '名义报价',
                        a.action.type === 'withdraw' ? null : a.action.amount,
                      ],
                      ['实际扣款', a.actualCost],
                      ['市场等价', a.marketEquivalent],
                      ['原始计分等价', a.scoringEquivalent],
                      ['实际计分取值', detail?.scoringValue],
                      ['基础积分', detail?.baseScore],
                      ['行动加算', detail?.additiveScore],
                      ['乘算前小计', detail?.subtotal],
                    ].map(([label, value]) => (
                      <div key={String(label)}>
                        <dt>{label}</dt>
                        <dd>{number(value as number | null | undefined)}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              );
            })}
          </div>
          {special.length ? (
            <ul className="replay-outcomes">
              {special.map((text, i) => (
                <li key={i}>{text}</li>
              ))}
            </ul>
          ) : (
            <p className="replay-muted">没有记录的特殊效果。</p>
          )}
        </details>
      </section>
      <div className="replay-room-body">
        <section className="replay-verdict-section">
          <div className="replay-section-heading">
            <h3>奖励最终去了哪里</h3>
            <span>占位 ≠ 资格 ≠ 发放</span>
          </div>
          <div className="replay-verdicts">
            {(['A', 'B'] as const).map((group) => {
              const v = replayRewardVerdict(record, playerId, group);
              return (
                <article key={group} className={'verdict-' + v.status}>
                  <header>
                    <span className="replay-group-letter">{group}</span>
                    <ItemIcon itemId={v.reward.itemId} size="medium" />
                    <h4>{getItemDefinition(v.reward.itemId).name}</h4>
                    <b className={'replay-verdict-badge verdict-' + v.status}>
                      {v.award
                        ? '获得 ×' + v.award.copies
                        : v.entitlement
                          ? '未发放'
                          : v.status === 'occupied'
                            ? '扰乱占位'
                            : '未获资格'}
                    </b>
                  </header>
                  <p>
                    {v.actions.map((a) => actionText(a.action)).join('；') ||
                      '没有向此目标报价'}
                  </p>
                  <div className="replay-verdict-path">
                    <span>资格</span>
                    <strong>
                      {v.entitlement
                        ? v.entitlement.sources
                            .map((s) => entitlementNames[s] ?? s)
                            .join(' / ')
                        : v.status === 'occupied'
                          ? '占位后不直接领奖'
                          : '未取得'}
                    </strong>
                    <span>发放</span>
                    <strong>
                      {v.award ? '实际获得 ×' + v.award.copies : '未获得道具'}
                    </strong>
                  </div>
                  {v.causes.map((e, i) => (
                    <p className="replay-cause" key={i}>
                      {replayEventText(e, name)}
                    </p>
                  ))}
                  {v.reward.hidden && (
                    <small>当时为未知奖励，结算后公开。</small>
                  )}
                </article>
              );
            })}
          </div>
        </section>
        <ReplayMarket
          record={record}
          playerId={playerId}
          name={name}
          radius={
            defaultRules.floorStartingMoney[
              record.settlement.room.floorIndex
            ]! * defaultRules.cooperationZoneRatio
          }
        />
      </div>
      <ReplayEvents {...props} />
      <details className="replay-inventory">
        <summary>
          {name(playerId)}的结算后完整库存 · {row.after.items.length}份
        </summary>
        <div className="replay-inventory-chips">
          {[...new Set(row.after.items.map((i) => i.itemId))].map((id) => (
            <span key={id}>
              <ItemIcon itemId={id} size="small" />
              {getItemDefinition(id).name} ×
              {row.after.items.filter((i) => i.itemId === id).length}
            </span>
          ))}
        </div>
        <details>
          <summary>实例与获得顺序</summary>
          <ul>
            {row.after.items.map((i) => (
              <li key={i.instanceId}>
                {getItemDefinition(i.itemId).name}
                <code>
                  {i.instanceId} · #{i.acquiredOrder}
                </code>
              </li>
            ))}
          </ul>
        </details>
      </details>
    </div>
  );
}
function ReplayEvents({ record, playerId, name }: ReplayPanelProps) {
  const [allEvents, setAllEvents] = useState(false);
  const stages = replayEventStages(record, playerId, allEvents);
  const labels = {
    cost: '扣款',
    score: '积分',
    entitlement: '资格',
    refund: '返款',
    destroy: '毁奖',
    duplicate: '复制',
    award: '获取',
    money: '资金',
    trigger: '触发',
  };
  return (
    <section className="replay-timeline-section">
      <div className="replay-section-heading">
        <h3>关键事件时间线</h3>
        <label className="replay-toggle">
          <input
            type="checkbox"
            checked={allEvents}
            onChange={(e) => setAllEvents(e.target.checked)}
          />
          显示全场原始事件
        </label>
      </div>
      <p className="replay-muted">
        按原记录顺序展示；默认包含所选玩家及关联资金转移。
      </p>
      <div className="replay-events-grid">
        {stages.map((stage) => (
          <div className="replay-event-stage" key={stage.title}>
            <h4>
              {stage.title}
              <small>{stage.events.length}条</small>
            </h4>
            {stage.events.length ? (
              <ol className="replay-events">
                {stage.events.map((e, i) => (
                  <li key={i}>
                    <span className={'replay-event-badge event-' + e.type}>
                      {labels[e.type]}
                    </span>
                    <div>
                      <span className="replay-event-owner">
                        {name(e.playerId)}
                        {e.group ? ' · ' + e.group : ''}
                        {e.effectItemId || e.itemId
                          ? ' · ' +
                            getItemDefinition(e.effectItemId ?? e.itemId!).name
                          : ''}
                      </span>
                      <p>{replayEventText(e, name)}</p>
                    </div>
                    {e.amount !== undefined && (
                      <b className="replay-event-amount">{number(e.amount)}</b>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="replay-muted">无相关事件。</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
export function ReplayFieldPanel({
  record,
  playerId,
  name,
  score,
  onInspect,
}: ReplayPanelProps & { onInspect: (id: string) => void }) {
  const rows = replayPlayerRows(record);
  return (
    <section className="replay-field-panel">
      <div className="replay-section-heading">
        <h3>本房全场明细 · {rows.length}人</h3>
        <span>点击玩家，返回个人复盘</span>
      </div>
      <div className="replay-table-wrap">
        <table className="result-table replay-table">
          <caption className="sr-only">本房全场玩家快照</caption>
          <thead>
            <tr>
              {[
                '玩家',
                '实际行动',
                '入房 → 结算资金',
                '原始房分',
                '追溯追加',
                '最终房分',
                '累计积分',
                '实际获得',
              ].map((t) => (
                <th scope="col" key={t}>
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.after.id}
                className={r.after.id === playerId ? 'ranking-row-self' : ''}
              >
                <th scope="row">
                  <button
                    type="button"
                    className="replay-player-link"
                    onClick={() => onInspect(r.after.id)}
                  >
                    {name(r.after.id)}
                  </button>
                </th>
                <td>
                  {record.settlement.resolvedActions
                    .filter((a) => a.playerId === r.after.id)
                    .map((a) => actionText(a.action))
                    .join('；')}
                </td>
                <td>
                  {r.before.money} → {r.after.money}
                </td>
                <td>{score(r.score.initialScore)}</td>
                <td>{score(r.score.retroactiveScore)}</td>
                <td>{score(r.score.finalScore)}</td>
                <td>{score(r.after.score)}</td>
                <td>
                  {r.awards
                    .map(
                      (a) => getItemDefinition(a.itemId).name + ' ×' + a.copies,
                    )
                    .join('、') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="replay-global-qualifications">
        <summary>全场资格来源与实际发放</summary>
        {record.settlement.room.rewards.map((reward) => (
          <section key={reward.group}>
            <h4>
              {reward.group} · {getItemDefinition(reward.itemId).name}
            </h4>
            <table className="replay-qualification-table">
              <thead>
                <tr>
                  <th>玩家</th>
                  <th>占位</th>
                  <th>最终资格</th>
                  <th>实际份数</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const id = r.after.id;
                  const entitlement = record.settlement.entitlements.find(
                    (e) => e.playerId === id && e.group === reward.group,
                  );
                  const placements = [
                    ...record.settlement.highPricePlacements
                      .filter(
                        (p) => p.group === reward.group && p.playerId === id,
                      )
                      .map(
                        (p) =>
                          '高价' +
                          (p.actionType === 'disrupt' ? '扰乱' : '竞拍'),
                      ),
                    ...record.settlement.cooperationPlacements
                      .filter(
                        (p) => p.group === reward.group && p.playerId === id,
                      )
                      .map(
                        (p) =>
                          '合作' +
                          (p.actionType === 'disrupt' ? '扰乱' : '竞拍'),
                      ),
                  ];
                  return (
                    <tr key={id}>
                      <th scope="row">{name(id)}</th>
                      <td>{placements.join(' / ') || '—'}</td>
                      <td>
                        {entitlement?.sources
                          .map((s) => entitlementNames[s] ?? s)
                          .join(' / ') || '—'}
                      </td>
                      <td>
                        {r.awards.find((a) => a.group === reward.group)
                          ?.copies ?? 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}
      </details>
    </section>
  );
}
export function ReplayOverviewPanel({
  log,
  playerId,
  name,
  score,
  index,
  onRoom,
}: {
  log: ReplayLog;
  playerId: string;
  name: (id: string) => string;
  score: (v: number) => string;
  index: number;
  onRoom: (i: number) => void;
}) {
  const overview = replayOverview(log, playerId);
  return (
    <section className="replay-overview-panel">
      <div className="replay-section-heading">
        <h3>{name(playerId)} · 整局概览</h3>
        <span>仅包含已结算房间</span>
      </div>
      <div className="replay-overview-metrics">
        {[
          ['累计积分', score(overview.cumulative)],
          ['总实际扣款', overview.cost],
          ['总返款', overview.refund],
          ['获奖道具份数', overview.awards],
        ].map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>
      {(['score', 'money'] as const).map((metric) => (
        <div className="replay-trend" key={metric}>
          <h4>{metric === 'score' ? '累计积分轨迹' : '结算资金轨迹'}</h4>
          <div className="replay-trend-bars">
            {overview.points.map((p) => {
              const maximum = Math.max(
                1,
                ...overview.points.map((v) => v[metric]),
              );
              return (
                <button
                  key={p.location}
                  type="button"
                  aria-current={p.index === index ? 'step' : undefined}
                  aria-label={
                    '查看' +
                    p.location +
                    (metric === 'score' ? '积分' : '资金') +
                    number(p[metric])
                  }
                  onClick={() => onRoom(p.index)}
                >
                  <span
                    style={{
                      height: Math.max(2, (p[metric] / maximum) * 100) + '%',
                    }}
                  />
                  <small>{p.location}</small>
                  <b>{metric === 'score' ? score(p.score) : p.money}</b>
                </button>
              );
            })}
          </div>
          <p className="replay-muted">
            {metric === 'score'
              ? '结算后累计积分；不含终局王冠倍率。'
              : '换层会重置资金，曲线变化不能直接解释为本房净收益。'}{' '}
            点击柱条查看对应房间。
          </p>
        </div>
      ))}
      <ReplayFinalRanking log={log} name={name} score={score} />
    </section>
  );
}
export function ReplayFinalRanking({
  log,
  name,
  score,
}: {
  log: ReplayLog;
  name: (id: string) => string;
  score: (v: number) => string;
}) {
  if (!log.final) return null;
  return (
    <section className="replay-final-ranking">
      <div className="replay-section-heading">
        <h3>整局终局倍率与排行</h3>
        <span>原记录排序 · 精确同分并列</span>
      </div>
      <div className="replay-table-wrap">
        <table className="result-table replay-table">
          <caption className="sr-only">记录的终局排行</caption>
          <thead>
            <tr>
              {['名次', '玩家', '累计积分', '王冠倍率', '最终积分'].map((t) => (
                <th scope="col" key={t}>
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {log.final.ranking.map((entry) => (
              <tr
                key={entry.playerId}
                className={entry.playerId === 'human' ? 'ranking-row-self' : ''}
              >
                <td>
                  {1 +
                    log.final!.ranking.filter(
                      (p) => p.finalScore > entry.finalScore,
                    ).length}
                </td>
                <th scope="row">{name(entry.playerId)}</th>
                <td>
                  {score(
                    log.final!.players.find((p) => p.id === entry.playerId)!
                      .score,
                  )}
                </td>
                <td>×{number(log.final!.crownMultipliers[entry.playerId])}</td>
                <td>{score(entry.finalScore)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <small className="replay-muted">终局构建：{log.final.build}</small>
    </section>
  );
}
