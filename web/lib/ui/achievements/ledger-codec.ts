import { isMilestoneEvent, isRevisionEvent, isCfEvent } from './event-codec';
import type { AchievementReceipt, AchievementRegistry } from './registry';
import { canonicalJson } from '../../shared/json-facts';
import { sha256Hex } from '../../shared/sha256';

export const packedAchievementReceiptLimit = 16384;
export const packedAchievementChunkSize = 8192;
export interface PackedAchievementRegistry {
  version: 2 | 3 | 4 | 5 | 6 | 7;
  catalogVersion: 1 | 2 | 3 | 4 | 5 | 6;
  activatedAt: string;
  manualUnlockAllAt: string | null;
  milestones?: { from: number; at: string };
  revisions?: { from: number; at: string };
  cf?: { from: number; at: string };
  stages?: { from: number; at: string };
  count: number;
  roots: [0 | 1, string][];
  data: string[];
}
function fail(): never {
  throw Error('成就成长模块损坏、版本不支持或容量超限，原档案保留。');
}
export function achievementReceiptKey(
  r: Omit<AchievementReceipt, 'key' | 'at'>,
) {
  return sha256Hex(
    canonicalJson([
      r.mode,
      r.root,
      r.parent,
      r.authorityHash,
      r.stage,
      r.position,
    ]),
  );
}
function base64(bytes: number[] | Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function unbase64(value: unknown): Uint8Array {
  if (
    typeof value !== 'string' ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    fail();
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  } catch {
    return fail();
  }
  if (base64(bytes) !== value) fail();
  return bytes;
}
function hashBytes(hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) fail();
  return Array.from({ length: 32 }, (_, i) =>
    parseInt(hash.slice(i * 2, i * 2 + 2), 16),
  );
}
function hex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
const stages = ['entry', 'room', 'floor', 'final', 'complete'] as const;
export function isExpandedAchievementEvent(
  r: Pick<AchievementReceipt, 'stage' | 'values'>,
) {
  return (
    r.stage === 'complete' ||
    (r.stage === 'room' && r.values.length >= 6) ||
    isMilestoneEvent(r)
  );
}
/** Lossless wire encoding only. Semantic validation and achievement evaluation
 * remain in registry.ts; all hashes are kept at the full 256-bit width. */
