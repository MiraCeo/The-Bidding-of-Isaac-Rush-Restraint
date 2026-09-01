import type { ItemDefinition, ItemId, ItemPool, ItemRarity } from './item-types';

function item(
  id: ItemId,
  name: string,
  pool: ItemPool,
  rarity: ItemRarity,
  effectStacks = true,
): ItemDefinition {
  return { id, name, pool, rarity, effectStacks };
}

export const itemCatalog: readonly ItemDefinition[] = [
  item('moms_knife', '妈刀', 'boss', 'rare'),
  item('sacred_heart', '圣心', 'boss', 'rare'),
  item('brimstone', '硫磺火', 'boss', 'rare'),
  item('moms_heart', '妈妈的心脏', 'boss', 'rare'),
  item('lucky_foot', '幸运脚', 'boss', 'rare'),
  item('transcendence', '超凡升天', 'boss', 'normal', false),
  item('short_brimstone', '短程硫磺火', 'boss', 'normal'),
  item('pentagram', '五芒星', 'boss', 'normal'),
  item('guppys_collar', '嗝屁猫的项圈', 'boss', 'normal'),
  item('holy_mantle', '神圣屏障', 'boss', 'rare'),
  item('twenty_twenty', '完美视力', 'common', 'rare'),
  item('blood_of_the_martyr', '殉道者之血', 'common', 'rare'),
  item('steam_sale', 'Steam大促', 'common', 'rare'),
  item('money_bag', '偷钱袋', 'common', 'rare'),
  item('poor_charm', '穷人护符', 'common', 'rare'),
  item('grab_bag', '福袋', 'common', 'normal'),
  item('score_charm', '积分护符', 'common', 'normal'),
  item('interest', '利息', 'common', 'normal'),
  item('d6', '六面骰', 'common', 'normal'),
  item('wooden_cross', '木质十字架', 'common', 'normal'),
  item('more_options', '更多选择', 'curse', 'rare', false),
  item('more_options_question', '更多选择?', 'curse', 'rare', false),
  item('dark_princes_crown', '黑王子之冠', 'curse', 'rare'),
  item('eternal_d6', '永恒六面骰', 'curse', 'normal'),
  item('whore_of_babylon', '巴比伦大淫妇', 'curse', 'normal'),
  item('guppys_tail', '嗝屁猫的尾巴', 'curse', 'normal', false),
] as const;

const itemById = new Map(itemCatalog.map((definition) => [definition.id, definition]));

export function getItemDefinition(itemId: ItemId): ItemDefinition {
  const definition = itemById.get(itemId);
  if (!definition) throw new RangeError(`Unknown item: ${itemId}`);
  return definition;
}

export function getItemSubpool(pool: ItemPool, rarity: ItemRarity): readonly ItemDefinition[] {
  return itemCatalog.filter((definition) => definition.pool === pool && definition.rarity === rarity);
}
