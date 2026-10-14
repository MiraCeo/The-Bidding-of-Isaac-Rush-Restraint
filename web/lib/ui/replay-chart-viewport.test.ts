import { describe, expect, it } from 'vitest';
import {
  clampReplayRange,
  panReplayRange,
  zoomReplayRange,
} from './replay-chart-viewport';
describe('read-only chart viewport geometry', () => {
  it('clamps both edges while preserving the width', () => {
    expect(clampReplayRange({ start: -2, end: 3 }, 15)).toEqual({
      start: 0,
      end: 5,
    });
    expect(clampReplayRange({ start: 14, end: 19 }, 15)).toEqual({
      start: 10,
      end: 15,
    });
    expect(clampReplayRange({ start: 0, end: 99 }, 15)).toEqual({
      start: 0,
      end: 15,
    });
  });
  it('keeps empty and one-room archives finite without a fictitious minimum span', () => {
    expect(zoomReplayRange({ start: 0, end: 0 }, 0, 0.5, 0)).toEqual({
      start: 0,
      end: 0,
    });
    expect(zoomReplayRange({ start: 0, end: 1 }, 1, 0.01, 0.5)).toEqual({
      start: 0,
      end: 1,
    });
  });
  it('zooms around the same proportional anchor and limits zoom in and out', () => {
    expect(zoomReplayRange({ start: 0, end: 15 }, 15, 0.5, 6)).toEqual({
      start: 3,
      end: 10.5,
    });
    expect(zoomReplayRange({ start: 3, end: 10.5 }, 15, 2, 6)).toEqual({
      start: 0,
      end: 15,
    });
    const min = zoomReplayRange({ start: 0, end: 15 }, 15, 0.001, 6);
    expect(min.end - min.start).toBeCloseTo(2);
  });
  it('pans without changing the scale and clamps at either boundary', () => {
    expect(panReplayRange({ start: 2, end: 7 }, 15, 3)).toEqual({
      start: 5,
      end: 10,
    });
    expect(panReplayRange({ start: 2, end: 7 }, 15, -10)).toEqual({
      start: 0,
      end: 5,
    });
    expect(panReplayRange({ start: 2, end: 7 }, 15, 99)).toEqual({
      start: 10,
      end: 15,
    });
  });
});
