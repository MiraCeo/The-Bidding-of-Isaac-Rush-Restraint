import { extractRevision058RoomCounts } from './revision058-facts';
import {
  extractRevision057RoomFacts,
  extractRevision057CompletionFacts,
} from './revision057-facts';
import { extractMilestoneRoomFacts } from './milestone-room-facts';
import { readRoomNearMissEvidence } from '../../game/room-near-miss-evidence';
import type { GameSession } from '../game-session';
import type { SurvivalGameState } from '../../game/survival-session';
import type { SurvivalClientSession } from '../survival-client';
import type { PlayerProfile } from '../player-profile';
import { canonicalJson } from '../../shared/json-facts';
import { sha256Hex } from '../../shared/sha256';
import {
  createSurvivalRuleFacts,
  survivalParameters,
  survivalCompatibility,
  survivalMatchId,
} from '../survival-record';
import {
  extractAchievementEntryFacts,
  extractAchievementRoomFacts,
  extractAchievementFloorFacts,
} from './facts';
import {
  encodeAchievementEvent,
  sameAchievementEventFacts,
  isMilestoneEvent,
  isRevisionEvent,
  isCfEvent,
  decodeAchievementEvent,
  achievementEventOrder,
  type EncodedAchievementEvent,
  type AchievementEvent,
} from './event-codec';
import { createAchievementBatch, prepareAchievementBaseline } from './registry';
import {
  currentAchievementBaseline,
  hasCurrentAchievementBaseline,
} from './baseline';

export interface GrowthUnit extends EncodedAchievementEvent {
  authorityHash: string;
}
export interface GrowthContext {
  version: 1;
  /** Fixed achievement data generation; missing means pre-cleanup facts. */
  baseline?: 1;
  mode: 'classic' | 'survival';
  root: string;
  /** Monotonic authority-stage boundary, not a room count or an export timestamp. */
  excludedThrough: number;
  units: GrowthUnit[];
  acknowledged: number;
  /** Local replacement generation; never part of match/authority identities. */
  profileEpoch?: string | null;
  /** Imported/replaced-profile prefix must not be granted merely by loading it. */
  ignoredThrough?: number;
  /** 0.5.3 new-fact boundary; absent on legacy contexts, never inferred from a date. */
  expansionFrom?: number;
  /** 0.5.6 prospective run/causal boundary; absent on older contexts. */
  milestonesFrom?: number;
  revisionsFrom?: number;
  /** Exact C-F multiplicities and catalog activation, never replay enrichment. */
  cfFrom?: number;
}
function fail(): never {
  throw Error('对局成长上下文不一致，原对局与档案保留。');
}
/** Drop obsolete achievement-only pending/acknowledged units, not game turns or
 * replay facts. The existing authority exclusion boundary prevents backfill. */
export function resetLegacyGrowthContext(
  context: GrowthContext,
  currentOrder?: number,
): GrowthContext {
  if (context.baseline === currentAchievementBaseline) return context;
  const c = validateGrowthContext(context, context.mode);
  const boundary =
    currentOrder ??
    (c.units.length
      ? achievementEventOrder(c.units.at(-1)!)
      : c.excludedThrough);
  const excludedThrough = Math.max(c.excludedThrough, boundary);
  return {
    ...c,
    baseline: currentAchievementBaseline,
    excludedThrough,
    expansionFrom: Math.max(
      c.expansionFrom ?? excludedThrough,
      excludedThrough,
    ),
    milestonesFrom: Math.max(
      c.milestonesFrom ?? excludedThrough,
      excludedThrough,
    ),
    revisionsFrom: Math.max(
      c.revisionsFrom ?? excludedThrough,
      excludedThrough,
    ),
    cfFrom: Math.max(c.cfFrom ?? excludedThrough, excludedThrough),
    units: [],
    acknowledged: 0,
    ...(c.ignoredThrough !== undefined ? { ignoredThrough: 0 } : {}),
  };
}
function exact(value: unknown, names: string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== names.length ||
    names.some((n) => !Object.hasOwn(value, n))
  )
    fail();
}
export function bindGrowthEpoch(
  context: GrowthContext,
  epoch: string | null,
  options: { fresh?: boolean; imported?: boolean } = {},
): GrowthContext {
  const changed =
    context.profileEpoch !== epoch &&
    !(context.profileEpoch === undefined && epoch === null);
  return {
    ...context,
    profileEpoch: epoch,
    ignoredThrough:
      options.imported || (!options.fresh && changed)
        ? context.units.length
        : (context.ignoredThrough ?? 0),
  };
}
/** Only the same unrounded knife explanation tails as existing completion
 * identities are normalized. All prices, authority scores and causes stay exact. */
