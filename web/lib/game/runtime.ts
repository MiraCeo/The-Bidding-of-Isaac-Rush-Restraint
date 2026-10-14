import type { ItemId, ItemInstance, RuntimePlayerState } from './item-types';
import type { PlayerState } from './types';

export function createRuntimePlayer(player: PlayerState): RuntimePlayerState {
  return {
    ...player,
    characterId: null,
    characterFloorStartingMoney: null,
    items: [],
    temporaryShields: 0,
    persistentShields: 0,
    triggeredCollarsThisFloor: [],
  };
}

/** Shared acquisition state for starting items and room rewards; contextual effects stay with the caller. */
export function grantItemInstance(player: RuntimePlayerState, instance: ItemInstance): void {
  player.items.push(instance);
  if (instance.itemId === 'holy_mantle') player.temporaryShields += 1;
  if (instance.itemId === 'wooden_cross') player.persistentShields += 1;
}

export function countItem(player: RuntimePlayerState, itemId: ItemId): number {
  return player.items.reduce((count, instance) => count + Number(instance.itemId === itemId), 0);
}

export function hasItem(player: RuntimePlayerState, itemId: ItemId): boolean {
  return countItem(player, itemId) > 0;
}

export function cloneRuntimePlayer(player: RuntimePlayerState): RuntimePlayerState {
  return {
    ...player,
    items: player.items.map((instance) => ({ ...instance })),
    triggeredCollarsThisFloor: [...player.triggeredCollarsThisFloor],
  };
}
