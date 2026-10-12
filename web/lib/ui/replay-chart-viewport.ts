export type ReplayChartRange = { start: number; end: number };

/** Display coordinates only. These helpers never change or interpolate replay facts. */
export function clampReplayRange(
  range: ReplayChartRange,
  total: number,
): ReplayChartRange {
  if (total <= 0) return { start: 0, end: 0 };
  const width = Math.min(
    total,
    Math.max(Math.min(2, total), range.end - range.start),
  );
  const start = Math.max(0, Math.min(total - width, range.start));
  return { start, end: start + width };
}
export function zoomReplayRange(
  range: ReplayChartRange,
  total: number,
  factor: number,
  anchor: number,
) {
  const current = clampReplayRange(range, total);
  const width = Math.min(
    total,
    Math.max(Math.min(2, total), (current.end - current.start) * factor),
  );
  const fraction = Math.max(
    0,
    Math.min(1, (anchor - current.start) / (current.end - current.start || 1)),
  );
  return clampReplayRange(
    { start: anchor - width * fraction, end: anchor + width * (1 - fraction) },
    total,
  );
}
export function panReplayRange(
  range: ReplayChartRange,
  total: number,
  delta: number,
) {
  return clampReplayRange(
    { start: range.start + delta, end: range.end + delta },
    total,
  );
}
