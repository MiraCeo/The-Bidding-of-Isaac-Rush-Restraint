import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  clampReplayRange,
  panReplayRange,
  zoomReplayRange,
  type ReplayChartRange,
} from '@/lib/ui/replay-chart-viewport';
import type { ReplayLog } from '@/lib/ui/replay-record';
import { replayChartAxis } from '@/lib/ui/replay-chart-axis';
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
  onReferenceRoom,
}: {
  log: ReplayLog;
  roomIndex: number;
  playerId: string;
  name: (id: string) => string;
  score: (v: number) => string;
  onFocusPlayer: (id: string) => void;
  onInspectAt: (id: string, index: number) => void;
  onReferenceRoom?: (index: number) => void;
}) {
  const id = useId();
  const svg = useRef<SVGSVGElement>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [onlyFocused, setOnlyFocused] = useState(false);
  const total = log.rooms.length;
  const [range, setRange] = useState<ReplayChartRange>({
    start: 0,
    end: total,
  });
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{
    pointerId: number;
    clientX: number;
    range: ReplayChartRange;
    width: number;
  } | null>(null);
  const suppressClick = useRef(false);
  const view = clampReplayRange(range, total);
  const span = view.end - view.start || 1;
  const minSpan = Math.min(2, total);
  function plotPoint(clientX: number, clientY: number) {
    const box = svg.current?.getBoundingClientRect();
    if (!box?.width || !box.height) return null;
    const px = ((clientX - box.left) * 925) / box.width;
    const py = ((clientY - box.top) * 363) / box.height;
    return px >= 74 && px <= 874 && py >= 34 && py <= 302
      ? { fraction: (px - 74) / 800, width: (box.width * 800) / 925 }
      : null;
  }
  useEffect(() => {
    const chart = svg.current;
    if (!chart) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || (!event.deltaY && !event.deltaX))
        return;
      const point = plotPoint(event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      setRange((old) => {
        const current = clampReplayRange(old, total);
        if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))
          return panReplayRange(
            current,
            total,
            Math.sign(event.deltaX || event.deltaY) *
              (current.end - current.start) *
              0.12,
          );
        return zoomReplayRange(
          current,
          total,
          event.deltaY < 0 ? 0.8 : 1.25,
          current.start + point.fraction * (current.end - current.start),
        );
      });
    };
    chart.addEventListener('wheel', wheel, { passive: false });
    return () => chart.removeEventListener('wheel', wheel);
  }, [total]);
  const model = useMemo(() => replayAllPlayerTimeline(log), [log]);
  const record = log.rooms[roomIndex];
  const ranking = useMemo(
    () => (record ? replayFieldComparison(record, 'score').points : []),
    [record],
  );
  if (!record) return null;
  const visible = (pid: string) =>
    pid === playerId || (!onlyFocused && !hidden.includes(pid));
  const displayed = model.series.filter((s) => visible(s.playerId));
  const maximum = Math.max(
    1,
    ...displayed.flatMap((s) =>
      s.points
        .filter(
          (_, i) => i >= Math.floor(view.start) && i <= Math.ceil(view.end),
        )
        .map((p) => p.value),
    ),
  );
  const x = (step: number) => 74 + ((step - view.start) * 800) / span;
  const axis = replayChartAxis(maximum);
  const y = (value: number) => 296 - (value / axis.maximum) * 254;
  const focus = model.series.find((s) => s.playerId === playerId)!;
  const focusValue = focus.points[roomIndex + 1]!.value;
  const currentVisible =
    roomIndex + 1 >= view.start && roomIndex + 1 <= view.end;
  const atMinimum = span <= minSpan + 0.000001;
  const atFull = span >= total - 0.000001;
  const location = (step: number) =>
    step === 0 ? '入场' : (model.rooms[step - 1]?.location ?? '');
  function zoom(factor: number) {
    setRange(
      zoomReplayRange(
        view,
        total,
        factor,
        currentVisible ? roomIndex + 1 : (view.start + view.end) / 2,
      ),
    );
  }
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
        <span>竖线与右侧积分榜对应参考房间；曲线展示整局已发生的进程</span>
        {onReferenceRoom && (
          <label className="replay-reference-room">
            参考房间{' '}
            <select
              aria-label="走势参考房间"
              value={roomIndex}
              onChange={(e) => onReferenceRoom(Number(e.target.value))}
            >
              {model.rooms.map((r) => (
                <option key={r.index} value={r.index}>
                  {r.location}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="replay-timeline-tools">
        <fieldset className="replay-chart-metrics" aria-label="积分走势缩放">
          <button
            type="button"
            aria-label="放大积分走势"
            disabled={atMinimum}
            onClick={() => zoom(0.67)}
          >
            ＋ 放大
          </button>
          <button
            type="button"
            aria-label="缩小积分走势"
            disabled={atFull}
            onClick={() => zoom(1.5)}
          >
            − 缩小
          </button>
          <button
            type="button"
            disabled={atFull}
            onClick={() => setRange({ start: 0, end: total })}
          >
            重置视图
          </button>
          <button
            type="button"
            disabled={currentVisible}
            onClick={() =>
              setRange(
                clampReplayRange(
                  {
                    start: roomIndex + 1 - span / 2,
                    end: roomIndex + 1 + span / 2,
                  },
                  total,
                ),
              )
            }
          >
            定位参考房间
          </button>
        </fieldset>
        <span className="replay-timeline-range-readout" aria-live="polite">
          可见：{location(Math.ceil(view.start))} —{' '}
          {location(Math.floor(view.end))} · {(total / span).toFixed(1)}×
        </span>
      </div>
      <fieldset className="replay-timeline-range" aria-label="积分走势房间范围">
        <label>
          起点 <b>{location(Math.round(view.start))}</b>
          <input
            type="range"
            min="0"
            max={Math.max(0, total - minSpan)}
            step="1"
            value={Math.round(view.start)}
            aria-label="走势范围起点"
            disabled={total <= minSpan}
            onChange={(e) =>
              setRange({
                start: Math.min(Number(e.target.value), view.end - minSpan),
                end: view.end,
              })
            }
          />
        </label>
        <label>
          终点 <b>{location(Math.round(view.end))}</b>
          <input
            type="range"
            min={minSpan}
            max={total}
            step="1"
            value={Math.round(view.end)}
            aria-label="走势范围终点"
            disabled={total <= minSpan}
            onChange={(e) =>
              setRange({
                start: view.start,
                end: Math.max(Number(e.target.value), view.start + minSpan),
              })
            }
          />
        </label>
      </fieldset>
      {!currentVisible && (
        <p className="replay-muted">
          参考房间不在可见范围；可点击“定位参考房间”，参考房间与右侧积分榜不会随缩放改变。
        </p>
      )}
      <div className="replay-timeline-layout">
        <div className="replay-chart-scroll">
          <svg
            ref={svg}
            viewBox="0 0 925 363"
            className={'replay-timeline-svg' + (dragging ? ' is-dragging' : '')}
            aria-labelledby={id}
            data-range-start={view.start}
            data-range-end={view.end}
            onPointerDown={(e) => {
              suppressClick.current = false;
              if (e.button !== 0) return;
              const point = plotPoint(e.clientX, e.clientY);
              if (point)
                gesture.current = {
                  pointerId: e.pointerId,
                  clientX: e.clientX,
                  range: view,
                  width: point.width,
                };
            }}
            onPointerMove={(e) => {
              const start = gesture.current;
              if (!start || start.pointerId !== e.pointerId) return;
              const dx = e.clientX - start.clientX;
              if (Math.abs(dx) < 5 && !suppressClick.current) return;
              e.preventDefault();
              suppressClick.current = true;
              setDragging(true);
              if (!e.currentTarget.hasPointerCapture?.(e.pointerId))
                e.currentTarget.setPointerCapture?.(e.pointerId);
              setRange(
                panReplayRange(
                  start.range,
                  total,
                  (-dx / start.width) * (start.range.end - start.range.start),
                ),
              );
            }}
            onPointerUp={(e) => {
              if (gesture.current?.pointerId !== e.pointerId) return;
              gesture.current = null;
              setDragging(false);
              if (e.currentTarget.hasPointerCapture?.(e.pointerId))
                e.currentTarget.releasePointerCapture?.(e.pointerId);
            }}
            onPointerCancel={() => {
              gesture.current = null;
              setDragging(false);
            }}
            onLostPointerCapture={() => {
              gesture.current = null;
              setDragging(false);
            }}
            onClickCapture={(e) => {
              if (suppressClick.current && e.detail !== 0) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            <title id={id}>
              全场玩家累计积分随房间进程变化，真实房间点之间直线连接，未含终局王冠倍率
            </title>
            <defs>
              <clipPath id={id + '-plot'}>
                <rect x="72" y="28" width="804" height="276" />
              </clipPath>
            </defs>
            {axis.ticks.map((tick) => (
              <g className="replay-chart-grid" key={tick}>
                <line x1="74" x2="874" y1={y(tick)} y2={y(tick)} />
                <text x="61" y={y(tick) + 4} textAnchor="end">
                  {tick}
                </text>
              </g>
            ))}
            <g clipPath={'url(#' + id + '-plot)'}>
              {model.rooms
                .filter(
                  (r, i) => i > 0 && r.floor !== model.rooms[i - 1]!.floor,
                )
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
              {currentVisible && (
                <line
                  x1={x(roomIndex + 1)}
                  x2={x(roomIndex + 1)}
                  y1="29"
                  y2="304"
                  className="replay-timeline-current"
                />
              )}
              {[...displayed.filter((s) => s.playerId !== playerId), focus].map(
                (s) => {
                  const color =
                    colors[
                      model.series.findIndex((p) => p.playerId === s.playerId)
                    ]!;
                  const path = s.points
                    .map(
                      (p, i) =>
                        (i === 0 ? 'M ' : 'L ') + x(i) + ' ' + y(p.value),
                    )
                    .join(' ');
                  return (
                    <a
                      key={s.playerId}
                      href="#replay-timeline-focus"
                      tabIndex={0}
                      aria-label={'关注' + name(s.playerId) + '的积分线'}
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
                },
              )}
              {focus.points
                .filter(
                  (p) =>
                    p.roomIndex >= 0 &&
                    p.roomIndex + 1 >= view.start &&
                    p.roomIndex + 1 <= view.end,
                )
                .map((p) => (
                  <a
                    key={p.roomIndex}
                    href="#replay-personal-result"
                    tabIndex={0}
                    aria-label={
                      '查看' +
                      name(playerId) +
                      '在' +
                      p.location +
                      '的复盘，累计积分' +
                      score(p.value)
                    }
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
            </g>
            {currentVisible && (
              <text
                x={x(roomIndex + 1)}
                y="20"
                textAnchor="middle"
                className="replay-timeline-current-label"
              >
                {record.location}
              </text>
            )}
            {Array.from({ length: total + 1 }, (_, step) => step)
              .filter((step) => step >= view.start && step <= view.end)
              .map((step) => (
                <text
                  key={step}
                  x={x(step)}
                  y="322"
                  textAnchor="middle"
                  className={
                    step === roomIndex + 1
                      ? 'replay-timeline-current-label'
                      : ''
                  }
                >
                  {step === 0
                    ? '入场'
                    : model.rooms[step - 1]!.location.replace('F', '').replace(
                        '-R',
                        '-',
                      )}
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
          aria-label="参考房间时点的累计积分排名"
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
        各真实结算点直线相连，连线不代表房间之间有额外结算。滚轮缩放、拖动左右平移，Shift＋滚轮平移；按钮和起止滑杆同样可用。纵轴按可见曲线自动适配。点击关注线上的房间点进入复盘，累计积分不含终局王冠倍率。
      </p>
    </section>
  );
}
