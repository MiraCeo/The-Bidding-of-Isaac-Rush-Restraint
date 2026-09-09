import type { ItemId } from './item-types';

export interface ItemPresentation {
  emoji: string;
  description: string;
}

export const itemPresentations: Readonly<Record<ItemId, ItemPresentation>> = {
  moms_knife: { emoji: '🔪', description: '追加一条以本房间最高市场等价出价四分之一为目标的计分曲线。' },
  sacred_heart: { emoji: '💖', description: '后续获得的分数提高至 150%。' },
  brimstone: { emoji: '🔥', description: '竞拍时可在报价的 80%～125% 区间取最高计分。' },
  moms_heart: { emoji: '🫀', description: '本次及后续 BOSS 房得分提高至 200%。' },
  lucky_foot: { emoji: '🦶', description: '正常竞拍进入合作区时，无论排名都获得一份道具。' },
  transcendence: { emoji: '🪽', description: '扰乱占据道具名额时，有 50% 概率赎回该道具。' },
  short_brimstone: { emoji: '🕯️', description: '扰乱时可在计分等价出价的 85%～120% 区间取最高计分。' },
  pentagram: { emoji: '⭐', description: '后续获得的分数提高至 125%。' },
  guppys_collar: { emoji: '📿', description: '每层资金首次低于 25% 时，有一半概率恢复 25% 初始资金。' },
  holy_mantle: { emoji: '🛡️', description: '每层获得一层临时屏障，可退回一次失败竞拍的实际扣款。' },
  twenty_twenty: { emoji: '👁️', description: '争夺道具时，竞拍的市场等价出价提高至 125%。' },
  blood_of_the_martyr: { emoji: '🩸', description: '每份行动获得分数时额外加 20 分。' },
  steam_sale: { emoji: '🏷️', description: '后续竞拍的实际扣款减少 30%，不提高名义报价上限。' },
  money_bag: { emoji: '💰', description: '进入房间时窃取资金榜相邻玩家 5% 的资金。' },
  poor_charm: { emoji: '🧿', description: '资金低于本层初始资金 30% 时每次加 20 分，否则加 5 分。' },
  grab_bag: { emoji: '🎁', description: '获得后返还本次实际扣款的 75%。' },
  score_charm: { emoji: '🏅', description: '每份行动获得分数时额外加 10 分。' },
  interest: { emoji: '📈', description: '每个房间资金增加 5%，下一层初始资金增加 10%。' },
  d6: { emoji: '🎲', description: '每个房间有六分之一概率使得分提高至 200%。' },
  wooden_cross: { emoji: '✝️', description: '获得一层持久屏障，可退回一次失败竞拍的实际扣款。' },
  more_options: { emoji: '↔️', description: '允许同时竞拍 A、B；双行动分数通常按 75% 结算。' },
  more_options_question: { emoji: '❔', description: '允许同时扰乱 A、B；每份扰乱分别受 50% 资金上限约束。' },
  dark_princes_crown: { emoji: '👑', description: '终局总分提高 40%，其他道具会逐件降低该加成。' },
  eternal_d6: { emoji: '🎲', description: '后续得分提高至 150%，但每房间有 25% 概率得分清零。' },
  whore_of_babylon: { emoji: '🔻', description: '后续得分提高至 125%；竞拍低于基准线时本房间得分清零。' },
  guppys_tail: { emoji: '🐈', description: '获得道具时各有三分之一概率消失、正常或获得双份。' },
};
