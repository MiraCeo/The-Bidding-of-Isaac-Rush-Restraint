/** Research only: actual official match/context/profile APIs, no rule overrides. */
import type { CharacterId, ItemId } from '../../game/item-types';
import type { PlayerProfile } from '../player-profile';
import { createPlayerProfile } from '../player-profile';
import type { GrowthContext } from './lifecycle';
import { applyGrowthContext } from './lifecycle';
import {
  projectAchievementRegistry,
  withAchievementVerificationScope,
} from './registry';
import { decodeAchievementEvent } from './event-codec';
import { extractAchievementRoomFacts } from './facts';
import {
  achievementCatalog,
  achievementCharacters,
  type AchievementId,
} from './catalog';
import { achievementSeries } from './series';
import { revision065NewSeries } from './revision065-catalog';
import {
  playAchievementStudy,
  type StudyPolicy,
  type StudyMatch,
} from './difficulty-study.test-helper';

export const currentStudyTime = new Date('2026-10-17T00:00:00.000Z');
export const currentStudyDifficulties = [
  'classic',
  'easy',
  'standard',
  'hard',
  'highest',
] as const;
export type CurrentStudyDifficulty = (typeof currentStudyDifficulties)[number];
export function freshStudyProfile() {
  return createPlayerProfile(currentStudyTime);
}
export function pairedStudySeed(index: number) {
  if (!Number.isSafeInteger(index) || index < 0 || index > 10000)
    throw Error('Invalid seed index');
  return (0x65100000 + Math.imul(index + 1, 7919)) >>> 0;
}
export function blankExposure() {
  return {
    humanRooms: 0,
    tailHeldRooms: 0,
    tailEligibleRooms: 0,
    tailEligibleGroups: 0,
    eternalHeldRooms: 0,
    eternalPositiveRooms: 0,
    eternalMissingEvidenceRooms: 0,
    optionsOfferedRooms: 0,
    optionsVisibleOfferedRooms: 0,
    bossRooms: 0,
    bossQualifiedRooms: 0,
    tailAcquiredCopies: 0,
    eternalAcquiredCopies: 0,
    optionsAcquiredCopies: 0,
  };
}
export type StudyExposure = ReturnType<typeof blankExposure>;
export function runCurrentStudyMatch(
  seed: number,
  role: CharacterId,
  policy: StudyPolicy,
  difficulty: CurrentStudyDifficulty,
) {
  const exposure = blankExposure();
  let context: GrowthContext | undefined;
  const match = playAchievementStudy(seed, role, policy, difficulty, {
    room: (record) => {
      const human = record.playersBefore.find(
        (p) => p.isHuman && p.id === 'human',
      );
      if (!human) throw Error('Research included AI-only room');
      exposure.humanRooms++;
      const owns = (id: ItemId) => human.items.some((i) => i.itemId === id);
      const entitlements = record.entitlements.filter(
        (e) => e.playerId === 'human',
      );
      const tailGroups = owns('guppys_tail')
        ? entitlements.filter(
            (e) =>
              record.room.rewards.find((r) => r.group === e.group)!.itemId !==
              'guppys_tail',
          ).length
        : 0;
      exposure.tailHeldRooms += Number(owns('guppys_tail'));
      exposure.tailEligibleRooms += Number(tailGroups > 0);
      exposure.tailEligibleGroups += tailGroups;
      const facts = extractAchievementRoomFacts(record)!;
      exposure.eternalHeldRooms += Number(owns('eternal_d6'));
      exposure.eternalPositiveRooms += Number(
        owns('eternal_d6') && (facts.scoreBeforeClear ?? 0) > 0,
      );
      exposure.eternalMissingEvidenceRooms += Number(
        owns('eternal_d6') && facts.scoreBeforeClear === undefined,
      );
      const options = (id: ItemId) =>
        id === 'more_options' || id === 'more_options_question';
      exposure.optionsOfferedRooms += Number(
        record.room.rewards.some((r) => options(r.itemId)),
      );
      exposure.optionsVisibleOfferedRooms += Number(
        record.room.rewards.some((r) => !r.hidden && options(r.itemId)),
      );
      exposure.bossRooms += Number(record.room.kind === 'boss');
      exposure.bossQualifiedRooms += Number(
        record.room.kind === 'boss' && entitlements.length > 0,
      );
      for (const award of record.awards.filter((a) => a.playerId === 'human')) {
        if (award.itemId === 'guppys_tail')
          exposure.tailAcquiredCopies += award.copies;
        if (award.itemId === 'eternal_d6')
          exposure.eternalAcquiredCopies += award.copies;
        if (options(award.itemId))
          exposure.optionsAcquiredCopies += award.copies;
      }
    },
    complete: (c) => {
      context = structuredClone(c);
    },
  });
  if (!context || !match.terminal || exposure.humanRooms !== match.humanRooms)
    throw Error('Incomplete current study match');
  const confirmedContext: GrowthContext = context;
  const singleView = withAchievementVerificationScope(() =>
    projectAchievementRegistry(
      applyGrowthContext(
        freshStudyProfile(),
        confirmedContext,
        currentStudyTime,
      ).profile,
    )!,
  );
  if (
    JSON.stringify(Object.keys(singleView.achievedAt).sort()) !==
    JSON.stringify(match.achieved)
  )
    throw Error('Single-game projection changed with the fixed research clock');
  const progress = singleView.progress;
  const causes = Object.fromEntries(
    revision065NewSeries.map((s) => [s.id, 0]),
  ) as Record<string, number>;
  const witnesses: { position: number; ids: string[] }[] = [];
  for (const unit of confirmedContext.units) {
    const e = decodeAchievementEvent(unit);
    if (e.stage !== 'room') continue;
    const ids = revision065NewSeries
      .filter(
        (s) =>
          e.facts[s.metric] &&
          (s.metric !== 'eternalCleared' ||
            (e.facts.scoreBeforeClear ?? 0) > 0),
      )
      .map((s) => s.id);
    for (const id of ids) causes[id]!++;
    if (ids.length) witnesses.push({ position: unit.position, ids });
  }
  for (const series of revision065NewSeries)
    if (progress[series.anchor] !== causes[series.id])
      throw Error('Cause count diverged from production projection');
  return {
    match,
    context: confirmedContext,
    progress,
    exposure,
    causes,
    witnesses,
  };
}
export type CurrentStudyMatch = ReturnType<typeof runCurrentStudyMatch>;
export function advanceStudyProfile(
  profile: PlayerProfile,
  context: GrowthContext,
  index: number,
  checkDuplicate = false,
) {
  return withAchievementVerificationScope(() => {
    const now = new Date(currentStudyTime.getTime() + index * 60000);
    const result = applyGrowthContext(profile, context, now);
    const view = projectAchievementRegistry(result.profile)!;
    if (
      checkDuplicate &&
      applyGrowthContext(result.profile, result.context, now).profile !==
        result.profile
    )
      throw Error('Duplicate study context wrote progress');
    return {
      profile: result.profile,
      progress: view.progress,
      achieved: Object.keys(view.achievedAt) as AchievementId[],
      unlocks: Object.keys(view.characterUnlocks) as CharacterId[],
    };
  });
}
export function availableStudyRoles(profile: PlayerProfile): CharacterId[] {
  const view = projectAchievementRegistry(profile);
  return achievementCharacters.filter(
    (id) => id === 'isaac' || !!view?.characterUnlocks[id],
  );
}
export function studyRate(hits: number, n: number) {
  if (
    !Number.isSafeInteger(n) ||
    !Number.isSafeInteger(hits) ||
    n < 0 ||
    hits < 0 ||
    hits > n
  )
    throw Error('Invalid study rate');
  if (!n) return { hits, n, rate: null, lo95: null, hi95: null };
  const z = 1.96,
    p = hits / n,
    d = 1 + (z * z) / n,
    c = (p + (z * z) / (2 * n)) / d,
    e = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return {
    hits,
    n,
    rate: p,
    lo95: Math.max(0, c - e),
    hi95: Math.min(1, c + e),
  };
}
export interface CurrentStudyRow {
  identity: string;
  cell: string;
  index: number;
  seedIndex: number;
  role: CharacterId;
  match: StudyMatch;
  exposure: StudyExposure;
  causes: Record<string, number>;
  progress: Partial<Record<AchievementId, number>>;
  achieved: AchievementId[];
  campaignProgress: Partial<Record<AchievementId, number>>;
  campaignAchieved: AchievementId[];
  unlocks: CharacterId[];
}
export function summarizeCurrentRows(
  rows: readonly CurrentStudyRow[],
  confidence = true,
) {
  const rate = (hits: number, n: number) => {
    const value = studyRate(hits, n);
    return confidence ? value : { ...value, lo95: null, hi95: null };
  };
  const groups = new Map<string, CurrentStudyRow[]>();
  const identities = new Set<string>();
  for (const row of rows) {
    if (identities.has(row.identity))
      throw Error('Duplicate research identity');
    identities.add(row.identity);
    groups.set(row.cell, [...(groups.get(row.cell) ?? []), row]);
  }
  return [...groups].map(([cell, unsorted]) => {
    const group = [...unsorted].sort((a, b) => a.index - b.index);
    if (group.some((r, i) => r.index !== i + 1))
      throw Error('Campaign has missing or repeated game index');
    if (new Set(group.map((r) => r.match.root)).size !== group.length)
      throw Error('Repeated campaign match root');
    const final = group.at(-1)!;
    return {
      cell,
      n: group.length,
      roles: group.map((r) => r.role),
      champion: rate(
        group.filter((r) => r.match.champion).length,
        group.length,
      ),
      exposure: Object.fromEntries(
        Object.keys(blankExposure()).map((key) => [
          key,
          group.reduce((n, r) => n + r.exposure[key as keyof StudyExposure], 0),
        ]),
      ),
      causes: Object.fromEntries(
        revision065NewSeries.map((s) => [
          s.id,
          group.reduce((n, r) => n + r.causes[s.id]!, 0),
        ]),
      ),
      achievements: Object.fromEntries(
        achievementCatalog.map((a) => {
          const applicable =
            a.scope === 'shared' || a.scope === group[0]!.match.mode;
          return [
            a.id,
            {
              applicable,
              singleGame: rate(
                applicable
                  ? group.filter((r) => r.achieved.includes(a.id)).length
                  : 0,
                applicable ? group.length : 0,
              ),
              firstCampaignGame:
                group.find((r) => r.campaignAchieved.includes(a.id))?.index ??
                null,
              progressAt5:
                group.find((r) => r.index === 5)?.campaignProgress[a.id] ??
                null,
              progressAt10:
                group.find((r) => r.index === 10)?.campaignProgress[a.id] ??
                null,
              progressAt20:
                group.find((r) => r.index === 20)?.campaignProgress[a.id] ??
                null,
              finalProgress: final.campaignProgress[a.id] ?? 0,
              censored: !final.campaignAchieved.includes(a.id),
            },
          ];
        }),
      ),
      unlocks: Object.fromEntries(
        achievementCharacters.map((id) => [
          id,
          id === 'isaac'
            ? 0
            : (group.find((r) => r.unlocks.includes(id))?.index ?? null),
        ]),
      ),
      completeSeries: achievementSeries.filter((s) =>
        s.ids.every((id) => final.campaignAchieved.includes(id)),
      ).length,
    };
  });
}
