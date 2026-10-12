import { describe, expect, it } from 'vitest';
import { replayEventText } from './replay-display';
import type { SettlementEvent } from '../game/item-types';
describe('event display precision independent of facts', () => {
  const name = (id: string) => id;
  it('formats a known score sentence using the selected precision without changing the event', () => {
    const e: SettlementEvent = {
      type: 'score',
      playerId: 'human',
      amount: 99.0832,
      message: '本房间获得 99.0832 分。',
    };
    const before = JSON.stringify(e);
    expect(replayEventText(e, name, (v) => v.toFixed(2))).toBe(
      '本房间获得 99.08 分。',
    );
    expect(replayEventText(e, name, (v) => v.toFixed(4))).toBe(
      '本房间获得 99.0832 分。',
    );
    expect(replayEventText(e, name)).toBe(e.message);
    expect(JSON.stringify(e)).toBe(before);
  });
  it('keeps heart copy counts and current item labels while formatting the bonus', () => {
    const e: SettlementEvent = {
      type: 'score',
      playerId: 'human',
      itemId: 'moms_heart',
      amount: 12.3456,
      message: '2 份妈妈的心脏追溯增加 12.3456 分。',
    };
    expect(replayEventText(e, name, (v) => v.toFixed(2))).toBe(
      '2 份以撒的心脏追溯增加 12.35 分。',
    );
  });
  it('preserves unknown historical text and integral money rather than rounding arbitrary strings', () => {
    const unknown: SettlementEvent = {
      type: 'score',
      playerId: 'human',
      amount: 1.2345,
      message: '历史协议 1.2345：特殊结果。',
    };
    expect(replayEventText(unknown, name, (v) => v.toFixed(2))).toBe(
      unknown.message,
    );
    const transfer: SettlementEvent = {
      type: 'money',
      playerId: 'ai-1',
      itemId: 'money_bag',
      amount: 25,
      message: '偷钱袋从 human 窃取 25 资金。',
    };
    expect(replayEventText(transfer, name, (v) => v.toFixed(2))).toContain(
      '25 资金',
    );
  });
});
