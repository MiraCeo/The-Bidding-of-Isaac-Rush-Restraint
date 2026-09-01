import { getItemSubpool, itemCatalog } from './item-catalog';
import type {
  GeneratedRoom,
  ItemDefinition,
  ItemPool,
  ItemRarity,
  RoomKind,
  RoomReward,
} from './item-types';
import type { RandomSource, RewardGroup } from './types';

interface WeightedValue<T> {
  value: T;
  weight: number;
}

interface RoomDistribution {
  pools: readonly WeightedValue<ItemPool>[];
  rarities: readonly WeightedValue<ItemRarity>[];
}

export const roomDistributions: Readonly<Record<RoomKind, RoomDistribution>> = {
  normal: {
    pools: [
      { value: 'common', weight: 0.9 },
      { value: 'curse', weight: 0.1 },
    ],
    rarities: [
      { value: 'normal', weight: 0.8 },
      { value: 'rare', weight: 0.2 },
    ],
  },
  treasure: {
    pools: [
      { value: 'common', weight: 0.9 },
      { value: 'curse', weight: 0.1 },
    ],
    rarities: [
      { value: 'normal', weight: 0.4 },
      { value: 'rare', weight: 0.6 },
    ],
  },
  shop: {
    pools: [
      { value: 'common', weight: 0.6 },
      { value: 'boss', weight: 0.3 },
      { value: 'curse', weight: 0.1 },
    ],
    rarities: [
      { value: 'normal', weight: 0.6 },
      { value: 'rare', weight: 0.4 },
    ],
  },
  hidden: {
    pools: [
      { value: 'common', weight: 0.3 },
      { value: 'boss', weight: 0.5 },
      { value: 'curse', weight: 0.2 },
    ],
    rarities: [{ value: 'rare', weight: 1 }],
  },
  boss: {
    pools: [
      { value: 'boss', weight: 0.9 },
      { value: 'curse', weight: 0.1 },
    ],
    rarities: [
      { value: 'normal', weight: 0.5 },
      { value: 'rare', weight: 0.5 },
    ],
  },
};

function weightedPick<T>(values: readonly WeightedValue<T>[], random: RandomSource): T {
  const total = values.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = random.next() * total;
  for (const entry of values) {
    cursor -= entry.weight;
    if (cursor < 0) return entry.value;
  }
  return values[values.length - 1]!.value;
}

function pickDefinition(
  kind: RoomKind,
  excludedId: string | undefined,
  random: RandomSource,
  catalog: readonly ItemDefinition[],
): ItemDefinition {
  const distribution = roomDistributions[kind];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const pool = weightedPick(distribution.pools, random);
    const rarity = weightedPick(distribution.rarities, random);
    const canonicalIds = new Set(getItemSubpool(pool, rarity).map((definition) => definition.id));
    const candidates = catalog.filter(
      (definition) =>
        canonicalIds.has(definition.id) &&
        definition.pool === pool &&
        definition.rarity === rarity &&
        definition.id !== excludedId,
    );
    if (candidates.length > 0) {
      return candidates[Math.min(candidates.length - 1, Math.floor(random.next() * candidates.length))]!;
    }
  }
  throw new RangeError(`Unable to draw two distinct rewards for ${kind} room.`);
}

function baseRoomKind(roomIndex: number): RoomKind {
  const kinds: readonly RoomKind[] = ['normal', 'treasure', 'normal', 'shop', 'boss'];
  const kind = kinds[roomIndex];
  if (!kind) throw new RangeError(`Unknown room index: ${roomIndex}`);
  return kind;
}

export function generateRoom(
  floorIndex: number,
  roomIndex: number,
  random: RandomSource,
  catalog: readonly ItemDefinition[] = itemCatalog,
): GeneratedRoom {
  let kind = baseRoomKind(roomIndex);
  if (kind === 'normal' && random.next() < 0.25) kind = 'hidden';

  if (floorIndex === 2 && roomIndex === 4) {
    return {
      floorIndex,
      roomIndex,
      kind: 'boss',
      rewards: [
        { group: 'A', itemId: 'moms_heart', hidden: false },
        { group: 'B', itemId: 'moms_heart', hidden: false },
      ],
    };
  }

  const first = pickDefinition(kind, undefined, random, catalog);
  const second = pickDefinition(kind, first.id, random, catalog);
  const reward = (group: RewardGroup, definition: ItemDefinition): RoomReward => ({
    group,
    itemId: definition.id,
    hidden: kind === 'treasure' && group === 'B',
  });

  return {
    floorIndex,
    roomIndex,
    kind,
    rewards: [reward('A', first), reward('B', second)],
  };
}

export function generateFloor(
  floorIndex: number,
  random: RandomSource,
  catalog: readonly ItemDefinition[] = itemCatalog,
): GeneratedRoom[] {
  return Array.from({ length: 5 }, (_, roomIndex) =>
    generateRoom(floorIndex, roomIndex, random, catalog),
  );
}
