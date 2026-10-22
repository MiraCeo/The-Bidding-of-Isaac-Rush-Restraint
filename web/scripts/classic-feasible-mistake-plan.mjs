import { decisionMistakePlan } from './classic-decision-mistake-plan.mjs';

/** Only selection order changes; every candidate rule and strength is inherited. */
export const feasibleMistakePlan = Object.freeze({
  ...decisionMistakePlan,
  rowKind: 'research-only-feasible-first-lapse',
  seedStart: 6000,
  selection: 'feasible-first',
  structuredArms: ['eligible25', 'eligible15', 'prior25', 'prior15'],
  arms: [
    { id: 'eligible25', base: 'original', rate: 0.25, mediumShare: 0.2 },
    { id: 'eligible15', base: 'original', rate: 0.15, mediumShare: 0.2 },
    { id: 'prior25', base: 'original', rate: 0.25, mediumShare: 0.2 },
    { id: 'prior15', base: 'original', rate: 0.15, mediumShare: 0.2 },
    { id: 'hard05', base: 'original', rate: 0.05, mediumShare: 0.2 },
    { id: 'highest', base: 'highest', rate: 0, mediumShare: 0 },
  ],
  primaryPairs: [
    ['eligible25', 'prior25'],
    ['eligible15', 'prior15'],
    ['eligible25', 'eligible15'],
    ['eligible15', 'hard05'],
    ['hard05', 'highest'],
  ],
});
