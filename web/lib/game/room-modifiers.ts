import type { RoomKind } from './item-types';

export const roomScoreMultipliers: Readonly<Record<RoomKind, number>> = {
  normal: 1,
  treasure: 1.5,
  shop: 1,
  hidden: 2,
  boss: 2,
};

export function getRoomScoreMultiplier(
  roomKind: RoomKind | undefined,
  multipliers: Readonly<Record<RoomKind, number>> = roomScoreMultipliers,
): number {
  return roomKind === undefined ? 1 : multipliers[roomKind];
}
