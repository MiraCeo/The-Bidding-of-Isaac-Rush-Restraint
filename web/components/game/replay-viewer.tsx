import { ItemIcon } from './item-icon';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { getItemDefinition, characterNames } from '@/lib/game';
import {
  replayRoomLocator,
  type ReplayLog,
  type ReplayRoomRecord,
} from '@/lib/ui/replay-record';
import {
  replayOutcomeLabels,
  replayPlayerRows,
  replayRoomNames,
  replayStrategyNames,
  entitlementNames,
  replayEventRelatedTo,
  replayEventText,
} from '@/lib/ui/replay-display';
import { serializeReplay } from '@/lib/ui/game-replay';
import { readBuildVersion } from '@/lib/ui/game-version';
import { downloadJsonFile } from '@/lib/ui/json-download';
import { useSessionTools } from './session-context';
import { ItemBadges } from './item-badges';
import { defaultRules } from '@/lib/game/config';
import { ReplayMarket } from './replay-market';

function amount(value: number | null | undefined) {
  return value == null ? '—' : Number(value.toFixed(4));
}
export function ReplayViewer() {
  const tools = useSessionTools();
  if (!tools) return <p className="utility-notice">当前没有可读取的回放。</p>;
  const log =
    tools.replaySource === 'file'
      ? tools.importedReplay?.replay
      : tools.session.replay;
  return (
    <div className="replay-page-content">
      <div className="replay-source-tabs" aria-label="回放来源">
        <Button
          type="button"
          variant={tools.replaySource === 'current' ? 'default' : 'secondary'}
          disabled={!tools.session.replay?.rooms.length}
          onClick={() => tools.onReplaySourceChange('current')}
        >
          本局记录
        </Button>
        <Button
          type="button"
          variant={tools.replaySource === 'file' ? 'default' : 'secondary'}
          disabled={!tools.importedReplay}
          onClick={() => tools.onReplaySourceChange('file')}
        >
          读取的回放文件
        </Button>
        <span>
          {tools.replaySource === 'file'
            ? '文件只读查看，不替换当前对局'
            : '本局只显示已结算房间'}
        </span>
      </div>
      {log ? (
        <ReplayArchive
          key={`${tools.replaySource}:${log.id}:${tools.replaySource === 'file' ? tools.importedReplay?.exportedAt : 'live'}`}
          log={log}
          scoreDecimals={tools.preferences.scoreDecimals}
        />
      ) : (
        <p className="utility-notice">暂无回放，请从设置页读取回放JSON。</p>
      )}
    </div>
  );
}
export function ReplayArchive({
  log,
  scoreDecimals = 2,
}: {
  log: ReplayLog;
  scoreDecimals?: 2 | 4;
}) {
  const [index, setIndex] = useState(0);
  const [playerId, setPlayerId] = useState('human');
  const [allEvents, setAllEvents] = useState(false);
  const [message, setMessage] = useState('');
  const [locatorOpen, setLocatorOpen] = useState(false);
  const record = log.rooms[Math.min(index, Math.max(0, log.rooms.length - 1))];
  const score = (value: number) => value.toFixed(scoreDecimals);
  const name = (id: string) => log.playerNames[id] ?? id;
  const locator = record ? replayRoomLocator(log, record) : log.id;
  async function copyLocator() {
    try {
      await navigator.clipboard.writeText(locator);
      setMessage('房间定位已复制。');
    } catch {
      setLocatorOpen(true);
      setMessage('定位详情已展开，可选中文字手动复制。');
    }
  }
  function exportArchive() {
    try {
      downloadJsonFile(
        serializeReplay(log, readBuildVersion()),
        `以撒的竞合-回放-${log.id}.json`,
      );
      setMessage('已请求下载这份只读回放。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法导出。');
    }
  }
  return (
    <>
      <div className="replay-identity">
        <strong>
          {characterNames[log.characterId]} ·{' '}
          {log.final ? '对局已结束' : '进行中记录'}
        </strong>
        <span>已结算 {log.rooms.length} / 15 房间 · 只读复盘</span>
        <details>
          <summary>档案详情</summary>
          <code>{log.id}</code>
          <p>
            开始构建：{log.startedBuild} · 规则：{log.rulesVersion}
          </p>
          <p>展示记录中的结果；不从历史房间恢复或修改行动。</p>
        </details>
        <Button type="button" variant="secondary" onClick={exportArchive}>
          导出此回放
        </Button>
      </div>
      {!record ? (
        <p className="empty-ranking-state">此回放尚无已结算房间。</p>
      ) : (
        <div className="replay-workspace">
          <aside className="replay-sidebar">
            <nav className="replay-room-nav" aria-label="回放房间">
              {log.rooms.map((r, i) => (
                <button
                  type="button"
                  key={r.location}
                  aria-current={index === i ? 'step' : undefined}
                  onClick={() => setIndex(i)}
                >
                  <span>
                    第 {r.settlement.room.floorIndex + 1} 层 · 房间{' '}
                    {r.settlement.room.roomIndex + 1}
                  </span>
                  <small>{replayRoomNames[r.settlement.room.kind]}</small>
                  <b>
                    +
                    {score(
                      r.settlement.roomScoreSummaries[playerId]?.finalScore ??
                        0,
                    )}
                  </b>
                </button>
              ))}
            </nav>
            <small>房间分为当前所选玩家的实际结果；未结算房间不显示。</small>
          </aside>
          <div className="replay-main">
            <div className="replay-toolbar">
              <div className="save-actions">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={index === 0}
                  onClick={() => setIndex((i) => i - 1)}
                >
                  上一房
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void copyLocator()}
                >
                  复制房间定位
                </Button>
                <strong>
                  {index + 1} / {log.rooms.length}
                </strong>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={index >= log.rooms.length - 1}
                  onClick={() => setIndex((i) => i + 1)}
                >
                  下一房
                </Button>
              </div>
              <label>
                查看玩家
                <select
                  aria-label="回放查看玩家"
                  value={playerId}
                  onChange={(e) => setPlayerId(e.target.value)}
                >
                  {Object.entries(log.playerNames).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                      {id === 'human' ? '（真人）' : ` · ${id}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <details
              className="replay-location"
              open={locatorOpen}
              onToggle={(e) => setLocatorOpen(e.currentTarget.open)}
            >
              <summary>定位与构建信息</summary>
              <label htmlFor="replay-locator">反馈定位 · 可直接复制</label>
              <input
                id="replay-locator"
                readOnly
                value={locator}
                onFocus={(e) => e.target.select()}
              />
              <small>
                本房构建：{record.build}
                {record.source !== 'live'
                  ? ' · 由兼容存档／检查点核验重建；构建字段保留已知来源'
                  : ' · 原局提交时记录'}
              </small>
            </details>
            <ReplayRoomDetails
              record={record}
              playerId={playerId}
              name={name}
              score={score}
            />
            <section className="replay-section">
              <div className="replay-section-heading">
                <h3>关键事件时间线</h3>
                <label className="replay-toggle">
                  <input
                    type="checkbox"
                    checked={allEvents}
                    onChange={(e) => setAllEvents(e.target.checked)}
                  />
                  展开全场原始事件
                </label>
              </div>
              <p>
                默认查看所选玩家的资金、道具与触发变化；保留原记录顺序，不再次执行。
              </p>
              <div className="replay-events-grid">
                {[
                  { title: '进入本房', events: record.entryEvents },
                  { title: '提交与结算', events: record.settlement.events },
                ].map(({ title, events }) => {
                  const displayed = events.filter(
                    (e) =>
                      allEvents ||
                      (replayEventRelatedTo(e, playerId) &&
                        e.type !== 'score' &&
                        e.type !== 'cost' &&
                        e.type !== 'entitlement'),
                  );
                  return (
                    <div key={title}>
                      <h4>
                        {title} · {displayed.length} 条
                      </h4>
                      {displayed.length ? (
                        <ol className="replay-events">
                          {displayed.map((event, i) => (
                            <li key={i}>
                              <b
                                className={`replay-event-badge event-${event.type}`}
                              >
                                {eventLabels[event.type]}
                              </b>
                              <span>
                                {name(event.playerId)}
                                {event.group ? ` · ${event.group}` : ''}
                                {event.effectItemId || event.itemId
                                  ? ` · ${getItemDefinition(event.effectItemId ?? event.itemId!).name}`
                                  : ''}
                              </span>
                              <p>{replayEventText(event, name)}</p>
                              {event.amount !== undefined && (
                                <small>记录数值 {amount(event.amount)}</small>
                              )}
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="replay-muted">无相关事件。</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
            <details className="replay-all-players replay-trend">
              <summary>{name(playerId)} · 整局积分轨迹</summary>
              <div className="replay-trend-bars">
                {log.rooms.map((r, i) => {
                  const total =
                    r.settlement.players.find((p) => p.id === playerId)
                      ?.score ?? 0;
                  const max = Math.max(
                    1,
                    ...log.rooms.map(
                      (v) =>
                        v.settlement.players.find((p) => p.id === playerId)
                          ?.score ?? 0,
                    ),
                  );
                  return (
                    <button
                      type="button"
                      key={r.location}
                      aria-label={`查看${r.location}积分${score(total)}`}
                      aria-current={i === index ? 'step' : undefined}
                      onClick={() => setIndex(i)}
                    >
                      <span
                        style={{
                          height: `${Math.max(2, (total / max) * 100)}%`,
                        }}
                      />
                      <small>{r.location}</small>
                      <b>{score(total)}</b>
                    </button>
                  );
                })}
              </div>
              <p>柱高表示结算后累计积分；终局王冠倍率仅在终局表中展示。</p>
            </details>
            <details className="replay-all-players">
              <summary>全场资金、原始／追溯／最终房间分 · 20人</summary>
              <div className="replay-table-wrap">
                <table className="result-table replay-table">
                  <caption className="sr-only">本房全场玩家快照</caption>
                  <thead>
                    <tr>
                      {[
                        '玩家',
                        '入房资金',
                        '结算资金',
                        '资金变化',
                        '原始房分',
                        '追溯追加',
                        '最终房分',
                        '累计积分',
                        '获得道具',
                      ].map((label) => (
                        <th scope="col" key={label}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {replayPlayerRows(record).map((row) => (
                      <tr
                        key={row.after.id}
                        className={row.after.isHuman ? 'ranking-row-self' : ''}
                      >
                        <th scope="row">{name(row.after.id)}</th>
                        <td>{row.before.money}</td>
                        <td>{row.after.money}</td>
                        <td>
                          {row.moneyDelta > 0 ? '+' : ''}
                          {row.moneyDelta}
                        </td>
                        <td>{score(row.score.initialScore)}</td>
                        <td>{score(row.score.retroactiveScore)}</td>
                        <td>{score(row.score.finalScore)}</td>
                        <td>{score(row.after.score)}</td>
                        <td>
                          {row.awards
                            .map(
                              (a) =>
                                `${getItemDefinition(a.itemId).name} ×${a.copies}`,
                            )
                            .join('、') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            {log.final && index === log.rooms.length - 1 && (
              <section className="replay-section">
                <h3>整局终局倍率与排行</h3>
                <p>来自原局完成时的终局快照，保留当时的并列排序结果。</p>
                <div className="replay-table-wrap">
                  <table className="result-table replay-table">
                    <caption className="sr-only">记录的终局排行</caption>
                    <thead>
                      <tr>
                        {[
                          '名次',
                          '玩家',
                          '累计积分',
                          '王冠倍率',
                          '最终积分',
                        ].map((label) => (
                          <th scope="col" key={label}>
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {log.final.ranking.map((entry) => (
                        <tr key={entry.playerId}>
                          <td>
                            {1 +
                              log.final!.ranking.filter(
                                (e) => e.finalScore > entry.finalScore,
                              ).length}
                          </td>
                          <th scope="row">{name(entry.playerId)}</th>
                          <td>
                            {score(
                              log.final!.players.find(
                                (p) => p.id === entry.playerId,
                              )!.score,
                            )}
                          </td>
                          <td>
                            ×
                            {amount(
                              log.final!.crownMultipliers[entry.playerId],
                            )}
                          </td>
                          <td>{score(entry.finalScore)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <small>终局构建：{log.final.build}</small>
              </section>
            )}
          </div>
        </div>
      )}
      {message && <output className="save-message">{message}</output>}
    </>
  );
}

const eventLabels = {
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

function ReplayRoomDetails({
  record,
  playerId,
  name,
  score,
}: {
  record: ReplayRoomRecord;
  playerId: string;
  name: (id: string) => string;
  score: (n: number) => string;
}) {
  const s = record.settlement;
  const row = replayPlayerRows(record).find((r) => r.after.id === playerId)!;
  const breakdown = s.scoreBreakdowns[playerId];
  const outcomes = replayOutcomeLabels(record, playerId);
  const strategy = record.aiChoices.find((c) => c.playerId === playerId);
  const actualActions = s.resolvedActions.filter(
    (a) => a.playerId === playerId,
  );
  const cost = actualActions.reduce((total, a) => total + a.actualCost, 0);
  const refunds = s.events
    .filter((e) => e.playerId === playerId && e.type === 'refund')
    .reduce((total, e) => total + (e.amount ?? 0), 0);
  return (
    <>
      <div className="replay-selected-heading">
        <h3>
          {record.location} · {replayRoomNames[s.room.kind]} · {name(playerId)}
        </h3>
        <span>
          {strategy ? replayStrategyNames[strategy.strategy] : '真人实际提交'}
        </span>
      </div>
      <div className="replay-action-summary">
        {actualActions.map((a) => (
          <span
            key={a.actionIndex}
            className={`replay-action-chip action-${a.action.type}`}
          >
            {a.action.type === 'withdraw'
              ? '观望'
              : `${a.action.group} · ${a.action.type === 'bid' ? '竞拍' : '扰乱'} ${a.action.amount}`}
          </span>
        ))}
        <span>
          实际扣款 <b>{cost}</b>
        </span>
        <span>
          返款 <b>{refunds}</b>
        </span>
      </div>
      <div className="build-summary-grid replay-summary-grid">
        <article>
          <span>实际获得</span>
          <div className="replay-award-icons">
            {row.awards.length ? (
              row.awards.map((a) => (
                <span key={a.group}>
                  <ItemIcon itemId={a.itemId} size="small" />
                  {getItemDefinition(a.itemId).name} ×{a.copies}
                </span>
              ))
            ) : (
              <strong>无道具</strong>
            )}
          </div>
          <small>最终资格与发放结果分开核对，毁奖／复制见下方原因。</small>
        </article>
        <article>
          <span>资金变化</span>
          <strong>
            {row.moneyDelta > 0 ? '+' : ''}
            {row.moneyDelta}
          </strong>
          <small>
            入房 {row.before.money} → 结算 {row.after.money}；
            {row.previous ? `上房结束 ${row.previous.money}` : '本局首房'}
          </small>
        </article>
        <article>
          <span>最终房间积分</span>
          <strong>{score(row.score.finalScore)}</strong>
          <small>
            原始 {score(row.score.initialScore)} + 追溯{' '}
            {score(row.score.retroactiveScore)}；累计 {score(row.after.score)}
          </small>
        </article>
        <article>
          <span>库存与屏障</span>
          <strong>
            {row.before.items.length} → {row.after.items.length}
          </strong>
          <small>
            临时屏障 {row.before.temporaryShields} →{' '}
            {row.after.temporaryShields}；持久屏障{' '}
            {row.before.persistentShields} → {row.after.persistentShields}
          </small>
        </article>
      </div>
      <div className="replay-score-chain" aria-label="本房计分过程">
        <span>
          行动小计{' '}
          <b>
            {score(
              breakdown?.actions.reduce((sum, a) => sum + a.subtotal, 0) ?? 0,
            )}
          </b>
        </span>
        <i>→</i>
        <span>
          综合倍率 <b>×{amount(breakdown?.multiplier)}</b>
          {breakdown?.cleared && <em>清零</em>}
        </span>
        <i>→</i>
        <span>
          原始房分 <b>{score(row.score.initialScore)}</b>
        </span>
        <i>→</i>
        <span>
          追溯追加 <b>+{score(row.score.retroactiveScore)}</b>
        </span>
        <i>→</i>
        <span>
          最终房分 <b>{score(row.score.finalScore)}</b>
        </span>
      </div>
      <section className="replay-section">
        <h3>为什么获得／失去奖励</h3>
        <div className="replay-verdicts">
          {s.room.rewards.map((reward) => {
            const entitlement = s.entitlements.find(
              (e) => e.playerId === playerId && e.group === reward.group,
            );
            const award = row.awards.find((a) => a.group === reward.group);
            const blocked =
              s.highPricePlacements.some(
                (p) =>
                  p.playerId === playerId &&
                  p.group === reward.group &&
                  p.actionType === 'disrupt',
              ) ||
              s.cooperationPlacements.some(
                (p) =>
                  p.playerId === playerId &&
                  p.group === reward.group &&
                  p.actionType === 'disrupt',
              );
            return (
              <article key={reward.group}>
                <ItemIcon itemId={reward.itemId} size="medium" />
                <div>
                  <h4>
                    {reward.group} · {getItemDefinition(reward.itemId).name}
                  </h4>
                  <p>
                    {entitlement
                      ? entitlement.sources
                          .map((v) => entitlementNames[v] ?? v)
                          .join(' / ')
                      : blocked
                        ? '扰乱占位，不直接领取奖励'
                        : '未取得奖励资格'}
                  </p>
                  <strong>
                    {award
                      ? `实际获得 ×${award.copies}`
                      : entitlement
                        ? '有资格，但未实际发放；查看毁奖事件'
                        : '未获得'}
                  </strong>
                </div>
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
          defaultRules.floorStartingMoney[s.room.floorIndex]! *
          defaultRules.cooperationZoneRatio
        }
      />
      <details className="replay-section replay-calculation-details">
        <summary>展开实际行动与计分明细</summary>
        <div className="replay-actions">
          {s.resolvedActions
            .filter((a) => a.playerId === playerId)
            .map((resolved) => {
              const a = resolved.action;
              const b = breakdown?.actions.find(
                (v) => v.actionIndex === resolved.actionIndex,
              );
              return (
                <article key={resolved.actionIndex}>
                  <h4>
                    {a.type === 'withdraw'
                      ? '静观其变'
                      : `${a.group} · ${a.type === 'bid' ? '竞拍' : '扰乱'}`}
                  </h4>
                  <dl>
                    {[
                      ['名义报价', a.type === 'withdraw' ? null : a.amount],
                      ['实际扣款', resolved.actualCost],
                      ['市场等价', resolved.marketEquivalent],
                      ['原始计分等价', resolved.scoringEquivalent],
                      ['实际计分取值', b?.scoringValue],
                      ['基础积分', b?.baseScore ?? 0],
                      ['行动加算', b?.additiveScore ?? 0],
                      ['乘算前小计', b?.subtotal ?? 0],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{amount(value as number | null | undefined)}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              );
            })}
        </div>
        <p>
          原始结算倍率 ×{amount(breakdown?.multiplier)} ·{' '}
          {breakdown?.cleared ? '已清零' : '未清零'} · 心脏追溯倍率 ×
          {amount(row.score.retroactiveMultiplier)}
        </p>
      </details>
      <details className="replay-section">
        <summary>展开全场资格与实际发放</summary>
        <div className="replay-rewards">
          {s.room.rewards.map((reward) => {
            const item = getItemDefinition(reward.itemId);
            const placement = (list: typeof s.highPricePlacements) =>
              list
                .filter((p) => p.group === reward.group)
                .map(
                  (p) =>
                    `${name(p.playerId)}${p.actionType === 'disrupt' ? '（扰乱占位）' : ''}`,
                )
                .join('、') || '无';
            return (
              <article key={reward.group}>
                <div className="build-item-heading">
                  <ItemIcon itemId={item.id} size="medium" />
                  <h4>
                    {reward.group} · {item.name}
                  </h4>
                </div>
                <ItemBadges item={item} compact />
                {reward.hidden && (
                  <small>当时为未知奖励；本房结算后公开。</small>
                )}
                <dl>
                  <div>
                    <dt>高价名额</dt>
                    <dd>{placement(s.highPricePlacements)}</dd>
                  </div>
                  <div>
                    <dt>合作名额</dt>
                    <dd>{placement(s.cooperationPlacements)}</dd>
                  </div>
                  <div>
                    <dt>最终资格</dt>
                    <dd>
                      {s.entitlements
                        .filter((e) => e.group === reward.group)
                        .map(
                          (e) =>
                            `${name(e.playerId)}（${e.sources.map((v) => entitlementNames[v] ?? v).join(' / ')}）`,
                        )
                        .join('、') || '无'}
                    </dd>
                  </div>
                  <div>
                    <dt>实际发放</dt>
                    <dd>
                      {s.awards
                        .filter((a) => a.group === reward.group)
                        .map((a) => `${name(a.playerId)} ×${a.copies}`)
                        .join('、') || '无人获得'}
                    </dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
      </details>
      <details className="replay-section">
        <summary>展开记录的效果与随机结果</summary>
        <p>
          展示原结算触发、赎回、毁奖、复制和项圈检查结果；不补造未记录的原始随机数。
        </p>
        {outcomes.length ? (
          <ul className="replay-outcomes">
            {outcomes.map((label, i) => (
              <li key={i}>{label}</li>
            ))}
          </ul>
        ) : (
          <p className="replay-muted">该玩家本房没有记录的特殊效果。</p>
        )}
      </details>
      <details className="replay-inventory">
        <summary>
          {name(playerId)}的结算后完整库存 · {row.after.items.length} 份
        </summary>
        <ul>
          {row.after.items.map((item) => (
            <li key={item.instanceId}>
              <strong>{getItemDefinition(item.itemId).name}</strong>
              <code>{item.instanceId}</code>
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
