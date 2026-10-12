import type { ReplayRoomRecord } from '@/lib/ui/replay-record';
import { replayMarketModel } from '@/lib/ui/replay-market';

export function ReplayMarket({
  record,
  playerId,
  name,
  radius,
}: {
  record: ReplayRoomRecord;
  playerId: string;
  name: (id: string) => string;
  radius: number;
}) {
  const model = replayMarketModel(record, radius);
  if (!model)
    return <p className="replay-muted">全场观望，本房没有市场基准线。</p>;
  const fmt = (v: number) => Number(v.toFixed(4));
  return (
    <section className="replay-section replay-market">
      <h3>行动在市场中的位置</h3>
      <p>
        基准线 <b>{fmt(model.target)}</b> · 合作区 {fmt(model.lower)}～
        {fmt(model.upper)} · 每个点代表一个实际行动，双行动分别标点。
      </p>
      <div className="replay-market-grid">
        {model.groups.map((group) => {
          const x = (v: number) =>
            18 + Math.max(0, Math.min(1, v / model.maximum)) * 464;
          return (
            <article key={group.group}>
              <h4>目标 {group.group}</h4>
              <svg
                viewBox="0 0 500 118"
                aria-label={`目标${group.group}市场位置，基准线${fmt(model.target)}`}
              >
                <title>目标{group.group}的实际行动市场位置</title>
                <rect
                  x={x(model.lower)}
                  y="12"
                  width={Math.max(1, x(model.upper) - x(model.lower))}
                  height="66"
                  className="market-cooperation"
                />
                <line
                  x1="18"
                  y1="78"
                  x2="482"
                  y2="78"
                  className="market-axis"
                />
                <line
                  x1={x(model.target)}
                  y1="8"
                  x2={x(model.target)}
                  y2="82"
                  className="market-target"
                />
                {group.cutoff !== null && (
                  <line
                    x1={x(group.cutoff)}
                    y1="12"
                    x2={x(group.cutoff)}
                    y2="78"
                    className="market-cutoff"
                  />
                )}
                {[
                  ...group.points.filter((p) => p.playerId !== playerId),
                  ...group.points.filter((p) => p.playerId === playerId),
                ].map((p, i) => (
                  <g key={`${p.playerId}:${p.actionIndex}`}>
                    {p.type === 'bid' ? (
                      <circle
                        cx={x(p.value)}
                        cy={28 + (i % 3) * 16}
                        r={p.playerId === playerId ? 6 : 3.5}
                        className={
                          p.playerId === playerId
                            ? 'market-point-self'
                            : 'market-point-bid'
                        }
                      />
                    ) : (
                      <rect
                        x={x(p.value) - 4}
                        y={24 + (i % 3) * 16}
                        width="8"
                        height="8"
                        className={
                          p.playerId === playerId
                            ? 'market-point-self'
                            : 'market-point-disrupt'
                        }
                      />
                    )}
                    <title>
                      {name(p.playerId)} · {p.type === 'bid' ? '竞拍' : '扰乱'}{' '}
                      · 市场等价 {fmt(p.value)}
                      {p.playerId === playerId ? ' · 当前查看' : ''}
                    </title>
                  </g>
                ))}
                <text x="18" y="105">
                  0
                </text>
                <text x="482" y="105" textAnchor="end">
                  {fmt(model.maximum)}
                </text>
              </svg>
              <p>
                {group.points
                  .filter((p) => p.playerId === playerId)
                  .map((p) => `所选行动：${fmt(p.value)}`)
                  .join('；') || '所选玩家未对这个目标行动'}
                <br />
                {group.cutoff === null
                  ? '无高价占位'
                  : `实际高价占位边界：${fmt(group.cutoff)}`}
              </p>
            </article>
          );
        })}
      </div>
      <small>
        圆点＝竞拍；方点＝扰乱；亮色描边＝所选玩家；蓝色带＝合作区；金色虚线＝实际高价占位边界。资格以记录结果为准。
      </small>
    </section>
  );
}
