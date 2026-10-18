import type { PlayerTurn, ResolvedAction } from '../game/item-types';
import type {
  ActionScoreBreakdown,
  TurnScoreBreakdown,
} from '../game/item-scoring';
import { packPlayerDeltas, unpackPlayerDeltas, type PackedPlayerDeltas } from './player-deltas-codec';
import {
  canonicalJson,
  copySnapshot,
  replayRoomLocator,
  type ReplayLog,
  type ReplayRuleFacts,
} from './replay-record';
import { shortHash } from './game-version';
import {
  fromEventFact,
  toEventFact,
  type EventFact,
} from './replay-event-facts';

type Room = PackedPlayerDeltas['rooms'][number];
type Resolution = Omit<ResolvedAction, 'playerId' | 'actionIndex' | 'action'>;
interface FactTurn extends PlayerTurn {
  resolutions: Resolution[];
}
interface FactScore {
  score?: number;
  actions?: Array<
    Omit<ActionScoreBreakdown, 'playerId' | 'scoringValue'> & {
      scoringValue?: number | null;
    }
  >;
  multiplier?: number;
  cleared?: true;
  triggers?: Array<{ index: number; amount?: number }>;
  retroactiveScore?: number;
  retroactiveMultiplier?: number;
  finalScore?: number;
}
type EventEntry =
  | EventFact
  | { ref: 'cost' | 'score'; playerId: string }
  | { ref: 'award'; index: number };
