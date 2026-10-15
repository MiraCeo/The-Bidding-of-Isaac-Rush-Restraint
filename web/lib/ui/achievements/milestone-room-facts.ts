import type { ClientRoomSettlementRecord } from '../../game/client-session';
/** Observe authoritative ordered placements and actual deliveries, never draw RNG. */
export function extractMilestoneRoomFacts(record: ClientRoomSettlementRecord) {
  const human = record.playersBefore.find((p) => p.id === 'human' && p.isHuman);
  if (!human) throw Error('新成就原因缺少真人结算。');
  const actions = record.resolvedActions.filter((a) => a.playerId === human.id);
  const awards = record.awards.filter(
    (a) => a.playerId === human.id && a.copies > 0,
  );
  const delivered = (group: string) => awards.some((a) => a.group === group);
  const source = (group: string, name: 'highest' | 'cooperation') =>
    record.entitlements.some(
      (e) =>
        e.playerId === human.id &&
        e.group === group &&
        e.sources.includes(name),
    );
  const high = (group: string) =>
    record.highPricePlacements.filter((p) => p.group === group);
  const bids = actions.filter((a) => a.action.type === 'bid');
  const lastHigh = bids.some(
    (a) =>
      a.action.type === 'bid' &&
      high(a.action.group).at(-1)?.playerId === human.id &&
      source(a.action.group, 'highest') &&
      delivered(a.action.group),
  );
  const alternative = bids.some((a) => {
    if (a.action.type !== 'bid') return false;
    const group = a.action.group;
    return (
      !high(group).some(
        (p) => p.playerId === human.id && p.actionType === 'bid',
      ) &&
      !source(group, 'highest') &&
      source(group, 'cooperation') &&
      delivered(group) &&
      record.resolvedActions.some(
        (other) =>
          other.playerId !== human.id &&
          other.action.type !== 'withdraw' &&
          other.action.group === group &&
          (other.marketEquivalent ?? 0) > (a.marketEquivalent ?? 0),
      )
    );
  });
  const redeemed = record.transcendenceRedemptions.some(
    (r) => r.playerId === human.id && delivered(r.group),
  );
  const vacancies = [
    ...record.highPricePlacements.map((p) => ({ ...p, slotType: 'highest' })),
    ...record.cooperationPlacements.map((p) => ({
      ...p,
      slotType: 'cooperation',
    })),
  ].filter(
    (p) =>
      p.playerId === human.id &&
      p.actionType === 'disrupt' &&
      !record.transcendenceRedemptions.some(
        (r) =>
          r.playerId === p.playerId &&
          r.group === p.group &&
          r.slotType === p.slotType,
      ),
  );
  const doubleVacancy =
    actions.length === 2 &&
    actions.every((a) => a.action.type === 'disrupt') &&
    new Set(vacancies.map((v) => v.group)).size === 2;
  const allIn =
    human.money > 0 &&
    bids.some(
      (a) =>
        a.action.type === 'bid' &&
        a.action.amount === human.money &&
        delivered(a.action.group),
    );
  const asymmetric =
    human.characterId === 'jacob_esau' &&
    bids.length === 2 &&
    bids[0]!.action.type === 'bid' &&
    bids[1]!.action.type === 'bid' &&
    bids[0]!.action.group !== bids[1]!.action.group &&
    bids[0]!.action.amount !== bids[1]!.action.amount &&
    awards.length > 0;
  const saleSavings = record.events
    .filter(
      (e) =>
        e.playerId === human.id &&
        e.type === 'money' &&
        e.itemId === 'steam_sale',
    )
    .reduce((sum, e) => sum + (e.amount ?? 0), 0);
  if (!Number.isSafeInteger(saleSavings) || saleSavings < 0)
    throw Error('节省金额证据无效。');
  return {
    milestoneFlags:
      Number(lastHigh) +
      Number(alternative) * 2 +
      Number(redeemed) * 4 +
      Number(doubleVacancy) * 8 +
      Number(allIn) * 16 +
      Number(asymmetric) * 32,
    saleSavings,
  };
}
