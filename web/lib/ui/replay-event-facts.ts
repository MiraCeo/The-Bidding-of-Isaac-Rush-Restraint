import type { SettlementEvent } from '../game/item-types';
import { canonicalJson, copySnapshot } from './replay-record';

export type EventReason =
  | 'cost'
  | 'turn_score'
  | 'heart_retroactive'
  | 'shield_refund'
  | 'bag_refund'
  | 'options_destroy'
  | 'tail_destroy'
  | 'tail_duplicate'
  | 'award'
  | 'sale_saving'
  | 'role_floor_start'
  | 'interest_floor'
  | 'interest_room'
  | 'collar_recovery'
  | 'bag_transfer'
  | 'legacy';
export interface EventFact extends Omit<SettlementEvent, 'message'> {
  reason: EventReason;
  targetPlayerId?: string;
  startingMoney?: number;
  copies?: number;
  /** Only unrecognized legacy events retain text; never discard their sole evidence. */
  legacyText?: string;
}
export function eventFactText(e: EventFact): string {
  switch (e.reason) {
    case 'cost':
      return `实际扣款 ${e.amount}。`;
    case 'turn_score':
      return `本房间获得 ${e.amount} 分。`;
    case 'heart_retroactive':
      return `${e.copies} 份妈妈的心脏追溯增加 ${e.amount} 分。`;
    case 'shield_refund':
      return `屏障退回 ${e.amount} 实际扣款。`;
    case 'bag_refund':
      return `福袋返还 ${e.amount} 资金。`;
    case 'options_destroy':
      return `更多选择随机摧毁了 ${e.group} 组道具。`;
    case 'tail_destroy':
      return '嗝屁猫的尾巴使道具消失。';
    case 'tail_duplicate':
      return '嗝屁猫的尾巴使道具翻倍。';
    case 'award':
      return `获得道具 ${e.itemId}。`;
    case 'sale_saving':
      return `Steam大促节省 ${e.amount} 资金。`;
    case 'role_floor_start':
      return `角色特性将本层初始资金调整为 ${e.startingMoney}。`;
    case 'interest_floor':
      return `利息提高本层初始资金 ${e.amount}。`;
    case 'interest_room':
      return `利息增加 ${e.amount} 资金。`;
    case 'collar_recovery':
      return `嗝屁猫的项圈恢复 ${e.amount} 资金。`;
    case 'bag_transfer':
      return `偷钱袋从 ${e.targetPlayerId} 窃取 ${e.amount} 资金。`;
    case 'legacy':
      return e.legacyText!;
    default:
      throw new Error('回放事件类型无效。');
  }
}
/** Convert existing engine traces at the storage boundary, without changing engine events. */
export function toEventFact(event: SettlementEvent): EventFact {
  const { message, ...fields } = copySnapshot(event);
  let reason: EventReason = 'legacy';
  const details: Partial<EventFact> = {};
  if (event.type === 'cost') reason = 'cost';
  else if (event.type === 'award') reason = 'award';
  else if (event.type === 'score') {
    if (!event.itemId) reason = 'turn_score';
    else if (event.itemId === 'moms_heart') {
      const count = /^(\d+) 份妈妈的心脏追溯增加 /.exec(message);
      if (count) {
        reason = 'heart_retroactive';
        details.copies = Number(count[1]);
      }
    }
  } else if (event.type === 'refund') {
    if (event.itemId === 'holy_mantle' || event.itemId === 'wooden_cross')
      reason = 'shield_refund';
    else if (event.itemId === 'grab_bag') reason = 'bag_refund';
  } else if (event.type === 'destroy') {
    if (event.effectItemId === 'more_options') reason = 'options_destroy';
    else if (event.effectItemId === 'guppys_tail') reason = 'tail_destroy';
  } else if (event.type === 'duplicate' && event.effectItemId === 'guppys_tail')
    reason = 'tail_duplicate';
  else if (event.type === 'money') {
    if (event.itemId === 'steam_sale') reason = 'sale_saving';
    else if (event.itemId === 'interest')
      reason = message.startsWith('利息提高本层初始资金 ')
        ? 'interest_floor'
        : 'interest_room';
    else if (event.itemId === 'guppys_collar') reason = 'collar_recovery';
    else if (event.itemId === 'money_bag') {
      const target = /^偷钱袋从 (human|ai-\d+) 窃取 /.exec(message);
      if (target) {
        reason = 'bag_transfer';
        details.targetPlayerId = target[1];
      }
    } else {
      const start = /^角色特性将本层初始资金调整为 (\d+)。$/.exec(message);
      if (start) {
        reason = 'role_floor_start';
        details.startingMoney = Number(start[1]);
      }
    }
  }
  const fact: EventFact = { ...fields, reason, ...details };
  // A template match must be exact, not a heuristic which loses unknown legacy evidence.
  if (reason === 'legacy' || eventFactText(fact) !== message)
    return { ...fields, reason: 'legacy', legacyText: message };
  return fact;
}
export function fromEventFact(fact: EventFact): SettlementEvent {
  const {
    reason: _reason,
    targetPlayerId: _target,
    startingMoney: _start,
    copies: _copies,
    legacyText: _legacy,
    ...fields
  } = fact;
  const event = { ...fields, message: eventFactText(fact) };
  if (canonicalJson(toEventFact(event)) !== canonicalJson(fact))
    throw new Error('回放事件参数不一致。');
  return event;
}