export function packAchievementRegistry(
  registry: AchievementRegistry,
  forceExpanded = false,
): PackedAchievementRegistry {
  const v7 = !!registry.stages;
  const v6 = !!registry.cf;
  if (v7 && !v6) fail();
  const v5 = !!registry.revisions;
  if ((v6 && !v5) || (!v6 && registry.receipts.some(isCfEvent))) fail();
  const v4 = !!registry.milestones;
  if ((v5 && !v4) || (!v5 && registry.receipts.some(isRevisionEvent))) fail();
  if (!v4 && registry.receipts.some(isMilestoneEvent)) fail();
  const expanded =
    forceExpanded || registry.receipts.some(isExpandedAchievementEvent);
  if (registry.receipts.length > packedAchievementReceiptLimit) fail();
  const roots: PackedAchievementRegistry['roots'] = [],
    rootIndices = new Map<string, number>(),
    nodes = new Map<string, number>(),
    bytes: number[] = [];
  const uint = (n: number) => {
    if (!Number.isSafeInteger(n) || n < 0) fail();
    do {
      const low = n % 128;
      n = Math.floor(n / 128);
      bytes.push(low + (n ? 128 : 0));
    } while (n);
  };
  let time = Date.parse(registry.activatedAt);
  for (const r of registry.receipts) {
    const identity = `${r.mode}/${r.root}`;
    let root = rootIndices.get(identity);
    if (root === undefined) {
      root = roots.length;
      roots.push([r.mode === 'classic' ? 0 : 1, base64(hashBytes(r.root))]);
      rootIndices.set(identity, root);
    }
    uint(root);
    const parent = r.parent === null ? 0 : nodes.get(r.parent);
    if (parent === undefined) fail();
    uint(parent);
    bytes.push(stages.indexOf(r.stage), r.position);
    const next = Date.parse(r.at),
      delta = next - time;
    uint(delta < 0 ? -delta * 2 - 1 : delta * 2);
    time = next;
    bytes.push(...hashBytes(r.authorityHash));
    const v = r.values;
    if (r.stage === 'room') {
      for (const n of v.slice(0, 4)) uint(n!);
      uint(v[4] === null ? 0 : 1);
      if (v[4] !== null) uint(Math.round(v[4]! * 10000));
      if (expanded) uint(v.length >= 6 ? v[5]! + 1 : 0);
    } else if (r.stage === 'final') {
      uint(v[0]!);
      uint(v[1]!);
      uint(v[2] === null ? 0 : v[2]! + 1);
    } else for (const n of v.slice(0, r.stage === 'floor' ? 1 : 2)) uint(n!);
    if (v4) {
      uint(isMilestoneEvent(r) ? 1 : 0);
      if (r.stage === 'room' && isMilestoneEvent(r)) {
        uint(v[6]!);
        uint(v[7]!);
      }
    }
    if (v5) {
      uint(isRevisionEvent(r) ? 1 : 0);
      if (isRevisionEvent(r)) {
        if (r.stage === 'room') for (const n of v.slice(8, 14)) uint(n!);
        else if (r.stage === 'complete') uint(v[3]!);
      }
    }
    if (v6) {
      uint(isCfEvent(r) ? 1 : 0);
      if (isCfEvent(r) && r.stage === 'room')
        for (const n of v.slice(14)) uint(n!);
    }
    nodes.set(r.key, nodes.size + 1);
  }
  const encoded = base64(bytes),
    data: string[] = [];
  for (let i = 0; i < encoded.length; i += packedAchievementChunkSize)
    data.push(encoded.slice(i, i + packedAchievementChunkSize));
  return {
    version: v7 ? 7 : v6 ? 6 : v5 ? 5 : v4 ? 4 : expanded ? 3 : 2,
    catalogVersion: v7 ? 6 : v6 ? 5 : v5 ? 4 : v4 ? 3 : expanded ? 2 : 1,
    ...(registry.milestones ? { milestones: { ...registry.milestones } } : {}),
    ...(registry.revisions ? { revisions: { ...registry.revisions } } : {}),
    ...(registry.cf ? { cf: { ...registry.cf } } : {}),
    ...(registry.stages ? { stages: { ...registry.stages } } : {}),
    activatedAt: registry.activatedAt,
    manualUnlockAllAt: registry.manualUnlockAllAt,
    count: registry.receipts.length,
    roots,
    data,
  };
}
/** Call only after envelope/byte/date validation. Bounds and canonical encodings
 * are checked before allocating receipt objects, followed by full semantic scan. */
