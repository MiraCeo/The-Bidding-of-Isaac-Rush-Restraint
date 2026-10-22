import {
  achievementCatalog,
  achievementCategories,
  characterAchievementRequirements,
  type AchievementDefinition,
  type AchievementId,
} from './v056-catalog';
import { achievementCollectionMetadata } from './v056-collection-metadata';
import { achievementSeries } from './v056-series';

/** Approved 0.5.7 configuration.
 * Versioned receipts and migration retain the prior published semantics.
 * Retired IDs remain historical records; their changed meanings get new IDs. */
export const revision057NewIds = [
  'A06',
  'A07',
  'A08',
  'A09',
  'A10',
  'A11',
  'A12',
  'A13',
  'A14',
  'A15',
  'B12',
  'B13',
  'B14',
  'B15',
  'B16',
  'B17',
  'B18',
  'B19',
  'B20',
  'B21',
  'B22',
  'B23',
  'B24',
  'B25',
  'D13',
  'D14',
  'D15',
  'D16',
  'E16',
] as const;
export type Revision057Id = AchievementId | (typeof revision057NewIds)[number];
export type Revision057Definition = Omit<AchievementDefinition, 'id'> & {
  id: Revision057Id;
};
export const revision057RetiredIds = ['A02', 'A04'] as const;
export const revision057NewSeries: readonly {
  id: string;
  name: string;
  anchor: Revision057Id;
  ids: readonly [Revision057Id, Revision057Id, Revision057Id];
  targets: readonly [number, number, number];
  kind: AchievementDefinition['kind'];
  unit: 'action' | 'group' | 'room' | 'match' | 'streak' | 'money';
  condition: (target: number) => string;
}[] = [
  {
    id: 'S-FAILED-BIDS',
    name: '失败乃成功之母',
    anchor: 'A01',
    ids: ['A01', 'A08', 'A09'],
    targets: [1, 20, 100],
    kind: 'cumulative',
    unit: 'action',
    condition: (n) =>
      `累计正常竞拍失败${n}次；双竞拍分别判断，屏障退款仍计入失败，观望与扰乱不计。`,
  },
  {
    id: 'S-LOSING-MATCHES',
    name: '屡败屡战',
    anchor: 'A10',
    ids: ['A10', 'A11', 'A12'],
    targets: [5, 10, 20],
    kind: 'cumulative',
    unit: 'match',
    condition: (n) =>
      `累计${n}局正式经典或生存终局排名第6及以后；同一正式对局身份只计一次，不以中途淘汰或竞拍失败代替。`,
  },
  {
    id: 'S-FAILED-STREAK',
    name: '屡战屡败',
    anchor: 'A03',
    ids: ['A06', 'A03', 'A07'],
    targets: [3, 5, 10],
    kind: 'same-match',
    unit: 'streak',
    condition: (n) =>
      `同一局连续正常竞拍失败${n}次；观望与扰乱保持，双竞拍任一成功则整房清零，双败加2。`,
  },
  {
    id: 'S-RECOVERY-MATCHES',
    name: '重整旗鼓',
    anchor: 'A13',
    ids: ['A13', 'A14', 'A15'],
    targets: [5, 10, 20],
    kind: 'cumulative',
    unit: 'match',
    condition: (n) =>
      `累计${n}场独立正式对局中，正常竞拍失败后在后续其他房间正常竞拍实际获奖；每局最多计1次，满足房间条件时入账。`,
  },
  {
    id: 'S-COOPERATION',
    name: '不谋而合',
    anchor: 'B01',
    ids: ['B01', 'B14', 'B15'],
    targets: [1, 10, 50],
    kind: 'cumulative',
    unit: 'group',
    condition: (n) =>
      `累计${n}份通过合作区资格实际取得的奖励机会；A、B分别计数，同组双资格不重复，复制不增加次数。`,
  },
  {
    id: 'S-WATCHED-VACANCIES',
    name: '坐山观虎斗',
    anchor: 'B04',
    ids: ['B04', 'B16', 'B17'],
    targets: [1, 10, 20],
    kind: 'cumulative',
    unit: 'room',
    condition: (n) =>
      `累计观望${n}个至少有一个奖励名额因扰乱实际轮空的房间；每房最多1次，赎回不算轮空。`,
  },
  {
    id: 'S-MISSED-COOPERATION',
    name: '和而不同',
    anchor: 'B05',
    ids: ['B05', 'B18', 'B19'],
    targets: [1, 5, 20],
    kind: 'cumulative',
    unit: 'group',
    condition: (n) =>
      `累计${n}份正常竞拍进入合作区但合作排名落选、本组无其他资格且未实际获奖；A、B分别计数，先有资格后被消除不计。`,
  },
  {
    id: 'S-MISSED-HIGH',
    name: '失之交臂',
    anchor: 'B06',
    ids: ['B06', 'B20', 'B21'],
    targets: [1, 5, 10],
    kind: 'cumulative',
    unit: 'group',
    condition: (n) =>
      `累计${n}份正常竞拍恰在本组正式高价第N＋1位、无其他资格且未获奖；包含扰乱占位与原同价决胜，A、B分别计数。`,
  },
  {
    id: 'S-LAST-HIGH',
    name: '恰到好处',
    anchor: 'B09',
    ids: ['B09', 'B22', 'B23'],
    targets: [1, 5, 10],
    kind: 'cumulative',
    unit: 'group',
    condition: (n) =>
      `累计${n}份正常竞拍恰为本组正式高价第N位并通过最高价资格实际获奖；N包含扰乱，A、B分别计数，复制不增加次数。`,
  },
  {
    id: 'S-ALTERNATIVE',
    name: '另辟蹊径',
    anchor: 'B11',
    ids: ['B11', 'B24', 'B25'],
    targets: [1, 5, 10],
    kind: 'cumulative',
    unit: 'group',
    condition: (n) =>
      `累计${n}份正常竞拍无本组最高价资格、凭合作资格实际获奖且本组存在更高市场等价报价；A、B分别计数，复制不增加次数。`,
  },
  {
    id: 'S-ALL-IN-AWARDS',
    name: '背水一战',
    anchor: 'D09',
    ids: ['D09', 'D13', 'D14'],
    targets: [1, 5, 10],
    kind: 'cumulative',
    unit: 'action',
    condition: (n) =>
      `累计${n}份投入全部正金额可用资金的正常竞拍实际取得本组道具；按名义报价，打折不取消全额事实，复制不增加次数。`,
  },
  {
    id: 'S-STOLEN-MONEY',
    name: '聚沙成塔',
    anchor: 'D11',
    ids: ['D11', 'D15', 'D16'],
    targets: [100, 1000, 5000],
    kind: 'cumulative',
    unit: 'money',
    condition: (n) =>
      `累计通过偷钱袋实际取得其他玩家${n}资金；只认真实金额原因，不把初始本金或持有道具当收入。`,
  },
];

