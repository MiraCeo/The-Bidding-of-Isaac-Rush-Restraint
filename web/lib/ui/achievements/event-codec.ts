import { canonicalJson } from '../../shared/json-facts';
import { achievementCharacters } from './catalog';
import type {
  AchievementEntryFacts,
  AchievementCompletionFacts,
  AchievementRoomFacts,
  AchievementFloorFacts,
  AchievementFinalFacts,
} from './facts';
import type { AchievementRunAnalysis } from './evaluation';

export type AchievementEvent =
  | { stage: 'entry'; facts: AchievementEntryFacts }
  | { stage: 'room'; facts: AchievementRoomFacts }
  | { stage: 'floor'; facts: AchievementFloorFacts }
  | { stage: 'final'; facts: AchievementFinalFacts }
  | { stage: 'complete'; facts: AchievementCompletionFacts };
export type AchievementStage = AchievementEvent['stage'];
export interface EncodedAchievementEvent {
  stage: AchievementStage;
  position: number;
  values: (number | null)[];
}
const roomFlags = [
  'cooperativeAward',
  'optionsDestroyed',
  'watchedVacancy',
  'causedVacancy',
  'shieldRefunded',
  'transcendenceRedeemed',
  'tailDestroyed',
  'tailDuplicated',
  'd6Doubled',
  'eternalCleared',
  'babylonCleared',
  'saleSaved',
  'poorCharmBoosted',
  'luckyFootNecessaryAward',
  'allInBid',
  'optionsAwarded',
  'bossAwarded',
  'brimstoneAwarded',
] as const;
function fail(): never {
  throw Error('成长结算事实损坏或字段不支持，原资料保留。');
}
function int(v: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > max)
    fail();
  return v;
}
function bool(v: unknown): boolean {
  if (typeof v !== 'boolean') fail();
  return v;
}
export function encodeAchievementEvent(
  event: AchievementEvent,
): EncodedAchievementEvent {
  const f = event.facts;
  let encoded: EncodedAchievementEvent;
  if (event.stage === 'entry') {
    const e = event.facts;
    encoded = {
      stage: event.stage,
      position: int(e.floorIndex, 6) * 5 + int(e.roomIndex, 4),
      values: [
        int(e.stolenMoney),
        int(e.interestMoney),
        ...(e.milestones === true ? [1] : []),
      ],
    };
  } else if (event.stage === 'room') {
    const e = event.facts;
    if (!Array.isArray(e.bidSuccesses) || e.bidSuccesses.length > 2) fail();
    e.bidSuccesses.forEach(bool);
    const bid =
      e.bidSuccesses.length === 0
        ? 0
        : e.bidSuccesses.length === 1
          ? e.bidSuccesses[0]
            ? 2
            : 1
          : 3 + Number(e.bidSuccesses[0]) * 2 + Number(e.bidSuccesses[1]);
    const mask = roomFlags.reduce(
      (m, key, i) => m + (bool(e[key]) ? 2 ** i : 0),
      0,
    );
    encoded = {
      stage: event.stage,
      position: int(e.floorIndex, 6) * 5 + int(e.roomIndex, 4),
      values: [
        bid,
        mask,
        int(e.highestAwardOpportunities, 2),
        int(e.hiddenAwardCopies, 4),
        e.scoreBeforeClear ?? null,
        ...(e.missedCooperation !== undefined || e.missedHighPrice !== undefined
          ? [
              Number(bool(e.missedCooperation)) +
                2 * Number(bool(e.missedHighPrice)),
            ]
          : []),
        ...(e.milestoneFlags !== undefined || e.saleSavings !== undefined
          ? [int(e.milestoneFlags, 63), int(e.saleSavings)]
          : []),
      ],
    };
  } else if (event.stage === 'floor') {
    const e = event.facts;
    encoded = {
      stage: event.stage,
      position: int(e.floorIndex, 6),
      values: [
        Number(bool(e.humanParticipated)) +
          Number(bool(e.humanSurvived)) * 2 +
          Number(bool(e.humanEliminated)) * 4 +
          Number(bool(e.lowestSurvivor)) * 8,
        ...(e.milestones === true ? [1] : []),
      ],
    };
  } else if (event.stage === 'final') {
    const e = event.facts;
    encoded = {
      stage: event.stage,
      position: int(e.lastEliminationFloor, 6),
      values: [
        Number(bool(e.humanSurvived)),
        Number(bool(e.highestDifficulty)),
        e.humanEliminationFloor,
        ...(e.milestones === true ? [1] : []),
      ],
    };
  } else if (event.stage === 'complete') {
    const e = event.facts;
    if (e.mode !== 'classic' && e.mode !== 'survival') fail();
    encoded = {
      stage: 'complete',
      position: e.mode === 'classic' ? 0 : 1,
      values: [
        int(achievementCharacters.indexOf(e.characterId), 4),
        Number(bool(e.champion)),
        ...(e.milestones === true ? [1] : []),
      ],
    };
  } else {
    void f;
    fail();
  }
  // A single validator is used for both fresh facts and persisted compact facts.
  decodeAchievementEvent(encoded);
  return encoded;
}
export function decodeAchievementEvent(
  encoded: EncodedAchievementEvent,
): AchievementEvent {
  if (!encoded || !Array.isArray(encoded.values)) fail();
  const v = encoded.values,
    p = encoded.position;
  const floorIndex = Math.floor(int(p, 34) / 5),
    roomIndex = p % 5;
  if (encoded.stage === 'entry') {
    if (v.length !== 2 && v.length !== 3) fail();
    if (v.length === 3 && v[2] !== 1) fail();
    return {
      stage: 'entry',
      facts: {
        floorIndex,
        roomIndex,
        ...(v.length === 3 ? { milestones: true as const } : {}),
        stolenMoney: int(v[0]),
        interestMoney: int(v[1]),
      },
    };
  }
  if (encoded.stage === 'room') {
    if (![5, 6, 8].includes(v.length)) fail();
    const code = int(v[0], 6),
      mask = int(v[1], 2 ** roomFlags.length - 1),
      score = v[4];
    if (
      score !== null &&
      (typeof score !== 'number' ||
        !Number.isFinite(score) ||
        score < 0 ||
        !Number.isSafeInteger(Math.round(score * 10000)) ||
        Math.round(score * 10000) / 10000 !== score)
    )
      fail();
    const bidSuccesses =
      code === 0
        ? []
        : code < 3
          ? [code === 2]
          : [code >= 5, (code - 3) % 2 === 1];
    if (
      v.length >= 6 &&
      int(v[5], 3) > 0 &&
      !bidSuccesses.some((success) => !success)
    )
      fail();
    if (v.length === 8) {
      const extra = int(v[6], 63),
        savings = int(v[7]);
      if (extra & 51 && !bidSuccesses.some(Boolean)) fail();
      if (extra & 1 && !v[2]) fail();
      if (extra & 2 && !(mask & 1)) fail();
      if (extra & 4 && !(mask & (2 ** 5))) fail();
      if (extra & 8 && (!(mask & (2 ** 3)) || code !== 0)) fail();
      if (extra & 16 && !(mask & (2 ** 14))) fail();
      if (
        extra & 32 &&
        (bidSuccesses.length !== 2 || !bidSuccesses.some(Boolean))
      )
        fail();
      if (savings > 0 !== !!(mask & (2 ** 11))) fail();
    }
    const flags = Object.fromEntries(
      roomFlags.map((key, i) => [key, (mask & (2 ** i)) !== 0]),
    ) as Pick<AchievementRoomFacts, (typeof roomFlags)[number]>;
    return {
      stage: 'room',
      facts: {
        floorIndex,
        roomIndex,
        bidSuccesses,
        ...flags,
        ...(v.length >= 6
          ? {
              missedCooperation: (int(v[5], 3) & 1) !== 0,
              missedHighPrice: (int(v[5], 3) & 2) !== 0,
            }
          : {}),
        ...(v.length === 8
          ? { milestoneFlags: int(v[6], 63), saleSavings: int(v[7]) }
          : {}),
        highestAwardOpportunities: int(v[2], 2),
        hiddenAwardCopies: int(v[3], 4),
        ...(score === null ? {} : { scoreBeforeClear: score }),
      },
    };
  }
  if (encoded.stage === 'floor') {
    int(p, 6);
    if (v.length !== 1 && v.length !== 2) fail();
    if (v.length === 2 && v[1] !== 1) fail();
    const mask = int(v[0], 15),
      humanParticipated = !!(mask & 1),
      humanSurvived = !!(mask & 2),
      humanEliminated = !!(mask & 4),
      lowestSurvivor = !!(mask & 8);
    if (
      humanParticipated
        ? humanSurvived === humanEliminated
        : humanSurvived || humanEliminated || lowestSurvivor
    )
      fail();
    if (lowestSurvivor && !humanSurvived) fail();
    return {
      stage: 'floor',
      facts: {
        floorIndex: p,
        ...(v.length === 2 ? { milestones: true as const } : {}),
        humanParticipated,
        humanSurvived,
        humanEliminated,
        lowestSurvivor,
      },
    };
  }
  if (encoded.stage === 'final') {
    int(p, 6);
    if (v.length !== 3 && v.length !== 4) fail();
    if (v.length === 4 && v[3] !== 1) fail();
    const humanSurvived = int(v[0], 1) === 1,
      highestDifficulty = int(v[1], 1) === 1;
    const humanEliminationFloor = v[2] === null ? null : int(v[2], p);
    if (humanSurvived !== (humanEliminationFloor === null)) fail();
    return {
      stage: 'final',
      facts: {
        ...(v.length === 4 ? { milestones: true as const } : {}),
        humanSurvived,
        highestDifficulty,
        lastEliminationFloor: p,
        humanEliminationFloor,
      },
    };
  }
  if (encoded.stage === 'complete') {
    int(p, 1);
    if (v.length !== 2 && v.length !== 3) fail();
    if (v.length === 3 && v[2] !== 1) fail();
    return {
      stage: 'complete',
      facts: {
        ...(v.length === 3 ? { milestones: true as const } : {}),
        mode: p === 0 ? 'classic' : 'survival',
        characterId: achievementCharacters[int(v[0], 4)]!,
        champion: int(v[1], 1) === 1,
      },
    };
  }
  fail();
}
export function achievementEventOrder(e: EncodedAchievementEvent): number {
  decodeAchievementEvent(e);
  if (e.stage === 'complete') return e.position === 0 ? 34 : 78;
  return e.stage === 'entry' || e.stage === 'room'
    ? Math.floor(e.position / 5) * 11 +
        (e.position % 5) * 2 +
        Number(e.stage === 'room')
    : e.position * 11 + (e.stage === 'floor' ? 10 : 11);
}
export function eventRunAnalysis(
  mode: 'classic' | 'survival',
  encoded: EncodedAchievementEvent,
): AchievementRunAnalysis {
  const event = decodeAchievementEvent(encoded);
  const input: AchievementRunAnalysis = {
    mode,
    source: 'formal',
    entries: [],
    rooms: [],
    floors: [],
  };
  if (event.stage === 'entry')
    input.entries = [{ eligible: true, facts: event.facts }];
  if (event.stage === 'room')
    input.rooms = [{ eligible: true, facts: event.facts }];
  if (event.stage === 'floor')
    input.floors = [{ eligible: true, facts: event.facts }];
  if (event.stage === 'complete') {
    if (event.facts.mode !== mode) fail();
    input.complete = { eligible: true, facts: event.facts };
  }
  if (event.stage === 'final')
    input.final = { eligible: true, facts: event.facts };
  return input;
}

/** A legacy room proof lacks new-catalog causes. Treat it as the same already
 * recorded authority unit, never enrich it retroactively or overwrite its time.
 * Two expanded proofs must still agree on every cause bit. */
export function sameAchievementEventFacts(
  a: EncodedAchievementEvent,
  b: EncodedAchievementEvent,
): boolean {
  if (a.stage !== b.stage || a.position !== b.position) return false;
  const base =
    a.stage === 'room'
      ? 5
      : a.stage === 'floor'
        ? 1
        : a.stage === 'final'
          ? 3
          : 2;
  let comparable = Math.min(a.values.length, b.values.length);
  if (a.stage === 'room')
    comparable = comparable >= 8 ? 8 : comparable >= 6 ? 6 : base;
  return (
    canonicalJson(a.values.slice(0, comparable)) ===
    canonicalJson(b.values.slice(0, comparable))
  );
}
export function isMilestoneEvent(
  e: Pick<EncodedAchievementEvent, 'stage' | 'values'>,
): boolean {
  return (
    e.values.length ===
    (e.stage === 'room'
      ? 8
      : e.stage === 'floor'
        ? 2
        : e.stage === 'final'
          ? 4
          : 3)
  );
}
