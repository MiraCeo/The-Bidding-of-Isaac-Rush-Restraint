import { getItemDefinition } from '../game/item-catalog';
import { countItem, hasItem } from '../game/runtime';
import { getDoubleActionScoreMultiplier } from '../game/characters';
import { defaultRules } from '../game/config';
import { getRoomScoreMultiplier } from '../game/room-modifiers';
import { getRuntimeActionAmounts } from '../game/turns';
import type { ActiveClientGameState } from '../game/client-session';
import type {
  ItemId,
  PlayerTurn,
  RuntimePlayerState,
} from '../game/item-types';
import type { RoomDraft } from './game-session';
import type { RulesConfig } from '../game/types';

export function draftTurn(playerId: string, draft: RoomDraft): PlayerTurn {
  const selected = draft.selectedAction;
  return {
    playerId,
    actions:
      selected.kind === 'withdraw'
        ? [{ type: 'withdraw' }]
        : selected.groups.map((group) => ({
            type: selected.kind,
            group,
            amount: draft.amounts[group][selected.kind],
          })),
  };
}
export function inventoryEntries(player: RuntimePlayerState) {
  const groups = new Map<ItemId, number>();
  for (const instance of player.items)
    groups.set(instance.itemId, (groups.get(instance.itemId) ?? 0) + 1);
  return Array.from(groups, ([id, count]) => ({
    item: getItemDefinition(id),
    count,
    effectiveCopies: getItemDefinition(id).effectStacks ? count : 1,
  }));
}
export function getBuildSummary(game: ActiveClientGameState, rules: RulesConfig = defaultRules) {
  const human = game.players.find((p) => p.id === game.humanPlayerId)!;
  const room = game.rooms[game.floorIndex]![game.roomIndex]!;
  const count = (id: ItemId) => countItem(human, id);
  const crownCount = count('dark_princes_crown');
  const crownFactor =
    Math.max(0.9, 1.4 - (human.items.length - crownCount) * 0.05) ** crownCount;
  const deterministicMultiplier =
    getRoomScoreMultiplier(room.kind, defaultRules.roomScoreMultipliers) *
    1.5 ** count('sacred_heart') *
    1.25 ** count('pentagram') *
    (room.kind === 'boss' ? 2 ** count('moms_heart') : 1) *
    1.5 ** count('eternal_d6') *
    1.25 ** count('whore_of_babylon');
  return {
    human,
    inventory: inventoryEntries(human),
    itemCount: human.items.length,
    temporaryShields: human.temporaryShields,
    persistentShields: human.persistentShields,
    canDoubleBid: hasItem(human, 'more_options'),
    canDoubleDisrupt: hasItem(human, 'more_options_question'),
    doubleMultiplier: getDoubleActionScoreMultiplier(human),
    crownFactor,
    effects: [
      {
        label: '竞拍扣款系数',
        value: `×${Number((0.7 ** count('steam_sale')).toFixed(6))}`,
        note: '按名义报价计算后取整；不提高名义报价上限。',
      },
      {
        label: '竞拍市场系数',
        value: `×${Number((1.25 ** count('twenty_twenty')).toFixed(6))}`,
        note: '改变市场等价，不改变原始计分等价。',
      },
      {
        label: '本房确定性倍率',
        value: `×${Number(deterministicMultiplier.toFixed(6))}`,
        note: '含房间与固定道具倍率；不含双行动、六面骰随机触发、清零与新获心脏追溯。',
      },
      {
        label: '终局王冠倍率',
        value: `×${Number(crownFactor.toFixed(6))}`,
        note: '按当前完整库存计算；重复非叠加道具也计入“其他道具”。',
      },
      ...(count('score_charm') + count('blood_of_the_martyr') > 0
        ? [
            {
              label: '固定行动加算',
              value: `+${10 * count('score_charm') + 20 * count('blood_of_the_martyr')}`,
              note: '积分护符与殉道者之血的合计；每份非观望行动、乘算前生效。',
            },
          ]
        : []),
      ...(count('poor_charm') > 0
        ? [
            {
              label: '穷人护符条件加算',
              value: `+${5 * count('poor_charm')} / +${20 * count('poor_charm')}`,
              note: `计分时资金低于 ${rules.floorStartingMoney[game.floorIndex]! * 0.3} 时取高档，否则取低档；扣款与项圈恢复可能改变档位。`,
            },
          ]
        : []),
    ],
  };
}
export function getQuotePreviews(player: RuntimePlayerState, turn: PlayerTurn) {
  return turn.actions.map((action) => ({
    action,
    nominal: action.type === 'withdraw' ? null : action.amount,
    ...getRuntimeActionAmounts(player, action, defaultRules),
    scoringRange:
      action.type === 'bid' && hasItem(player, 'brimstone')
        ? [action.amount * 0.8, action.amount * 1.25]
        : action.type === 'disrupt' && hasItem(player, 'short_brimstone')
          ? [
              action.amount * defaultRules.disruptionScoringMultiplier * 0.85,
              action.amount * defaultRules.disruptionScoringMultiplier * 1.2,
            ]
          : null,
  }));
}