export function unpackAchievementRegistry(
  value: PackedAchievementRegistry,
): AchievementRegistry {
  if (
    !(
      (value.version === 2 && value.catalogVersion === 1) ||
      (value.version === 3 && value.catalogVersion === 2) ||
      (value.version === 4 && value.catalogVersion === 3) ||
      (value.version === 5 && value.catalogVersion === 4) ||
      (value.version === 6 && value.catalogVersion === 5) ||
      (value.version === 7 && value.catalogVersion === 6)
    )
  )
    fail();
  if (
    !Number.isSafeInteger(value.count) ||
    value.count < 0 ||
    value.count > packedAchievementReceiptLimit ||
    !Array.isArray(value.roots) ||
    value.roots.length > value.count ||
    !Array.isArray(value.data) ||
    value.data.length > 112
  )
    fail();
  const roots = value.roots.map((r) => {
    if (!Array.isArray(r) || r.length !== 2 || (r[0] !== 0 && r[0] !== 1))
      fail();
    const bytes = unbase64(r[1]);
    if (bytes.length !== 32) fail();
    return {
      mode: r[0] === 0 ? ('classic' as const) : ('survival' as const),
      root: hex(bytes),
    };
  });
  if (new Set(roots.map((r) => `${r.mode}/${r.root}`)).size !== roots.length)
    fail();
  for (const [i, chunk] of value.data.entries()) {
    if (
      typeof chunk !== 'string' ||
      !chunk.length ||
      chunk.length > packedAchievementChunkSize ||
      (i < value.data.length - 1 && chunk.length !== packedAchievementChunkSize)
    )
      fail();
  }
  const bytes = unbase64(value.data.join(''));
  let offset = 0,
    time = Date.parse(value.activatedAt),
    nextRoot = 0;
  const byte = () => {
    if (offset >= bytes.length) fail();
    return bytes[offset++]!;
  };
  const uint = () => {
    let n = 0,
      factor = 1;
    for (let i = 0; i < 8; i++) {
      const b = byte();
      n += (b % 128) * factor;
      if (!Number.isSafeInteger(n)) fail();
      if (b < 128) {
        if (i && b === 0) fail();
        return n;
      }
      factor *= 128;
    }
    return fail();
  };
  const receipts: AchievementReceipt[] = [];
  for (let i = 0; i < value.count; i++) {
    const rootIndex = uint(),
      parentIndex = uint();
    if (rootIndex >= roots.length || rootIndex > nextRoot || parentIndex > i)
      fail();
    if (rootIndex === nextRoot) nextRoot++;
    const stage = stages[byte()],
      position = byte(),
      delta = uint();
    if (!stage || (stage === 'complete' && value.version < 3)) fail();
    time += delta % 2 ? -(delta + 1) / 2 : delta / 2;
    if (
      !Number.isSafeInteger(time) ||
      time < -62167219200000 ||
      time > 253402300799999
    )
      fail();
    if (offset + 32 > bytes.length) fail();
    const authorityHash = hex(bytes.subarray(offset, offset + 32));
    offset += 32;
    let values: (number | null)[];
    if (stage === 'entry' || stage === 'complete') values = [uint(), uint()];
    else if (stage === 'floor') values = [uint()];
    else if (stage === 'final') {
      values = [uint(), uint()];
      const eliminated = uint();
      values.push(eliminated === 0 ? null : eliminated - 1);
    } else {
      values = [uint(), uint(), uint(), uint()];
      const present = uint();
      if (present > 1) fail();
      values.push(present ? uint() / 10000 : null);
      if (value.version >= 3) {
        const code = uint();
        if (code > 4) fail();
        if (code) values.push(code - 1);
      }
    }
    if (value.version >= 4) {
      const present = uint();
      if (present > 1) fail();
      if (present) {
        if (stage === 'room') {
          if (values.length !== 6) fail();
          values.push(uint(), uint());
        } else values.push(1);
      }
    }
    if (value.version >= 5) {
      const present = uint();
      if (present > 1) fail();
      if (present) {
        if (stage === 'room') {
          if (values.length !== 8) fail();
          values.push(uint(), uint(), uint(), uint(), uint(), uint());
        } else if (stage === 'complete') {
          if (values.length !== 3) fail();
          values.push(uint());
        } else {
          const oldLength = stage === 'entry' ? 3 : stage === 'floor' ? 2 : 4;
          if (values.length !== oldLength) fail();
          values.push(1);
        }
      }
    }
    if (value.version >= 6) {
      const present = uint();
      if (present > 1) fail();
      if (present) {
        const priorLength =
          stage === 'room'
            ? 14
            : stage === 'entry' || stage === 'complete'
              ? 4
              : stage === 'floor'
                ? 3
                : 5;
        if (values.length !== priorLength) fail();
        if (stage === 'room') values.push(uint(), uint(), uint());
        else values.push(1);
      }
    }
    const candidate = {
      ...roots[rootIndex]!,
      stage,
      position,
      values,
      parent: parentIndex === 0 ? null : receipts[parentIndex - 1]!.key,
      authorityHash,
      at: new Date(time).toISOString(),
    };
    receipts.push({ ...candidate, key: achievementReceiptKey(candidate) });
  }
  if (offset !== bytes.length || nextRoot !== roots.length) fail();
  return {
    version: 1,
    catalogVersion: 1,
    activatedAt: value.activatedAt,
    manualUnlockAllAt: value.manualUnlockAllAt,
    receipts,
    ...(value.version >= 4 ? { milestones: value.milestones } : {}),
    ...(value.version >= 5 ? { revisions: value.revisions } : {}),
    ...(value.version >= 6 ? { cf: value.cf } : {}),
    ...(value.version === 7 ? { stages: value.stages } : {}),
  };
}
