import { decisionMistakePlan } from './classic-decision-mistake-plan.mjs';
export const feasibleMistakePlan: typeof decisionMistakePlan & {
  readonly selection: 'feasible-first';
  readonly structuredArms: readonly string[];
};
