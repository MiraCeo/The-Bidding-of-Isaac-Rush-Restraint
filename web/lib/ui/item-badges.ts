import type { ItemDefinition, ItemId } from '../game/item-types';

export type ItemBadgeTone =
  | 'neutral'
  | 'gold'
  | 'plum'
  | 'violet'
  | 'amber'
  | 'cyan'
  | 'rose'
  | 'teal'
  | 'mint'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'orange'
  | 'red'
  | 'green'
  | 'steel';

export interface ItemBadge {
  kind: 'pool' | 'rarity' | 'effect' | 'stacking';
  label: string;
  tone: ItemBadgeTone;
}

type EffectGroup =
  | 'additive'
  | 'multiplier'
  | 'scoring'
  | 'boss'
  | 'reward'
  | 'economy'
  | 'shield'
  | 'market'
  | 'double'
  | 'final'
  | 'risk'
  | 'random';

const effectGroups: Readonly<
  Record<EffectGroup, { label: string; tone: ItemBadgeTone }>
> = {
  additive: { label: '积分加算', tone: 'amber' },
  multiplier: { label: '积分倍率', tone: 'violet' },
  scoring: { label: '计分修正', tone: 'cyan' },
  boss: { label: 'BOSS增益', tone: 'rose' },
  reward: { label: '奖励效果', tone: 'teal' },
  economy: { label: '资金效果', tone: 'mint' },
  shield: { label: '屏障返款', tone: 'sky' },
  market: { label: '市场修正', tone: 'blue' },
  double: { label: '双行动', tone: 'steel' },
  final: { label: '终局倍率', tone: 'indigo' },
  risk: { label: '清零风险', tone: 'red' },
  random: { label: '随机触发', tone: 'orange' },
};

/** Presentation categories only; actual effects remain in the game engine. */
const itemEffects: Readonly<Record<ItemId, readonly EffectGroup[]>> = {
  moms_knife: ['additive'],
  sacred_heart: ['multiplier'],
  brimstone: ['scoring'],
  moms_heart: ['boss'],
  lucky_foot: ['reward'],
  transcendence: ['reward', 'random'],
  short_brimstone: ['scoring'],
  pentagram: ['multiplier'],
  guppys_collar: ['economy', 'random'],
  holy_mantle: ['shield'],
  twenty_twenty: ['market'],
  blood_of_the_martyr: ['additive'],
  steam_sale: ['economy'],
  money_bag: ['economy'],
  poor_charm: ['additive'],
  grab_bag: ['economy'],
  score_charm: ['additive'],
  interest: ['economy'],
  d6: ['multiplier', 'random'],
  wooden_cross: ['shield'],
  more_options: ['double', 'random'],
  more_options_question: ['double'],
  dark_princes_crown: ['final'],
  eternal_d6: ['multiplier', 'risk', 'random'],
  whore_of_babylon: ['multiplier', 'risk'],
  guppys_tail: ['reward', 'random'],
};

const poolBadges: Readonly<
  Record<ItemDefinition['pool'], { label: string; tone: ItemBadgeTone }>
> = {
  common: { label: '常见', tone: 'neutral' },
  boss: { label: 'BOSS', tone: 'gold' },
  curse: { label: '诅咒', tone: 'plum' },
};

export function getItemBadges(
  item: ItemDefinition,
  includeEffects = true,
): ItemBadge[] {
  const badges: ItemBadge[] = [
    { kind: 'pool', ...poolBadges[item.pool] },
    {
      kind: 'rarity',
      label: item.rarity === 'rare' ? '稀有' : '普通',
      tone: item.rarity === 'rare' ? 'violet' : 'neutral',
    },
  ];
  if (includeEffects) {
    badges.push(
      ...itemEffects[item.id].map((group) => ({
        kind: 'effect' as const,
        ...effectGroups[group],
      })),
    );
    badges.push({
      kind: 'stacking',
      label: item.effectStacks ? '效果可叠加' : '效果不叠加',
      tone: item.effectStacks ? 'green' : 'orange',
    });
  }
  return badges;
}
