import type { ReplayRoomRecord } from '@/lib/ui/replay-record';
import { replayMarketModel } from '@/lib/ui/replay-market';
import { getItemDefinition } from '@/lib/game/item-catalog';
import { ItemIcon } from './item-icon';

type Point = NonNullable<
  ReturnType<typeof replayMarketModel>
>['groups'][number]['points'][number];
const fmt = (v: number | null) => (v === null ? '—' : Number(v.toFixed(4)));
function place(points: Point[], maximum: number) {
  const rows: number[] = [];
  const x = (value: number) => 54 + (value / maximum) * 480;
  const plotted = points
    .map((point) => {
      const marketX = x(point.value),
        cooperationX =
          point.scoringEquivalent === null ? null : x(point.scoringEquivalent);
      return {
        point,
        marketX,
        cooperationX,
        left: Math.min(marketX, cooperationX ?? marketX),
        right: Math.max(marketX, cooperationX ?? marketX),
      };
    })
    .sort(
      (a, b) =>
        a.left - b.left ||
        a.point.playerId.localeCompare(b.point.playerId) ||
        a.point.actionIndex - b.point.actionIndex,
    )
    .map((p) => {
      let row = rows.findIndex((last) => p.left - last >= 17);
      if (row < 0) row = rows.length;
      rows[row] = p.right;
      return { ...p, row };
    });
  return { plotted, rows: Math.max(1, rows.length) };
}
export function ReplayMarket({
  record,
  playerId,
  name,
  radius,
  compact = false,
}: {
  record: Pick<ReplayRoomRecord, 'settlement'>;
  playerId: string;
  name: (id: string) => string;
  radius: number;
  compact?: boolean;
}) {
  const model = replayMarketModel(record, radius);
  if (!model)
    return (
      <section
        className={`replay-section replay-market${compact ? ' settlement-market-compact' : ''}`}
      >
        <h3>行动在市场中的位置</h3>
        <p className="replay-muted">
          全场观望，本房没有市场基准线，也没有有效报价。
        </p>
      </section>
    );
  const layouts = model.groups.map((g) =>
    place(g.points, model.combinedMaximum),
  );
  const rows = Math.max(...layouts.map((l) => l.rows));
  const ownLabelRows = compact
    ? Math.max(
        ...model.groups.map(
          (g) => g.points.filter((p) => p.playerId === playerId).length,
        ),
      )
    : 0;
  const top = 44 + ownLabelRows * 20,
    bottom = top + (rows - 1) * 17 + 20,
    height = bottom + 44;
  const x = (v: number) => 54 + (v / model.combinedMaximum) * 480;
  return (
    <section
      className={`replay-section replay-market${compact ? ' settlement-market-compact' : ''}`}
    >
      <div className="replay-section-heading">
        <div>
          <h3>行动在市场中的位置</h3>
          <p>
            {compact
              ? `亮色是${name(playerId)}，A／B使用同一坐标尺度。`
              : `每个目标一张图：高价边界与合作区同屏，亮色是${name(playerId)}`}
          </p>
        </div>
        <span className="replay-market-target-badge">
          全场基准线 T = {fmt(model.target)}
        </span>
      </div>
      <div className="replay-market-grid">
        {model.groups.map((group, groupIndex) => {
          const reward = record.settlement.room.rewards.find(
            (r) => r.group === group.group,
          )!;
          const own = group.points.filter((p) => p.playerId === playerId),
            layout = layouts[groupIndex]!;
          return (
            <article key={group.group} data-own-actions={own.length}>
              <header>
                <span className="replay-group-letter">{group.group}</span>
                <ItemIcon itemId={reward.itemId} size="small" />
                <h4>{getItemDefinition(reward.itemId).name}</h4>
                <small>{group.points.length}个报价</small>
              </header>
              <svg
                viewBox={`0 0 580 ${height}`}
                data-market-chart="combined"
                aria-label={`目标${group.group}高价与合作共同市场图，基准线${fmt(model.target)}`}
              >
                <title>
                  目标{group.group}
                  ：实心为市场等价，空心为合作判定；重合时合并标记
                </title>
                <rect
                  x={x(model.lower)}
                  y={top - 14}
                  width={Math.max(1, x(model.upper) - x(model.lower))}
                  height={bottom - top + 14}
                  className="market-cooperation"
                />
                <line
                  x1="54"
                  x2="534"
                  y1={bottom}
                  y2={bottom}
                  className="market-axis"
                />
                <line
                  x1={x(model.target)}
                  x2={x(model.target)}
                  y1={top - 22}
                  y2={bottom + 6}
                  className="market-target"
                />
                <text
                  x={x(model.target)}
                  y="16"
                  textAnchor="middle"
                  className="market-target-label"
                >
                  T {fmt(model.target)}
                </text>
                {group.cutoff !== null && (
                  <line
                    x1={x(group.cutoff)}
                    x2={x(group.cutoff)}
                    y1={top - 14}
                    y2={bottom}
                    className="market-cutoff"
                  />
                )}
                {[
                  ...layout.plotted.filter(
                    (p) => p.point.playerId !== playerId,
                  ),
                  ...layout.plotted.filter(
                    (p) => p.point.playerId === playerId,
                  ),
                ].map((p) => {
                  const selected = p.point.playerId === playerId,
                    py = top + p.row * 17;
                  const separate =
                    p.cooperationX !== null &&
                    p.point.scoringEquivalent !== p.point.value;
                  const cls = selected
                    ? 'market-point-self'
                    : p.point.type === 'bid'
                      ? 'market-point-bid'
                      : 'market-point-disrupt';
                  const hollowStroke = selected
                    ? '#fff0b5'
                    : p.point.type === 'bid'
                      ? '#dda948'
                      : '#b899d6';
                  return (
                    <g
                      key={p.point.playerId + ':' + p.point.actionIndex}
                      className={selected ? 'market-selected-action' : ''}
                      data-action-reference={
                        p.point.playerId + ':' + p.point.actionIndex
                      }
                    >
                      <title>
                        {name(p.point.playerId)} ·{' '}
                        {p.point.type === 'bid' ? '竞拍' : '扰乱'}{' '}
                        {p.point.nominalAmount} · 市场等价 {fmt(p.point.value)}{' '}
                        · 合作判定 {fmt(p.point.scoringEquivalent)}
                      </title>
                      {separate && (
                        <line
                          x1={p.marketX}
                          x2={p.cooperationX!}
                          y1={py}
                          y2={py}
                          className={
                            'market-equivalence-link' +
                            (selected ? ' is-selected' : '')
                          }
                        />
                      )}
                      {selected && (
                        <circle
                          cx={p.marketX}
                          cy={py}
                          r="10"
                          className="market-point-halo"
                        />
                      )}
                      {p.point.type === 'bid' ? (
                        <circle
                          cx={p.marketX}
                          cy={py}
                          r={selected ? 5.5 : 4}
                          className={cls}
                          data-marker="market"
                        />
                      ) : (
                        <rect
                          x={p.marketX - 4.5}
                          y={py - 4.5}
                          width="9"
                          height="9"
                          className={cls}
                          data-marker="market"
                        />
                      )}
                      {separate &&
                        (p.point.type === 'bid' ? (
                          <circle
                            cx={p.cooperationX!}
                            cy={py}
                            r={selected ? 5.5 : 4}
                            className="market-cooperation-marker"
                            style={{ stroke: hollowStroke }}
                            data-marker="cooperation"
                          />
                        ) : (
                          <rect
                            x={p.cooperationX! - 4.5}
                            y={py - 4.5}
                            width="9"
                            height="9"
                            className="market-cooperation-marker"
                            style={{ stroke: hollowStroke }}
                            data-marker="cooperation"
                          />
                        ))}
                      {selected && (
                        <text
                          x={p.left}
                          y={
                            compact
                              ? 36 +
                                own.findIndex(
                                  (entry) =>
                                    entry.actionIndex === p.point.actionIndex,
                                ) *
                                  20
                              : py - 13
                          }
                          textAnchor={p.left > 395 ? 'end' : 'start'}
                          className="market-own-label"
                        >
                          {name(playerId)}{' '}
                          {separate
                            ? `市场${fmt(p.point.value)} / 合作${fmt(p.point.scoringEquivalent)}`
                            : fmt(p.point.value)}
                        </text>
                      )}
                    </g>
                  );
                })}
                <text x="54" y={bottom + 27}>
                  0
                </text>
                <text x="534" y={bottom + 27} textAnchor="end">
                  {fmt(model.combinedMaximum)}
                </text>
              </svg>
              <div className="market-zone-labels">
                <span>
                  高价边界{' '}
                  <b>{group.cutoff === null ? '无占位' : fmt(group.cutoff)}</b>
                </span>
                <span>
                  合作区{' '}
                  <b>
                    {fmt(model.lower)}～{fmt(model.upper)}
                  </b>
                </span>
              </div>
              <div className="market-own-actions">
                {own.length ? (
                  own.map((p) => (
                    <div key={p.actionIndex}>
                      <strong>
                        {name(playerId)} · {p.type === 'bid' ? '竞拍' : '扰乱'}{' '}
                        {p.nominalAmount}
                      </strong>
                      <dl>
                        <div>
                          <dt>市场等价</dt>
                          <dd>{fmt(p.value)}</dd>
                        </div>
                        <div>
                          <dt>合作判定</dt>
                          <dd>{fmt(p.scoringEquivalent)}</dd>
                        </div>
                        <div>
                          <dt>实际计分取值</dt>
                          <dd>{fmt(p.scoringValue)}</dd>
                        </div>
                      </dl>
                      <small>
                        {[
                          p.highPlacement ? '高价占位' : '',
                          p.cooperationPlacement ? '合作占位' : '',
                        ]
                          .filter(Boolean)
                          .join(' · ') || '未取得高价／合作占位'}{' '}
                        · 以原结算记录为准
                      </small>
                    </div>
                  ))
                ) : (
                  <p>
                    {group.points.length
                      ? `${name(playerId)}未向此目标报价`
                      : '此目标无人报价；基准线仍由全场决定'}
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <div className="market-chart-legend">
        <span>● 竞拍 / ■ 扰乱</span>
        <span>实心：市场等价</span>
        <span>空心：合作判定</span>
        <span>蓝带：合作区</span>
        <span>金虚线：高价边界</span>
      </div>
      {compact ? (
        <details className="market-reading-help">
          <summary>读图说明</summary>{' '}
          <p>
            两种等价相同只画一枚标记，不同时用短线连接；高价看实心位置，合作区看空心位置。道具调整后的计分取值只列数值，不混入资格判定。
          </p>
        </details>
      ) : (
        <p>
          两种等价相同只画一枚标记，不同时用短线连接；高价看实心位置，合作区看空心位置。道具调整后的计分取值只列数值，不混入资格判定。
        </p>
      )}
    </section>
  );
}
