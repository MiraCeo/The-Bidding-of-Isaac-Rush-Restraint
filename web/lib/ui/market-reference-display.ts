/** Overview formatting only; never fed back into calculations. */
const overviewFormat = new Intl.NumberFormat('zh-CN', {
  useGrouping: false,
  maximumFractionDigits: 2,
});
export function marketOverview(value: number): string {
  return overviewFormat.format(value);
}
export function marketDifference(value: number): string {
  if (value === 0) return '0';
  const magnitude = marketOverview(Math.abs(value));
  return `${value < 0 ? '−' : '+'}${magnitude === '0' ? '<0.01' : magnitude}`;
}
/** Navigation only, never serialized. */
export interface MarketReplayPosition {
  floorIndex: number;
  roomIndex: number;
}
export function marketReplayIndex(
  rooms: readonly MarketReplayPosition[],
  position?: MarketReplayPosition,
): number {
  if (!position) return 0;
  return Math.max(
    0,
    rooms.findIndex(
      (room) =>
        room.floorIndex === position.floorIndex &&
        room.roomIndex === position.roomIndex,
    ),
  );
}
