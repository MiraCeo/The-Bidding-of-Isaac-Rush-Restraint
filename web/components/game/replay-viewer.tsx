import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  getItemDefinition,
  characterNames,
  itemPresentations,
} from '@/lib/game';
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
} from '@/lib/ui/replay-display';
import { serializeReplay } from '@/lib/ui/game-replay';
import { readBuildVersion } from '@/lib/ui/game-version';
import { downloadJsonFile } from '@/lib/ui/json-download';
import { useSessionTools } from './session-context';
import { ItemBadges } from './item-badges';

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
  const record = log.rooms[Math.min(index, Math.max(0, log.rooms.length - 1))];
  const score = (value: number) => value.toFixed(scoreDecimals);
  const name = (id: string) => log.playerNames[id] ?? id;
  const locator = record ? replayRoomLocator(log, record) : log.id;
  async function copyLocator() {
    try {
      await navigator.clipboard.writeText(locator);
      setMessage('房间定位已复制。');
    } catch {
      setMessage('可选中上方定位文字，手动复制。');
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
      <div className="utility-notice replay-identity">
        <strong>{log.id}</strong>
        <span>
          角色：{characterNames[log.characterId]} · 已结算 {log.rooms.length} /
          15 房间{log.final ? ' · 对局已结束' : ' · 部分回放'}
        </span>
        <small>
          开始构建：{log.startedBuild} · 规则：{log.rulesVersion}
        </small>
        <p>
          读取保存的实际结果，不自动播放、不重抽随机数，也不能从历史房间恢复或修改行动。
        </p>
      </div>
      {!record ? (
        <p className="empty-ranking-state">此回放尚无已结算房间。</p>
      ) : (
        <>
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
              </button>
            ))}
          </nav>
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
          <div className="replay-location">
            <label htmlFor="replay-locator">反馈定位 · 可直接复制</label>
            <input
              id="replay-locator"
              readOnly
              value={locator}
              onFocus={(e) => e.target.select()}
            />
            <div className="save-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => void copyLocator()}
              >
                复制房间定位
              </Button>
              <Button type="button" variant="secondary" onClick={exportArchive}>
                导出此回放
              </Button>
            </div>
            <small>
              本房构建：{record.build}
              {record.source === 'save-reconstruction'
                ? ' · 由旧存档的固定种子与已提交记录核验重建'
                : ' · 原局提交时记录'}
            </small>
          </div>
          <ReplayRoomDetails
            record={record}
            playerId={playerId}
            name={name}
            score={score}
          />
          <section className="replay-section">
            <div className="replay-section-heading">
              <h3>入房与结算事件</h3>
              <label className="replay-toggle">
                <input
                  type="checkbox"
                  checked={allEvents}
                  onChange={(e) => setAllEvents(e.target.checked)}
                />
                显示全场事件
              </label>
            </div>
            <p>入房经济与本次提交后的事件分别列出；这里不会再次执行它们。</p>
            <div className="replay-events-grid">
              {[
                { title: '进入本房', events: record.entryEvents },
                { title: '提交与结算', events: record.settlement.events },
              ].map(({ title, events }) => {
                const displayed = events.filter(
                  (e) => allEvents || e.playerId === playerId,
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
                            <span>
                              {name(event.playerId)}
                              {event.group ? ` · ${event.group}` : ''}
                              {event.itemId
                                ? ` · ${getItemDefinition(event.itemId).name}`
                                : ''}
                            </span>
                            <p>{event.message}</p>
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
                      {['名次', '玩家', '累计积分', '王冠倍率', '最终积分'].map(
                        (label) => (
                          <th scope="col" key={label}>
                            {label}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {log.final.ranking.map((entry, i) => (
                      <tr key={entry.playerId}>
                        <td>{i + 1}</td>
                        <th scope="row">{name(entry.playerId)}</th>
                        <td>
                          {score(
                            log.final!.players.find(
                              (p) => p.id === entry.playerId,
                            )!.score,
                          )}
                        </td>
                        <td>
                          ×{amount(log.final!.crownMultipliers[entry.playerId])}
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
        </>
      )}
      {message && <output className="save-message">{message}</output>}
    </>
  );
}

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
      <div className="build-summary-grid replay-summary-grid">
        <article>
          <span>本房基准线</span>
          <strong>{amount(s.baseline?.target)}</strong>
          <small>
            {s.baseline
              ? `有效样本 ${s.baseline.participantCount} · 市场均值 ${s.baseline.meanMarketBid}`
              : '全场观望，无市场基准线'}
          </small>
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
      <section className="replay-section">
        <h3>实际行动与计分</h3>
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
      </section>
      <section className="replay-section">
        <h3>资格与实际发放</h3>
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
                  <span aria-hidden="true">
                    {itemPresentations[item.id].emoji}
                  </span>
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
      </section>
      <section className="replay-section">
        <h3>记录的效果与随机结果</h3>
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
      </section>
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
