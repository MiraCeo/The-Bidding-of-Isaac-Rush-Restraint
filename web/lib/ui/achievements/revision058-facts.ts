import type { ClientRoomSettlementRecord } from '../../game/client-session';

/** Only the three group/action multiplicities absent from older room proofs.
 * Existing cause booleans already represent exact per-room metrics. No RNG. */
export function extractRevision058RoomCounts(
  record: ClientRoomSettlementRecord,
): readonly [number, number, number] | null {
  const human = record.playersBefore.find((p) => p.id === 'human' && p.isHuman);
  if (!human) return null;
  const actions = record.resolvedActions.filter((a) => a.playerId === human.id);
  const events = record.events.filter((e) => e.playerId === human.id);
  const hasSource = (group: 'A' | 'B', source: string) =>
    record.entitlements.some(
      (e) =>
        e.playerId === human.id &&
        e.group === group &&
        e.sources.includes(source),
    );
  const placedBid = (group: 'A' | 'B') =>
    [...record.highPricePlacements, ...record.cooperationPlacements].some(
      (p) =>
        p.playerId === human.id && p.group === group && p.actionType === 'bid',
    );
  // The engine refunds all failed actual costs in one player-level event BEFORE
  // More Options removes an entitlement. Reconstruct that qualification stage,
  // not final delivery or inventory. A zero-cost failed bid earned no refund.
  const qualifiedBeforeDestruction = (group: 'A' | 'B') =>
    placedBid(group) ||
    record.entitlements.some(
      (e) => e.playerId === human.id && e.group === group,
    ) ||
    events.some(
      (e) =>
        e.type === 'destroy' &&
        e.effectItemId === 'more_options' &&
        e.group === group,
    );
  const refunded = events.some(
    (e) =>
      e.type === 'refund' &&
      ['holy_mantle', 'wooden_cross'].includes(e.itemId ?? '') &&
      (e.amount ?? 0) > 0,
  );
  const refundGroups = actions.filter(
    (a) =>
      a.action.type === 'bid' &&
      a.actualCost > 0 &&
      !qualifiedBeforeDestruction(a.action.group),
  );
  const vacancyGroups = new Set<string>();
  for (const [slots, type] of [
    [record.highPricePlacements, 'highest'],
    [record.cooperationPlacements, 'cooperation'],
  ] as const) {
    for (const p of slots)
      if (
        p.playerId === human.id &&
        p.actionType === 'disrupt' &&
        actions.some(
          (a) => a.action.type === 'disrupt' && a.action.group === p.group,
        ) &&
        !record.transcendenceRedemptions.some(
          (r) =>
            r.playerId === p.playerId &&
            r.group === p.group &&
            r.slotType === type,
        )
      )
        vacancyGroups.add(p.group);
  }
  const luckyGroups = new Set(
    record.awards
      .filter(
        (a) =>
          a.playerId === human.id &&
          a.copies > 0 &&
          hasSource(a.group, 'lucky_foot') &&
          !placedBid(a.group) &&
          !hasSource(a.group, 'highest') &&
          !hasSource(a.group, 'cooperation') &&
          !hasSource(a.group, 'transcendence'),
      )
      .map((a) => a.group),
  );
  return [
    vacancyGroups.size,
    refunded
      ? new Set(
          refundGroups.map((a) =>
            a.action.type === 'bid' ? a.action.group : '',
          ),
        ).size
      : 0,
    luckyGroups.size,
  ];
}
