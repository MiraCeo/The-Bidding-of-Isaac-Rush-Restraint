import { useId, useMemo, useState } from 'react';
import { getItemDefinition } from '@/lib/game';
import type { SettlementEvent } from '@/lib/game/item-types';
import type { ReplayRoomRecord } from '@/lib/ui/replay-record';
import { replayEventText } from '@/lib/ui/replay-display';
import {
  replayEventStages,
  replayPlayerEventGroups,
} from '@/lib/ui/replay-view-model';

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
const number = (v: number) => Number(v.toFixed(4));
function EventList({
  events,
  name,
  relatedPlayer,
  score,
}: {
  events: Array<{ event: SettlementEvent; sequence: number }>;
  name: (id: string) => string;
  relatedPlayer?: string;
  score: (value: number) => string;
}) {
  return (
    <ol className="replay-events">
      {events.map(({ event: e, sequence }) => (
        <li key={sequence} data-event-sequence={sequence}>
          <span className={'replay-event-badge event-' + e.type}>
            {labels[e.type]}
          </span>
          <div>
            <span className="replay-event-owner">
              <small className="replay-event-sequence">#{sequence}</small>{' '}
              {name(e.playerId)}
              {e.group ? ' · ' + e.group : ''}
              {e.effectItemId || e.itemId
                ? ' · ' + getItemDefinition(e.effectItemId ?? e.itemId!).name
                : ''}
              {relatedPlayer && relatedPlayer !== e.playerId && (
                <small className="replay-related-event">关联事件</small>
              )}
            </span>
            <p>{replayEventText(e, name, score)}</p>
            {e.type === 'score' && e.amount !== undefined && (
              <details className="replay-event-precise">
                <summary>精确记录</summary>
                <p>{replayEventText(e, name)}</p>
                <span>原始数值：{String(e.amount)}</span>
              </details>
            )}
          </div>
          {e.amount !== undefined && (
            <b className="replay-event-amount">
              {e.type === 'score' ? score(e.amount) : number(e.amount)}
            </b>
          )}
        </li>
      ))}
    </ol>
  );
}
export function ReplayEvents({
  record,
  playerId,
  name,
  allPlayers = false,
  score = (value) => value.toFixed(2),
}: {
  record: ReplayRoomRecord;
  playerId: string;
  name: (id: string) => string;
  allPlayers?: boolean;
  score?: (value: number) => string;
}) {
  const [mode, setMode] = useState<'players' | 'sequence'>('players');
  const id = useId();
  const context = record.location + ':' + playerId;
  const [expanded, setExpanded] = useState<{ context: string; ids: string[] }>({
    context,
    ids: [playerId],
  });
  const open = expanded.context === context ? expanded.ids : [playerId];
  const model = useMemo(() => replayPlayerEventGroups(record), [record]);
  const stages = allPlayers
    ? model.stages
    : replayEventStages(record, playerId, false).map((stage, i) => ({
        title: stage.title,
        events: model.stages[i]!.events.filter(({ event }) =>
          stage.events.includes(event),
        ),
      }));
  const sorted = [...model.players].sort(
    (a, b) => Number(b.playerId === playerId) - Number(a.playerId === playerId),
  );
  return (
    <section className="replay-timeline-section">
      <div className="replay-section-heading">
        <div>
          <h3>{allPlayers ? '本房全场事件' : '本房关键事件'}</h3>
          {allPlayers && (
            <p className="replay-muted">
              {model.players.length}人 · {model.total}条原始事件 ·
              关联转移显示在双方条目，事件总数不重复计算
            </p>
          )}
        </div>
        {allPlayers && (
          <fieldset
            className="replay-chart-metrics"
            aria-label="全场事件排列方式"
          >
            <button
              type="button"
              aria-pressed={mode === 'players'}
              onClick={() => setMode('players')}
            >
              按玩家
            </button>
            <button
              type="button"
              aria-pressed={mode === 'sequence'}
              onClick={() => setMode('sequence')}
            >
              原始顺序
            </button>
          </fieldset>
        )}
      </div>
      {allPlayers && mode === 'players' ? (
        <>
          <div className="replay-event-controls">
            <span>先看关注玩家；展开后按进入本房 → 提交与结算展示</span>
            <button
              type="button"
              onClick={() =>
                setExpanded({
                  context,
                  ids: model.players
                    .filter((p) => p.count)
                    .map((p) => p.playerId),
                })
              }
            >
              展开全部
            </button>
            <button
              type="button"
              onClick={() => setExpanded({ context, ids: [] })}
            >
              收起全部
            </button>
          </div>
          <div className="replay-player-events">
            {sorted.map((p) => {
              const isOpen = open.includes(p.playerId) && p.count > 0;
              const bodyId = id + '-events-' + p.playerId;
              return (
                <article
                  key={p.playerId}
                  className={
                    'replay-player-event' +
                    (p.playerId === playerId ? ' is-focused' : '')
                  }
                  data-player-id={p.playerId}
                >
                  <button
                    type="button"
                    className="replay-player-event-toggle"
                    aria-expanded={isOpen}
                    aria-controls={bodyId}
                    disabled={!p.count}
                    onClick={() =>
                      setExpanded({
                        context,
                        ids: isOpen
                          ? open.filter((id) => id !== p.playerId)
                          : [...open, p.playerId],
                      })
                    }
                  >
                    <span className="replay-player-event-name">
                      <span aria-hidden="true">
                        {p.count ? (isOpen ? '−' : '+') : '·'}
                      </span>
                      <strong>{name(p.playerId)}</strong>
                      {p.playerId === playerId && <small>当前关注</small>}
                    </span>
                    <span className="replay-player-event-stats">
                      扣款 {p.result.cost} · 返款 {p.result.refund} · 本房积分{' '}
                      {score(p.result.score.finalScore)}
                      {p.result.awards.length > 0
                        ? ' · 获奖 ' +
                          p.result.awards.reduce((n, a) => n + a.copies, 0) +
                          '份'
                        : ''}
                    </span>
                    <span className="replay-player-event-count">
                      {p.count ? p.count + '条相关事件' : '无相关事件'}
                    </span>
                  </button>
                  <div
                    id={bodyId}
                    className="replay-player-event-body"
                    hidden={!isOpen}
                  >
                    {p.stages
                      .filter((s) => s.events.length)
                      .map((s) => (
                        <div className="replay-event-stage" key={s.title}>
                          <h4>
                            {s.title}
                            <small>{s.events.length}条</small>
                          </h4>
                          <EventList
                            score={score}
                            events={s.events}
                            name={name}
                            relatedPlayer={p.playerId}
                          />
                        </div>
                      ))}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <p className="replay-muted">
            {allPlayers
              ? '按原始事件编号展示，保留全场发生顺序。'
              : '按原记录顺序展示所选玩家及关联资金转移。'}
          </p>
          <div className="replay-events-grid">
            {stages.map((s) => (
              <div className="replay-event-stage" key={s.title}>
                <h4>
                  {s.title}
                  <small>{s.events.length}条</small>
                </h4>
                {s.events.length ? (
                  <EventList
                    score={score}
                    events={s.events}
                    name={name}
                    relatedPlayer={allPlayers ? undefined : playerId}
                  />
                ) : (
                  <p className="replay-muted">无相关事件。</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
