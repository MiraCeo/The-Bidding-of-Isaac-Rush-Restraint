import { useId, useMemo } from 'react';
import type { ReplayLog } from '@/lib/ui/replay-record';
import { replayMoneyTimeline } from '@/lib/ui/replay-view-model';
import { replayChartAxis } from '@/lib/ui/replay-chart-axis';

export function ReplayMoneyTimeline({
  log,
  playerId,
  roomIndex,
  name,
  onRoom,
}: {
  log: ReplayLog;
  playerId: string;
  roomIndex: number;
  name: (id: string) => string;
  onRoom: (index: number) => void;
}) {
  const id = useId();
  const model = useMemo(
    () => replayMoneyTimeline(log, playerId),
    [log, playerId],
  );
  const axis = replayChartAxis(model.maximum, true);
  const x = (step: number) => 80 + (step * 810) / Math.max(1, log.rooms.length);
  const y = (money: number) => 248 - (money * 200) / axis.maximum;
  return (
    <section className="replay-money-timeline" aria-label="整局分层资金走势">
      <div className="replay-section-heading">
        <div>
          <h3>结算资金走势</h3>
          <p>{name(playerId)} · 每层单独连线，换层重置不计作普通收益</p>
        </div>
        <span>空心点：该层初始资金 · 实心点：房间结算资金</span>
      </div>
      <div className="replay-chart-scroll">
        <svg
          viewBox="0 0 950 315"
          className="replay-money-svg"
          aria-labelledby={id}
        >
          <title id={id}>
            {name(playerId)}的逐房资金，按楼层分段，换层不连线
          </title>
          {axis.ticks.map((tick) => (
            <g className="replay-chart-grid" key={tick}>
              <line x1="80" x2="900" y1={y(tick)} y2={y(tick)} />
              <text x="65" y={y(tick) + 4} textAnchor="end">
                {tick}
              </text>
            </g>
          ))}
          {model.segments.map((s) => (
            <g key={s.floor}>
              <text
                x={x(s.startIndex + 0.3)}
                y="22"
                className="replay-money-floor-label"
              >
                第{s.floor + 1}层 ·{' '}
                {s.initialKnown ? (s.reset ? '重置' : '初始') : '入房'}{' '}
                {s.startingMoney}
              </text>
              {s.reset && (
                <line
                  x1={x(s.startIndex + 0.3)}
                  x2={x(s.startIndex + 0.3)}
                  y1="35"
                  y2="248"
                  className="replay-timeline-floor-line"
                />
              )}
              <path
                className="replay-money-series"
                data-floor={s.floor}
                d={
                  'M ' +
                  x(s.startIndex + 0.3) +
                  ' ' +
                  y(s.startingMoney) +
                  ' ' +
                  s.points
                    .map((p) => 'L ' + x(p.index + 1) + ' ' + y(p.money))
                    .join(' ')
                }
              />
              <circle
                cx={x(s.startIndex + 0.3)}
                cy={y(s.startingMoney)}
                r="4"
                className="replay-money-entry"
              >
                <title>
                  第{s.floor + 1}层{s.initialKnown ? '初始' : '入房'}{' '}
                  {s.startingMoney} · 首个记录入房 {s.entryMoney}
                </title>
              </circle>
              {s.points.map((p) => (
                <a
                  key={p.index}
                  href="#replay-personal-result"
                  tabIndex={0}
                  className={
                    'replay-money-point' +
                    (p.index === roomIndex ? ' is-selected' : '')
                  }
                  aria-label={
                    '查看' + p.location + '资金' + p.money + '的个人复盘'
                  }
                  onClick={(e) => {
                    e.preventDefault();
                    onRoom(p.index);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onRoom(p.index);
                    }
                  }}
                >
                  <title>
                    {p.location} · 入房 {p.before} → 结算 {p.money} · 扣款{' '}
                    {p.cost} · 返款 {p.refund} · 其他变化 {p.otherMoneyChange}
                  </title>
                  <circle
                    cx={x(p.index + 1)}
                    cy={y(p.money)}
                    r="11"
                    className="replay-chart-hit"
                  />
                  <circle cx={x(p.index + 1)} cy={y(p.money)} r="3.5" />
                  <text x={x(p.index + 1)} y="276" textAnchor="middle">
                    {p.location.replace('F', '').replace('-R', '-')}
                  </text>
                </a>
              ))}
            </g>
          ))}
          <text x="490" y="305" textAnchor="middle">
            房间进程（层－房间）
          </text>
        </svg>
      </div>
      <p className="replay-muted">
        每个点使用保存的真实资金；入房资金已包含当房入场效果。换层的初始资金以空心点和断线标注。点击或键盘选择房间点进入个人复盘。
      </p>
    </section>
  );
}
