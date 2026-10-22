import type { RewardGroup } from './types';
export interface RoomNearMissEvidence {
  group: RewardGroup;
  cooperationLost: boolean;
  nextHighPrice: boolean;
}
const evidence = new WeakMap<object, readonly RoomNearMissEvidence[]>();
/** Non-enumerable observational sidecar; never changes ranking, RNG or file facts. */
export function rememberRoomNearMissEvidence(
  key: object,
  facts: RoomNearMissEvidence[],
) {
  evidence.set(
    key,
    facts.map((f) => Object.freeze({ ...f })),
  );
}
export function readRoomNearMissEvidence(key: object) {
  return evidence.get(key)?.map((f) => ({ ...f }));
}
