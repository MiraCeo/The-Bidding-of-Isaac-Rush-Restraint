import type { CharacterId } from '../../game/item-types';

/** Product catalog v1. No RNG, storage, rewards or new-game restrictions. */
export const achievementCatalogVersion = 1; // Legacy ledger schema1/2 identity stays fixed.
export const currentAchievementCatalogVersion = 2; // schema3 stays catalog2
export const milestoneAchievementCatalogVersion = 3;
export const achievementCharacters = [
  'isaac',
  'lost',
  'azazel',
  'eden',
  'jacob_esau',
] as const;
export const achievementCategories = [
  { id: 'A', name: '竞拍失败', count: 5 },
  { id: 'B', name: '竞拍与策略', count: 10 },
  { id: 'C', name: '扰乱与结算奇遇', count: 9 },
  { id: 'D', name: '资金与道具', count: 12 },
  { id: 'E', name: '角色道具与探索', count: 13 },
  { id: 'F', name: '生存淘汰', count: 11 },
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
  | 'B05'
  | 'B06'
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
  | 'E06'
  | 'E07'
  | 'E08'
  | 'F01'
  | 'F02'
  | 'F03'
  | 'F04'
  | 'F05'
  | 'F06'
  | 'A04'
  | 'A05'
  | 'B07'
  | 'B08'
  | 'B09'
  | 'B11'
  | 'C08'
  | 'C09'
  | 'D07'
  | 'D08'
  | 'D09'
  | 'D10'
  | 'D11'
  | 'D12'
  | 'E09'
  | 'E10'
  | 'E11'
  | 'E12'
  | 'E15'
  | 'F07'
  | 'F08'
  | 'F09'
  | 'F10'
  | 'F12';
export interface AchievementDefinition {
  id: AchievementId;
  category: AchievementCategory;
  name: string;
  condition: string;
  target: number;
  scope: 'shared' | 'classic' | 'survival';
  kind: 'event' | 'cumulative' | 'same-match' | 'final';
}
function definition(
  id: AchievementId,
  name: string,
  condition: string,
  target = 1,
  kind: AchievementDefinition['kind'] = 'event',
  scope: AchievementDefinition['scope'] = id.startsWith('F')
    ? 'survival'
    : 'shared',
): AchievementDefinition {
  return {
    id,
    category: id[0] as AchievementCategory,
    name,
    condition,
    target,
    kind,
    scope,
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
  definition(
    'B05',
    '和而不同',
    '正常竞拍进入合作区但合作排名落选，本组未取得其他奖励资格且未获得道具。',
  ),
  definition(
    'B06',
    '失之交臂',
    '正常竞拍在本组正式高价排序中恰为名额后的第1位，未取得其他奖励资格且未获得道具。',
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
    '同一局分别触发永恒六面骰和巴比伦大淫妇的清零效果，可在同房出现。',
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
  definition(
    'E06',
    '初出茅庐',
    '首次完成一局新的正式经典对局。',
    1,
    'final',
    'classic',
  ),
  definition(
    'E07',
    '独占鳌头',
    '首次取得新的经典正式最终排名第一，并列第一也计入。',
    1,
    'final',
    'classic',
  ),
  definition(
    'E08',
    '各显神通',
    '分别使用五名角色完成新的正式对局；生存以正式终局存在个人结果为准，淘汰也计入。',
    5,
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
    '以当层存活者最低的层结算成绩（survivalScore）通过淘汰，并列均满足。',
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
  definition(
    'F06',
    '冠绝全场',
    '首次成为新的生存对局正式冠军，不限制AI难度。',
    1,
    'final',
  ),
  definition(
    'A04',
    '重整旗鼓',
    '同局新发生正常竞拍失败后，在后续其他房间正常竞拍实际获得道具。',
    1,
    'same-match',
    'shared',
  ),
  definition(
    'A05',
    '败而不馁',
    '同局新发生正常竞拍失败后，取得经典正式最终第一名，并列计入。',
    1,
    'same-match',
    'classic',
  ),
  definition(
    'B07',
    '财大气粗 I',
    '累计通过最高价资格实际获得1次奖励机会，复制不增加机会次数。',
    1,
    'cumulative',
    'shared',
  ),
  definition(
    'B08',
    '财大气粗 III',
    '累计通过最高价资格实际获得50次奖励机会，复制不增加机会次数。',
    50,
    'cumulative',
    'shared',
  ),
  definition(
    'B09',
    '恰到好处',
    '正常竞拍恰为本组正式高价名额第N位，取得最高价资格且实际获奖。',
    1,
    'event',
    'shared',
  ),
  definition(
    'B11',
    '另辟蹊径',
    '正常竞拍无本组最高价资格但凭合作资格实际获奖，且本组其他参与者市场等价报价严格更高。',
    1,
    'event',
    'shared',
  ),
  definition(
    'C08',
    '反客为主',
    '真人扰乱名额由超凡升天转化资格，且本组实际交付道具。',
    1,
    'event',
    'shared',
  ),
  definition(
    'C09',
    '两处空席',
    '同房两份真人扰乱分别令A、B两组至少一个名额实际轮空，赎回不算轮空。',
    1,
    'event',
    'shared',
  ),
  definition(
    'D07',
    '钱生钱 I',
    '累计通过利息实际获得100资金。',
    100,
    'cumulative',
    'shared',
  ),
  definition(
    'D08',
    '钱生钱 III',
    '累计通过利息实际获得5000资金。',
    5000,
    'cumulative',
    'shared',
  ),
  definition(
    'D09',
    '背水一战',
    '正资金全额正常报价的同份行动实际取得本组道具。',
    1,
    'event',
    'shared',
  ),
  definition(
    'D10',
    '精打细算',
    '累计因Steam大促实际少扣款100资金，只计新增金额原因事实。',
    100,
    'cumulative',
    'shared',
  ),
  definition(
    'D11',
    '聚沙成塔',
    '累计通过偷钱袋实际取得其他玩家100资金。',
    100,
    'cumulative',
    'shared',
  ),
  definition(
    'D12',
    '细水长流',
    '同一局启用后通过真实利息累计取得200资金，不使用跨局总数。',
    200,
    'same-match',
    'shared',
  ),
  definition(
    'E09',
    '渐入佳境',
    '按独立正式对局身份累计完成5局经典模式，同根分支不多计。',
    5,
    'cumulative',
    'classic',
  ),
  definition(
    'E10',
    '久经沙场',
    '按独立正式对局身份累计完成20局经典模式，同根分支不多计。',
    20,
    'cumulative',
    'classic',
  ),
  definition(
    'E11',
    '本色出演',
    '使用以撒取得新正式经典最终第一名，并列计入。',
    1,
    'final',
    'classic',
  ),
  definition(
    'E12',
    '有惊无险',
    '使用游魂的同局新发生正金额屏障退款，随后正式完成经典模式。',
    1,
    'same-match',
    'classic',
  ),
  definition(
    'E15',
    '左右开弓',
    '雅阁和以扫同房对A、B分别提交不等金额的两份正常竞拍，且至少一份实际获奖。',
    1,
    'event',
    'shared',
  ),
  definition(
    'F07',
    '初涉险境',
    '首次形成正式生存终局的真人个人结果，被淘汰也计入。',
    1,
    'cumulative',
    'survival',
  ),
  definition(
    'F08',
    '渐入险境',
    '按独立正式对局身份累计形成5次生存终局个人结果，淘汰也计入。',
    5,
    'cumulative',
    'survival',
  ),
  definition(
    'F09',
    '久经风浪',
    '按独立正式对局身份累计形成15次生存终局个人结果，淘汰也计入。',
    15,
    'cumulative',
    'survival',
  ),
  definition(
    'F10',
    '登峰造极',
    '在同一局最高AI难度下成为新的正式生存冠军。',
    1,
    'final',
    'survival',
  ),
  definition(
    'F12',
    '险中求胜',
    '同局新以最低档存活者资格通过一层，最终成为正式生存冠军。',
    1,
    'same-match',
    'survival',
  ),
];

export const milestoneAchievementIds = [
  'A04',
  'A05',
  'B07',
  'B08',
  'B09',
  'B11',
  'C08',
  'C09',
  'D07',
  'D08',
  'D09',
  'D10',
  'D11',
  'D12',
  'E09',
  'E10',
  'E11',
  'E12',
  'E15',
  'F07',
  'F08',
  'F09',
  'F10',
  'F12',
] as const;
export const v053AchievementCatalog = achievementCatalog.filter(
  (a) => !(milestoneAchievementIds as readonly string[]).includes(a.id),
);
export const legacyAchievementCatalog = v053AchievementCatalog.filter(
  (a) => !['B05', 'B06', 'E06', 'E07', 'E08', 'F06'].includes(a.id),
);

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