type FactRoom = Omit<Room, 'seed' | 'entryEvents' | 'settlement'> & {
  entryEvents: EventFact[];
  settlement: Omit<
    Room['settlement'],
    | 'turns'
    | 'resolvedActions'
    | 'scoreBreakdowns'
    | 'roomScoreSummaries'
    | 'events'
  > & {
    turns: FactTurn[];
    scores: Record<string, FactScore>;
    events: EventEntry[];
  };
};
export interface FactsReplay extends Omit<PackedPlayerDeltas, 'encoding' | 'rooms'> {
  encoding: 'settlement-facts-1';
  ruleFacts: ReplayRuleFacts;
  triggerCatalog: Array<{
    itemId: TurnScoreBreakdown['triggers'][number]['itemId'];
    kind: string;
  }>;
  rooms: FactRoom[];
  checksum: string;
}
export function replayRuleFacts(log: ReplayLog): ReplayRuleFacts {
  if (!log.ruleFacts) throw new Error('回放缺少明确的计分参数。');
  return copySnapshot(log.ruleFacts);
}
function fail(): never {
  throw new Error('回放事实记录损坏或参数不一致。');
}
function keys(value: unknown, allowed: string[]): void {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    fail();
}
function withChecksum(payload: Omit<FactsReplay, 'checksum'>): FactsReplay {
  return { ...payload, checksum: shortHash(canonicalJson(payload)) };
}
/** Lossless factual references, not a replay of rules, AI or random draws. */
export function packReplayFacts(log: ReplayLog): FactsReplay {
  const packed = packPlayerDeltas(log);
  const triggerCatalog: FactsReplay['triggerCatalog'] = [];
  function triggerIndex(
    trigger: TurnScoreBreakdown['triggers'][number],
  ): number {
    let index = triggerCatalog.findIndex(
      (t) => t.itemId === trigger.itemId && t.kind === trigger.kind,
    );
    if (index < 0) {
      index = triggerCatalog.length;
      triggerCatalog.push({ itemId: trigger.itemId, kind: trigger.kind });
    }
    return index;
  }
  const rooms = packed.rooms.map((r, roomIndex): FactRoom => {
    const { seed: _seed, entryEvents, settlement: s, ...identity } = r;
    const {
      turns,
      resolvedActions,
      scoreBreakdowns,
      roomScoreSummaries,
      events,
      ...results
    } = s;
    if (
      r.seed !== log.seed ||
      resolvedActions.length !== turns.reduce((n, t) => n + t.actions.length, 0)
    )
      fail();
    const factTurns = turns.map((t) => ({
      ...t,
      resolutions: t.actions.map((action, actionIndex) => {
        const matches = resolvedActions.filter(
          (a) => a.playerId === t.playerId && a.actionIndex === actionIndex,
        );
        if (
          matches.length !== 1 ||
          canonicalJson(matches[0]!.action) !== canonicalJson(action)
        )
          fail();
        const {
          playerId: _id,
          action: _action,
          actionIndex: _index,
          ...resolution
        } = matches[0]!;
        return resolution;
      }),
    }));
    const scores: Record<string, FactScore> = {};
    for (const [playerId, summary] of Object.entries(roomScoreSummaries)) {
      const b = scoreBreakdowns[playerId];
      if (summary.initialScore !== (b?.score ?? 0)) fail();
      const fact: FactScore = b
        ? {
            score: b.score,
            actions: b.actions.map((a) => {
              const resolution = resolvedActions.find(
                (r) =>
                  r.playerId === playerId && r.actionIndex === a.actionIndex,
              );
              if (!resolution || a.playerId !== playerId) fail();
              const { playerId: _id, scoringValue, ...numbers } = a;
              return {
                ...numbers,
                ...(scoringValue === resolution.scoringEquivalent
                  ? {}
                  : { scoringValue }),
              };
            }),
            ...(b.multiplier === 1 ? {} : { multiplier: b.multiplier }),
            ...(b.cleared ? { cleared: true as const } : {}),
            ...(b.triggers.length
              ? {
                  triggers: b.triggers.map((t) => ({
                    index: triggerIndex(t),
                    ...(t.amount === undefined ? {} : { amount: t.amount }),
                  })),
                }
              : {}),
          }
        : {};
      if (summary.retroactiveScore !== 0)
        fact.retroactiveScore = summary.retroactiveScore;
      if (summary.retroactiveMultiplier !== 1)
        fact.retroactiveMultiplier = summary.retroactiveMultiplier;
      if (summary.finalScore !== (b?.score ?? 0))
        fact.finalScore = summary.finalScore;
      if (Object.keys(fact).length) scores[playerId] = fact;
    }
    const factEvents = events.map((e): EventEntry => {
      const fact = toEventFact(e);
      if (fact.reason === 'cost') {
        const amount = resolvedActions
          .filter((a) => a.playerId === e.playerId)
          .reduce((n, a) => n + a.actualCost, 0);
        const expected = {
          type: 'cost' as const,
          playerId: e.playerId,
          amount,
          message: `实际扣款 ${amount}。`,
        };
        if (canonicalJson(expected) === canonicalJson(e))
          return { ref: 'cost', playerId: e.playerId };
      }
      if (fact.reason === 'turn_score') {
        const amount = scoreBreakdowns[e.playerId]?.score;
        const expected = {
          type: 'score' as const,
          playerId: e.playerId,
          amount,
          message: `本房间获得 ${amount} 分。`,
        };
        if (canonicalJson(expected) === canonicalJson(e))
          return { ref: 'score', playerId: e.playerId };
      }
      if (fact.reason === 'award') {
        const index = s.awards.findIndex(
          (a) =>
            a.playerId === e.playerId &&
            a.group === e.group &&
            a.itemId === e.itemId,
        );
        if (
          index >= 0 &&
          canonicalJson(e) ===
            canonicalJson({
              type: 'award',
              playerId: e.playerId,
              group: e.group,
              itemId: e.itemId,
              message: `获得道具 ${e.itemId}。`,
            })
        )
          return { ref: 'award', index };
      }
      return fact;
    });
    return {
      ...identity,
      locator: replayRoomLocator(log, log.rooms[roomIndex]!),
      entryEvents: entryEvents.map(toEventFact),
      settlement: { ...results, turns: factTurns, scores, events: factEvents },
    };
  });
  const { encoding: _encoding, rooms: _rooms, ...identity } = packed;
  return withChecksum({
    ...identity,
    encoding: 'settlement-facts-1',
    ruleFacts: replayRuleFacts(log),
    triggerCatalog,
    rooms,
  });
}
export function unpackReplayFacts(value: unknown): ReplayLog {
  if (!value || typeof value !== 'object') fail();
  const input = value as FactsReplay;
  keys(input, [
    'id',
    'seed',
    'characterId',
    'rulesVersion',
    'classicAi',
    'startedBuild',
    'ruleFacts',
    'playerNames',
    'encoding',
    'items',
    'initialPlayers',
    'rooms',
    'final',
    'triggerCatalog',
    'checksum',
  ]);
  keys(input.ruleFacts, [
    'floorStartingMoney',
    'cooperationRadii',
    'scoreStorageDecimals',
  ]);
  const {
    checksum,
    triggerCatalog,
    encoding,
    rooms: encodedRooms,
    ...identity
  } = input;
  if (
    encoding !== 'settlement-facts-1' ||
    !Array.isArray(triggerCatalog) ||
    triggerCatalog.length > 512 ||
    !Array.isArray(encodedRooms) ||
    encodedRooms.length > 15 ||
    typeof checksum !== 'string' ||
    checksum !==
      shortHash(
        canonicalJson({
          triggerCatalog,
          encoding,
          rooms: encodedRooms,
          ...identity,
        }),
      )
  )
    fail();
  const rooms = encodedRooms.map((r): Room => {
    keys(r, [
      'location',
      'build',
      'source',
      'locator',
      'aiChoices',
      'entryEvents',
      'entryChanges',
      'resultChanges',
      'checkpoint',
      'settlement',
    ]);
    const { entryEvents, settlement: s, ...roomIdentity } = r;
    keys(s, [
      'room',
      'baseline',
      'turns',
      'scores',
      'events',
      'entitlements',
      'awards',
      'cooperationPlacements',
      'highPricePlacements',
      'transcendenceRedemptions',
    ]);
    if (
      !Array.isArray(entryEvents) ||
      entryEvents.length > 2000 ||
      !Array.isArray(s.turns) ||
      s.turns.length > 20 ||
      !Array.isArray(s.events) ||
      s.events.length > 2000 ||
      !s.scores ||
      typeof s.scores !== 'object'
    )
      fail();
    const { scores, events, turns: encodedTurns, ...results } = s;
    const resolvedActions: ResolvedAction[] = [];
    const turns = encodedTurns.map((t) => {
      keys(t, ['playerId', 'actions', 'resolutions']);
      if (
        !Array.isArray(t.actions) ||
        t.actions.length < 1 ||
        t.actions.length > 2 ||
        !Array.isArray(t.resolutions) ||
        t.resolutions.length !== t.actions.length
      )
        fail();
      const { resolutions, ...turn } = t;
      t.actions.forEach((action, actionIndex) =>
        resolvedActions.push({
          ...resolutions[actionIndex]!,
          playerId: t.playerId,
          actionIndex,
          action,
        }),
      );
      return turn;
    });
    const scoreBreakdowns: Room['settlement']['scoreBreakdowns'] = {};
    const roomScoreSummaries: Room['settlement']['roomScoreSummaries'] = {};
    for (const t of turns) {
      const fact = scores[t.playerId] ?? {};
      if (fact.score !== undefined) {
        if (
          !Array.isArray(fact.actions) ||
          fact.actions.length > 2 ||
          (fact.triggers &&
            (!Array.isArray(fact.triggers) || fact.triggers.length > 4000))
        )
          fail();
        scoreBreakdowns[t.playerId] = {
          score: fact.score,
          multiplier: fact.multiplier ?? 1,
          cleared: fact.cleared ?? false,
          actions: fact.actions.map((a) => {
            const resolution = resolvedActions.find(
              (r) =>
                r.playerId === t.playerId && r.actionIndex === a.actionIndex,
            );
            if (!resolution) fail();
            return {
              ...a,
              playerId: t.playerId,
              scoringValue:
                a.scoringValue === undefined
                  ? resolution.scoringEquivalent
                  : a.scoringValue,
            };
          }),
          triggers: (fact.triggers ?? []).map((t) => {
            const definition = triggerCatalog[t.index];
            if (!Number.isInteger(t.index) || !definition) fail();
            return {
              ...definition,
              ...(t.amount === undefined ? {} : { amount: t.amount }),
            };
          }),
        };
      }
      roomScoreSummaries[t.playerId] = {
        initialScore: fact.score ?? 0,
        finalScore: fact.finalScore ?? fact.score ?? 0,
        retroactiveScore: fact.retroactiveScore ?? 0,
        retroactiveMultiplier: fact.retroactiveMultiplier ?? 1,
      };
    }
    const decodedEvents = events.map((e) => {
      if (!('ref' in e)) return fromEventFact(e);
      if (e.ref === 'award') {
        const award = results.awards[e.index];
        if (!Number.isInteger(e.index) || !award) fail();
        return fromEventFact({
          type: 'award',
          reason: 'award',
          playerId: award.playerId,
          group: award.group,
          itemId: award.itemId,
        });
      }
      const amount =
        e.ref === 'cost'
          ? resolvedActions
              .filter((a) => a.playerId === e.playerId)
              .reduce((n, a) => n + a.actualCost, 0)
          : scoreBreakdowns[e.playerId]?.score;
      if ((e.ref !== 'cost' && e.ref !== 'score') || amount === undefined)
        fail();
      return fromEventFact({
        type: e.ref,
        reason: e.ref === 'cost' ? 'cost' : 'turn_score',
        playerId: e.playerId,
        amount,
      });
    });
    return {
      ...roomIdentity,
      seed: input.seed,
      entryEvents: entryEvents.map(fromEventFact),
      settlement: {
        ...results,
        turns,
        resolvedActions,
        scoreBreakdowns,
        roomScoreSummaries,
        events: decodedEvents,
      },
    };
  });
  const log = unpackPlayerDeltas({ ...identity, encoding: 'player-deltas-1', rooms });
  if (canonicalJson(packReplayFacts(log)) !== canonicalJson(input)) fail();
  return log;
}
/** Ignore provenance, generated wording and source locators, but compare every recorded fact. */
export function replayFactsIdentity(log: ReplayLog): string {
  const {
    checksum: _checksum,
    startedBuild: _build,
    ...facts
  } = packReplayFacts(log);
  return canonicalJson({
    ...facts,
    rooms: facts.rooms.map(
      ({ build: _build, source: _source, locator: _locator, ...r }) => r,
    ),
    final: facts.final ? (({ build: _build, ...f }) => f)(facts.final) : null,
  });
}
