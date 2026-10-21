import { mistakePlan } from './classic-mistake-plan.mjs';

/** User-specified probabilities. Same quote-lapse severity in every nonzero arm. */
export const mistakeTierPlan = Object.freeze({
  ...mistakePlan,
  seedStart: 4000,
  arms: [
    { id: 'easy25', base: 'original', rate: 0.25, mediumShare: 0.2 },
    { id: 'standard15', base: 'original', rate: 0.15, mediumShare: 0.2 },
    { id: 'hard05', base: 'original', rate: 0.05, mediumShare: 0.2 },
    { id: 'highest', base: 'highest', rate: 0, mediumShare: 0 },
  ],
  primaryPairs: [
    ['easy25', 'standard15'],
    ['standard15', 'hard05'],
    ['hard05', 'highest'],
  ],
});
