import { feasibleMistakePlan } from './classic-feasible-mistake-plan.mjs';

/** One-knob trial: easy medium-request share 0.20 -> 0.40, all else frozen. */
export const easySeverityPlan = Object.freeze({
  ...feasibleMistakePlan,
  rowKind: 'research-only-easy-severity-lapse',
  seedStart: 7000,
  structuredArms: ['easy-m40', 'easy-m20', 'standard'],
  feasibleArms: ['easy-m40', 'easy-m20', 'standard'],
  arms: [
    { id: 'easy-m40', base: 'original', rate: 0.25, mediumShare: 0.4 },
    { id: 'easy-m20', base: 'original', rate: 0.25, mediumShare: 0.2 },
    { id: 'standard', base: 'original', rate: 0.15, mediumShare: 0.2 },
    { id: 'hard05', base: 'original', rate: 0.05, mediumShare: 0.2 },
    { id: 'highest', base: 'highest', rate: 0, mediumShare: 0 },
  ],
  primaryPairs: [['easy-m40', 'easy-m20']],
  secondaryPairs: [
    ['easy-m40', 'standard'],
    ['standard', 'hard05'],
    ['hard05', 'highest'],
  ],
});
