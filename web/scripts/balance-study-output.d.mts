export type BalancePurpose = 'pilot' | 'main' | 'campaign' | 'analysis';
export interface Plan {
  steps: number;
  stepsPerBatch: number;
  batches: number;
  seedStart: number;
  repetitions?: number;
}
export const balanceStudyPlan: Readonly<
  Record<'pilot' | 'main' | 'campaign', Plan>
>;
export function corpusSourceProvenance(root: string): unknown;
export function allocateBalanceRun(
  root: string,
  purpose: BalancePurpose,
): string;
export function assertBalanceRun(
  root: string,
  directory: string,
): { purpose: BalancePurpose; source: unknown };
export function writeBalanceJson(
  root: string,
  directory: string,
  name: string,
  value: unknown,
): void;