const additions: Revision057Definition[] = [
  {
    id: 'B12',
    category: 'B',
    name: '两败俱伤',
    target: 1,
    scope: 'shared',
    kind: 'event',
    condition:
      '同一道具组至少一条有实际名额的获奖路径，其全部名额均因未赎回的扰乱占位而轮空；真人在场即可，不要求亲自扰乱。',
  },
  {
    id: 'B13',
    category: 'B',
    name: '全军覆没',
    target: 1,
    scope: 'shared',
    kind: 'event',
    condition:
      '同一道具组的最高价与合作区两条路径均有实际名额，且所有名额都因未赎回的扰乱占位轮空；可同时达成两败俱伤，不拼A、B两组。',
  },
  {
    id: 'E16',
    category: 'E',
    name: '双重保障',
    target: 1,
    scope: 'shared',
    kind: 'event',
    condition:
      '使用游魂时通过房间奖励实际额外取得神圣屏障；初始装备、屏障退款、仅有资格或被消除的奖励不计。',
  },
];
const stages = revision057NewSeries.flatMap((s) =>
  s.ids.map(
    (id, index): Revision057Definition => ({
      id,
      category: id[0] as AchievementDefinition['category'],
      name: `${s.name} ${['I', 'II', 'III'][index]}`,
      target: s.targets[index]!,
      kind: s.kind,
      scope: 'shared',
      condition: s.condition(s.targets[index]!),
    }),
  ),
);
const overrides = new Map(stages.map((a) => [a.id, a]));
export const revision057Catalog: readonly Revision057Definition[] = [
  ...achievementCatalog
    .filter((a) => !(revision057RetiredIds as readonly string[]).includes(a.id))
    .map((a) => overrides.get(a.id) ?? a),
  ...stages.filter((a) => !achievementCatalog.some((old) => old.id === a.id)),
  ...additions,
];
export const revision057Metadata = new Map<
  Revision057Id,
  { tier: 'bronze' | 'silver' | 'gold'; hidden: boolean }
>(
  Object.entries(achievementCollectionMetadata).map(([id, m]) => [
    id as AchievementId,
    { ...m },
  ]),
);
for (const s of revision057NewSeries)
  s.ids.forEach((id, i) =>
    revision057Metadata.set(id, {
      tier: (['bronze', 'silver', 'gold'] as const)[i]!,
      hidden: false,
    }),
  );
for (const id of ['A05', 'B03'] as const)
  revision057Metadata.set(id, {
    ...revision057Metadata.get(id)!,
    hidden: true,
  });
revision057Metadata.set('E12', { tier: 'bronze', hidden: false });
revision057Metadata.set('B12', { tier: 'silver', hidden: true });
revision057Metadata.set('B13', { tier: 'gold', hidden: true });
// Existing role-specific composite badges use silver as the default; still user-adjustable.
revision057Metadata.set('E16', { tier: 'silver', hidden: false });
export const revision057Series: readonly {
  id: string;
  name: string;
  anchor: Revision057Id;
  ids: readonly Revision057Id[];
}[] = [
  ...achievementSeries,
  ...revision057NewSeries.map(({ id, name, anchor, ids }) => ({
    id,
    name,
    anchor,
    ids,
  })),
];
export const revision057Categories = achievementCategories.map((c) => ({
  ...c,
  count: revision057Catalog.filter((a) => a.category === c.id).length,
}));
export const revision057CharacterRequirements = {
  ...characterAchievementRequirements,
  lost: ['E01', 'A10'] as readonly Revision057Id[],
};
