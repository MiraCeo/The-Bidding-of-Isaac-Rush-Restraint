import type { CharacterId } from '../../game/item-types';

/** Product catalog v1. No RNG, storage, rewards or new-game restrictions. */
export const achievementCatalogVersion = 1;
export const achievementCategories = [
  { id: 'A', name: '竞拍失败', count: 3 },
  { id: 'B', name: '竞拍与策略', count: 4 },
  { id: 'C', name: '扰乱与结算奇遇', count: 7 },
  { id: 'D', name: '资金与道具', count: 6 },
  { id: 'E', name: '角色道具与探索', count: 5 },
  { id: 'F', name: '生存淘汰', count: 5 },
] as const;
export type AchievementCategory = (typeof achievementCategories)[number]['id'];
export type AchievementId =
  | 'A01'
  | 'A02'
  | 'A03'
  | 'B01'
  | 'B02'
  | 'B03'
  | 'B04'
  | 'C01'
  | 'C02'
  | 'C03'
  | 'C04'
  | 'C05'
  | 'C06'
  | 'C07'
  | 'D01'
  | 'D02'
  | 'D03'
  | 'D04'
  | 'D05'
  | 'D06'
  | 'E01'
  | 'E02'
  | 'E03'
  | 'E04'
  | 'E05'
  | 'F01'
  | 'F02'
  | 'F03'
  | 'F04'
  | 'F05';
export interface AchievementDefinition {
  id: AchievementId;
  category: AchievementCategory;
  name: string;
  condition: string;
  target: number;
  scope: 'shared' | 'survival';
  kind: 'event' | 'cumulative' | 'same-match' | 'final';
}
function definition(
  id: AchievementId,
  name: string,
  condition: string,
  target = 1,
  kind: AchievementDefinition['kind'] = 'event',
): AchievementDefinition {
  return {
    id,
    category: id[0] as AchievementCategory,
    name,
    condition,
    target,
    kind,
    scope: id.startsWith('F') ? 'survival' : 'shared',
  };
}
export const achievementCatalog: readonly AchievementDefinition[] = [
  definition('A01', '失败乃成功之母', '累计正常竞拍失败1次。', 1, 'cumulative'),
  definition('A02', '屡败屡战', '累计正常竞拍失败10次。', 10, 'cumulative'),
  definition(
    'A03',
    '屡战屡败',
    '同一局内连续正常竞拍失败5次；观望与扰乱保持，双竞拍有任一成功则清零。',
    5,
    'same-match',
  ),
  definition('B01', '不谋而合', '首次通过合作区资格实际获得道具。'),
  definition(
    'B02',
    '财大气粗',
    '累计通过最高价资格实际获得10次奖励机会；复制不增加机会次数。',
    10,
    'cumulative',
  ),
  definition(
    'B03',
    '鱼与熊掌不可兼得',
    '更多选择使同时取得A、B资格后随机失去一件奖励。',
  ),
  definition(
    'B04',
    '坐山观虎斗',
    '观望一个至少有奖励名额因扰乱而实际轮空的房间。',
  ),
  definition('C01', '鸠占鹊巢', '真人通过扰乱占据奖励名额并使其实际轮空。'),
  definition('C02', '塞翁失马', '正常竞拍失败后通过屏障实际退回资金。'),
  definition('C03', '柳暗花明', '超凡升天将真人扰乱占据的名额转化为道具资格。'),
  definition('C04', '竹篮打水一场空', '已取得资格的奖励被嗝屁猫的尾巴消除。'),
  definition('C05', '好事成双', '嗝屁猫的尾巴将一次奖励变成两份。'),
  definition('C06', '时来运转', '六面骰真实触发房间得分翻倍，之后清零不撤销。'),
  definition(
    'C07',
    '祸不单行',
    '同一局两种清零效果各自触发，可在同房出现。',
    2,
    'same-match',
  ),
  definition('D01', '顺手牵羊', '偷钱袋实际窃取其他玩家正金额资金。'),
  definition('D02', '薅羊毛', 'Steam大促实际减少正常竞拍扣款。'),
  definition(
    'D03',
    '钱生钱',
    '累计通过利息实际获得1000资金。',
    1000,
    'cumulative',
  ),
  definition('D04', '穷则思变', '穷人护符按现行低资金条件实际产生强化加算。'),
  definition('D05', '意外之喜', '幸运脚新增必要资格，且实际取得奖励。'),
  definition(
    'D06',
    '孤注一掷',
    '正常竞拍名义报价等于行动前全部正金额可用资金。',
  ),
  definition(
    'E01',
    '非将军之过',
    '永恒六面骰清零，且正式四位精度未清零应得分大于0。',
  ),
  definition(
    'E02',
    '我全都要',
    '房间实际获得更多选择或更多选择?，不计初始装备。',
  ),
  definition('E03', '厚积薄发', '实际获得BOSS房奖励。'),
  definition('E04', '硫磺火？', '房间实际获得硫磺火，不计初始装备。'),
  definition(
    'E05',
    '神秘礼物',
    '累计实际取得3件宝箱房原隐藏问号奖励，复制按件数计。',
    3,
    'cumulative',
  ),
  definition('F01', '马失前蹄', '真人首次在生存第一层有效淘汰结算被淘汰。'),
  definition(
    'F02',
    '逃出生天',
    '局内最高AI难度，真人在整场正式终局存活，不要求第一名。',
    1,
    'final',
  ),
  definition(
    'F03',
    '吊车尾',
    '真人属于当层存活者最低survivalScore档，并列均满足。',
  ),
  definition(
    'F04',
    '过关斩将',
    '同局正式前三层均作为真人通过合格的新淘汰结算。',
    3,
    'same-match',
  ),
  definition(
    'F05',
    '功亏一篑',
    '真人合格的新淘汰事件属于整场最后一次淘汰，由终局确认。',
    1,
    'final',
  ),
];

export const characterAchievementRequirements: Readonly<
  Record<CharacterId, readonly AchievementId[]>
> = {
  isaac: [],
  lost: ['E01', 'A02'],
  azazel: ['E03', 'E04'],
  eden: ['E05'],
  jacob_esau: ['E02'],
};
/** Pure capability projection. Manual authorization never creates achievements. */
export function availableAchievementCharacters(
  achieved: ReadonlySet<AchievementId>,
  manualUnlockAll = false,
): CharacterId[] {
  return (
    Object.keys(characterAchievementRequirements) as CharacterId[]
  ).filter(
    (id) =>
      manualUnlockAll ||
      characterAchievementRequirements[id].every((key) => achieved.has(key)),
  );
}
