import { useId, useMemo, useState } from 'react';
import type { ReplayRoomRecord } from '@/lib/ui/replay-record';
import { replayChartAxis } from '@/lib/ui/replay-chart-axis';
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
  const model = useMemo(
    () => replayFieldComparison(record, metric),
    [record, metric],
  );
  const format = (v: number) => (metric === 'money' ? String(v) : score(v));
  const signed = (v: number) => (v > 0 ? '+' : '') + format(v);
  const selected = model.points.find(
    (p) => p.playerId === (hovered ?? playerId),
  )!;
  const label = metrics.find((m) => m.id === metric)!.label;
  const describe = (p: (typeof model.points)[number]) =>
    metric === 'roomScore'
      ? label + ' ' + format(p.value)
      : (metric === 'score' ? '入房累计' : '行动前资金') +
        ' ' +
        format(p.before) +
        ' → ' +
        label +
        ' ' +
        format(p.value) +
        '，变化 ' +
        signed(p.change);
  const axis = replayChartAxis(model.maximum, metric === 'money');
  const slot = 842 / Math.max(1, model.points.length);
  const x = (index: number) => 72 + slot * (index + 0.5);
  const y = (value: number) => 212 - (value / axis.maximum) * 166;
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
        {metric !== 'roomScore' && (
          <span>
            {metric === 'score' ? '入房累计' : '行动前资金'}{' '}
            {format(selected.before)} → {format(selected.value)}{' '}
            <em
              className={
                selected.change < 0 ? 'value-negative' : 'value-positive'
              }
            >
              （{signed(selected.change)}）
            </em>
          </span>
        )}
        <span>本图并列按精确值计算 · 第{selected.rank}名</span>
        {metric === 'money' && (
          <span>
            实际扣款 {selected.cost} · 返款 {selected.refund} · 其他变化{' '}
            {signed(selected.otherMoneyChange)}
          </span>
        )}
      </div>
      {metric !== 'roomScore' && (
        <div className="replay-bar-legend" aria-label="柱状图颜色含义">
          {metric === 'score' ? (
            <>
              <span>
                <i className="bar-swatch bar-before" />
                入房已有积分
              </span>
              <span>
                <i className="bar-swatch bar-gain" />
                本房新增（含追溯追加）
              </span>
            </>
          ) : (
            <>
              <span>
                <i className="bar-swatch bar-money-before" />
                行动前资金（轮廓）
              </span>
              <span>
                <i className="bar-swatch bar-money-after" />
                结算后资金（实心）
              </span>
            </>
          )}
          <span>亮色描边：当前关注玩家</span>
        </div>
      )}
      <div className="replay-chart-scroll">
        <svg
          viewBox="0 0 950 270"
          aria-labelledby={id}
          className={'replay-comparison-svg metric-' + metric}
        >
          <title id={id}>
            {record.location}全场{label}对比，按结算后该指标从高到低排列
          </title>
          {axis.ticks.map((value) => {
            return (
              <g key={value} className="replay-chart-grid">
                <line x1="72" x2="914" y1={y(value)} y2={y(value)} />
                <text x="60" y={y(value) + 4} textAnchor="end">
                  {value}
                </text>
              </g>
            );
          })}
          {model.points.map((p, i) => (
            <a
              key={p.playerId}
              href="#replay-personal-result"
              tabIndex={0}
              className={
                'replay-comparison-point' +
                (p.playerId === playerId ? ' is-selected' : '')
              }
              data-player-id={p.playerId}
              aria-label={
                '查看' + name(p.playerId) + '的本房复盘，' + describe(p)
              }
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
                {name(p.playerId)} · {describe(p)} · 第{p.rank}名
                {metric === 'money'
                  ? ' · 扣款 ' +
                    p.cost +
                    ' · 返款 ' +
                    p.refund +
                    ' · 其他变化 ' +
                    signed(p.otherMoneyChange)
                  : ''}
              </title>
              <rect
                x={x(i) - slot / 2}
                y="40"
                width={slot}
                height="181"
                className="replay-chart-hit"
              />
              {metric === 'score' && (
                <>
                  <rect
                    x={x(i) - slot * 0.31}
                    y={y(Math.min(p.before, p.value))}
                    width={slot * 0.62}
                    height={212 - y(Math.min(p.before, p.value))}
                    className="replay-bar-before"
                    data-value={p.before}
                  />
                  {p.change !== 0 && (
                    <rect
                      x={x(i) - slot * 0.31}
                      y={y(Math.max(p.value, p.before))}
                      width={slot * 0.62}
                      height={Math.abs(y(p.before) - y(p.value))}
                      className={
                        p.change < 0 ? 'replay-bar-loss' : 'replay-bar-gain'
                      }
                      data-value={p.change}
                    />
                  )}
                </>
              )}
              {metric === 'money' && (
                <>
                  <rect
                    x={x(i) - slot * 0.34}
                    y={y(p.before)}
                    width={slot * 0.68}
                    height={212 - y(p.before)}
                    rx="3"
                    className="replay-bar-money-before"
                    data-value={p.before}
                  />
                  <rect
                    x={x(i) - slot * 0.24}
                    y={y(p.value)}
                    width={slot * 0.48}
                    height={212 - y(p.value)}
                    rx="2"
                    className="replay-bar-money-after"
                    data-value={p.value}
                  />
                </>
              )}
              <rect
                x={x(i) - slot * 0.31}
                y={y(p.value)}
                width={slot * 0.62}
                height={Math.max(1, 212 - y(p.value))}
                rx="3"
                className="replay-comparison-bar"
                data-value={p.value}
              />
              <text x={x(i)} y="239" textAnchor="middle">
                {name(p.playerId)}
              </text>
              {p.playerId === playerId && (
                <text
                  x={x(i)}
                  y={Math.max(18, y(Math.max(p.value, p.before)) - 14)}
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
        横轴是按结算后指标排序的玩家，不是时间；点击或键盘选择一根柱进入个人复盘。
        {metric === 'score'
          ? '灰色旧积分与金色新增积分叠加为结算后累计，不含终局王冠倍率。'
          : metric === 'money'
            ? '行动前与结算后资金重叠比较，不相加；净变化不等于实际扣款。行动前取入房效果及换层重置之后的快照。'
            : '描边标明当前关注玩家。'}
      </p>
    </section>
  );
}
