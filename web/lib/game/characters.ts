import { itemCatalog } from './item-catalog';
import type { CharacterId, ItemId, RuntimePlayerState } from './item-types';
import { roundMoney } from './money';
import { cloneRuntimePlayer } from './runtime';
import type { RandomSource } from './types';

export interface CharacterDefinition {
  id: CharacterId;
  name: string;
  fixedStartingItems: readonly ItemId[];
  randomStartingItemCount: number;
}

export const characterCatalog: readonly CharacterDefinition[] = [
  { id: 'isaac', name: '以撒', fixedStartingItems: ['d6'], randomStartingItemCount: 0 },
  { id: 'lost', name: '游魂', fixedStartingItems: ['holy_mantle', 'eternal_d6'], randomStartingItemCount: 0 },
  { id: 'azazel', name: '阿撒泻勒', fixedStartingItems: ['brimstone'], randomStartingItemCount: 0 },
  { id: 'eden', name: '伊甸', fixedStartingItems: [], randomStartingItemCount: 2 },
  {
    id: 'jacob_esau',
    name: '雅阁和以扫',
    fixedStartingItems: ['more_options', 'more_options_question'],
    randomStartingItemCount: 0,
  },
] as const;

export const characterOrder = characterCatalog.map((character) => character.id);
export const characterNames = Object.fromEntries(
  characterCatalog.map((character) => [character.id, character.name]),
) as Readonly<Record<CharacterId, string>>;

const edenItemPool = itemCatalog.filter((item) => item.id !== 'grab_bag');

export function chooseRandomCharacter(random: RandomSource): CharacterId {
  return characterOrder[Math.min(characterOrder.length - 1, Math.floor(random.next() * characterOrder.length))]!;
}

export function getDoubleActionScoreMultiplier(player: RuntimePlayerState): number {
  return player.characterId === 'jacob_esau' ? 1 : 0.75;
}

export function getCharacterFloorStartingMoney(
  player: RuntimePlayerState,
  baseStartingMoney: number,
  random: RandomSource,
): number {
  if (player.characterId === 'isaac') return roundMoney(baseStartingMoney * 1.1);
  if (player.characterId === 'jacob_esau') return roundMoney(baseStartingMoney * 1.2);
  if (player.characterId === 'eden') {
    return roundMoney(baseStartingMoney * (0.9 + random.next() * 0.2));
  }
  return roundMoney(baseStartingMoney);
}

export function getCharacterStartingItems(characterId: CharacterId, random: RandomSource): ItemId[] {
  const definition = characterCatalog.find((character) => character.id === characterId);
  if (!definition) throw new RangeError(`Unknown character: ${characterId}`);
  if (definition.randomStartingItemCount === 0) return [...definition.fixedStartingItems];
  if (definition.randomStartingItemCount > edenItemPool.length) {
    throw new RangeError('Eden starting item pool is too small.');
  }
  const remainingPool = [...edenItemPool];
  const randomItems = Array.from({ length: definition.randomStartingItemCount }, () => {
    const index = Math.min(remainingPool.length - 1, Math.floor(random.next() * remainingPool.length));
    return remainingPool.splice(index, 1)[0]!.id;
  });
  return [...definition.fixedStartingItems, ...randomItems];
}

export function assignCharacter(
  player: RuntimePlayerState,
  characterId: CharacterId,
  random: RandomSource,
): RuntimePlayerState {
  const next = cloneRuntimePlayer(player);
  next.characterId = characterId;
  const startingItems = getCharacterStartingItems(characterId, random);
  next.items.push(...startingItems.map((itemId, index) => ({
    instanceId: `${player.id}-starting-${index + 1}`,
    itemId,
    acquiredOrder: index + 1,
  })));
  return next;
}
