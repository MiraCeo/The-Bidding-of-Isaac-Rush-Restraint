import type { ItemId, RuntimePlayerState } from './item-types';
import type { PlayerState } from './types';

export function createRuntimePlayer(player: PlayerState): RuntimePlayerState {
  return {
    ...player,
    characterId: null,
    items: [],
    temporaryShields: 0,
    persistentShields: 0,
    triggeredCollarsThisFloor: [],
  };
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
