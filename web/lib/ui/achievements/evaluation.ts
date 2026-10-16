import { achievementCatalog as v056Catalog } from './v056-catalog';
import {
  achievementCatalog,
  achievementCharacters,
  type AchievementId,
} from './catalog';
import type {
  AchievementEntryFacts,
  AchievementCompletionFacts,
  AchievementRoomFacts,
  AchievementFloorFacts,
  AchievementFinalFacts,
} from './facts';

export interface AchievementCounters {
  failedBids: number;
  highestAwards: number;
  interestMoney: number;
  hiddenCopies: number;
  completedCharacters?: number;
}
export function emptyAchievementCounters(): AchievementCounters {
  return { failedBids: 0, highestAwards: 0, interestMoney: 0, hiddenCopies: 0 };
}
export interface AchievementRunState {
  consecutiveFailedBids: number;
  peakConsecutiveFailures: number;
  eternalCleared: boolean;
  babylonCleared: boolean;
  passedFirstFloors: number[];
  eliminatedFloors: number[];
}
export function emptyAchievementRunState(): AchievementRunState {
  return {
    consecutiveFailedBids: 0,
    peakConsecutiveFailures: 0,
    eternalCleared: false,
    babylonCleared: false,
    passedFirstFloors: [],
    eliminatedFloors: [],
  };
}
/** An exclusion marker must be established by the future verified lifecycle layer,
 * not guessed from a file's name, export time, current build or replay source string. */
export interface AchievementAnalysisUnit<T> {
  eligible: boolean;
  facts: T;
}
export interface AchievementRunAnalysis {
  mode: 'classic' | 'survival';
  source: 'formal' | 'read-only' | 'tutorial';
  entries: readonly AchievementAnalysisUnit<AchievementEntryFacts>[];
  rooms: readonly AchievementAnalysisUnit<AchievementRoomFacts>[];
  floors: readonly AchievementAnalysisUnit<AchievementFloorFacts>[];
  final?: AchievementAnalysisUnit<AchievementFinalFacts>;
  complete?: AchievementAnalysisUnit<AchievementCompletionFacts>;
}
function integer(n: number, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(n) || n < 0 || n > max)
    throw Error('成就分析计数或位置无效。');
  return n;
}
function add(a: number, b: number) {
  return integer(integer(a) + integer(b));
}
function ordered<T>(
  units: readonly AchievementAnalysisUnit<T>[],
  position: (facts: T) => number,
) {
  let prior = -1;
  for (const unit of units) {
    if (typeof unit.eligible !== 'boolean')
      throw Error('成就分析缺少明确资格边界。');
    const index = integer(position(unit.facts));
    if (index <= prior)
      throw Error('成就分析事实必须有序且位置唯一，不能重复累加。');
    prior = index;
  }
}
function roomPosition(facts: { floorIndex: number; roomIndex: number }) {
  return integer(facts.floorIndex, 6) * 5 + integer(facts.roomIndex, 4);
}

/** Pure, repeatable analysis of ONE match's eligible prefix. The baseline excludes
 * this match. Output is a candidate, never an incremental receipt or saved reward.
 * Calling twice with the same inputs returns the same result; do not feed its
 * counters back as the baseline for the same match. Lifecycle/dedup persistence
 * is deliberately not wired in this first development batch. */