function authority(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(authority);
  if (!value || typeof value !== 'object') return value;
  const o = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(o).map(([key, v]) => [
      key,
      o.itemId === 'moms_knife' &&
      o.kind === 'additive_score' &&
      key === 'amount' &&
      typeof v === 'number'
        ? Number(v.toFixed(8))
        : authority(v),
    ]),
  );
}
function digest(value: unknown) {
  return sha256Hex(canonicalJson(authority(value)));
}
function append(
  ctx: GrowthContext,
  event: AchievementEvent,
  facts: unknown,
): GrowthContext {
  const unit = {
    ...encodeAchievementEvent(event),
    authorityHash: digest(facts),
  };
  const order = achievementEventOrder(unit);
  if (order <= ctx.excludedThrough) return ctx;
  if (ctx.units.length && order <= achievementEventOrder(ctx.units.at(-1)!))
    fail();
  return { ...ctx, units: [...ctx.units, unit] };
}
function classicPrefix(session: GameSession) {
  return session.replay!.rooms.map((r) => ({
    entryEvents: r.entryEvents,
    settlement: r.settlement,
    aiChoices: r.aiChoices,
  }));
}
function survivalPrefix(game: SurvivalGameState) {
  return game.roomRecords.map(({ build: _build, ...r }) => r);
}
export function classicGrowthOrder(session: GameSession): number {
  const g = session.game;
  return g.phase === 'character_selection'
    ? -1
    : g.phase === 'game_result'
      ? 34
      : g.floorIndex * 11 + g.roomIndex * 2 + Number(g.phase !== 'room_action');
}
export function survivalGrowthOrder(game: SurvivalGameState): number {
  if (game.phase === 'competition_complete') return 78;
  return (
    game.floorIndex * 11 +
    (game.phase === 'floor_result'
      ? 10
      : game.roomIndex * 2 + Number(game.phase === 'room_result'))
  );
}
export function beginClassicGrowth(
  session: GameSession,
  excludedThrough = -1,
  expansionFrom = excludedThrough,
  milestonesFrom = expansionFrom,
  revisionsFrom = milestonesFrom,
  cfFrom = revisionsFrom,
): GameSession {
  if (session.game.phase === 'character_selection' || !session.replay) fail();
  const ctx: GrowthContext = {
    version: 1,
    baseline: currentAchievementBaseline,
    mode: 'classic',
    root: digest(['classic', session.replay.id]),
    excludedThrough,
    expansionFrom,
    milestonesFrom,
    revisionsFrom,
    cfFrom,
    units: [],
    acknowledged: 0,
  };
  return { ...session, growth: observeClassicGrowth(undefined, session, ctx) };
}
export function beginSurvivalGrowth(
  session: SurvivalClientSession,
  excludedThrough = -1,
  expansionFrom = excludedThrough,
  milestonesFrom = expansionFrom,
  revisionsFrom = milestonesFrom,
  cfFrom = revisionsFrom,
): SurvivalClientSession {
  const g = session.game;
  const id = survivalMatchId(
    g.seed,
    g.selectedCharacter,
    survivalCompatibility(createSurvivalRuleFacts(survivalParameters(g))),
  );
  const ctx: GrowthContext = {
    version: 1,
    baseline: currentAchievementBaseline,
    mode: 'survival',
    root: digest(['survival', id]),
    excludedThrough,
    expansionFrom,
    milestonesFrom,
    revisionsFrom,
    cfFrom,
    units: [],
    acknowledged: 0,
  };
  return {
    ...session,
    growth: observeSurvivalGrowth(undefined, session.game, ctx),
  };
}
function withNearMissFacts(
  record: import('../../game/client-session').ClientRoomSettlementRecord,
  facts: NonNullable<ReturnType<typeof extractAchievementRoomFacts>>,
  expanded: boolean,
) {
  if (!expanded) return facts;
  const evidence = readRoomNearMissEvidence(record.scoreBreakdowns);
  if (!evidence) throw Error('新结算缺少真实落选次序证据，成长待核验。');
  return {
    ...facts,
    missedCooperation: evidence.some((e) => e.cooperationLost),
    missedHighPrice: evidence.some((e) => e.nextHighPrice),
  };
}
function revisionRoomFacts(
  record: import('../../game/client-session').ClientRoomSettlementRecord,
) {
  const f = extractRevision057RoomFacts(record);
  if (!f) throw Error('新成就缺少真人房间结算。');
  return {
    revisionCounts: [
      f.cooperativeAwardOpportunities,
      f.missedCooperationActions,
      f.missedHighPriceActions,
      f.lastHighPriceAwardOpportunities,
      f.alternativeAwardOpportunities,
    ] as const,
    revisionFlags:
      Number(f.onePathEntirelyVacant) +
      2 * Number(f.bothPathsEntirelyVacant) +
      4 * Number(f.lostHolyMantleAward),
  };
}
export function observeClassicGrowth(
  before: GameSession | undefined,
  next: GameSession,
  ctx: GrowthContext,
): GrowthContext {
  const g = next.game;
  if (g.phase === 'character_selection') fail();
  ctx = resetLegacyGrowthContext(
    ctx,
    before ? classicGrowthOrder(before) : classicGrowthOrder(next),
  );
  let result =
    ctx.expansionFrom === undefined
      ? {
          ...ctx,
          expansionFrom: before
            ? classicGrowthOrder(before)
            : classicGrowthOrder(next),
        }
      : ctx;
  result = {
    ...result,
    cfFrom:
      ctx.cfFrom ??
      (before ? classicGrowthOrder(before) : classicGrowthOrder(next)),
    revisionsFrom:
      ctx.revisionsFrom ??
      (before ? classicGrowthOrder(before) : classicGrowthOrder(next)),
    milestonesFrom:
      ctx.milestonesFrom ??
      (before ? classicGrowthOrder(before) : classicGrowthOrder(next)),
  };
  if (
    g.phase === 'room_action' &&
    (!before ||
      before.game.phase === 'character_selection' ||
      before.game.floorIndex !== g.floorIndex ||
      before.game.roomIndex !== g.roomIndex)
  ) {
    result = append(
      result,
      {
        stage: 'entry',
        facts: {
          ...(g.floorIndex * 11 + g.roomIndex * 2 > result.revisionsFrom!
            ? { revisions: true as const }
            : {}),
          ...(g.floorIndex * 11 + g.roomIndex * 2 > result.cfFrom!
            ? { cf: true as const }
            : {}),
          ...extractAchievementEntryFacts(
            g.roomEntryEvents,
            g.floorIndex,
            g.roomIndex,
          ),
          ...(g.floorIndex * 11 + g.roomIndex * 2 > result.milestonesFrom!
            ? { milestones: true as const }
            : {}),
        },
      },
      [classicPrefix(next), g.roomEntryEvents, g.players],
    );
  }
  if (
    g.roomSettlement &&
    (!before ||
      before.game.phase === 'character_selection' ||
      before.game.roomSettlement !== g.roomSettlement)
  ) {
    const facts = extractAchievementRoomFacts(g.roomSettlement);
    if (facts)
      result = append(
        result,
        {
          stage: 'room',
          facts: {
            ...(g.floorIndex * 11 + g.roomIndex * 2 + 1 > result.cfFrom!
              ? { cfCounts: extractRevision058RoomCounts(g.roomSettlement)! }
              : {}),
            ...(g.floorIndex * 11 + g.roomIndex * 2 + 1 > result.revisionsFrom!
              ? revisionRoomFacts(g.roomSettlement)
              : {}),
            ...withNearMissFacts(
              g.roomSettlement,
              facts,
              g.floorIndex * 11 + g.roomIndex * 2 + 1 > result.expansionFrom!,
            ),
            ...(g.floorIndex * 11 + g.roomIndex * 2 + 1 > result.milestonesFrom!
              ? extractMilestoneRoomFacts(g.roomSettlement)
              : {}),
          },
        },
        classicPrefix(next),
      );
  }
  if (
    before &&
    g.phase === 'game_result' &&
    before.game.phase !== 'game_result' &&
    result.expansionFrom! < 34
  ) {
    const human = g.finalRanking.find((r) => r.playerId === g.humanPlayerId);
    if (!human) fail();
    result = append(
      result,
      {
        stage: 'complete',
        facts: {
          ...(34 > result.milestonesFrom! ? { milestones: true as const } : {}),
          ...(34 > result.revisionsFrom!
            ? { finalRank: extractRevision057CompletionFacts(g)!.finalRank }
            : {}),
          ...(34 > result.cfFrom! ? { cf: true as const } : {}),
          mode: 'classic',
          characterId: g.selectedCharacter,
          champion: !g.finalRanking.some(
            (r) => r.finalScore > human.finalScore,
          ),
        },
      },
      [classicPrefix(next), g.finalRanking, g.selectedCharacter],
    );
  }
  return result;
}
export function observeSurvivalGrowth(
  before: SurvivalGameState | undefined,
  next: SurvivalGameState,
  ctx: GrowthContext,
): GrowthContext {
  ctx = resetLegacyGrowthContext(
    ctx,
    before ? survivalGrowthOrder(before) : survivalGrowthOrder(next),
  );
  let result =
    ctx.expansionFrom === undefined
      ? {
          ...ctx,
          expansionFrom: before
            ? survivalGrowthOrder(before)
            : survivalGrowthOrder(next),
        }
      : ctx;
  result = {
    ...result,
    cfFrom:
      ctx.cfFrom ??
      (before ? survivalGrowthOrder(before) : survivalGrowthOrder(next)),
    revisionsFrom:
      ctx.revisionsFrom ??
      (before ? survivalGrowthOrder(before) : survivalGrowthOrder(next)),
    milestonesFrom:
      ctx.milestonesFrom ??
      (before ? survivalGrowthOrder(before) : survivalGrowthOrder(next)),
  };
  if (
    next.phase === 'room_action' &&
    next.activePlayerIds.includes('human') &&
    (!before ||
      before.floorIndex !== next.floorIndex ||
      before.roomIndex !== next.roomIndex)
  ) {
    result = append(
      result,
      {
        stage: 'entry',
        facts: {
          ...(next.floorIndex * 11 + next.roomIndex * 2 > result.revisionsFrom!
            ? { revisions: true as const }
            : {}),
          ...(next.floorIndex * 11 + next.roomIndex * 2 > result.cfFrom!
            ? { cf: true as const }
            : {}),
          ...extractAchievementEntryFacts(
            next.roomEntryEvents,
            next.floorIndex,
            next.roomIndex,
          ),
          ...(next.floorIndex * 11 + next.roomIndex * 2 > result.milestonesFrom!
            ? { milestones: true as const }
            : {}),
        },
      },
      [survivalPrefix(next), next.roomEntryEvents, next.players],
    );
  }
  if (
    next.roomSettlement &&
    (!before || before.roomSettlement !== next.roomSettlement)
  ) {
    const facts = extractAchievementRoomFacts(next.roomSettlement);
    if (facts)
      result = append(
        result,
        {
          stage: 'room',
          facts: {
            ...(next.floorIndex * 11 + next.roomIndex * 2 + 1 > result.cfFrom!
              ? { cfCounts: extractRevision058RoomCounts(next.roomSettlement)! }
              : {}),
            ...(next.floorIndex * 11 + next.roomIndex * 2 + 1 >
            result.revisionsFrom!
              ? revisionRoomFacts(next.roomSettlement)
              : {}),
            ...withNearMissFacts(
              next.roomSettlement,
              facts,
              next.floorIndex * 11 + next.roomIndex * 2 + 1 >
                result.expansionFrom!,
            ),
            ...(next.floorIndex * 11 + next.roomIndex * 2 + 1 >
            result.milestonesFrom!
              ? extractMilestoneRoomFacts(next.roomSettlement)
              : {}),
          },
        },
        survivalPrefix(next),
      );
  }
  if (
    next.floorRecords.length >
    (before?.floorRecords.length ?? next.floorRecords.length)
  ) {
    const record = next.floorRecords.at(-1)!,
      facts = {
        ...(record.floorIndex * 11 + 10 > result.revisionsFrom!
          ? { revisions: true as const }
          : {}),
        ...(record.floorIndex * 11 + 10 > result.cfFrom!
          ? { cf: true as const }
          : {}),
        ...extractAchievementFloorFacts(record),
        ...(record.floorIndex * 11 + 10 > result.milestonesFrom!
          ? { milestones: true as const }
          : {}),
      };
    if (facts.humanParticipated)
      result = append(result, { stage: 'floor', facts }, [
        survivalPrefix(next),
        next.floorRecords.map(({ build: _build, ...r }) => r),
      ]);
  }
  if (
    next.phase === 'competition_complete' &&
    before?.phase !== 'competition_complete'
  ) {
    const human = next.finalRanking.find((r) => r.playerId === 'human'),
      last = next.floorRecords.at(-1);
    if (!human || !last?.plan.shouldFinish) fail();
    const facts = {
      ...(next.floorRecords.at(-1)!.floorIndex * 11 + 11 >
      result.milestonesFrom!
        ? { milestones: true as const }
        : {}),
      ...(last.floorIndex * 11 + 11 > result.revisionsFrom!
        ? { revisions: true as const }
        : {}),
      ...(last.floorIndex * 11 + 11 > result.cfFrom!
        ? { cf: true as const }
        : {}),
      humanSurvived: human.status === 'survived',
      highestDifficulty: next.aiDifficulty === 'highest',
      lastEliminationFloor: last.floorIndex,
      humanEliminationFloor: human.eliminationFloorIndex,
    };
    const final = {
      players: next.players,
      activePlayerIds: next.activePlayerIds,
      eliminated: next.eliminated,
      cumulativeScores: next.cumulativeScores,
      ranking: next.finalRanking,
      championId: next.championId,
      reason: next.completionReason,
    };
    result = append(result, { stage: 'final', facts }, [
      survivalPrefix(next),
      next.floorRecords.map(({ build: _build, ...r }) => r),
      final,
    ]);
    if (before && result.expansionFrom! < 78)
      result = append(
        result,
        {
          stage: 'complete',
          facts: {
            ...(78 > result.milestonesFrom!
              ? { milestones: true as const }
              : {}),
            ...(78 > result.revisionsFrom!
              ? {
                  finalRank: extractRevision057CompletionFacts(next)!.finalRank,
                }
              : {}),
            ...(78 > result.cfFrom! ? { cf: true as const } : {}),
            mode: 'survival',
            characterId: next.selectedCharacter,
            champion: next.championId === 'human',
          },
        },
        [
          survivalPrefix(next),
          next.floorRecords.map(({ build: _build, ...r }) => r),
          final,
        ],
      );
  }
  return result;
}
export function validateGrowthContext(
  value: unknown,
  mode: 'classic' | 'survival',
): GrowthContext {
  const optional =
    value && typeof value === 'object'
      ? [
          'profileEpoch',
          'ignoredThrough',
          'expansionFrom',
          'milestonesFrom',
          'revisionsFrom',
          'cfFrom',
          'baseline',
        ].filter((key) => Object.hasOwn(value, key))
      : [];
  exact(value, [
    'version',
    'mode',
    'root',
    'excludedThrough',
    'units',
    'acknowledged',
    ...optional,
  ]);
  const c = value as GrowthContext;
  const max = mode === 'classic' ? 34 : 78;
  if (
    c.version !== 1 ||
    c.mode !== mode ||
    typeof c.root !== 'string' ||
    !/^[a-f0-9]{64}$/.test(c.root) ||
    !Number.isInteger(c.excludedThrough) ||
    c.excludedThrough < -1 ||
    c.excludedThrough > max ||
    !Array.isArray(c.units) ||
    c.units.length > (mode === 'classic' ? 31 : 79) ||
    !Number.isInteger(c.acknowledged) ||
    c.acknowledged < 0 ||
    c.acknowledged > c.units.length
  )
    fail();
  if (
    (c.profileEpoch !== undefined &&
      c.profileEpoch !== null &&
      (typeof c.profileEpoch !== 'string' ||
        !/^[a-f0-9]{64}$/.test(c.profileEpoch))) ||
    (c.ignoredThrough !== undefined &&
      (!Number.isInteger(c.ignoredThrough) ||
        c.ignoredThrough < 0 ||
        c.ignoredThrough > c.units.length))
  )
    fail();
  if (
    c.expansionFrom !== undefined &&
    (!Number.isInteger(c.expansionFrom) ||
      c.expansionFrom < c.excludedThrough ||
      c.expansionFrom > max)
  )
    fail();
  if (
    c.milestonesFrom !== undefined &&
    (!Number.isInteger(c.milestonesFrom) ||
      c.milestonesFrom < c.excludedThrough ||
      c.milestonesFrom > max ||
      c.expansionFrom === undefined ||
      c.milestonesFrom < c.expansionFrom)
  )
    fail();
  if (
    c.revisionsFrom !== undefined &&
    (!Number.isInteger(c.revisionsFrom) ||
      c.revisionsFrom < c.excludedThrough ||
      c.revisionsFrom > max ||
      c.milestonesFrom === undefined ||
      c.revisionsFrom < c.milestonesFrom)
  )
    fail();
  if (
    c.cfFrom !== undefined &&
    (!Number.isInteger(c.cfFrom) ||
      c.cfFrom < c.excludedThrough ||
      c.cfFrom > max ||
      c.revisionsFrom === undefined ||
      c.cfFrom < c.revisionsFrom)
  )
    fail();
  if (c.baseline !== undefined && c.baseline !== currentAchievementBaseline)
    fail();
  let previous = c.excludedThrough;
  for (const unit of c.units) {
    exact(unit, ['stage', 'position', 'values', 'authorityHash']);
    decodeAchievementEvent(unit);
    if (
      typeof unit.authorityHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(unit.authorityHash) ||
      (mode === 'classic' &&
        (unit.stage === 'floor' ||
          unit.stage === 'final' ||
          (unit.stage !== 'complete' && unit.position >= 15)))
    )
      fail();
    const order = achievementEventOrder(unit);
    if (
      (unit.stage === 'complete' &&
        unit.position !== (mode === 'classic' ? 0 : 1)) ||
      ((unit.stage === 'complete' ||
        (unit.stage === 'room' && unit.values.length >= 6)) &&
        (c.expansionFrom === undefined || order <= c.expansionFrom))
    )
      fail();
    if (
      isMilestoneEvent(unit) &&
      (c.milestonesFrom === undefined || order <= c.milestonesFrom)
    )
      fail();
    if (
      isRevisionEvent(unit) &&
      (c.revisionsFrom === undefined || order <= c.revisionsFrom)
    )
      fail();
    if (isCfEvent(unit) && (c.cfFrom === undefined || order <= c.cfFrom))
      fail();
    if (order <= previous || order > max) fail();
    previous = order;
  }
  return structuredClone(c);
}
export function restoreGrowthContext(
  recorded: unknown,
  expected: GrowthContext,
  currentOrder: number,
): GrowthContext {
  const c = validateGrowthContext(recorded, expected.mode);
  const authorityContext = (v: GrowthContext) => {
    const { profileEpoch: _epoch, ignoredThrough: _ignored, ...rest } = v;
    if (c.expansionFrom === undefined) delete rest.expansionFrom;
    if (c.milestonesFrom === undefined) delete rest.milestonesFrom;
    if (c.revisionsFrom === undefined) delete rest.revisionsFrom;
    if (c.cfFrom === undefined) delete rest.cfFrom;
    if (c.baseline === undefined) delete rest.baseline;
    return { ...rest, acknowledged: 0 };
  };
  if (
    c.excludedThrough > currentOrder ||
    canonicalJson(authorityContext(c)) !==
      canonicalJson(authorityContext(expected))
  )
    fail();
  return c;
}
/** Used only under a coordinated profile write. Reading/importing a checkpoint
 * NEVER invokes it. Missing acknowledged history fails rather than re-awarding. */
