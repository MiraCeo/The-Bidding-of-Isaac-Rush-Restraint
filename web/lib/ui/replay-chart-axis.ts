/** Display ticks only. Never round authoritative values or use these ticks for ranking. */
export function replayChartAxis(value: number, integer = false) {
  const maximum = Number.isFinite(value) && value > 0 ? value : 1;
  const raw = maximum / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const unit =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = Math.max(integer ? 1 : 0, unit * magnitude);
  const count = Math.ceil(maximum / step);
  const ticks = Array.from({ length: count + 1 }, (_, i) =>
    Number((step * i).toPrecision(12)),
  );
  return { maximum: ticks.at(-1)!, step, ticks };
}
