import type { ReplayLog } from './replay-record';
import type { SurvivalReplayLog } from './survival-record';
import { replayFactsIdentity } from './replay-facts-codec';
import { survivalReplayFactIdentity } from './survival-view-model';
import { sha256Hex } from '../shared/sha256';

/** Same survival identity projection as library1. Only unrounded knife explanation tails
 * are normalized; stored payloads and all authoritative scores remain exact. */
export function survivalCompletionFacts(log: SurvivalReplayLog): string {
  return survivalReplayFactIdentity({
    ...log,
    rooms: log.rooms.map((room) => ({
      ...room,
      scoreBreakdowns: Object.fromEntries(
        Object.entries(room.scoreBreakdowns).map(([id, breakdown]) => [
          id,
          {
            ...breakdown,
            triggers: breakdown.triggers.map((trigger) =>
              trigger.itemId === 'moms_knife' &&
              trigger.kind === 'additive_score' &&
              trigger.amount !== undefined
                ? { ...trigger, amount: Number(trigger.amount.toFixed(8)) }
                : trigger,
            ),
          },
        ]),
      ),
    })),
  });
}
/** Registration-only classic projection. Library1's already-stored classic keys
 * remain exact; the classic checkpoint metadata protocol is not changed here. */
export function classicCompletionFacts(log: ReplayLog): string {
  return replayFactsIdentity({
    ...log,
    rooms: log.rooms.map((room) => ({
      ...room,
      settlement: {
        ...room.settlement,
        scoreBreakdowns: Object.fromEntries(
          Object.entries(room.settlement.scoreBreakdowns).map(
            ([id, breakdown]) => [
              id,
              {
                ...breakdown,
                triggers: breakdown.triggers.map((trigger) =>
                  trigger.itemId === 'moms_knife' &&
                  trigger.kind === 'additive_score' &&
                  trigger.amount !== undefined
                    ? { ...trigger, amount: Number(trigger.amount.toFixed(8)) }
                    : trigger,
                ),
              },
            ],
          ),
        ),
      },
    })),
  });
}
export function classicCompletionKey(log: ReplayLog) {
  return `classic/${sha256Hex(classicCompletionFacts(log))}`;
}
export function normalizedSurvivalCompletionKey(log: SurvivalReplayLog) {
  return `survival/${sha256Hex(survivalCompletionFacts(log))}`;
}
export function oldSurvivalCompletionKey(log: SurvivalReplayLog) {
  return `${log.id}/${sha256Hex(survivalReplayFactIdentity(log))}`;
}
