import { useId, useState } from 'react';
import type { ReplayLog } from '@/lib/ui/replay-record';
import {
  replayAllPlayerTimeline,
  replayFieldComparison,
} from '@/lib/ui/replay-view-model';

const colors = [
  '#f4c363',
  '#64c9bf',
  '#8eaafa',
  '#c58bdc',
  '#e69380',
  '#a7ce73',
  '#6eb8e1',
  '#e6a15d',
  '#e381b6',
  '#adadf2',
  '#80c7a0',
  '#b6bf68',
  '#d5946d',
  '#9fb8cb',
  '#be8fa9',
  '#85b681',
  '#78c9d4',
  '#c8a574',
  '#a2a0c4',
  '#ccba93',
];
export function ReplayScoreTimeline({
  log,
  roomIndex,
  playerId,
  name,
  score,
  onFocusPlayer,
  onInspectAt,
}: {
  log: ReplayLog;
  roomIndex: number;
  playerId: string;
  name: (id: string) => string;
  score: (v: number) => string;
  onFocusPlayer: (id: string) => void;
  onInspectAt: (id: string, index: number) => void;
}) {
  const id = useId();
  const [hidden, setHidden] = useState<string[]>([]);
  const [onlyFocused, setOnlyFocused] = useState(false);
  const model = replayAllPlayerTimeline(log),
    record = log.rooms[roomIndex];
  if (!record) return null;
  const ranking = replayFieldComparison(record, 'score').points;
  const x = (step: number) =>
    74 + (step * 800) / Math.max(1, model.rooms.length);
  const y = (value: number) => 296 - (value / model.maximum) * 254;
  const visible = (pid: string) =>
    pid === playerId || (!onlyFocused && !hidden.includes(pid));
  const focus = model.series.find((s) => s.playerId === playerId)!;
  const focusValue = focus.points[roomIndex + 1]!.value;
  return (
    <section className="replay-score-timeline" aria-label="全场累计积分时序图">
      <div className="replay-section-heading">
        <div>
          <h3>全场积分走势</h3>
          <p>
            横轴是房间进程，每名玩家一条积分线 · 共{model.rooms.length}
            个已结算房间
          </p>
        </div>
        <fieldset
          className="replay-chart-metrics"
          aria-label="积分走势显示范围"
        >
          <button
            type="button"
            aria-pressed={!onlyFocused && !hidden.length}
            onClick={() => {
              setOnlyFocused(false);
              setHidden([]);
            }}
          >
            显示全部
          </button>
          <button
            type="button"
            aria-pressed={onlyFocused}
            onClick={() => setOnlyFocused(true)}
          >
            仅看关注
          </button>
        </fieldset>
      </div>
      <div className="replay-chart-readout">
        <strong>{name(playerId)}</strong>
        <span>
          {record.location}时累计 <b>{score(focusValue)}</b>
        </span>
        <span>竖线为当前复盘房间；曲线展示整局已发生的进程</span>
      </div>
      <div className="replay-timeline-layout">
        <div className="replay-chart-scroll">
          <svg
            viewBox="0 0 925 363"
            className="replay-timeline-svg"
            aria-labelledby={id}
          >
            <title id={id}>
              全场玩家累计积分随房间进程变化，未含终局王冠倍率
            </title>
            {[0, 1, 2, 3, 4].map((tick) => (
              <g className="replay-chart-grid" key={tick}>
                <line
                  x1="74"
                  x2="884"
                  y1={y((model.maximum * tick) / 4)}
                  y2={y((model.maximum * tick) / 4)}
                />
                <text
                  x="61"
                  y={y((model.maximum * tick) / 4) + 4}
                  textAnchor="end"
                >
                  {Number(((model.maximum * tick) / 4).toFixed(2))}
                </text>
              </g>
            ))}
            {model.rooms
              .filter((r) => r.index > 0 && r.index % 5 === 0)
              .map((r) => (
                <line
                  key={r.index}
                  x1={x(r.index + 0.5)}
                  x2={x(r.index + 0.5)}
                  y1="34"
                  y2="302"
                  className="replay-timeline-floor-line"
                />
              ))}
            <line
              x1={x(roomIndex + 1)}
              x2={x(roomIndex + 1)}
              y1="29"
              y2="304"
              className="replay-timeline-current"
            />
            <text
              x={x(roomIndex + 1)}
              y="20"
              textAnchor="middle"
              className="replay-timeline-current-label"
            >
              {record.location}
            </text>
            {[...model.series.filter((s) => s.playerId !== playerId), focus]
              .filter((s) => visible(s.playerId))
              .map((s) => {
                const color =
                  colors[
                    model.series.findIndex((p) => p.playerId === s.playerId)
                  ]!;
                const path = s.points
                  .map((p, i) =>
                    i === 0
                      ? `M ${x(0)} ${y(p.value)}`
                      : `H ${x(i)} V ${y(p.value)}`,
                  )
                  .join(' ');
                return (
                  <a
                    key={s.playerId}
                    href="#replay-timeline-focus"
                    aria-label={`关注${name(s.playerId)}的积分线`}
                    className="replay-timeline-series-link"
                    onClick={(e) => {
                      e.preventDefault();
                      onFocusPlayer(s.playerId);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                        onFocusPlayer(s.playerId);
                      }
                    }}
                  >
                    <title>
                      {name(s.playerId)} · {record.location}累计
                      {score(s.points[roomIndex + 1]!.value)}
                    </title>
                    <path
                      d={path}
                      stroke={color}
                      className={
                        'replay-player-series' +
                        (s.playerId === playerId ? ' is-focused' : '')
                      }
                      data-player-id={s.playerId}
                    />
                  </a>
                );
              })}
            {focus.points
              .filter((p) => p.roomIndex >= 0)
              .map((p) => (
                <a
                  key={p.roomIndex}
                  href="#replay-personal-result"
                  aria-label={`查看${name(playerId)}在${p.location}的复盘，累计积分${score(p.value)}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onInspectAt(playerId, p.roomIndex);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      onInspectAt(playerId, p.roomIndex);
                    }
                  }}
                  className="replay-timeline-inspect-point"
                >
                  <title>
                    {p.location} · {name(playerId)} · 累计{score(p.value)}
                  </title>
                  <circle
                    cx={x(p.roomIndex + 1)}
                    cy={y(p.value)}
                    r="10"
                    className="replay-chart-hit"
                  />
                  <circle
                    cx={x(p.roomIndex + 1)}
                    cy={y(p.value)}
                    r={p.roomIndex === roomIndex ? 5.5 : 3.5}
                  />
                </a>
              ))}
            <text x={x(0)} y="322" textAnchor="middle">
              入场
            </text>
            {model.rooms.map((r) => (
              <text
                key={r.index}
                x={x(r.index + 1)}
                y="322"
                textAnchor="middle"
                className={
                  r.index === roomIndex ? 'replay-timeline-current-label' : ''
                }
              >
                {r.location.replace('F', '').replace('-R', '-')}
              </text>
            ))}
            <text
              x="480"
              y="352"
              textAnchor="middle"
              className="replay-timeline-axis-label"
            >
              房间进程（层－房间）
            </text>
          </svg>
        </div>
        <aside
          className="replay-timeline-leaderboard"
          id="replay-timeline-focus"
          aria-label="当前房间时点的累计积分排名"
        >
          <header>
            <strong>积分榜</strong>
            <span>{record.location}时点</span>
          </header>
          <ol>
            {ranking.map((p) => {
              const color =
                colors[
                  model.series.findIndex((s) => s.playerId === p.playerId)
                ]!;
              return (
                <li
                  key={p.playerId}
                  className={p.playerId === playerId ? 'is-focused' : ''}
                >
                  <input
                    type="checkbox"
                    aria-label={`显示${name(p.playerId)}的积分线`}
                    checked={visible(p.playerId)}
                    disabled={p.playerId === playerId}
                    onChange={(e) => {
                      if (onlyFocused && e.target.checked) {
                        setOnlyFocused(false);
                        setHidden(
                          model.series
                            .filter(
                              (s) =>
                                s.playerId !== playerId &&
                                s.playerId !== p.playerId,
                            )
                            .map((s) => s.playerId),
                        );
                      } else
                        setHidden((ids) =>
                          e.target.checked
                            ? ids.filter((id) => id !== p.playerId)
                            : [...ids, p.playerId],
                        );
                    }}
                  />
                  <span
                    className="replay-series-color"
                    style={{ backgroundColor: color }}
                  />
                  <span className="replay-timeline-rank">{p.rank}</span>
                  <button
                    type="button"
                    onClick={() => onFocusPlayer(p.playerId)}
                    aria-label={`关注${name(p.playerId)}的积分走势`}
                  >
                    {name(p.playerId)}
                  </button>
                  <b>{score(p.value)}</b>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>
      <p className="replay-muted">
        积分只在真实结算点变化，所以使用阶梯折线，不补造房间之间的数据。可隐藏部分玩家；点击关注线上的房间点进入对应复盘。累计积分不含终局王冠倍率。
      </p>
    </section>
  );
}
