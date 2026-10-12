import { describe, expect, it } from 'vitest';
import { replayChartAxis } from './replay-chart-axis';
describe('display-only readable axes', () => {
  it('uses clean ticks that contain the original maximum', () => {
    expect(replayChartAxis(308.42)).toEqual({
      maximum: 400,
      step: 100,
      ticks: [0, 100, 200, 300, 400],
    });
    expect(replayChartAxis(554.47).ticks).toEqual([0, 200, 400, 600]);
  });
  it('keeps fractional and large maxima finite without excessive ticks', () => {
    for (const value of [0.02, 0.0001, 2632.3291, 1e10]) {
      const axis = replayChartAxis(value);
      expect(axis.maximum).toBeGreaterThanOrEqual(value);
      expect(axis.ticks).toHaveLength(Math.ceil(value / axis.step) + 1);
      expect(axis.ticks.length).toBeLessThanOrEqual(5);
      expect(axis.ticks.every(Number.isFinite)).toBe(true);
    }
  });
  it('does not invent fractional money ticks', () => {
    expect(replayChartAxis(1, true).ticks).toEqual([0, 1]);
    expect(replayChartAxis(3, true).ticks).toEqual([0, 1, 2, 3]);
  });
  it('handles zero and invalid maxima without NaN coordinates', () => {
    for (const value of [0, -1, Infinity, NaN])
      expect(replayChartAxis(value).maximum).toBe(1);
  });
});
