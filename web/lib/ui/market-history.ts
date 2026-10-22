import type { ClientRoomSettlementRecord } from '../game/client-session';
import type { RulesConfig, RewardGroup } from '../game/types';
import { replayMarketModel } from './replay-market';

export interface HistoricalMarketGroup {
  group: RewardGroup;
  cutoff: number | null;
  missing: 'no-actions' | 'no-high-placement' | null;
}
/** Public numeric facts only: no rewards, names, secret turns or AI summaries. */
export interface HistoricalMarket {
  floorIndex: number;
  roomIndex: number;
  playerCount: number;
  target: number | null;
  lower: number | null;
  upper: number | null;
  groups: readonly HistoricalMarketGroup[];
}

/** Callers supply only their own session's published settlements. The selector
 * excludes this/future rooms and other floors before looking at any market facts. */
export function selectMarketHistory(
  records: readonly ClientRoomSettlementRecord[],
  position: { floorIndex: number; roomIndex: number },
  rules: Pick<RulesConfig, 'floorStartingMoney' | 'cooperationZoneRatio'>,
): HistoricalMarket[] {
  const funds = rules.floorStartingMoney[position.floorIndex];
  if (funds === undefined || !Number.isFinite(funds) || funds < 0) return [];
  const unique = new Map<number, ClientRoomSettlementRecord>();
  for (const record of records) {
    if (
      record.room.floorIndex === position.floorIndex &&
      Number.isInteger(record.room.roomIndex) &&
      record.room.roomIndex >= 0 &&
      record.room.roomIndex < position.roomIndex
    )
      unique.set(record.room.roomIndex, record);
  }
  return [...unique.values()]
    .sort((a, b) => b.room.roomIndex - a.room.roomIndex)
    .slice(0, 3)
    .map((record) => {
      const model = replayMarketModel(
        { settlement: record },
        funds * rules.cooperationZoneRatio,
      );
      return {
        floorIndex: record.room.floorIndex,
        roomIndex: record.room.roomIndex,
        playerCount: record.playersBefore.length,
        target: model?.target ?? null,
        lower: model?.lower ?? null,
        upper: model?.upper ?? null,
        groups: (['A', 'B'] as const).map((group) => {
          const points = model?.groups.find((entry) => entry.group === group);
          return {
            group,
            cutoff: points?.cutoff ?? null,
            missing: !points?.points.length
              ? 'no-actions'
              : points.cutoff === null
                ? 'no-high-placement'
                : null,
          };
        }),
      };
    });
}

export function missingMarketLabel(group: HistoricalMarketGroup): string {
  return group.missing === 'no-actions'
    ? `${group.group}组无行动`
    : `${group.group}组无高价名额`;
}
