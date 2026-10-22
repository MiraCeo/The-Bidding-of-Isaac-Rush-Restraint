import {
  revision057Catalog,
  revision057Categories,
  revision057Metadata,
  revision057Series,
  type Revision057Id,
  type Revision057Definition,
} from './revision057-catalog';

// Append IDs only. Global renumbering and old-data cleanup remain separate TODOs.
export const revision058NewIds = [
  'C10',
  'C11',
  'C12',
  'C13',
  'C14',
  'C15',
  'D17',
  'D18',
  'D19',
  'D20',
  'D21',
  'D22',
  'E17',
  'E18',
  'E19',
  'E20',
  'F13',
  'F14',
  'F15',
  'F16',
] as const;
export type Revision058Id = Revision057Id | (typeof revision058NewIds)[number];
export type Revision058Definition = Omit<Revision057Definition, 'id'> & {
  id: Revision058Id;
};
export const revision058NewSeries: readonly {
  id: string;
  name: string;
  anchor: Revision058Id;
  ids: readonly [Revision058Id, Revision058Id, Revision058Id];
  targets: readonly [number, number, number];
  unit: 'action' | 'group' | 'room' | 'money' | 'copy' | 'floor' | 'prefix';
  condition: (n: number) => string;
}[] = [
  {
    id: 'S-PERSONAL-VACANCIES',
    name: '鸠占鹊巢',
    anchor: 'C01',
    ids: ['C01', 'C10', 'C11'],
    targets: [1, 10, 20],
    unit: 'group',
    condition: (n) =>
      `累计${n}份真人扰乱行动使本组奖励名额实际轮空；同组双路径只计一次，A、B分别计，超凡升天赎回不算。`,
  },
  {
    id: 'S-SHIELD-REFUNDS',
    name: '塞翁失马',
    anchor: 'C02',
    ids: ['C02', 'C12', 'C13'],
    targets: [1, 10, 20],
    unit: 'action',
    condition: (n) =>
      `累计${n}份正常竞拍失败行动通过屏障实际退回正金额资金；同一行动多条退款事件只计一次，退款不撤销失败。`,
  },
  {
    id: 'S-D6-DOUBLES',
    name: '时来运转',
    anchor: 'C06',
    ids: ['C06', 'C14', 'C15'],
    targets: [6, 18, 66],
    unit: 'room',
    condition: (n) =>
      `累计${n}个房间由六面骰真实触发积分翻倍，每房最多一次；之后清零不撤销，不按最终积分倒推。`,
  },
  {
    id: 'S-POOR-CHARM',
    name: '穷则思变',
    anchor: 'D04',
    ids: ['D04', 'D17', 'D18'],
    targets: [1, 10, 30],
    unit: 'room',
    condition: (n) =>
      `累计${n}个房间满足现行低资金条件并实际取得穷人护符强化加算；每房最多一次，不按护符数量重复累计。`,
  },
  {
    id: 'S-LUCKY-AWARDS',
    name: '意外之喜',
    anchor: 'D05',
    ids: ['D05', 'D19', 'D20'],
    targets: [1, 5, 10],
    unit: 'group',
    condition: (n) =>
      `累计${n}组因幸运脚新增必要资格并实际取得道具；原本已有其他资格不计，A、B分别计，复制不增加次数。`,
  },
  {
    id: 'S-SALE-SAVINGS',
    name: '精打细算',
    anchor: 'D10',
    ids: ['D10', 'D21', 'D22'],
    targets: [100, 1000, 5000],
    unit: 'money',
    condition: (n) =>
      `累计因Steam大促实际少扣款${n}资金，只计真实节省金额，不计屏障退款，不从旧打折布尔补金额。`,
  },
  {
    id: 'S-HIDDEN-GIFTS',
    name: '神秘礼物',
    anchor: 'E05',
    ids: ['E05', 'E17', 'E18'],
    targets: [3, 10, 30],
    unit: 'copy',
    condition: (n) =>
      `累计实际取得${n}件宝箱房原隐藏问号奖励；尾巴复制按实际件数计，不计初始装备，伊甸只需第一级3件。`,
  },
  {
    id: 'S-ASYMMETRIC-BIDS',
    name: '左右开弓',
    anchor: 'E15',
    ids: ['E15', 'E19', 'E20'],
    targets: [1, 5, 10],
    unit: 'room',
    condition: (n) =>
      `累计${n}个房间使用雅阁和以扫对A、B分别提交不等金额的正常竞拍，且至少一份本组道具实际交付；每房一次。`,
  },
  {
    id: 'S-LOWEST-SURVIVOR',
    name: '吊车尾',
    anchor: 'F03',
    ids: ['F03', 'F13', 'F14'],
    targets: [1, 5, 10],
    unit: 'floor',
    condition: (n) =>
      `累计${n}次以当层存活者最低的层结算成绩通过淘汰；同局各层分别计，并列最低计入，不使用跨层累计分。`,
  },
  {
    id: 'S-FIRST-FLOORS',
    name: '过关斩将',
    anchor: 'F04',
    ids: ['F15', 'F04', 'F16'],
    targets: [1, 3, 5],
    unit: 'prefix',
    condition: (n) =>
      `同局从第一层起连续通过前${n}层正式淘汰结算；不跨局、不从中间层拼接，提前终局不虚算未发生层数。`,
  },
];
const stages: Revision058Definition[] = revision058NewSeries.flatMap((s) =>
  s.ids.map((id, i) => ({
    id,
    category: id[0] as Revision058Definition['category'],
    name: `${s.name} ${['I', 'II', 'III'][i]}`,
    target: s.targets[i]!,
    kind: s.unit === 'prefix' ? 'same-match' : 'cumulative',
    scope: id[0] === 'F' ? 'survival' : 'shared',
    condition: s.condition(s.targets[i]!),
  })),
);
const overrides = new Map(stages.map((a) => [a.id, a]));
export const revision058Catalog: readonly Revision058Definition[] = [
  ...revision057Catalog.map(
    (a) =>
      overrides.get(a.id) ??
      (a.id === 'C08'
        ? {
            ...a,
            target: 2,
            kind: 'same-match' as const,
            condition:
              '同一局在两个不同房间，分别通过超凡升天转化自己的扰乱资格，且实际取得本组道具；必须同一父分支，同房A、B不代替两个房间。',
          }
        : a),
  ),
  ...stages.filter((a) => !revision057Catalog.some((old) => old.id === a.id)),
];
export const revision058Series: readonly {
  id: string;
  name: string;
  anchor: Revision058Id;
  ids: readonly Revision058Id[];
}[] = [
  ...revision057Series,
  ...revision058NewSeries.map(({ id, name, anchor, ids }) => ({
    id,
    name,
    anchor,
    ids,
  })),
];
export const revision058Categories = revision057Categories.map((c) => ({
  ...c,
  count: revision058Catalog.filter((a) => a.category === c.id).length,
}));
export const revision058Metadata = new Map<
  Revision058Id,
  { tier: 'bronze' | 'silver' | 'gold'; hidden: boolean }
>(revision057Metadata);
for (const s of revision058NewSeries)
  s.ids.forEach((id, i) =>
    revision058Metadata.set(id, {
      tier: (['bronze', 'silver', 'gold'] as const)[i]!,
      hidden: false,
    }),
  );
revision058Metadata.set('C08', { tier: 'gold', hidden: true });
revision058Metadata.set('D12', { tier: 'bronze', hidden: false });
revision058Metadata.set('E08', { tier: 'silver', hidden: false });
revision058Metadata.set('E11', { tier: 'silver', hidden: true });
revision058Metadata.set('F05', { tier: 'silver', hidden: true });
