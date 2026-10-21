export const audit117Plan: Readonly<{
  kind: string;
  version: number;
  matrixBlocks: number;
  matrixSeedStart: number;
  naturalSeedStart: number;
  naturalBlocks: number;
  additionalNaturalGames: number;
  edgeBlocks: number;
  edgeGames: number;
  policies: readonly ('pace' | 'public-ai' | 'explore')[];
  difficulties: readonly ('easy' | 'standard' | 'hard' | 'highest')[];
  roles: readonly ('isaac' | 'lost' | 'azazel' | 'eden' | 'jacob_esau')[];
  baseline: string;
  confirmation: string;
  scope: string;
}>;
export function audit117Seed(
  block: number,
  index: number,
  kind: 'matrix' | 'long' | 'pilot',
): number;
export function audit117Tasks(): string[];
export function allocateAudit117(root: string): string;
export function assertAudit117(
  root: string,
  directory: string,
): { source: unknown };
