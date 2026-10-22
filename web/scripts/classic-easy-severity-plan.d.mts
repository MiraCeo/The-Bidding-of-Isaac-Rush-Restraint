import { feasibleMistakePlan } from './classic-feasible-mistake-plan.mjs';
export const easySeverityPlan: typeof feasibleMistakePlan & {
  readonly feasibleArms: readonly string[];
  readonly secondaryPairs: readonly (readonly [string, string])[];
};
