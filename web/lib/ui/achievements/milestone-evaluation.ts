import {
  achievementCatalog,
  milestoneAchievementIds,
  type AchievementId,
} from './v056-catalog';
import { decodeAchievementEvent, isMilestoneEvent } from './event-codec';
import type { AchievementReceipt } from './registry';
import { balance081Target } from './balance081-targets';
interface Run {
  failureAt: number | null;
  interest: number;
  shield: boolean;
  lowest: boolean;
  highest: boolean;
}
const emptyRun = (): Run => ({
  failureAt: null,
  interest: 0,
  shield: false,
  lowest: false,
  highest: false,
});
export function createMilestoneScan() {
  return {
    highest: 0,
    interest: 0,
    stolen: 0,
    savings: 0,
    classic: new Set<string>(),
    survival: new Set<string>(),
    runs: new Map<string, Run>(),
    progress: Object.fromEntries(
      milestoneAchievementIds.map((id) => [id, 0]),
    ) as Record<(typeof milestoneAchievementIds)[number], number>,
    achievedAt: {} as Partial<Record<AchievementId, string>>,
  };
}
export type MilestoneScan = ReturnType<typeof createMilestoneScan>;
export function cloneMilestoneScan(s: MilestoneScan): MilestoneScan {
  return {
    ...s,
    classic: new Set(s.classic),
    survival: new Set(s.survival),
    runs: new Map(s.runs),
    progress: { ...s.progress },
    achievedAt: { ...s.achievedAt },
  };
}
function add(a: number, b: number) {
  const n = a + b;
  if (!Number.isSafeInteger(n) || n < 0)
    throw Error('累计成长数值超限，原档案保留。');
  return n;
}
/** Legacy facts contribute only reliable cumulative metrics. Prospective run state
 * requires both an activated ledger prefix and a freshly observed versioned fact. */
export function scanMilestoneReceipt(
  s: MilestoneScan,
  r: AchievementReceipt,
  active: boolean,
) {
  const event = decodeAchievementEvent(r),
    fresh = active && isMilestoneEvent(r);
  const run = {
    ...((r.parent ? s.runs.get(r.parent) : undefined) ?? emptyRun()),
  };
  const mark = (id: (typeof milestoneAchievementIds)[number], yes: boolean) => {
    if (yes) s.progress[id] = 1;
  };
  if (event.stage === 'entry') {
    s.interest = add(s.interest, event.facts.interestMoney);
    s.stolen = add(s.stolen, event.facts.stolenMoney);
    if (fresh) run.interest = add(run.interest, event.facts.interestMoney);
  }
  if (event.stage === 'room') {
    const f = event.facts;
    s.highest = add(s.highest, f.highestAwardOpportunities);
    if (fresh) {
      s.savings = add(s.savings, f.saleSavings!);
      const award =
        f.cooperativeAward ||
        f.highestAwardOpportunities > 0 ||
        f.luckyFootNecessaryAward;
      mark(
        'A04',
        run.failureAt !== null &&
          run.failureAt < r.position &&
          f.bidSuccesses.length > 0 &&
          award,
      );
      if (f.bidSuccesses.some((x) => !x)) run.failureAt ??= r.position;
      run.shield ||= f.shieldRefunded;
      const flags = f.milestoneFlags!;
      for (const [id, bit] of [
        ['B09', 1],
        ['B11', 2],
        ['C08', 4],
        ['C09', 8],
        ['D09', 16],
        ['E15', 32],
      ] as const)
        mark(id, !!(flags & bit));
    }
  }
  if (fresh && event.stage === 'floor')
    run.lowest ||= event.facts.humanSurvived && event.facts.lowestSurvivor;
  if (fresh && event.stage === 'final')
    run.highest = event.facts.highestDifficulty;
  if (event.stage === 'complete') {
    (r.mode === 'classic' ? s.classic : s.survival).add(r.root);
    if (fresh) {
      const f = event.facts;
      mark('A05', r.mode === 'classic' && f.champion && run.failureAt !== null);
      mark(
        'E11',
        r.mode === 'classic' && f.champion && f.characterId === 'isaac',
      );
      mark(
        'E12',
        r.mode === 'classic' && f.characterId === 'lost' && run.shield,
      );
      mark('F10', r.mode === 'survival' && f.champion && run.highest);
      mark('F12', r.mode === 'survival' && f.champion && run.lowest);
    }
  }
  s.runs.set(r.key, run);
  s.progress.B07 = s.progress.B08 = s.highest;
  s.progress.D07 = s.progress.D08 = s.interest;
  s.progress.D10 = s.savings;
  s.progress.D11 = s.stolen;
  s.progress.D12 = Math.max(s.progress.D12, run.interest);
  s.progress.E09 = s.progress.E10 = s.classic.size;
  s.progress.F07 = s.progress.F08 = s.progress.F09 = s.survival.size;
  if (active)
    for (const id of milestoneAchievementIds) {
      if (
        s.progress[id] >=
          balance081Target(
            id,
            achievementCatalog.find((a) => a.id === id)!.target,
          ) &&
        s.achievedAt[id] === undefined
      )
        s.achievedAt[id] = r.at;
    }
}
