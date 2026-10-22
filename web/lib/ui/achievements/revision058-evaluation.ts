import { revision058NewSeries } from './revision058-catalog';
import { achievementCatalog, type AchievementId } from './catalog';
import {
  decodeAchievementEvent,
  isMilestoneEvent,
  isCfEvent,
} from './event-codec';
import type { AchievementReceipt } from './registry';

export const revision058EvaluatedIds: readonly AchievementId[] = [
  ...revision058NewSeries.flatMap((s) => s.ids),
  'C08',
];
interface Run {
  redeemedRooms: number;
  prefix: number;
  hardPrefix: number;
}
export function createRevision058Scan() {
  return {
    totals: {
      vacancies: 0,
      refunds: 0,
      doubles: 0,
      poor: 0,
      lucky: 0,
      savings: 0,
      gifts: 0,
      asymmetric: 0,
      lowest: 0,
    },
    prefixPeak: 0,
    hardPrefixPeak: 0,
    redeemedPeak: 0,
    runs: new Map<string, Run>(),
    progress: Object.fromEntries(
      revision058EvaluatedIds.map((id) => [id, 0]),
    ) as Partial<Record<AchievementId, number>>,
    achievedAt: {} as Partial<Record<AchievementId, string>>,
  };
}
export type Revision058Scan = ReturnType<typeof createRevision058Scan>;
export function cloneRevision058Scan(s: Revision058Scan): Revision058Scan {
  return {
    ...s,
    totals: { ...s.totals },
    runs: new Map(s.runs),
    progress: { ...s.progress },
    achievedAt: { ...s.achievedAt },
  };
}
function add(a: number, b: number) {
  const n = a + b;
  if (!Number.isSafeInteger(n) || n < 0)
    throw Error('成就累计数值超限，原档案保留。');
  return n;
}
/** Derive exact counters from retained causes. No legacy achievement/time
 * conversion: changed conditions are evaluated as the new conditions. */
export function scanRevision058Receipt(
  s: Revision058Scan,
  r: AchievementReceipt,
  active: boolean,
) {
  const e = decodeAchievementEvent(r),
    t = s.totals;
  const run = {
    ...((r.parent ? s.runs.get(r.parent) : undefined) ?? {
      redeemedRooms: 0,
      prefix: 0,
      hardPrefix: 0,
    }),
  };
  if (e.stage === 'room') {
    const f = e.facts;
    t.doubles = add(t.doubles, Number(f.d6Doubled));
    t.poor = add(t.poor, Number(f.poorCharmBoosted));
    t.gifts = add(t.gifts, f.hiddenAwardCopies);
    if (isMilestoneEvent(r)) {
      t.savings = add(t.savings, f.saleSavings!);
      t.asymmetric = add(t.asymmetric, Number(!!(f.milestoneFlags! & 32)));
      run.redeemedRooms = add(
        run.redeemedRooms,
        Number(!!(f.milestoneFlags! & 4)),
      );
      s.redeemedPeak = Math.max(s.redeemedPeak, run.redeemedRooms);
    }
    if (isCfEvent(r)) {
      t.vacancies = add(t.vacancies, f.cfCounts![0]);
      t.refunds = add(t.refunds, f.cfCounts![1]);
      t.lucky = add(t.lucky, f.cfCounts![2]);
    }
  }
  if (e.stage === 'floor') {
    const f = e.facts;
    t.lowest = add(
      t.lowest,
      Number(f.humanParticipated && f.humanSurvived && f.lowestSurvivor),
    );
    if (f.floorIndex === run.prefix && f.humanParticipated && f.humanSurvived)
      run.prefix++;
    s.prefixPeak = Math.max(s.prefixPeak, run.prefix);
    if (
      f.floorIndex === run.hardPrefix &&
      f.humanParticipated &&
      f.humanSurvived &&
      (f.difficulty === 'hard' || f.difficulty === 'highest')
    )
      run.hardPrefix++;
    s.hardPrefixPeak = Math.max(s.hardPrefixPeak, run.hardPrefix);
  }
  s.runs.set(r.key, run);
  const metrics: Record<string, number> = {
    'S-PERSONAL-VACANCIES': t.vacancies,
    'S-SHIELD-REFUNDS': t.refunds,
    'S-D6-DOUBLES': t.doubles,
    'S-POOR-CHARM': t.poor,
    'S-LUCKY-AWARDS': t.lucky,
    'S-SALE-SAVINGS': t.savings,
    'S-HIDDEN-GIFTS': t.gifts,
    'S-ASYMMETRIC-BIDS': t.asymmetric,
    'S-LOWEST-SURVIVOR': t.lowest,
    'S-FIRST-FLOORS': s.prefixPeak,
  };
  for (const series of revision058NewSeries)
    for (const id of series.ids) s.progress[id] = metrics[series.id]!;
  s.progress.C08 = s.redeemedPeak;
  s.progress.F16 = s.hardPrefixPeak;
  if (active)
    for (const id of revision058EvaluatedIds)
      if (
        (s.progress[id] ?? 0) >=
          achievementCatalog.find((a) => a.id === id)!.target &&
        s.achievedAt[id] === undefined
      )
        s.achievedAt[id] = r.at;
}
