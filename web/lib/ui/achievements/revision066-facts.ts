import type { ClientRoomSettlementRecord } from '../../game/client-session';
/** Observe only the authoritative debit; never infer it from balance differences. */
export function extractAllInCapital(
  record: ClientRoomSettlementRecord,
): readonly [number, number] | undefined {
  const human = record.playersBefore.find((p) => p.id === 'human' && p.isHuman);
  if (!human) return undefined;
  const base = human.characterFloorStartingMoney;
  if (base === null || !Number.isSafeInteger(base) || base <= 0)
    throw Error('全押成就缺少本层角色初始资金证据，成长待核验。');
  const actions = record.resolvedActions.filter(
    (a) =>
      a.playerId === human.id &&
      a.action.type === 'bid' &&
      human.money > 0 &&
      a.action.amount === human.money,
  );
  const debit = actions.reduce((sum, a) => sum + a.actualCost, 0);
  if (!Number.isSafeInteger(debit) || debit < 0)
    throw Error('全押成就实际扣款证据无效。');
  return [debit, base];
}
