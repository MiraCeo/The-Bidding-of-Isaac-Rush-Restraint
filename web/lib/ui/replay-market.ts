import type { ReplayRoomRecord } from './replay-record';

export function replayMarketModel(
  record: Pick<ReplayRoomRecord, 'settlement'>,
  radius: number,
) {
  const s = record.settlement;
  if (!s.baseline) return null;
  const target = s.baseline.target;
  const lower = Math.max(0, target - radius),
    upper = target + radius;
  const groups = (['A', 'B'] as const).map((group) => {
    const points = s.resolvedActions.flatMap((a) =>
      a.action.type !== 'withdraw' &&
      a.action.group === group &&
      a.marketEquivalent !== null
        ? [
            {
              playerId: a.playerId,
              actionIndex: a.actionIndex,
              type: a.action.type,
              value: a.marketEquivalent,
              nominalAmount: a.action.amount,
              scoringEquivalent: a.scoringEquivalent,
              scoringValue:
                s.scoreBreakdowns[a.playerId]?.actions.find(
                  (detail) => detail.actionIndex === a.actionIndex,
                )?.scoringValue ?? null,
              highPlacement: s.highPricePlacements.some(
                (p) =>
                  p.playerId === a.playerId &&
                  p.group === group &&
                  p.actionType === a.action.type,
              ),
              cooperationPlacement: s.cooperationPlacements.some(
                (p) =>
                  p.playerId === a.playerId &&
                  p.group === group &&
                  p.actionType === a.action.type,
              ),
            },
          ]
        : [],
    );
    const high = points.filter((p) =>
      s.highPricePlacements.some(
        (v) =>
          v.group === group &&
          v.playerId === p.playerId &&
          v.actionType === p.type,
      ),
    );
    return {
      group,
      points,
      cutoff: high.length ? Math.min(...high.map((p) => p.value)) : null,
    };
  });
  return {
    target,
    lower,
    upper,
    maximum:
      Math.max(
        1,
        upper,
        ...groups.flatMap((g) => g.points.map((p) => p.value)),
      ) * 1.06,
    groups,
    cooperationMaximum:
      Math.max(
        1,
        upper,
        ...groups.flatMap((g) => g.points.map((p) => p.scoringEquivalent ?? 0)),
      ) * 1.06,
    combinedMaximum:
      Math.max(
        1,
        upper,
        ...groups.flatMap((g) =>
          g.points.flatMap((p) => [p.value, p.scoringEquivalent ?? 0]),
        ),
      ) * 1.06,
  };
}
