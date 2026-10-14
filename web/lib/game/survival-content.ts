import { itemCatalog } from './item-catalog';
import type { ItemId } from './item-types';

/** Mode-scoped exclusion, including human/AI Eden starts. Classic content is untouched. */
export const survivalExcludedItems: readonly ItemId[] = Object.freeze([
  'dark_princes_crown',
]);
export const survivalItemCatalog = Object.freeze(
  itemCatalog
    .filter((item) => !survivalExcludedItems.includes(item.id))
    .map((item) => Object.freeze({ ...item })),
);
