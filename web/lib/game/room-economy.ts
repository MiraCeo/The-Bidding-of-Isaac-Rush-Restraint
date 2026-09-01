import type { RuntimePlayerState, SettlementEvent } from './item-types';
import { getCharacterFloorStartingMoney } from './characters';
import { roundMoney } from './money';
import { cloneRuntimePlayer, countItem } from './runtime';
import type { RandomSource, RulesConfig } from './types';

function applyPercentRepeated(value: number, multiplier: number, count: number): number {
  let result = value;
  for (let index = 0; index < count; index += 1) result = roundMoney(result * multiplier);
  return result;
}

export function checkCollarTriggers(
  player: RuntimePlayerState,
  floorIndex: number,
  rules: RulesConfig,
  random: RandomSource,
  events: SettlementEvent[],
): void {
  const floorMoney = rules.floorStartingMoney[floorIndex];
  if (floorMoney === undefined || player.money >= floorMoney * 0.25) return;

  for (const collar of player.items.filter((instance) => instance.itemId === 'guppys_collar')) {
    if (player.triggeredCollarsThisFloor.includes(collar.instanceId)) continue;
    player.triggeredCollarsThisFloor.push(collar.instanceId);
    if (random.next() < 0.5) {
      const amount = roundMoney(floorMoney * 0.25);
      player.money = roundMoney(player.money + amount);
      events.push({
        type: 'money',
        playerId: player.id,
        amount,
        itemId: 'guppys_collar',
        message: `嗝屁猫的项圈恢复 ${amount} 资金。`,
      });
    }
  }
}

export interface PreparedRoomPlayers {
  players: RuntimePlayerState[];
  events: SettlementEvent[];
}

export function preparePlayersForRoom(
  players: readonly RuntimePlayerState[],
  floorIndex: number,
  roomIndex: number,
  rules: RulesConfig,
  random: RandomSource,
): PreparedRoomPlayers {
  const floorMoney = rules.floorStartingMoney[floorIndex];
  if (floorMoney === undefined) throw new RangeError(`Unknown floor index: ${floorIndex}`);
  const next = players.map(cloneRuntimePlayer);
  const events: SettlementEvent[] = [];

  for (const player of next) {
    const interestCount = countItem(player, 'interest');
    if (roomIndex === 0) {
      player.temporaryShields = countItem(player, 'holy_mantle');
      player.triggeredCollarsThisFloor = [];
      const characterStartingMoney = getCharacterFloorStartingMoney(player, floorMoney, random);
      player.money = characterStartingMoney;
      if (characterStartingMoney !== floorMoney) {
        events.push({
          type: 'money',
          playerId: player.id,
          amount: characterStartingMoney - floorMoney,
          message: `角色特性将本层初始资金调整为 ${characterStartingMoney}。`,
        });
      }
      player.money = applyPercentRepeated(player.money, 1.1, interestCount);
      if (player.money !== characterStartingMoney) {
        events.push({
          type: 'money',
          playerId: player.id,
          amount: player.money - characterStartingMoney,
          itemId: 'interest',
          effectItemId: 'interest',
          message: `利息提高本层初始资金 ${player.money - characterStartingMoney}。`,
        });
      }
    }

    const beforeInterest = player.money;
    player.money = applyPercentRepeated(player.money, 1.05, interestCount);
    if (player.money !== beforeInterest) {
      events.push({
        type: 'money',
        playerId: player.id,
        amount: player.money - beforeInterest,
        itemId: 'interest',
        effectItemId: 'interest',
        message: `利息增加 ${player.money - beforeInterest} 资金。`,
      });
    }
    checkCollarTriggers(player, floorIndex, rules, random, events);
  }

  const bags = next
    .flatMap((player) =>
      player.items
        .filter((instance) => instance.itemId === 'money_bag')
        .map((instance) => ({ player, acquiredOrder: instance.acquiredOrder })),
    )
    .sort((left, right) => left.acquiredOrder - right.acquiredOrder);

  for (const { player } of bags) {
    const ranked = [...next].sort(
      (left, right) => right.money - left.money || left.id.localeCompare(right.id),
    );
    const ownerIndex = ranked.findIndex((candidate) => candidate.id === player.id);
    const target = ownerIndex === 0 ? ranked[1] : ranked[ownerIndex - 1];
    if (!target) continue;
    const amount = roundMoney(target.money * 0.05);
    target.money = roundMoney(target.money - amount);
    player.money = roundMoney(player.money + amount);
    events.push({
      type: 'money',
      playerId: player.id,
      amount,
      itemId: 'money_bag',
      effectItemId: 'money_bag',
      message: `偷钱袋从 ${target.id} 窃取 ${amount} 资金。`,
    });
    checkCollarTriggers(target, floorIndex, rules, random, events);
  }

  return { players: next, events };
}
