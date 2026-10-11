import { getItemDefinition } from '../game/item-catalog';
import type { ItemId } from '../game/item-types';

/** v1 wire/catalog labels are frozen so cosmetic renaming cannot invalidate old saves. */
export const persistedItemNames: Readonly<Partial<Record<ItemId, string>>> = {
  moms_heart: '妈妈的心脏',
  short_brimstone: '短程硫磺火',
};
export function displayItemText(text: string): string {
  let result = text;
  for (const [id, former] of Object.entries(persistedItemNames))
    result = result.replaceAll(former, getItemDefinition(id as ItemId).name);
  return result;
}
