import { getItemDefinition } from '../game/item-catalog';
import { countItem } from '../game/runtime';
import { displayItemText } from './item-labels';
import type { ReplayRoomRecord } from './replay-record';
import type { SettlementEvent } from '../game/item-types';

// Legacy Money Bag traces record only the owner; recognize its exact persisted grammar.
// Do not infer associations from arbitrary substrings or change the engine's v1 event identity.
function legacyTransferTarget(event: SettlementEvent): string | null {
  if (event.type !== 'money' || event.itemId !== 'money_bag') return null;
  return (
    /^偷钱袋从 (human|ai-\d+) 窃取 \d+ 资金。$/.exec(event.message)?.[1] ?? null
  );
}
export function replayEventRelatedTo(
  event: SettlementEvent,
  playerId: string,
): boolean {
  return (
    event.playerId === playerId || legacyTransferTarget(event) === playerId
  );
}
export function replayEventText(
  event: SettlementEvent,
  name: (id: string) => string,
  score?: (value: number) => string,
): string {
  if (score && event.type === 'score' && event.amount !== undefined) {
    if (event.message === `本房间获得 ${event.amount} 分。`)
      return `本房间获得 ${score(event.amount)} 分。`;
    const heart = /^(\d+) 份妈妈的心脏追溯增加 ([\d.-]+) 分。$/.exec(
      event.message,
    );
    if (
      event.itemId === 'moms_heart' &&
      heart &&
      Number(heart[2]) === event.amount
    )
      return displayItemText(
        `${heart[1]} 份妈妈的心脏追溯增加 ${score(event.amount)} 分。`,
      );
  }
  if (event.type === 'award' && event.itemId)
    return `获得道具 ${getItemDefinition(event.itemId).name}。`;
  const target = legacyTransferTarget(event);
  if (target)
    return `偷钱袋：${name(target)} → ${name(event.playerId)}，转移 ${event.amount ?? 0} 资金。`;
  return displayItemText(event.message);
}

export const replayRoomNames = {
  normal: '普通房',
  treasure: '宝箱房',
  shop: '商店',
  hidden: '隐藏房',
  boss: 'BOSS房',
} as const;
export const replayStrategyNames = {
  high_bid: '高价竞拍',
  cooperate: '合作竞拍',
  disrupt_high: '高价扰乱',
  disrupt_cooperate: '合作扰乱',
  withdraw: '观望',
} as const;
export const entitlementNames: Record<string, string> = {
  highest: '高价资格',
  cooperation: '合作资格',
  transcendence: '超凡升天赎回',
  lucky_foot: '幸运脚资格',
};

export function replayPlayerRows(record: ReplayRoomRecord) {
  const s = record.settlement;
  return s.players.map((after) => {
    const before = s.playersBefore.find((p) => p.id === after.id)!;
    const previous = record.previousPlayers?.find((p) => p.id === after.id);
    const score = s.roomScoreSummaries[after.id]!;
    return {
      before,
      after,
      previous,
      score,
      moneyDelta: after.money - before.money,
      awards: s.awards.filter((a) => a.playerId === after.id),
    };
  });
}
export function replayOutcomeLabels(
  record: ReplayRoomRecord,
  playerId: string,
): string[] {
  const s = record.settlement;
  const player = s.playersBefore.find((p) => p.id === playerId)!;
  const after = s.players.find((p) => p.id === playerId)!;
  const previous = record.previousPlayers?.find((p) => p.id === playerId);
  const breakdown = s.scoreBreakdowns[playerId];
  const labels = (breakdown?.triggers ?? []).map((trigger) => {
    const kinds: Record<string, string> = {
      scoring_adjustment: '计分调整',
      additive_score: '积分加算',
      multiplier_applied: '固定倍率',
      boss_multiplier_applied: 'BOSS倍率',
      double_score: '随机翻倍触发',
      clear_score: '清零触发',
    };
    return `${getItemDefinition(trigger.itemId).name}：${kinds[trigger.kind] ?? trigger.kind}${trigger.amount === undefined ? '' : ` ${Number(trigger.amount.toFixed(4))}`}`;
  });
  if (
    breakdown &&
    countItem(player, 'd6') &&
    !breakdown.triggers.some((t) => t.itemId === 'd6')
  )
    labels.push('六面骰：本房未触发随机翻倍。');
  if (
    breakdown &&
    countItem(player, 'eternal_d6') &&
    !breakdown.triggers.some((t) => t.itemId === 'eternal_d6')
  )
    labels.push('永恒六面骰：本房未触发清零。');
  const previousCollars =
    record.settlement.room.roomIndex === 0
      ? []
      : (previous?.triggeredCollarsThisFloor ?? []);
  const checked = after.triggeredCollarsThisFloor.filter(
    (id) => !previousCollars.includes(id),
  ).length;
  const recoveries = [...record.entryEvents, ...s.events].filter(
    (e) =>
      e.playerId === playerId &&
      e.itemId === 'guppys_collar' &&
      e.type === 'money',
  ).length;
  if (checked)
    labels.push(
      `嗝屁猫的项圈：本房检查 ${checked} 份，实际恢复 ${recoveries} 次。`,
    );
  for (const redemption of s.transcendenceRedemptions.filter(
    (r) => r.playerId === playerId,
  ))
    labels.push(
      `超凡升天：赎回 ${redemption.group} 的${redemption.slotType === 'highest' ? '高价' : '合作'}名额。`,
    );
  for (const event of s.events.filter(
    (e) =>
      e.playerId === playerId &&
      (e.type === 'destroy' || e.type === 'duplicate'),
  ))
    labels.push(`${event.group ?? ''}：${event.message}`);
  return labels.map(displayItemText);
}
