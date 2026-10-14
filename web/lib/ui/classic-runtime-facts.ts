import type { TurnScoreBreakdown } from '../game/item-scoring';
import {
  canonicalJson,
  copySnapshot,
  replayRoomLocator,
  type ReplayLog,
  type ReplayRoomRecord,
} from './replay-record';

// Math.exp explanation tails only. Never apply this to stored scores, amounts,
// multipliers, actions, balances, AI choices or arbitrary numeric fields.
const view = new DataView(new ArrayBuffer(8));
function bits(n: number) {
  view.setFloat64(0, n);
  return view.getBigUint64(0);
}
function value(n: bigint) {
  view.setBigUint64(0, n);
  return view.getFloat64(0);
}
export function adjacentKnifeExplanation(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0)
    return false;
  const delta = bits(a) - bits(b);
  return delta >= -2n && delta <= 2n;
}
function object(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
export function preserveKnifeExplanationTails<
  T extends { scoreBreakdowns: Record<string, TurnScoreBreakdown> },
>(expected: T, incoming: unknown): T {
  const result = copySnapshot(expected),
    source = object(object(incoming).scoreBreakdowns);
  for (const [id, b] of Object.entries(result.scoreBreakdowns)) {
    const triggers = object(source[id]).triggers;
    b.triggers.forEach((t, i) => {
      if (
        t.itemId !== 'moms_knife' ||
        t.kind !== 'additive_score' ||
        t.amount === undefined
      )
        return;
      const actual = object(Array.isArray(triggers) ? triggers[i] : null);
      if (
        actual.itemId !== t.itemId ||
        actual.kind !== t.kind ||
        typeof actual.amount !== 'number' ||
        !adjacentKnifeExplanation(t.amount, actual.amount)
      )
        throw Error('经典记录的妈刀说明金额超出限定浮点邻域。');
      t.amount = actual.amount;
    });
  }
  return result;
}

/** Legacy v5 checkpoints store a room fingerprint, not its explanation values.
 * Recover ONLY a unique nearby-knife candidate reproducing that exact fingerprint.
 * Bounded meet-in-the-middle search; no schema/key migration or unchecked hash acceptance. */
export function restoreClassicRoomLocator(
  log: ReplayLog,
  room: ReplayRoomRecord,
  locator: unknown,
): ReplayRoomRecord {
  if (
    typeof locator !== 'string' ||
    !locator.startsWith(`${log.id}/${room.location}#`) ||
    !/#[a-f0-9]{8}$/.test(locator)
  )
    throw Error('检查点的历史定位损坏。');
  if (locator === replayRoomLocator(log, room)) return room;
  const clone = copySnapshot(room),
    positions: Array<{
      trigger: TurnScoreBreakdown['triggers'][number];
      amount: number;
    }> = [];
  for (const b of Object.values(clone.settlement.scoreBreakdowns))
    for (const t of b.triggers)
      if (
        t.itemId === 'moms_knife' &&
        t.kind === 'additive_score' &&
        t.amount !== undefined &&
        Number.isFinite(t.amount) &&
        t.amount > 0
      ) {
        positions.push({ trigger: t, amount: t.amount });
        t.amount =
          `__knife_tail_${positions.length - 1}__` as unknown as number;
      }
  if (!positions.length) throw Error('检查点的历史定位损坏。');
  const template = canonicalJson({
    entryEvents: clone.entryEvents,
    aiChoices: clone.aiChoices,
    settlement: clone.settlement,
  });
  // Canonical object ordering need not match the traversal ordering.
  const markers = [...template.matchAll(/"__knife_tail_(\d+)__"/g)];
  const ordered = markers.map((m) => positions[Number(m[1])]!);
  const segments: string[] = [];
  let offset = 0;
  for (const m of markers) {
    segments.push(template.slice(offset, m.index));
    offset = m.index! + m[0].length;
  }
  segments.push(template.slice(offset));
  const middle = Math.ceil(ordered.length / 2),
    limit = 65536;
  const radius = 5 ** middle <= limit ? 2 : 1;
  if (3 ** middle > limit)
    throw Error('检查点的说明尾数候选超过核验上限，原文件保留。');
  const choices = ordered.map((p) => {
    const n = bits(p.amount),
      result = [p.amount];
    for (let d = 1; d <= radius; d++)
      for (const direction of [-1n, 1n]) {
        const candidateBits = n + direction * BigInt(d);
        if (candidateBits <= 0n || candidateBits >= 0x7ff0000000000000n)
          continue;
        const candidate = value(candidateBits);
        if (adjacentKnifeExplanation(p.amount, candidate))
          result.push(candidate);
      }
    return result;
  });
  let work = 0;
  function hash(h: number, text: string) {
    work += text.length;
    if (work > 20_000_000)
      throw Error('检查点的说明尾数核验超过工作上限，原文件保留。');
    for (let i = 0; i < text.length; i++)
      h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function reverse(h: number, text: string) {
    work += text.length;
    if (work > 20_000_000)
      throw Error('检查点的说明尾数核验超过工作上限，原文件保留。');
    // 0x359c449b is the inverse of FNV's odd multiplier modulo 2^32.
    for (let i = text.length - 1; i >= 0; i--)
      h = Math.imul(h, 0x359c449b) ^ text.charCodeAt(i);
    return h >>> 0;
  }
  const forward = new Map<number, { values: number[]; ambiguous: boolean }>();
  function walkForward(i: number, h: number, selected: number[]) {
    if (i === middle) {
      const previous = forward.get(h);
      if (previous) previous.ambiguous = true;
      else forward.set(h, { values: selected, ambiguous: false });
      return;
    }
    for (const n of choices[i]!) {
      const afterValue = hash(h, JSON.stringify(n));
      // Meet immediately BEFORE segments[middle], which the reverse traversal
      // has already undone. Including it on both sides shifts the boundary.
      walkForward(
        i + 1,
        i + 1 === middle ? afterValue : hash(afterValue, segments[i + 1]!),
        [...selected, n],
      );
    }
  }
  walkForward(0, hash(2166136261, segments[0]!), []);
  let found: number[] | null = null,
    ambiguous = false;
  function walkBackward(i: number, h: number, selected: number[]) {
    if (i < middle) {
      const match = forward.get(h);
      if (match) {
        if (found || match.ambiguous) ambiguous = true;
        else found = [...match.values, ...selected];
      }
      return;
    }
    for (const n of choices[i]!)
      walkBackward(
        i - 1,
        reverse(reverse(h, JSON.stringify(n)), segments[i]!),
        [n, ...selected],
      );
  }
  walkBackward(
    ordered.length - 1,
    reverse(Number.parseInt(locator.slice(-8), 16), segments.at(-1)!),
    [],
  );
  if (!found || ambiguous)
    throw Error('检查点的历史定位无法唯一核验，原文件保留。');
  const recovered = found as number[];
  ordered.forEach((p, i) => {
    p.trigger.amount = recovered[i]!;
  });
  clone.locator = undefined;
  if (replayRoomLocator(log, clone) !== locator)
    throw Error('检查点的历史定位损坏。');
  return { ...clone, locator };
}
