import type { ReplayLog } from './replay-record';
import { copySnapshot } from './replay-record';
import { replayFactsIdentity } from './replay-facts-codec';
import { adjacentKnifeExplanation } from './classic-runtime-facts';

/** Compact deletion witness, not a replacement for the original payload/key.
 * Base SHA covers every fact except positive knife explanation amounts; the
 * ordered amounts are compared individually within two float64 neighbours. */
export interface ClassicLibraryProof {
  version: 1;
  base: string;
  amounts: number[];
}
export const classicProofAmountLimit = 600;
export async function classicLibraryProof(
  log: ReplayLog,
  digest: (source: string) => Promise<string>,
): Promise<ClassicLibraryProof> {
  const projected = copySnapshot(log),
    amounts: number[] = [];
  for (const room of projected.rooms) {
    for (const id of Object.keys(room.settlement.scoreBreakdowns).sort()) {
      for (const t of room.settlement.scoreBreakdowns[id]!.triggers) {
        if (
          t.itemId === 'moms_knife' &&
          t.kind === 'additive_score' &&
          typeof t.amount === 'number' &&
          Number.isFinite(t.amount) &&
          t.amount > 0
        ) {
          amounts.push(t.amount);
          t.amount = 0;
        }
      }
    }
  }
  if (amounts.length > classicProofAmountLimit)
    throw Error('经典回放的说明凭据超过600项核验上限，未更改回放库。');
  return {
    version: 1,
    base: await digest(replayFactsIdentity(projected)),
    amounts,
  };
}
export function validClassicLibraryProof(
  value: unknown,
): value is ClassicLibraryProof {
  const p = value as ClassicLibraryProof;
  return (
    !!p &&
    typeof p === 'object' &&
    !Array.isArray(p) &&
    Object.keys(p).length === 3 &&
    ['version', 'base', 'amounts'].every((key) => Object.hasOwn(p, key)) &&
    p.version === 1 &&
    typeof p.base === 'string' &&
    /^[a-f0-9]{64}$/.test(p.base) &&
    Array.isArray(p.amounts) &&
    p.amounts.length <= classicProofAmountLimit &&
    p.amounts.every(
      (n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 1e15,
    )
  );
}
export function sameClassicLibraryProof(
  a: ClassicLibraryProof,
  b: ClassicLibraryProof,
): boolean {
  return (
    a.base === b.base &&
    a.amounts.length === b.amounts.length &&
    a.amounts.every((n, i) => adjacentKnifeExplanation(n, b.amounts[i]!))
  );
}
