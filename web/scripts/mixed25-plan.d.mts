export const mixed25Plan: Readonly<{
  kind: string;
  version: number;
  blocks: number;
  games: number;
  seedStart: number;
  pilotSeedStart: number;
  routes: readonly ('public' | 'mixed' | 'collector')[];
  checkpoints: readonly number[];
  targets: Readonly<Record<string, number>>;
  scope: string;
}>;
export function mixed25Seed(
  block: number,
  index: number,
  pilot?: boolean,
): number;
export function allocateMixed25(
  root: string,
  purpose: 'pilot' | 'main',
): string;
export function assertMixed25(
  root: string,
  directory: string,
): { purpose: 'pilot' | 'main'; source: unknown };
