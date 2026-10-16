import type { ClientRoomSettlementRecord } from '../../game/client-session';
import type { SettlementEvent } from '../../game/item-types';
import type { SurvivalFloorRecord } from '../../game/survival-session';
import type { SurvivalReplayLog } from '../survival-record';
import { readLiveScoreBeforeClear } from '../../game/item-scoring';

/** These are analysis DTOs, NOT trusted receipts or a persisted file format.
 * Callers must supply verified authority and independently establish eligibility.
 * Reading/reconstructing facts does not make them newly played events. */
export interface AchievementEntryFacts {
  floorIndex: number;
  roomIndex: number;
  /** Present only on prospectively observed 0.5.6 authority stages. */
  milestones?: true;
  revisions?: true;
  stolenMoney: number;
  interestMoney: number;
}
export interface AchievementCompletionFacts {
  milestones?: true;
  revisions?: true;
  mode: 'classic' | 'survival';
  characterId: import('../../game/item-types').CharacterId;
  champion: boolean;
  finalRank?: number;
}
export interface AchievementRoomFacts {
  milestoneFlags?: number;
  revisionCounts?: readonly [number, number, number, number, number];
  revisionFlags?: number;
  saleSavings?: number;
  missedCooperation?: boolean;
  missedHighPrice?: boolean;
  floorIndex: number;
  roomIndex: number;
  /** Empty = withdraw/disrupt. Outcomes describe market qualification, not delivery. */
  bidSuccesses: boolean[];
  cooperativeAward: boolean;
  highestAwardOpportunities: number;
  optionsDestroyed: boolean;
  watchedVacancy: boolean;
  causedVacancy: boolean;
  shieldRefunded: boolean;
  transcendenceRedeemed: boolean;
  tailDestroyed: boolean;
  tailDuplicated: boolean;
  d6Doubled: boolean;
  eternalCleared: boolean;
  babylonCleared: boolean;
  /** Missing is unresolved evidence, never inferred from rounded action subtotals. */
  scoreBeforeClear?: number;
  saleSaved: boolean;
  poorCharmBoosted: boolean;
  luckyFootNecessaryAward: boolean;
  allInBid: boolean;
  optionsAwarded: boolean;
  bossAwarded: boolean;
  brimstoneAwarded: boolean;
  hiddenAwardCopies: number;
}
export interface AchievementFloorFacts {
  milestones?: true;
  revisions?: true;
  floorIndex: number;
  humanParticipated: boolean;
  humanSurvived: boolean;
  humanEliminated: boolean;
  lowestSurvivor: boolean;
}
export interface AchievementFinalFacts {
  milestones?: true;
  revisions?: true;
  humanSurvived: boolean;
  highestDifficulty: boolean;
  lastEliminationFloor: number;
  humanEliminationFloor: number | null;
}
function amount(value: number | undefined): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < 0)
    throw Error('成就事实的资金或数量无效。');
  return value;
}
function sum(values: number[]): number {
  return amount(values.reduce((total, n) => total + amount(n), 0));
}
export function extractAchievementEntryFacts(
  events: readonly SettlementEvent[],
  floorIndex: number,
  roomIndex: number,
): AchievementEntryFacts {
  const humanMoney = events.filter(
    (event) => event.playerId === 'human' && event.type === 'money',
  );
  return {
    floorIndex,
    roomIndex,
    stolenMoney: sum(
      humanMoney
        .filter((e) => e.itemId === 'money_bag')
        .map((e) => amount(e.amount)),
    ),
    interestMoney: sum(
      humanMoney
        .filter((e) => e.itemId === 'interest')
        .map((e) => amount(e.amount)),
    ),
  };
}

