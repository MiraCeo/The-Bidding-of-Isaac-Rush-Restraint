import { defaultRules } from '../game/config';
import {
  survivalOfficialCutLines,
  survivalPrototypeRules as survival,
} from '../game/survival-rules';
import { createGameRuleSections, type GameRuleSection } from './game-rules';

/** Read-only survival reference; shared room rules, mode-specific progression. */
export function createSurvivalRuleSections(): GameRuleSection[] {
  const common = createGameRuleSections({
    ...defaultRules,
    scoreStorageDecimals: survival.scoreStorageDecimals,
  }).map((section): GameRuleSection => {
    if (section.id === 'flow')
      return {
        ...section,
        paragraphs: [
          `${survival.initialPlayerCount}人开局，每层${survival.roomsPerFloor}房，第${survival.roomsPerFloor}房为BOSS。每层基础资金重置为${survival.floorStartingMoney}，再应用角色与道具效果。正式斩杀线为${survivalOfficialCutLines.join('／')}。`,
          ...section.paragraphs.slice(1),
        ],
      };
    if (section.id === 'rewards')
      return {
        ...section,
        paragraphs: [
          ...section.paragraphs.slice(0, -1),
          '更多选择的双竞拍同时取得 A、B 资格时，随机摧毁其中一组道具；这不改写此前的屏障失败判定。每层BOSS使用普通奖励池，保留心脏对BOSS分数的追溯机制，不使用经典第三层双心脏规则。',
        ],
      };
    if (section.id === 'floors')
      return {
        ...section,
        title: '换层、道具池与隐藏信息',
        paragraphs: [
          `每层公共初始资金均为${survival.floorStartingMoney}；换层重置资金，保留道具，再应用角色与道具效果。`,
          '生存模式暂不提供黑王子之冠，伊甸开局也不抽取。积分存储保留4位，显示偏好不改变淘汰判定。',
          section.paragraphs[2]!,
        ],
      };
    return section;
  });
  return [
    ...common,
    {
      id: 'survival-score',
      title: '层末生存分与累计积分',
      formula: {
        expression: `S = R + ${survival.moneyExchangeRatio} × 剩余资金 + ${survival.scoreInheritanceRatio} × 上层S`,
        caption: 'R是本层房间分之和；生存分S用于本层淘汰判定，不等于累计积分。',
      },
      paragraphs: [
        '层末：S = R ＋ 0.1 × 剩余资金 ＋ 0.2 × 上层S。累计积分只加 R 与资金兑换；继承分不重复计入，也不再次乘道具倍率。',
      ],
    },
    {
      id: 'survival-elimination',
      title: '斩杀线、补淘汰与团灭',
      paragraphs: [
        `正式斩杀线按层依次为${survivalOfficialCutLines.join('／')}。`,
        `线下全部淘汰。若不足${survival.minimumEliminations}人，再从达标者末位补足；末位同分按种子抽签。剩余人数≤${survival.finalSurvivorCount}时结算；全部线下则团灭，无冠军。`,
      ],
    },
    {
      id: 'survival-ranking',
      title: '最终排名与提前淘汰冻结',
      paragraphs: [
        '总榜：存活者在前；淘汰者按淘汰层数降序，再按累计积分降序。同层同分抽签，保留事实记录。',
        '玩家提前淘汰后冻结，AI自动完成剩余比赛。最终结果使用已记录的名次，不以累计分重新覆盖存活状态或淘汰层数。',
      ],
    },
    {
      id: 'survival-difficulty',
      title: 'AI难度与信息边界',
      paragraphs: [
        '生存AI分简单、标准、困难、最高四档；默认标准。最高保留0.3.1原设置，其他档逐级减弱判断和报价精度，基本资金规划与合法性不变。开局后难度锁定，存档和回放保留本局难度。',
      ],
    },
  ];
}
