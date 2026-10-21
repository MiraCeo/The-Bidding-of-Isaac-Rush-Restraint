import { easySeverityPlan } from './classic-easy-severity-plan.mjs';
export type AiGrade = 'low' | 'mid' | 'high';
export type PopulationArm = (typeof easySeverityPlan.arms)[number] & {
  readonly ratios: readonly number[];
  readonly counts: readonly number[];
};
export function apportionAiCounts(
  count: number,
  ratios: readonly number[],
): number[];
export function makePopulationArm(
  id: string,
  ratios: readonly number[],
): PopulationArm;
export const populationPlan: Omit<typeof easySeverityPlan, 'arms'> & {
  readonly probabilityMode: 'per-ai-fixed-grade';
  readonly grades: readonly AiGrade[];
  readonly levels: Readonly<
    Record<AiGrade, { readonly rate: number; readonly mediumShare: number }>
  >;
  readonly aiCount: number;
  readonly arms: readonly PopulationArm[];
};
