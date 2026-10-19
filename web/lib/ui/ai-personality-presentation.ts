import type { AiDoctrine } from '../game/ai-decision';
import {
  personalityQuoteNoiseRatio,
  type AiPersonality,
} from '../game/ai-personality';

/** Read-only explanations of ai-personality.ts; never imported by the engine. */
export const aiPersonalityPresentation: Readonly<
  Record<AiPersonality, { summary: string; detail: string }>
> = {
  stable: {
    summary: '更偏向正常竞拍，减少两类扰乱。',
    detail:
      '略提高高价竞争与合作的权重，同时压低最高价扰乱和合作区扰乱；不等于固定合作。',
  },
  disruptive: {
    summary: '更偏向扰乱，较少正常竞拍或静观。',
    detail:
      '提高两类扰乱的相对权重，并降低高价竞争、合作和静观的权重；实际行动仍受流派允许范围约束。',
  },
  cautious: {
    summary: '更愿意保留资金、选择静观。',
    detail:
      '降低高价竞争、合作与两类扰乱的权重，提高静观权重；谨慎不代表绝不参与。',
  },
  aggressive: {
    summary: '更积极参与，尤其偏向高价竞争。',
    detail:
      '提高高价竞争、合作和少量扰乱权重，降低静观权重；不会因此获得额外资金。',
  },
  follower: {
    summary: '顺应最近已结算市场的行动风向。',
    detail:
      '近期扰乱比例高时更偏扰乱，否则更偏正常竞拍；市场参与率较高时减少静观，参与率低时增加静观。参考的是公开历史，不是本房秘密报价。',
  },
  rebellious: {
    summary: '倾向与最近已结算市场的风向相反。',
    detail:
      '近期扰乱较多时更偏正常竞拍，否则提高扰乱倾向；参与率高时更愿静观，参与率低时更愿入场。',
  },
  common_good: {
    summary: '偏向合作，并瞄准合作区中心。',
    detail:
      '提高合作、降低两类扰乱与静观的相对权重；合作报价定位倾向合作区中心，不保证一定获奖或与其他人协调。',
  },
  generous: {
    summary: '偏向合作，合作报价位置更靠下。',
    detail:
      '提高合作、减少高价竞争与扰乱；合作报价在合作区内倾向较低位置。该人格不会直接给其他玩家转移资金或道具。',
  },
  steady: {
    summary: '随评估的奖励价值调整参与力度。',
    detail:
      '目标评估价值较高时提高高价竞争与合作倾向、减少静观；价值低时更收敛。与主要减少扰乱的“稳定”不是同一词条。',
  },
  retreating: {
    summary: '奖励评估价值越高，越倾向退让。',
    detail:
      '随评估价值上升降低高价竞争与合作权重，并提高静观权重。这里使用奖励价值评估，并非读取对手尚未公开的报价。',
  },
  impulsive: {
    summary: '遇到高价值奖励时更积极争取。',
    detail:
      '目标评估价值越高，高价竞争倾向提升越明显，同时减少静观；不意味着每次都报最高价。',
  },
  speculative: {
    summary: '让行动权重更靠近所属流派的底盘。',
    detail:
      '将分析修正后的权重向流派基础权重拉回，减弱当前局势等修正的偏移；不是专指低价捡漏，也不会开启流派禁止的行动。',
  },
  conservative: {
    summary: '倾向继续使用上一次的行动策略。',
    detail:
      '有上一房行动记录时，提高同类策略权重，包括上次选择静观的情况；没有历史策略时不产生这一重复偏好。',
  },
  vain: {
    summary: '更偏爱公开可见的积分类道具。',
    detail:
      '提高含积分类奖励目标的偏好，并增加参与争取的倾向；只分析已公开的奖励，不提前知道隐藏道具。',
  },
  greedy: {
    summary: '更偏爱公开可见的经济类道具。',
    detail:
      '提高含经济类奖励目标的偏好，并增加参与争取的倾向；这是道具类型偏好，不是单纯把每次报价提高。',
  },
  adaptive: {
    summary: '更重视局势分析，并随排名压力调整。',
    detail:
      '增强局势分析与少量道具分析的影响；排名压力较高时更偏合作和合作区扰乱，整体较少静观。',
  },
  rational: {
    summary: '资金紧张或竞拍失败较多时更收敛。',
    detail:
      '增强局势分析影响；资金紧张时降低高价竞争与最高价扰乱，增加合作、合作区扰乱和少量静观。竞拍失败比例较高时进一步降低高价竞争倾向。',
  },
  arrogant: {
    summary: '较少听从局势和道具分析的调整。',
    detail:
      '降低局势分析和道具分析对行动权重的影响，更依赖原有流派与其他偏好；不等于必定高价竞争。',
  },
  all_in: {
    summary: '兼容词条：第一层参与时倾向合法最高报价。',
    detail:
      '当前新局随机池不生成此人格。兼容记录中，第一层奖励价值低时更偏静观，价值较高时更偏参与；参与报价可被推至合法上限，仍不能越过资金与行动限制。',
  },
  stubborn: {
    summary: '弱化局势变化与人格修正，更贴近原流派。',
    detail:
      '压平人格修正强度，降低局势／道具分析影响，并再次将最终策略权重拉向流派底盘；不是简单重复上一次行动，那属于“守旧”。',
  },
  gambler: {
    summary: '报价扰动更大，也会压平其他人格修正。',
    detail: `报价扰动比例为${Math.round(personalityQuoteNoiseRatio(['gambler']) * 100)}%，通常人格为${Math.round(personalityQuoteNoiseRatio([]) * 100)}%；同时减弱人格修正的极端程度。扰动不是固定失误率，也不保证更高收益。`,
  },
};

export const aiDoctrinePresentation: Readonly<
  Record<AiDoctrine, { name: string; summary: string }>
> = {
  balanced: {
    name: '均衡主义',
    summary: '保留五类行动，以合作为主要基础倾向，也会竞争、扰乱或静观。',
  },
  cooperative: {
    name: '合作主义',
    summary:
      '偏向合作，不使用最高价扰乱；仍可能使用合作区扰乱，并非完全不扰乱。',
  },
  chaotic: {
    name: '混乱主义',
    summary: '两类扰乱的基础占比更高，仍保留正常竞拍与静观，并非每房必定扰乱。',
  },
};
