import { useId, useState } from 'react';
import type { ReplayRoomRecord } from '@/lib/ui/replay-record';
import {
  replayFieldComparison,
  type ReplayFieldMetric,
} from '@/lib/ui/replay-view-model';

const metrics: Array<{ id: ReplayFieldMetric; label: string }> = [
  { id: 'roomScore', label: '本房积分' },
  { id: 'score', label: '累计积分' },
  { id: 'money', label: '结算资金' },
];
export function ReplayFieldChart({
  record,
  playerId,
  name,
  score,
  onInspect,
}: {
  record: ReplayRoomRecord;
  playerId: string;
  name: (id: string) => string;
  score: (value: number) => string;
  onInspect: (id: string) => void;
}) {
  const [metric, setMetric] = useState<ReplayFieldMetric>('roomScore');
  const [hovered, setHovered] = useState<string | null>(null);
  const id = useId();
  const model = replayFieldComparison(record, metric);
  const format = (v: number) => (metric === 'money' ? String(v) : score(v));
  const selected = model.points.find(
    (p) => p.playerId === (hovered ?? playerId),
  )!;
  const label = metrics.find((m) => m.id === metric)!.label;
  const tickCount =
    metric === 'money' ? Math.min(4, Math.ceil(model.maximum)) : 4;
  const slot = 842 / Math.max(1, model.points.length);
  const x = (index: number) => 72 + slot * (index + 0.5);
  const y = (value: number) => 212 - (value / model.maximum) * 166;
  return (
    <section className="replay-field-chart" aria-label="本房全场柱状对比">
      <div className="replay-section-heading">
        <div>
          <h3>全场结果对比</h3>
          <p>同一个房间 · {model.points.length}名玩家</p>
        </div>
        <fieldset className="replay-chart-metrics" aria-label="全场图表指标">
          {metrics.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={metric === m.id}
              onClick={() => {
                setMetric(m.id);
                setHovered(null);
              }}
            >
              {m.label}
            </button>
          ))}
        </fieldset>
      </div>
      <div className="replay-chart-readout" aria-live="polite">
        <strong>{name(selected.playerId)}</strong>
        <span>
          {label} <b>{format(selected.value)}</b>
        </span>
        <span>本图并列按精确值计算 · 第{selected.rank}名</span>
      </div>
      <div className="replay-chart-scroll">
        <svg
          viewBox="0 0 950 270"
          aria-labelledby={id}
          className="replay-comparison-svg"
        >
          <title id={id}>
            {record.location}全场{label}对比，按该指标从高到低排列
          </title>
          {Array.from({ length: tickCount + 1 }, (_, tick) => tick).map(
            (tick) => {
              const value = (model.maximum * tick) / tickCount;
              return (
                <g key={tick} className="replay-chart-grid">
                  <line x1="72" x2="914" y1={y(value)} y2={y(value)} />
                  <text x="60" y={y(value) + 4} textAnchor="end">
                    {metric === 'money'
                      ? Math.round(value)
                      : Number(value.toFixed(2))}
                  </text>
                </g>
              );
            },
          )}
          {model.points.map((p, i) => (
            <a
              key={p.playerId}
              href="#replay-personal-result"
              tabIndex={0}
              className={
                'replay-comparison-point' +
                (p.playerId === playerId ? ' is-selected' : '')
              }
              aria-label={`查看${name(p.playerId)}的本房复盘，${label}${format(p.value)}`}
              onPointerEnter={() => setHovered(p.playerId)}
              onPointerLeave={() => setHovered(null)}
              onFocus={() => setHovered(p.playerId)}
              onBlur={() => setHovered(null)}
              onClick={(e) => {
                e.preventDefault();
                onInspect(p.playerId);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onInspect(p.playerId);
                }
              }}
            >
              <title>
                {name(p.playerId)} · {label} {format(p.value)} · 第{p.rank}名
              </title>
              <rect
                x={x(i) - slot / 2}
                y="40"
                width={slot}
                height="181"
                className="replay-chart-hit"
              />
              <rect
                x={x(i) - slot * 0.31}
                y={y(p.value)}
                width={slot * 0.62}
                height={Math.max(1, 212 - y(p.value))}
                rx="3"
                className="replay-comparison-bar"
              />
              <text x={x(i)} y="239" textAnchor="middle">
                {name(p.playerId)}
              </text>
              {p.playerId === playerId && (
                <text
                  x={x(i)}
                  y={Math.max(18, y(p.value) - 14)}
                  textAnchor="middle"
                  className="replay-chart-selected-value"
                >
                  {format(p.value)}
                </text>
              )}
            </a>
          ))}
        </svg>
      </div>
      <p className="replay-muted">
        横轴是按当前指标排序的玩家，不是时间；柱高用于比较，亮色柱为当前关注玩家。点击或键盘选择一根柱进入个人复盘。
        {metric === 'score' ? '累计积分不含终局王冠倍率。' : ''}
      </p>
    </section>
  );
}
