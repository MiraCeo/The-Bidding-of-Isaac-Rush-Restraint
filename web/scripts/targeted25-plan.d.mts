export const targeted25Plan: Readonly<{
  kind: string;
  version: number;
  blocks: number;
  games: number;
  seedStart: number;
  pilotSeedStart: number;
  routes: readonly 'targeted'[];
  checkpoints: readonly number[];
  targets: Readonly<Record<string, number>>;
  baseline: string;
  parameters: Readonly<Record<string, unknown>>;
  scope: string;
}>;
export function targeted25Seed(
  block: number,
  index: number,
  pilot?: boolean,
): number;
export function allocateTargeted25(
  root: string,
  purpose: 'pilot' | 'main',
): string;
export function assertTargeted25(
  root: string,
  directory: string,
): {
  purpose: 'pilot' | 'main';
  source: unknown;
  baselineHashes: Record<string, string>;
};
export function targeted25BaselineHashes(root: string): Record<string, string>;