export function applyGrowthContext(
  profile: PlayerProfile,
  context: GrowthContext,
  now = new Date(),
) {
  const c = resetLegacyGrowthContext(
    validateGrowthContext(context, context.mode),
  );
  profile = prepareAchievementBaseline(profile, now);
  const batch = createAchievementBatch(profile, now);
  let parent: string | null = null;
  const find = (unit: GrowthUnit) =>
    batch.find({ ...unit, mode: c.mode, root: c.root });
  for (let i = 0; i < c.units.length; i++) {
    const unit = c.units[i]!;
    if (i < (c.ignoredThrough ?? 0)) {
      const known = find(unit);
      if (known) {
        if (!sameAchievementEventFacts(known, unit)) fail();
        parent = known.key;
      }
      continue;
    }
    if (i < c.acknowledged) {
      const receipt = find(unit);
      if (!receipt)
        throw Error('已确认成长凭据不在当前档案中，未重新补发；当前对局保留。');
      if (!sameAchievementEventFacts(receipt, unit)) fail();
      parent = receipt.key;
      continue;
    }
    batch.append({
      source: 'live',
      mode: c.mode,
      root: c.root,
      parent,
      authorityHash: unit.authorityHash,
      event: decodeAchievementEvent(unit),
    });
    parent = find(unit)!.key;
  }
  return {
    profile: batch.finish(),
    context: { ...c, acknowledged: c.units.length },
  };
}
/** Paired-backup consistency only. No activation, counters, replay or writes. */
export function validateGrowthProfilePair(
  profile: PlayerProfile,
  context: GrowthContext,
): void {
  const c = validateGrowthContext(context, context.mode);
  // Legacy files are verified against their original legacy profile first.
  // A cleared current profile makes an unmarked old prefix explicitly excluded.
  const current = hasCurrentAchievementBaseline(profile);
  if (!c.baseline && current) return;
  if (c.baseline && !current) throw Error('成长基线与配套档案不一致。');
  const batch = createAchievementBatch(profile);
  for (const unit of c.units.slice(c.ignoredThrough ?? 0, c.acknowledged)) {
    const receipt = batch.find({ ...unit, mode: c.mode, root: c.root });
    if (!receipt || !sameAchievementEventFacts(receipt, unit))
      throw Error('完整备份的已确认成长凭据与配套档案不一致。');
  }
}
