import { defaultRules } from '../game/config';
import type { RulesConfig } from '../game/types';

export interface GameRuleSection {
  id: string;
  title: string;
  paragraphs: string[];
  formula?: { expression: string; caption: string };
  comparison?: {
    caption: string;
    rows: Array<{ label: string; purpose: string }>;
  };
}

function percent(ratio: number): string {
  return `${Number((ratio * 100).toFixed(4))}%`;
}

export function createGameRuleSections(
  rules: RulesConfig = defaultRules,
): GameRuleSection[] {
  const meanFactor =
    rules.baselineMeanMultiplier === 2 / 3
      ? '2/3'
      : String(Number(rules.baselineMeanMultiplier.toFixed(4)));
  return [
    {
      id: 'flow',
      title: '对局与提交',
      paragraphs: [
        `${rules.playerCount} 人共同市场：1 名真人与 ${rules.playerCount - 1} 名 AI；${rules.roomsPerFloor.length} 层，房间数依次为 ${rules.roomsPerFloor.join(' / ')}，共 ${rules.roomsPerFloor.reduce((sum, count) => sum + count, 0)} 房。`,
        '每房选择行动后只提交一次。提交立即锁定行动，AI 只根据公开局势与已结算历史作决策，随后统一结算；不读取你的本房秘密报价。',
        '结算后可查看积分排行、争夺榜，或直接进入下一房间。查看规则、设置和公开排行不会提交行动，也不会推进房间。',
      ],
    },
    {
      id: 'actions',
      title: '竞拍、扰乱与观望',
      paragraphs: [
        '正常竞拍：选择 A 或 B，名义报价为大于 0 的整数，不能超过当前资金。竞与合是同一竞拍行动的不同目标，不是两种独立提交方式。',
        `扰乱市场：每份扰乱报价最多为行动前资金的 ${percent(rules.disruptionMaxMoneyRatio)}，向下取整；实际扣款为报价，市场等价为 ${rules.disruptionMarketMultiplier} 倍，计分等价为 ${rules.disruptionScoringMultiplier} 倍。`,
        '静观其变：不扣款、不加入市场样本、不获得本房行动积分和竞拍奖励；房间仍会正常推进，入房效果仍按规则执行。',
      ],
    },
    {
      id: 'amounts',
      title: '四种金额不能混用',
      comparison: {
        caption: '报价与等价值的用途',
        rows: [
          { label: '名义报价', purpose: '决定行动是否合法，用于报价上限。' },
          { label: '实际扣款', purpose: '决定实际花费与对应返款的计算基础。' },
          { label: '市场等价', purpose: '参与市场均值与最高价名额排序。' },
          { label: '计分等价', purpose: '参与基础计分与合作资格判断。' },
        ],
      },
      paragraphs: [
        '名义报价决定行动合法性；实际扣款决定花费；市场等价参与均值与最高价名额；计分等价参与基础计分与合作资格。',
        'Steam大促降低实际扣款，不提高名义报价上限；完美视力提高竞拍的市场等价，不提高名义报价或直接改写计分等价。具体效果见道具说明。',
      ],
    },
    {
      id: 'market',
      title: '共同基准线与合作区',
      formula: {
        expression: `T = ${meanFactor} × M + ${percent(rules.targetConstantRatio)} × F`,
        caption: `合作区：T ± ${percent(rules.cooperationZoneRatio)} × F。M 是有效行动的市场等价均值，F 是本层公共初始资金。`,
      },
      paragraphs: [
        `A、B 共用一个市场。M 为所有有效行动的市场等价均值，基准线 T = ${meanFactor} × M + ${percent(rules.targetConstantRatio)} × F；F 为本层公共初始资金，不随角色个人资金变化。`,
        `合作区为 T ± ${percent(rules.cooperationZoneRatio)} × F，这个数是半径而非整个区间宽度。合作距离按计分等价判断，硫磺火系列的取最佳分数范围不移动合作资格。`,
        '双行动贡献两个市场样本，不按玩家去重；观望不贡献样本。全员观望时没有基准线，也没有市场奖励。',
      ],
    },
    {
      id: 'rewards',
      title: '每组奖励怎样分配',
      paragraphs: [
        `最高价名额：A、B 分组，按市场等价降序取参与人数的 ${percent(rules.highPriceWinnerRatio)}，四舍五入；非空组至少 1 个名额。扰乱也参与排序并占位。`,
        '合作名额：每组进入合作区的 k 份行动中，取 ceil(k / 2) 个最接近基准线的名额。同分或同距离按现行随机规则决胜。',
        '正常竞拍占据名额可获得道具；扰乱通常让名额轮空。最高价与合作重复资格合并为一份，不向后顺延。超凡升天、幸运脚等例外见道具说明。',
        '更多选择的双竞拍同时取得 A、B 资格时，随机摧毁其中一组道具；这不改写此前的屏障失败判定。第三层 BOSS 的两组妈妈的心脏属于固定终局奖励例外。',
      ],
    },
    {
      id: 'score',
      title: '房间积分与双行动',
      formula: {
        expression: `基础积分 = ${rules.maximumBaseScore} × exp(−|计分值 − T| / σ)`,
        caption: `σ = ${percent(rules.scoreSigmaRatio)} × F；道具与房间倍率另行计算。`,
      },
      paragraphs: [
        `基础曲线为 ${rules.maximumBaseScore} × exp(−|计分值 − T| / σ)，σ = ${percent(rules.scoreSigmaRatio)} × F；越接近基准线，基础积分越高。道具加算、乘算和清零效果另外处理，不把基础曲线峰值当作最终房分上限。`,
        `普通房 ×${rules.roomScoreMultipliers.normal}、商店 ×${rules.roomScoreMultipliers.shop}、宝箱房 ×${rules.roomScoreMultipliers.treasure}、隐藏房 ×${rules.roomScoreMultipliers.hidden}、BOSS 房 ×${rules.roomScoreMultipliers.boss}。积分内部保存 ${rules.scoreStorageDecimals} 位小数，设置仅改变显示位数。`,
        '更多选择允许 A、B 双竞拍；名义报价总和不能超过当前资金的 50%。更多选择?允许 A、B 双扰乱，每份分别受扰乱上限约束。两份必须是不同组的同类行动，不能与观望混合，实际总扣款不能超过资金。',
        '双行动通常按 75% 折算积分；雅阁和以扫不受此折算。新取得的多数计分道具从后续房间生效；本房 BOSS 新取得的妈妈的心脏每份对已结算房分追溯乘 2，不重掷其他随机效果。',
      ],
    },
    {
      id: 'effects',
      title: '容易混淆的道具效果',
      paragraphs: [
        '屏障退回失败正常竞拍的实际扣款，不退扰乱扣款。临时屏障优先消耗，每层按神圣屏障库存重置；木质十字架的持久屏障消耗后不会因换层再生。',
        '嗝屁猫的尾巴只改动其他道具的实际获得份数，不影响尾巴自身，重复尾巴不重复判定。硫磺火、短程硫磺火、幸运脚等标记为不叠加的道具，重复份数仍计入库存。',
        '福袋只在正常竞拍获得时，按对应行动实际扣款的 75% 逐份四舍五入返款；扰乱获得不返款。多份福袋独立返款，累计可以超过该笔扣款，不能直接以名义报价计算。',
      ],
    },
    {
      id: 'floors',
      title: '换层、终局与隐藏信息',
      paragraphs: [
        `本层公共初始资金依次为 ${rules.floorStartingMoney.join(' / ')}；换层重置资金，保留道具与积分，再处理角色资金特性和入房效果。`,
        '游戏中的当前积分排行展示累计积分，尚未包含黑王子之冠等终局倍率；最终排行以终局结算后的积分为准。',
        '宝箱问号道具的本房具体内容在结算前不向玩家或 AI 展示。道具图鉴页签是通用规则查询，不揭示当前隐藏奖励或未来房间。',
      ],
    },
  ];
}
