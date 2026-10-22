import {
  populationPlan,
  makePopulationArm,
} from './classic-population-plan.mjs';

/** User revision: only roster ratios change; previous composition remains paired. */
export const populationRevisionPlan = Object.freeze({
  ...populationPlan,
  rowKind: 'research-only-ai-population-revision',
  seedStart: 9000,
  structuredArms: [
    'mix-easy',
    'mix-standard',
    'mix-hard',
    'prior-standard',
    'prior-hard',
    'prior-highest',
  ],
  feasibleArms: [
    'mix-easy',
    'mix-standard',
    'mix-hard',
    'prior-standard',
    'prior-hard',
    'prior-highest',
  ],
  arms: [
    makePopulationArm('mix-easy', [80, 20, 0]),
    makePopulationArm('mix-standard', [20, 70, 10]),
    makePopulationArm('mix-hard', [10, 30, 60]),
    makePopulationArm('mix-highest', [0, 0, 100]),
    makePopulationArm('prior-standard', [50, 40, 10]),
    makePopulationArm('prior-hard', [20, 50, 30]),
    makePopulationArm('prior-highest', [0, 40, 60]),
  ],
  primaryPairs: [
    ['mix-easy', 'mix-standard'],
    ['mix-standard', 'mix-hard'],
    ['mix-hard', 'mix-highest'],
  ],
  secondaryPairs: [
    ['mix-standard', 'prior-standard'],
    ['mix-hard', 'prior-hard'],
    ['mix-highest', 'prior-highest'],
  ],
});
