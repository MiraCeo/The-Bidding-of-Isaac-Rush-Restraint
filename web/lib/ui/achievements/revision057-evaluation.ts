import { revision057NewSeries } from './revision057-catalog';
import { achievementCatalog, type AchievementId } from './catalog';
import {
  decodeAchievementEvent,
  isMilestoneEvent,
  isRevisionEvent,
} from './event-codec';
import type { AchievementReceipt } from './registry';

export const revision057EvaluatedIds = [
  ...revision057NewSeries.flatMap((s) => s.ids),
  'B12',
  'B13',
  'E16',
] as readonly AchievementId[];
interface Run {
  streak: number;
  failureAt: number | null;
}
export function createRevision057Scan() {
  return {
    failedBids: 0,
    peak: 0,
    stolen: 0,
    allIn: 0,
    watched: 0,
    groups: [0, 0, 0, 0, 0],
    completed: new Set<string>(),
    lost: new Set<string>(),
    recovered: new Set<string>(),
    runs: new Map<string, Run>(),
    progress: Object.fromEntries(
      revision057EvaluatedIds.map((id) => [id, 0]),
    ) as Partial<Record<AchievementId, number>>,
    achievedAt: {} as Partial<Record<AchievementId, string>>,
  };
}
export type Revision057Scan = ReturnType<typeof createRevision057Scan>;
export function cloneRevision057Scan(s: Revision057Scan): Revision057Scan {
  return {
    ...s,
    groups: [...s.groups],
    completed: new Set(s.completed),
    lost: new Set(s.lost),
    recovered: new Set(s.recovered),
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
/** Scan already validated authority receipts. Never called for a replay or draft.
 * Old group booleans cannot reconstruct group multiplicity or a final rank. */
export function scanRevision057Receipt(
  s: Revision057Scan,
  r: AchievementReceipt,
  active: boolean,
) {
  const e = decodeAchievementEvent(r),
    fresh = active && isRevisionEvent(r);
  const run = {
    ...((r.parent ? s.runs.get(r.parent) : undefined) ?? {
      streak: 0,
      failureAt: null,
    }),
  };
  const mark = (id: AchievementId, yes: boolean) => {
    if (yes) s.progress[id] = 1;
  };
  if (e.stage === 'entry') s.stolen = add(s.stolen, e.facts.stolenMoney);
  if (e.stage === 'room') {
    const f = e.facts,
      failed = f.bidSuccesses.filter((x) => !x).length;
    s.failedBids = add(s.failedBids, failed);
    run.streak = f.bidSuccesses.some(Boolean)
      ? 0
      : add(run.streak, f.bidSuccesses.length);
    s.peak = Math.max(s.peak, run.streak);
    s.watched = add(s.watched, Number(f.watchedVacancy));
    if (isMilestoneEvent(r)) {
      s.allIn = add(s.allIn, Number(!!(f.milestoneFlags! & 16)));
      const award =
        f.cooperativeAward ||
        f.highestAwardOpportunities > 0 ||
        f.luckyFootNecessaryAward;
      if (
        run.failureAt !== null &&
        run.failureAt < r.position &&
        f.bidSuccesses.length > 0 &&
        award
      )
        s.recovered.add(r.mode + '/' + r.root);
      if (failed) run.failureAt ??= r.position;
    }
    if (fresh) {
      for (let i = 0; i < 5; i++)
        s.groups[i] = add(s.groups[i]!, f.revisionCounts![i]!);
      mark('B12', !!(f.revisionFlags! & 1));
      mark('B13', !!(f.revisionFlags! & 2));
      mark('E16', !!(f.revisionFlags! & 4));
    }
  }
  if (e.stage === 'complete') {
    const key = r.mode + '/' + r.root;
    if (!s.completed.has(key) && fresh && e.facts.finalRank! > 5)
      s.lost.add(key);
    s.completed.add(key);
  }
  s.runs.set(r.key, run);
  for (const series of revision057NewSeries) {
    const metric = (
      {
        'S-FAILED-BIDS': s.failedBids,
        'S-LOSING-MATCHES': s.lost.size,
        'S-FAILED-STREAK': s.peak,
        'S-RECOVERY-MATCHES': s.recovered.size,
        'S-COOPERATION': s.groups[0]!,
        'S-MISSED-COOPERATION': s.groups[1]!,
        'S-MISSED-HIGH': s.groups[2]!,
        'S-LAST-HIGH': s.groups[3]!,
        'S-ALTERNATIVE': s.groups[4]!,
        'S-WATCHED-VACANCIES': s.watched,
        'S-ALL-IN-AWARDS': s.allIn,
        'S-STOLEN-MONEY': s.stolen,
      } as Record<string, number>
    )[series.id]!;
    for (const id of series.ids) s.progress[id] = metric;
  }
  if (active)
    for (const id of revision057EvaluatedIds) {
      if (
        (s.progress[id] ?? 0) >=
          achievementCatalog.find((a) => a.id === id)!.target &&
        s.achievedAt[id] === undefined
      )
        s.achievedAt[id] = r.at;
    }
}
