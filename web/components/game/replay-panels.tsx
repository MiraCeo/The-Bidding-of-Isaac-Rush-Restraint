import { useId, useRef, useState } from 'react';
import { getItemDefinition } from '@/lib/game';
import { ItemIcon } from './item-icon';
import { ReplayMarket } from './replay-market';
import { ReplayFieldChart } from './replay-field-chart';
import { ReplayScoreTimeline } from './replay-score-timeline';
import { ReplayMoneyTimeline } from './replay-money-timeline';
import { ReplayEvents } from './replay-events';
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
  replayOverview,
  replayOwnedItems,
  replayFloorGroups,
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

export function ReplayRoomPanel(
  props: ReplayPanelProps & { cooperationRadius: number; scoreNote?: string },
) {
  const { record, playerId, name, score } = props;
  const [scoreOpen, setScoreOpen] = useState(false);
  const scoreDetailsId = useId();
  const scoreToggle = useRef<HTMLButtonElement>(null);
  const row = replaySelectedResult(record, playerId),
    b = row.breakdown;
  const special = replayOutcomeLabels(record, playerId),
    owned = replayOwnedItems(record, playerId);
  return (
    <div className="replay-room-panel" id="replay-personal-result">
      <div className="replay-action-summary">
        {row.actions.map((a) => (
          <span
            className={'replay-action-chip action-' + a.action.type}
            key={a.actionIndex}
          >
            {actionText(a.action)}
          </span>
        ))}
        <span>本房实际提交 · {row.actions.length}个行动</span>
      </div>
      <div className="replay-summary-grid">
        <article className="replay-score-hero">
          <span>最终房间积分</span>
          <strong>{score(row.score.finalScore)}</strong>
          <small>
            {props.scoreNote ??
              `结算后累计 ${score(row.after.score)} · 不含终局王冠倍率`}
          </small>
          <div className="replay-score-brief">
            <span>
              原始房分 <b>{score(row.score.initialScore)}</b>
            </span>
            <span>
              追溯追加 <b>+{score(row.score.retroactiveScore)}</b>
            </span>
          </div>
          <button
            type="button"
            className="replay-score-toggle"
            ref={scoreToggle}
            aria-expanded={scoreOpen}
            aria-controls={scoreDetailsId}
            onClick={() => setScoreOpen((open) => !open)}
          >
            {scoreOpen ? '收起计分过程' : '查看这笔分数的计分过程'}{' '}
            <span aria-hidden="true">{scoreOpen ? '−' : '+'}</span>
          </button>
        </article>
        <article className="replay-cash-hero">
          <span>资金变化</span>
          <strong
            className={row.moneyDelta < 0 ? 'value-negative' : 'value-positive'}
          >
            {signed(row.moneyDelta)}
          </strong>
          <small>
            入房 {row.before.money} → 结算资金 {row.after.money}
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
              ? (row.floorReset ? '换层重置／入房效果：' : '入房变化：') +
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
            本房新获得 {row.awards.reduce((n, a) => n + a.copies, 0)}份 · 库存{' '}
            {row.before.items.length} → {row.after.items.length}
          </small>
          <small>
            临时屏障 {row.before.temporaryShields} →{' '}
            {row.after.temporaryShields} · 持久屏障{' '}
            {row.before.persistentShields} → {row.after.persistentShields}
          </small>
        </article>
        <section
          className="replay-calculation-details replay-score-expanded"
          id={scoreDetailsId}
          hidden={!scoreOpen}
        >
          <header>
            <div>
              <h3>本房计分过程 · {name(playerId)}</h3>
              <p>对应上方最终房间积分 {score(row.score.finalScore)}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setScoreOpen(false);
                scoreToggle.current?.focus();
              }}
            >
              收起
            </button>
          </header>

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
        </section>
        <article className="replay-owned-items">
          <div className="replay-section-heading">
            <h3>现在拥有的道具</h3>
            <span>
              {name(playerId)} · 本房结算后快照 · {row.after.items.length}份
            </span>
          </div>
          <div className="replay-inventory-chips">
            {owned.length ? (
              owned.map((item) => (
                <span
                  key={item.itemId}
                  className={item.gained ? 'is-new-item' : ''}
                  title={
                    getItemDefinition(item.itemId).effectStacks
                      ? undefined
                      : '保留实际副本数量，效果不叠加'
                  }
                >
                  <ItemIcon itemId={item.itemId} size="small" />
                  <b>{getItemDefinition(item.itemId).name}</b>
                  <span>×{item.copies}</span>
                  {item.gained > 0 && <small>本房 +{item.gained}</small>}
                </span>
              ))
            ) : (
              <p className="replay-muted">本房结束时没有持有道具。</p>
            )}
          </div>
        </article>
      </div>
      <ReplayMarket
        record={record}
        playerId={playerId}
        name={name}
        radius={props.cooperationRadius}
      />
      <details className="replay-event-details">
        <summary>查看本房关键事件</summary>
        <ReplayEvents {...props} />
      </details>
    </div>
  );
}
function ReplayRewardDestinations({
  record,
  playerId,
  name,
  onInspect,
}: ReplayPanelProps & { onInspect: (id: string) => void }) {
  const s = record.settlement;
  return (
    <section className="replay-reward-destinations">
      <div className="replay-section-heading">
        <h3>奖励最终去了哪里</h3>
        <span>本房全场实际发放，不只看当前玩家</span>
      </div>
      <div className="replay-reward-groups">
        {s.room.rewards.map((reward) => {
          const awards = s.awards.filter((a) => a.group === reward.group);
          const causes = s.events.filter(
            (e) =>
              e.group === reward.group &&
              (e.type === 'destroy' || e.type === 'duplicate'),
          );
          return (
            <article key={reward.group}>
              <header>
                <span className="replay-group-letter">{reward.group}</span>
                <ItemIcon itemId={reward.itemId} size="medium" />
                <h4>{getItemDefinition(reward.itemId).name}</h4>
                <span>
                  {awards.length}人 · {awards.reduce((n, a) => n + a.copies, 0)}
                  份
                </span>
              </header>
              <div className="replay-award-recipients">
                {awards.length ? (
                  awards.map((a) => (
                    <button
                      key={a.playerId}
                      type="button"
                      className={a.playerId === playerId ? 'is-selected' : ''}
                      onClick={() => onInspect(a.playerId)}
                      aria-label={`查看${name(a.playerId)}的${reward.group}组获奖复盘`}
                    >
                      {name(a.playerId)} <b>×{a.copies}</b>
                    </button>
                  ))
                ) : (
                  <p className="replay-muted">此目标没有实际发放道具。</p>
                )}
              </div>
              <small>
                高价占位{' '}
                {
                  s.highPricePlacements.filter((p) => p.group === reward.group)
                    .length
                }{' '}
                · 合作占位{' '}
                {
                  s.cooperationPlacements.filter(
                    (p) => p.group === reward.group,
                  ).length
                }{' '}
                · 最终资格{' '}
                {s.entitlements.filter((e) => e.group === reward.group).length}
              </small>
              {causes.length > 0 && (
                <ul className="replay-reward-causes">
                  {causes.map((e, i) => (
                    <li key={i}>
                      <b>{name(e.playerId)}</b> · {replayEventText(e, name)}
                    </li>
                  ))}
                </ul>
              )}
              {reward.hidden && <small>当时为未知奖励，结算后公开。</small>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
export function ReplayFieldPanel(
  props: ReplayPanelProps & {
    onInspect: (id: string) => void;
  },
) {
  const { record, playerId, name, score, onInspect } = props;
  const rows = replayPlayerRows(record);
  return (
    <section className="replay-field-panel">
      <ReplayFieldChart {...props} />
      <ReplayRewardDestinations {...props} />
      <section className="replay-field-table-section">
        <div className="replay-section-heading">
          <h3>全场行动与结算 · {rows.length}人</h3>
          <span>点击玩家进入本房个人复盘</span>
        </div>
        <section className="replay-table-wrap" aria-label="本房全场明细表">
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
                        (a) =>
                          getItemDefinition(a.itemId).name + ' ×' + a.copies,
                      )
                      .join('、') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </section>
      <details className="replay-global-qualifications">
        <summary>展开全场占位、资格与发放依据</summary>
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
                  <th>特殊结果</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const v = replayRewardVerdict(
                    record,
                    r.after.id,
                    reward.group,
                  );
                  const placements = [
                    ...record.settlement.highPricePlacements
                      .filter(
                        (p) =>
                          p.group === reward.group && p.playerId === r.after.id,
                      )
                      .map(
                        (p) =>
                          '高价' +
                          (p.actionType === 'disrupt' ? '扰乱' : '竞拍'),
                      ),
                    ...record.settlement.cooperationPlacements
                      .filter(
                        (p) =>
                          p.group === reward.group && p.playerId === r.after.id,
                      )
                      .map(
                        (p) =>
                          '合作' +
                          (p.actionType === 'disrupt' ? '扰乱' : '竞拍'),
                      ),
                  ];
                  return (
                    <tr key={r.after.id}>
                      <th scope="row">{name(r.after.id)}</th>
                      <td>{placements.join(' / ') || '—'}</td>
                      <td>
                        {v.entitlement?.sources
                          .map((s) => entitlementNames[s] ?? s)
                          .join(' / ') || '—'}
                      </td>
                      <td>{v.award?.copies ?? 0}</td>
                      <td>
                        {v.causes
                          .map((e) => replayEventText(e, name))
                          .join('；') || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}
      </details>
      <details className="replay-event-details">
        <summary>查看本房全场事件记录</summary>
        <ReplayEvents {...props} allPlayers />
      </details>
    </section>
  );
}
export function ReplayOverviewPanel({
  log,
  roomIndex,
  playerId,
  name,
  score,
  onRoom,
  onFocusPlayer,
  onInspectAt,
  onReferenceRoom,
}: {
  log: ReplayLog;
  roomIndex: number;
  playerId: string;
  name: (id: string) => string;
  score: (v: number) => string;
  onRoom: (i: number) => void;
  onFocusPlayer: (id: string) => void;
  onInspectAt: (id: string, index: number) => void;
  onReferenceRoom: (index: number) => void;
}) {
  const overview = replayOverview(log, playerId);
  const floors = replayFloorGroups(log, playerId);
  return (
    <section className="replay-overview-panel">
      <div className="replay-section-heading">
        <h3>整局汇总 · {name(playerId)}</h3>
        <span>涵盖全部{log.rooms.length}个已结算房间</span>
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
      <section className="replay-floor-totals">
        <h3>逐层表现</h3>
        <div>
          {floors.map((floor) => (
            <article key={floor.floor}>
              <span>
                第{floor.floor + 1}层 · {floor.rooms.length}房
              </span>
              <strong>+{score(floor.total)}</strong>
              <small>
                获得{floor.rooms.reduce((n, r) => n + r.awards, 0)}份道具
              </small>
            </article>
          ))}
        </div>
      </section>
      <ReplayScoreTimeline
        log={log}
        roomIndex={roomIndex}
        playerId={playerId}
        name={name}
        score={score}
        onFocusPlayer={onFocusPlayer}
        onInspectAt={onInspectAt}
        onReferenceRoom={onReferenceRoom}
      />
      <ReplayMoneyTimeline
        log={log}
        playerId={playerId}
        roomIndex={roomIndex}
        name={name}
        onRoom={onRoom}
      />
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
    </section>
  );
}
