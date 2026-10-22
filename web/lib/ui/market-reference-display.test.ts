import { expect, it } from 'vitest';
import {
  marketOverview,
  marketDifference,
  marketReplayIndex,
} from './market-reference-display';

it('rounds only the overview, preserving nonzero small differences and readable signs', () => {
  expect(marketOverview(30.31578947368421)).toBe('30.32');
  expect(marketOverview(40.00000000000001)).toBe('40');
  expect(marketDifference(0)).toBe('0');
  expect(marketDifference(0.000001)).toBe('+<0.01');
  expect(marketDifference(-0.000001)).toBe('−<0.01');
  expect(marketDifference(-23.5)).toBe('−23.5');
  expect(marketOverview(123456789.125)).toBe('123456789.13');
});
it('matches both room and floor, and leaves ordinary or missing-location replay at the original first room', () => {
  const rooms = [
    { floorIndex: 0, roomIndex: 0 },
    { floorIndex: 1, roomIndex: 0 },
    { floorIndex: 1, roomIndex: 1 },
  ];
  expect(marketReplayIndex(rooms, { floorIndex: 1, roomIndex: 0 })).toBe(1);
  expect(marketReplayIndex(rooms, { floorIndex: 1, roomIndex: 1 })).toBe(2);
  expect(marketReplayIndex(rooms)).toBe(0);
  expect(marketReplayIndex(rooms, { floorIndex: 2, roomIndex: 1 })).toBe(0);
  expect(marketReplayIndex([], rooms[0])).toBe(0);
});