export function extractAchievementRoomFacts(
  record: ClientRoomSettlementRecord,
  evidence: { scoreBeforeClear?: number } = {},
): AchievementRoomFacts | null {
  const before = record.playersBefore.find(
    (p) => p.id === 'human' && p.isHuman,
  );
  // AI-only survival rooms contain no human; no guessed frozen human effects.
  if (!before) return null;
  const actions = record.resolvedActions.filter((a) => a.playerId === 'human');
  const events = record.events.filter((e) => e.playerId === 'human');
  const awards = record.awards.filter((a) => a.playerId === 'human');
  const entitlements = record.entitlements.filter(
    (e) => e.playerId === 'human',
  );
  if (
    entitlements.some((e) =>
      e.sources.some(
        (s) =>
          !['highest', 'cooperation', 'lucky_foot', 'transcendence'].includes(
            s,
          ),
      ),
    )
  )
    throw Error('成就事实含未知资格来源，不能按当前目录解释。');
  const placed = (group: 'A' | 'B', type: 'highest' | 'cooperation') =>
    (type === 'highest'
      ? record.highPricePlacements
      : record.cooperationPlacements
    ).some(
      (p) =>
        p.playerId === 'human' && p.group === group && p.actionType === 'bid',
    );
  const eventByCause = (type: SettlementEvent['type'], cause: string) =>
    events.some((e) => e.type === type && e.effectItemId === cause);
  const vacancies = [
    ...record.highPricePlacements.map((p) => ({
      ...p,
      slotType: 'highest' as const,
    })),
    ...record.cooperationPlacements.map((p) => ({
      ...p,
      slotType: 'cooperation' as const,
    })),
  ].filter(
    (p) =>
      p.actionType === 'disrupt' &&
      !record.transcendenceRedemptions.some(
        (r) =>
          r.group === p.group &&
          r.playerId === p.playerId &&
          r.slotType === p.slotType,
      ),
  );
  const hasSource = (group: 'A' | 'B', source: string) =>
    entitlements.some((e) => e.group === group && e.sources.includes(source));
  const triggers = record.scoreBreakdowns.human?.triggers ?? [];
  const trigger = (itemId: string, kind: string) =>
    triggers.some((t) => t.itemId === itemId && t.kind === kind);
  const poorCount = before.items.filter(
    (i) => i.itemId === 'poor_charm',
  ).length;
  const poorCharmBoosted =
    poorCount > 0 &&
    triggers.some(
      (t) =>
        t.itemId === 'poor_charm' &&
        t.kind === 'additive_score' &&
        t.amount === poorCount * 20,
    );
  const scoreBeforeClear =
    evidence.scoreBeforeClear ??
    (record.scoreBreakdowns.human
      ? readLiveScoreBeforeClear(record.scoreBreakdowns.human)
      : undefined);
  if (
    scoreBeforeClear !== undefined &&
    (!Number.isFinite(scoreBeforeClear) ||
      scoreBeforeClear < 0 ||
      !Number.isSafeInteger(Math.round(scoreBeforeClear * 10000)) ||
      Math.round(scoreBeforeClear * 10000) / 10000 !== scoreBeforeClear)
  )
    throw Error('未清零应得分必须是权威四位精度事实。');
  return {
    floorIndex: record.room.floorIndex,
    roomIndex: record.room.roomIndex,
    bidSuccesses: actions
      .filter((a) => a.action.type === 'bid')
      .map((a) => {
        if (a.action.type !== 'bid') return false;
        const group = a.action.group;
        return (
          placed(group, 'highest') ||
          placed(group, 'cooperation') ||
          hasSource(group, 'lucky_foot') ||
          events.some(
            (e) =>
              e.type === 'destroy' &&
              e.effectItemId === 'more_options' &&
              e.group === group,
          )
        );
      }),
    cooperativeAward: awards.some((a) => hasSource(a.group, 'cooperation')),
    highestAwardOpportunities: new Set(
      awards.filter((a) => hasSource(a.group, 'highest')).map((a) => a.group),
    ).size,
    optionsDestroyed: eventByCause('destroy', 'more_options'),
    watchedVacancy:
      actions.length === 1 &&
      actions[0]!.action.type === 'withdraw' &&
      vacancies.length > 0,
    causedVacancy: vacancies.some((p) => p.playerId === 'human'),
    shieldRefunded: events.some(
      (e) =>
        e.type === 'refund' &&
        ['holy_mantle', 'wooden_cross'].includes(e.itemId ?? '') &&
        amount(e.amount) > 0,
    ),
    transcendenceRedeemed: record.transcendenceRedemptions.some(
      (r) => r.playerId === 'human',
    ),
    tailDestroyed: eventByCause('destroy', 'guppys_tail'),
    tailDuplicated: eventByCause('duplicate', 'guppys_tail'),
    d6Doubled: trigger('d6', 'double_score'),
    eternalCleared: trigger('eternal_d6', 'clear_score'),
    babylonCleared: trigger('whore_of_babylon', 'clear_score'),
    ...(scoreBeforeClear === undefined ? {} : { scoreBeforeClear }),
    saleSaved: events.some(
      (e) =>
        e.type === 'money' && e.itemId === 'steam_sale' && amount(e.amount) > 0,
    ),
    poorCharmBoosted,
    luckyFootNecessaryAward: awards.some(
      (a) =>
        hasSource(a.group, 'lucky_foot') &&
        !placed(a.group, 'highest') &&
        !placed(a.group, 'cooperation') &&
        !hasSource(a.group, 'highest') &&
        !hasSource(a.group, 'cooperation'),
    ),
    allInBid:
      before.money > 0 &&
      actions.some(
        (a) => a.action.type === 'bid' && a.action.amount === before.money,
      ),
    optionsAwarded: awards.some(
      (a) =>
        a.itemId === 'more_options' || a.itemId === 'more_options_question',
    ),
    bossAwarded: record.room.kind === 'boss' && awards.length > 0,
    brimstoneAwarded: awards.some((a) => a.itemId === 'brimstone'),
    hiddenAwardCopies:
      record.room.kind !== 'treasure'
        ? 0
        : sum(
            awards
              .filter((a) =>
                record.room.rewards.some(
                  (r) => r.group === a.group && r.hidden,
                ),
              )
              .map((a) => a.copies),
          ),
  };
}

export function extractAchievementFloorFacts(
  record: SurvivalFloorRecord,
): AchievementFloorFacts {
  const humanParticipated = record.activePlayerIds.includes('human');
  const humanSurvived =
    humanParticipated && record.plan.survivorIds.includes('human');
  const survivorScores = record.plan.survivorIds.map(
    (id) => record.scores[id]?.survivalScore,
  );
  if (
    survivorScores.some((n) => n === undefined || !Number.isFinite(n) || n < 0)
  )
    throw Error('生存层末缺少权威存活者成绩。');
  return {
    floorIndex: record.floorIndex,
    humanParticipated,
    humanSurvived,
    humanEliminated:
      humanParticipated &&
      record.plan.eliminations.some((e) => e.playerId === 'human'),
    lowestSurvivor:
      humanSurvived &&
      record.scores.human!.survivalScore ===
        Math.min(...(survivorScores as number[])),
  };
}
export function extractAchievementFinalFacts(
  log: SurvivalReplayLog,
): AchievementFinalFacts | null {
  if (!log.final) return null;
  const human = log.final.ranking.find((r) => r.playerId === 'human');
  const last = log.floors.at(-1);
  if (!human || !last || !last.plan.shouldFinish)
    throw Error('生存终局缺少真人或最后淘汰结算证据。');
  return {
    humanSurvived: human.status === 'survived',
    highestDifficulty: log.ruleFacts.parameters.aiDifficulty === 'highest',
    lastEliminationFloor: last.floorIndex,
    humanEliminationFloor: human.eliminationFloorIndex,
  };
}