export function evaluateAchievementRun(
  input: AchievementRunAnalysis,
  baseline: Readonly<AchievementCounters> = emptyAchievementCounters(),
  initial: Readonly<AchievementRunState> = emptyAchievementRunState(),
) {
  if (
    !['classic', 'survival'].includes(input.mode) ||
    !['formal', 'read-only', 'tutorial'].includes(input.source)
  )
    throw Error('成就分析模式或来源无效。');
  const counters = { ...baseline };
  Object.values(counters).forEach((n) => integer(n));
  const progress = Object.fromEntries(
    achievementCatalog.map((a) => [a.id, 0]),
  ) as Record<AchievementId, number>;
  const unresolvedEvidence: AchievementId[] = [];
  integer(initial.consecutiveFailedBids, 70);
  integer(initial.peakConsecutiveFailures, 70);
  if (
    initial.consecutiveFailedBids > initial.peakConsecutiveFailures ||
    typeof initial.eternalCleared !== 'boolean' ||
    typeof initial.babylonCleared !== 'boolean'
  )
    throw Error('成就单局状态无效。');
  for (const floors of [initial.passedFirstFloors, initial.eliminatedFloors]) {
    if (floors.length > 7 || new Set(floors).size !== floors.length)
      throw Error('成就层状态无效。');
    floors.forEach((i) => integer(i, 6));
  }
  let streak = initial.consecutiveFailedBids,
    peakStreak = initial.peakConsecutiveFailures,
    eternal = initial.eternalCleared,
    babylon = initial.babylonCleared;
  const passedFirstFloors = new Set(initial.passedFirstFloors),
    eliminatedFloors = new Set(initial.eliminatedFloors);
  const mark = (id: AchievementId, value: boolean) => {
    if (value) progress[id] = 1;
  };
  ordered(input.entries, roomPosition);
  ordered(input.rooms, roomPosition);
  ordered(input.floors, (facts) => integer(facts.floorIndex, 6));
  const maximumFloors = input.mode === 'classic' ? 3 : 7;
  if (
    input.entries.length > maximumFloors * 5 ||
    input.rooms.length > maximumFloors * 5 ||
    input.floors.length > maximumFloors ||
    [...input.entries, ...input.rooms, ...input.floors].some(
      (u) => u.facts.floorIndex >= maximumFloors,
    )
  )
    throw Error('成就分析超出正式层房边界。');
  if (input.mode === 'classic' && (input.floors.length || input.final))
    throw Error('经典分析不能包含生存结算。');
  if (input.source === 'formal') {
    for (const { eligible, facts } of input.entries) {
      if (!eligible) continue;
      mark('D01', facts.stolenMoney > 0);
      counters.interestMoney = add(counters.interestMoney, facts.interestMoney);
      integer(facts.stolenMoney);
    }
    for (const { eligible, facts: r } of input.rooms) {
      if (!eligible) continue;
      if (
        r.bidSuccesses.length > 2 ||
        r.bidSuccesses.some((success) => typeof success !== 'boolean')
      )
        throw Error('正常竞拍结果无效。');
      counters.failedBids = add(
        counters.failedBids,
        r.bidSuccesses.filter((success) => !success).length,
      );
      if (r.bidSuccesses.some(Boolean)) streak = 0;
      else streak = add(streak, r.bidSuccesses.length);
      peakStreak = Math.max(peakStreak, streak);
      counters.highestAwards = add(
        counters.highestAwards,
        integer(r.highestAwardOpportunities, 2),
      );
      counters.hiddenCopies = add(
        counters.hiddenCopies,
        integer(r.hiddenAwardCopies, 4),
      );
      mark('B05', r.missedCooperation === true);
      mark('B06', r.missedHighPrice === true);
      mark('B01', r.cooperativeAward);
      mark('B03', r.optionsDestroyed);
      mark('B04', r.watchedVacancy);
      mark('C01', r.causedVacancy);
      mark('C02', r.shieldRefunded);
      mark('C03', r.transcendenceRedeemed);
      mark('C04', r.tailDestroyed);
      mark('C05', r.tailDuplicated);
      mark('C06', r.d6Doubled);
      eternal ||= r.eternalCleared;
      babylon ||= r.babylonCleared;
      if (r.eternalCleared) {
        if (r.scoreBeforeClear === undefined) {
          if (!unresolvedEvidence.includes('E01'))
            unresolvedEvidence.push('E01');
        } else {
          const score = r.scoreBeforeClear;
          if (
            !Number.isFinite(score) ||
            score < 0 ||
            Math.round(score * 10000) / 10000 !== score
          )
            throw Error('E01缺少合法四位精度证据。');
          mark('E01', score > 0);
        }
      }
      mark('D02', r.saleSaved);
      mark('D04', r.poorCharmBoosted);
      mark('D05', r.luckyFootNecessaryAward);
      mark('D06', r.allInBid);
      mark('E02', r.optionsAwarded);
      mark('E03', r.bossAwarded);
      mark('E04', r.brimstoneAwarded);
    }
    for (const { eligible, facts: f } of input.floors) {
      if (!eligible || !f.humanParticipated) continue;
      mark('F01', f.humanEliminated && f.floorIndex === 0);
      mark('F03', f.lowestSurvivor && f.humanSurvived);
      if (f.humanSurvived && f.floorIndex < 3)
        passedFirstFloors.add(f.floorIndex);
      if (f.humanEliminated) eliminatedFloors.add(f.floorIndex);
    }
    if (input.final?.eligible) {
      const f = input.final.facts;
      integer(f.lastEliminationFloor, 6);
      mark('F02', f.humanSurvived && f.highestDifficulty);
      mark(
        'F05',
        f.humanEliminationFloor === f.lastEliminationFloor &&
          eliminatedFloors.has(f.lastEliminationFloor),
      );
    }
    if (input.complete?.eligible) {
      const f = input.complete.facts,
        index = achievementCharacters.indexOf(f.characterId);
      if (f.mode !== input.mode || index < 0 || typeof f.champion !== 'boolean')
        throw Error('正式完成事实不一致。');
      counters.completedCharacters =
        integer(counters.completedCharacters ?? 0, 31) | (2 ** index);
      mark('E06', input.mode === 'classic');
      mark('E07', input.mode === 'classic' && f.champion);
      mark('F06', input.mode === 'survival' && f.champion);
    }
    if (counters.completedCharacters !== undefined)
      integer(counters.completedCharacters, 31);
    progress.E08 = (counters.completedCharacters ?? 0)
      .toString(2)
      .replaceAll('0', '').length;
    progress.A01 = counters.failedBids;
    progress.A02 = counters.failedBids;
    progress.A03 = peakStreak;
    progress.B02 = counters.highestAwards;
    progress.C07 = Number(eternal) + Number(babylon);
    progress.D03 = counters.interestMoney;
    progress.E05 = counters.hiddenCopies;
    progress.F04 = passedFirstFloors.size;
  }
  const achieved = v056Catalog
    .filter((a) => progress[a.id] >= a.target)
    .map((a) => a.id);
  return {
    counters,
    progress,
    achieved,
    unresolvedEvidence,
    // Current streak is distinct from the peak explaining an earned candidate.
    // Mixed double bids clear this value before checking the room result.
    runState: {
      consecutiveFailedBids: streak,
      peakConsecutiveFailures: peakStreak,
      eternalCleared: eternal,
      babylonCleared: babylon,
      passedFirstFloors: [...passedFirstFloors],
      eliminatedFloors: [...eliminatedFloors],
    },
  };
}
