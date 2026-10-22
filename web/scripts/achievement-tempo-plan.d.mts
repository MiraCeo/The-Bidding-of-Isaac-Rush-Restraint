export interface TempoScenario {
  id: string;
  mode: 'classic' | 'survival';
  aiPolicy: 'classic-population-1' | 'classic-tiered-1' | 'role-aware-1';
  difficulty: 'easy' | 'standard' | 'hard' | 'highest';
}
export interface TempoPlan {
  kind: string;
  version: number;
  blocks: number;
  steps: number;
  seedStart: number;
  pilotSeedStart: number;
  policies: readonly ('pace' | 'public-ai' | 'explore')[];
  scenarios: readonly TempoScenario[];
  thresholds: readonly number[];
  current: { allIn: readonly number[]; boss: readonly number[] };
  candidates: {
    allIn: readonly (readonly number[])[];
    boss: readonly (readonly number[])[];
  };
  roleSelection: string;
  scope: string;
}
export const tempoPlan: Readonly<TempoPlan>;
export function tempoSeed(
  block: number,
  step: number,
  purpose?: 'pilot' | 'main',
): number;
export function allocateTempoRun(
  root: string,
  purpose: 'pilot' | 'main',
): string;
export function assertTempoRun(
  root: string,
  directory: string,
): { purpose: 'pilot' | 'main'; source: unknown; plan: TempoPlan };
