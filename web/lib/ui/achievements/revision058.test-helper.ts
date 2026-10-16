import { appendAchievementEvent, readAchievementRegistry } from './registry';
import {
  decodeAchievementEvent,
  type EncodedAchievementEvent,
} from './event-codec';
import type { PlayerProfile } from '../player-profile';
import { sha256Hex } from '../../shared/sha256';
export const cfNow = new Date('2026-10-16T06:00:00.000Z');
let serial = 0;
export function appendCf(
  p: PlayerProfile,
  event: EncodedAchievementEvent,
  o: {
    root?: string;
    parent?: string | null;
    mode?: 'classic' | 'survival';
    authority?: string;
    source?: 'live' | 'historical' | 'read-only' | 'tutorial';
  } = {},
) {
  const n = serial++;
  return appendAchievementEvent(
    p,
    {
      source: o.source ?? 'live',
      mode: o.mode ?? 'classic',
      root: sha256Hex(o.root ?? 'cf-root-' + n),
      parent: o.parent ?? null,
      authorityHash: sha256Hex(o.authority ?? 'cf-authority-' + n),
      event: decodeAchievementEvent(event),
    },
    cfNow,
  );
}
export const cfLast = (p: PlayerProfile) =>
  readAchievementRegistry(p)!.receipts.at(-1)!.key;
export const cfEntry: EncodedAchievementEvent = {
  stage: 'entry',
  position: 0,
  values: [0, 0, 1, 1, 1],
};
export function cfRoom(
  position = 0,
  o: {
    code?: number;
    mask?: number;
    highest?: number;
    copies?: number;
    flags?: number;
    savings?: number;
    revision?: number[];
    counts?: [number, number, number];
    old?: boolean;
  } = {},
): EncodedAchievementEvent {
  return {
    stage: 'room',
    position,
    values: [
      o.code ?? 0,
      o.mask ?? 0,
      o.highest ?? 0,
      o.copies ?? 0,
      null,
      0,
      o.flags ?? 0,
      o.savings ?? 0,
      ...(o.revision ?? [0, 0, 0, 0, 0, 0]),
      ...(o.old ? [] : (o.counts ?? [0, 0, 0])),
    ],
  };
}
export const cfFloor = (
  position: number,
  mask = 3,
): EncodedAchievementEvent => ({
  stage: 'floor',
  position,
  values: [mask, 1, 1, 1],
});
