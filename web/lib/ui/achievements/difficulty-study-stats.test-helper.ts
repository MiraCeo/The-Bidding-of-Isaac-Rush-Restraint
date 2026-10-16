/** Research-only descriptive aggregates. No ledger or achievement rule writes. */
import type { AchievementId } from './catalog';
import { achievementCatalog } from './v056-catalog';
import type { StudyMatch, StudyMetrics } from './difficulty-study.test-helper';

export function studyGroups(rows: readonly StudyMatch[]) {
  const groups = new Map<string, StudyMatch[]>();
  for (const row of rows) {
    const key = `${row.policy}/${row.difficulty}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

const metricGoals: {
  id: AchievementId;
  metric: keyof StudyMetrics;
  target: number;
}[] = [
  { id: 'B07', metric: 'highest', target: 1 },
  { id: 'B02', metric: 'highest', target: 10 },
  { id: 'B08', metric: 'highest', target: 50 },
  { id: 'D07', metric: 'interest', target: 100 },
  { id: 'D03', metric: 'interest', target: 1000 },
  { id: 'D08', metric: 'interest', target: 5000 },
  { id: 'D10', metric: 'savings', target: 100 },
  { id: 'D11', metric: 'stolen', target: 100 },
];

/** Disjoint consecutive blocks in caller's documented order, not independent players.
 * Any short final block is excluded rather than padded with invented results. */
export function summarizeStudyCampaigns(
  rows: readonly StudyMatch[],
  window = 20,
) {
  if (!Number.isSafeInteger(window) || window < 1)
    throw Error('Invalid campaign window');
  return [...studyGroups(rows)].map(([key, group]) => {
    if (new Set(group.map((r) => r.root)).size !== group.length)
      throw Error('Repeated official match root');
    const mode = group[0]!.mode;
    const goals = [
      ...metricGoals.map((g) => ({
        id: g.id,
        target: g.target,
        value: (r: StudyMatch) => r.metrics[g.metric],
      })),
      ...(mode === 'classic'
        ? [
            { id: 'E06', target: 1 },
            { id: 'E09', target: 5 },
            { id: 'E10', target: 20 },
          ]
        : [
            { id: 'F07', target: 1 },
            { id: 'F08', target: 5 },
            { id: 'F09', target: 15 },
          ]
      ).map((g) => ({ ...g, value: (r: StudyMatch) => Number(r.terminal) })),
    ];
    const blocks: StudyMatch[][] = [];
    for (let i = 0; i + window <= group.length; i += window)
      blocks.push(group.slice(i, i + window));
    return {
      key,
      window,
      campaigns: blocks.length,
      excludedTail: group.length % window,
      goals: Object.fromEntries(
        goals.map((g) => {
          const firstHit = blocks.map((block) => {
            let sum = 0;
            const index = block.findIndex(
              (r) => (sum += g.value(r)) >= g.target,
            );
            return index < 0 ? null : index + 1;
          });
          const observed = firstHit
            .filter((x): x is number => x !== null)
            .sort((a, b) => a - b);
          return [
            g.id,
            {
              target: g.target,
              firstHit,
              hits: observed.length,
              censored: blocks.length - observed.length,
              medianAmongHits: observed.length
                ? observed[Math.ceil(observed.length / 2) - 1]
                : null,
              hitBy: Object.fromEntries(
                [5, 10, 20]
                  .filter((n) => n <= window)
                  .map((n) => [
                    n,
                    firstHit.filter((x) => x !== null && x <= n).length,
                  ]),
              ),
            },
          ];
        }),
      ),
    };
  });
}

export const studyOverlapPairs: readonly (readonly [
  AchievementId,
  AchievementId,
])[] = [
  ['A04', 'A01'],
  ['A05', 'E07'],
  ['B09', 'B07'],
  ['B11', 'B01'],
  ['C08', 'C03'],
  ['C09', 'C01'],
  ['D09', 'D06'],
  ['D12', 'D07'],
  ['E11', 'E07'],
  ['E12', 'C02'],
  ['E15', 'B03'],
  ['F10', 'F02'],
  ['F10', 'F06'],
  ['F12', 'F03'],
  ['F12', 'F06'],
];
/** Same-match co-occurrence, not the logical equivalence of two rules. */
export function summarizeStudyOverlaps(rows: readonly StudyMatch[]) {
  const eligible = (r: StudyMatch, id: AchievementId) => {
    const scope = achievementCatalog.find((a) => a.id === id)!.scope;
    return scope === 'shared' || scope === r.mode;
  };
  return studyOverlapPairs.map(([a, b]) => {
    const group = rows.filter((r) => eligible(r, a) && eligible(r, b));
    const aHits = group.filter((r) => r.achieved.includes(a)).length;
    const bHits = group.filter((r) => r.achieved.includes(b)).length;
    const both = group.filter(
      (r) => r.achieved.includes(a) && r.achieved.includes(b),
    ).length;
    return {
      a,
      b,
      n: group.length,
      aHits,
      bHits,
      both,
      aOnly: aHits - both,
      bOnly: bHits - both,
      jaccard: aHits + bHits - both ? both / (aHits + bHits - both) : null,
      shareOfBase: bHits ? both / bHits : null,
    };
  });
}
