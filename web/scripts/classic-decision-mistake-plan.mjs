import { mistakeTierPlan } from './classic-mistake-tier-plan.mjs';

/** Content ablation: probabilities, world distribution and human policies fixed. */
export const decisionMistakePlan = Object.freeze({
  ...mistakeTierPlan,
  rowKind: 'research-only-decision-lapse',
  seedStart: 5000,
  arms: [
    { id: 'new25', base: 'original', rate: 0.25, mediumShare: 0.2 },
    { id: 'new15', base: 'original', rate: 0.15, mediumShare: 0.2 },
    { id: 'old25', base: 'original', rate: 0.25, mediumShare: 0.2 },
    { id: 'old15', base: 'original', rate: 0.15, mediumShare: 0.2 },
    { id: 'hard05', base: 'original', rate: 0.05, mediumShare: 0.2 },
    { id: 'highest', base: 'highest', rate: 0, mediumShare: 0 },
  ],
  content: {
    rewardShare: 0.45,
    budgetShare: 0.35,
    quoteShare: 0.2,
    minimumVisibleValueGap: 0.15,
    rewardLossCaps: { mild: 0.35, medium: 0.65 },
    budgetLossCaps: { mild: 0.4, medium: 0.8 },
    budgetFactors: { mild: [1.3, 1.45], medium: [1.6, 1.8] },
    budgetMinimumExtraFloorRatio: { mild: 0.025, medium: 0.05 },
    budgetMaximumExtraFloorRatio: { mild: 0.1, medium: 0.18 },
    budgetMaximumCashRatio: { mild: 0.65, medium: 0.75 },
  },
  primaryPairs: [
    ['new25', 'old25'],
    ['new15', 'old15'],
    ['new25', 'new15'],
    ['new15', 'hard05'],
    ['hard05', 'highest'],
  ],
});
