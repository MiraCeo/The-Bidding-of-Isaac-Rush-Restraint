/** Money is always non-negative integer state; halves round upward. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Money must be finite.');
  return Math.max(0, Math.floor(value + 0.5));
}
