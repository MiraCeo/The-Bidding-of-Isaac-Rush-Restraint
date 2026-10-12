import type { ItemInstance, RuntimePlayerState } from '../game/item-types';
import { canonicalJson, copySnapshot, type ReplayLog } from './replay-record';

type PackedPlayer = Omit<RuntimePlayerState, 'items'> & { items: string[] };
type PlayerChange = { id: string; fields: Partial<Omit<PackedPlayer, 'id'>> };
type Room = ReplayLog['rooms'][number];
export interface PackedReplay extends Omit<ReplayLog, 'rooms' | 'final'> {
  encoding: 'player-deltas-1';
  items: Record<string, ItemInstance>;
  initialPlayers: PackedPlayer[];
  rooms: Array<
    Omit<Room, 'previousPlayers' | 'settlement'> & {
      entryChanges: PlayerChange[];
      resultChanges: PlayerChange[];
      checkpoint?: PackedPlayer[];
      settlement: Omit<Room['settlement'], 'playersBefore' | 'players'>;
    }
  >;
  final:
    | (Omit<NonNullable<ReplayLog['final']>, 'players'> & {
        playerChanges: PlayerChange[];
      })
    | null;
}
function invalid(): never {
  throw new Error('回放差分记录损坏。');
}
function changes(
  before: PackedPlayer[],
  after: PackedPlayer[],
): PlayerChange[] {
  if (before.length !== after.length) invalid();
  return after.flatMap((player, i) => {
    const previous = before[i];
    if (!previous || previous.id !== player.id) invalid();
    const fields: PlayerChange['fields'] = {};
    for (const key of Object.keys(player) as Array<keyof PackedPlayer>) {
      if (
        key !== 'id' &&
        canonicalJson(player[key]) !== canonicalJson(previous[key])
      )
        Object.assign(fields, { [key]: player[key] });
    }
    return Object.keys(fields).length ? [{ id: player.id, fields }] : [];
  });
}
function apply(players: PackedPlayer[], delta: PlayerChange[]): PackedPlayer[] {
  if (!Array.isArray(delta) || delta.length > 20) invalid();
  const ids = new Set<string>();
  const next = copySnapshot(players);
  for (const change of delta) {
    if (
      !change ||
      ids.has(change.id) ||
      !change.fields ||
      typeof change.fields !== 'object'
    )
      invalid();
    ids.add(change.id);
    const p = next.find((p) => p.id === change.id);
    if (!p) invalid();
    for (const key of Object.keys(change.fields)) {
      if (key === 'id' || !Object.hasOwn(p, key)) invalid();
    }
    Object.assign(p, copySnapshot(change.fields));
  }
  return next;
}
/** Lossless storage encoding. Scores, events and random outcomes are never recomputed here. */
export function packReplay(log: ReplayLog): PackedReplay {
  const items: Record<string, ItemInstance> = {};
  function pack(players: RuntimePlayerState[]): PackedPlayer[] {
    return players.map((p) => ({
      ...p,
      items: p.items.map((item) => {
        const old = items[item.instanceId];
        if (old && canonicalJson(old) !== canonicalJson(item)) invalid();
        Object.defineProperty(items, item.instanceId, {
          value: copySnapshot(item),
          enumerable: true,
          configurable: true,
        });
        return item.instanceId;
      }),
    }));
  }
  const initialPlayers = pack(log.rooms[0]?.settlement.playersBefore ?? []);
  let previous = initialPlayers;
  const rooms = log.rooms.map((r) => {
    const { previousPlayers: oldPrevious, settlement, ...identity } = r;
    if (
      oldPrevious &&
      canonicalJson(pack(oldPrevious)) !== canonicalJson(previous)
    )
      invalid();
    const { playersBefore, players, ...result } = settlement;
    const entry = pack(playersBefore),
      end = pack(players);
    const encoded = {
      ...identity,
      entryChanges: changes(previous, entry),
      resultChanges: changes(entry, end),
      ...(settlement.room.roomIndex === 0 ? { checkpoint: entry } : {}),
      settlement: result,
    };
    previous = end;
    return encoded;
  });
  const final = log.final
    ? (() => {
        const { players, ...result } = log.final;
        return { ...result, playerChanges: changes(previous, pack(players)) };
      })()
    : null;
  return {
    ...log,
    encoding: 'player-deltas-1',
    items,
    initialPlayers,
    rooms,
    final,
  };
}
export function unpackReplay(value: unknown): ReplayLog {
  if (!value || typeof value !== 'object') invalid();
  const input = value as PackedReplay;
  if (
    input.encoding !== 'player-deltas-1' ||
    !input.items ||
    !Array.isArray(input.initialPlayers) ||
    input.initialPlayers.length > 20 ||
    !Array.isArray(input.rooms) ||
    input.rooms.length > 15
  )
    invalid();
  function unpack(players: PackedPlayer[]): RuntimePlayerState[] {
    if (new Set(players.map((p) => p.id)).size !== players.length) invalid();
    return players.map((p) => {
      if (!Array.isArray(p.items) || p.items.length > 2000) invalid();
      return {
        ...p,
        items: p.items.map((id) => {
          if (
            !Object.hasOwn(input.items, id) ||
            input.items[id]?.instanceId !== id
          )
            invalid();
          return copySnapshot(input.items[id]!);
        }),
      };
    });
  }
  let previous = copySnapshot(input.initialPlayers);
  const rooms = input.rooms.map((r, i) => {
    const { entryChanges, resultChanges, checkpoint, settlement, ...identity } =
      r;
    const entry = apply(previous, entryChanges);
    if (checkpoint && canonicalJson(checkpoint) !== canonicalJson(entry))
      invalid();
    const end = apply(entry, resultChanges);
    const decoded: Room = {
      ...identity,
      previousPlayers: i ? unpack(previous) : null,
      settlement: {
        ...settlement,
        playersBefore: unpack(entry),
        players: unpack(end),
      },
    };
    previous = end;
    return decoded;
  });
  const final = input.final
    ? (() => {
        const { playerChanges, ...result } = input.final;
        return { ...result, players: unpack(apply(previous, playerChanges)) };
      })()
    : null;
  const {
    encoding: _encoding,
    items: _items,
    initialPlayers: _initial,
    ...identity
  } = input;
  const log: ReplayLog = { ...identity, rooms, final };
  // Reject unused dictionaries, extra fields, missing checkpoints and noncanonical/no-op deltas.
  if (canonicalJson(packReplay(log)) !== canonicalJson(input)) invalid();
  return log;
}
