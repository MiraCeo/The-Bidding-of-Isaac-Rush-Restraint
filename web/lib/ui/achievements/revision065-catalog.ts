import {
  revision058Catalog,
  revision058Series,
  revision058Metadata,
  revision058Categories,
  type Revision058Id,
  type Revision058Definition,
} from './revision058-catalog';
export type Revision065Id =
  | Revision058Id
  | 'C16'
  | 'C17'
  | 'C18'
  | 'C19'
  | 'E21'
  | 'E22'
  | 'E23'
  | 'E24'
  | 'E25'
  | 'E26';
export type Revision065Definition = Omit<Revision058Definition, 'id'> & {
  id: Revision065Id;
};
export const revision065NewSeries: readonly {
  id: string;
  name: string;
  anchor: Revision065Id;
  ids: readonly [Revision065Id, Revision065Id, Revision065Id];
  targets: readonly [number, number, number];
  metric:
    | 'tailDestroyed'
    | 'tailDuplicated'
    | 'eternalCleared'
    | 'optionsAwarded'
    | 'bossAwarded';
}[] = [
  {
    id: 'S-TAIL-DESTROYED',
    name: '竹篮打水一场空',
    anchor: 'C04',
    ids: ['C04', 'C16', 'C17'],
    targets: [1, 5, 10],
    metric: 'tailDestroyed',
  },
  {
    id: 'S-TAIL-DUPLICATED',
    name: '好事成双',
    anchor: 'C05',
    ids: ['C05', 'C18', 'C19'],
    targets: [1, 5, 10],
    metric: 'tailDuplicated',
  },
  {
    id: 'S-ETERNAL-CLEARS',
    name: '非将军之过',
    anchor: 'E01',
    ids: ['E01', 'E21', 'E22'],
    targets: [1, 5, 20],
    metric: 'eternalCleared',
  },
  {
    id: 'S-OPTIONS-AWARDS',
    name: '我全都要',
    anchor: 'E02',
    ids: ['E02', 'E23', 'E24'],
    targets: [1, 5, 10],
    metric: 'optionsAwarded',
  },
  {
    id: 'S-BOSS-AWARDS',
    name: '厚积薄发',
    anchor: 'E03',
    ids: ['E03', 'E25', 'E26'],
    targets: [1, 5, 15],
    metric: 'bossAwarded',
  },
];
const stages = revision065NewSeries.flatMap((s) =>
  s.ids.map(
    (id, i): Revision065Definition => ({
      ...revision058Catalog.find((a) => a.id === s.anchor)!,
      id,
      name: `${s.name} ${['I', 'II', 'III'][i]}`,
      target: s.targets[i]!,
      kind: 'cumulative',
    }),
  ),
);
export const revision065Catalog: readonly Revision065Definition[] = [
  ...revision058Catalog.map((a) => stages.find((s) => s.id === a.id) ?? a),
  ...stages.filter((s) => !revision058Catalog.some((a) => a.id === s.id)),
];
export const revision065Series: readonly {
  id: string;
  name: string;
  anchor: Revision065Id;
  ids: readonly Revision065Id[];
}[] = [...revision058Series, ...revision065NewSeries];
export const revision065Categories = revision058Categories.map((c) => ({
  ...c,
  count: revision065Catalog.filter((a) => a.category === c.id).length,
}));
export const revision065Metadata = new Map<
  Revision065Id,
  { tier: 'bronze' | 'silver' | 'gold'; hidden: boolean }
>(revision058Metadata);
for (const s of revision065NewSeries)
  s.ids.forEach((id, i) =>
    revision065Metadata.set(id, {
      tier: (['bronze', 'silver', 'gold'] as const)[i]!,
      hidden: false,
    }),
  );
