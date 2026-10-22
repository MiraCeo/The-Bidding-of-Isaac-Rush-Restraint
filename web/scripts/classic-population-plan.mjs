import { easySeverityPlan } from './classic-easy-severity-plan.mjs';

export function apportionAiCounts(count, ratios) {
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    ratios.length !== 3 ||
    ratios.some((n) => !Number.isFinite(n) || n < 0) ||
    ratios.reduce((a, b) => a + b, 0) <= 0
  )
    throw Error('Invalid AI population');
  const total = ratios.reduce((a, b) => a + b, 0);
  const ideal = ratios.map((n) => (n / total) * count),
    allocated = ideal.map(Math.floor);
  const order = ideal
    .map((n, i) => ({ i, remainder: n - allocated[i] }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (
    let i = 0, missing = count - allocated.reduce((a, b) => a + b, 0);
    i < missing;
    i++
  )
    allocated[order[i].i]++;
  return allocated;
}
const grades = ['low', 'mid', 'high'];
const levels = {
  low: { rate: 0.25, mediumShare: 0.4 },
  mid: { rate: 0.15, mediumShare: 0.2 },
  high: { rate: 0, mediumShare: 0 },
};
const arm = (id, ratios) => {
  const counts = apportionAiCounts(19, ratios);
  const triggerMass = counts.reduce(
    (n, count, i) => n + count * levels[grades[i]].rate,
    0,
  );
  const mediumMass = counts.reduce(
    (n, count, i) =>
      n + count * levels[grades[i]].rate * levels[grades[i]].mediumShare,
    0,
  );
  // Generic runner uses rate only to distinguish the all-original fast path.
  // These fields are roster averages, NEVER the per-player probability input.
  return {
    id,
    base: triggerMass === 0 ? 'highest' : 'original',
    rate: triggerMass / 19,
    mediumShare: triggerMass ? mediumMass / triggerMass : 0,
    ratios,
    counts,
  };
};
export { arm as makePopulationArm };
export const populationPlan = Object.freeze({
  ...easySeverityPlan,
  rowKind: 'research-only-ai-population-mixture',
  seedStart: 8000,
  probabilityMode: 'per-ai-fixed-grade',
  grades,
  levels,
  aiCount: 19,
  structuredArms: [
    'mix-easy',
    'mix-standard',
    'mix-hard',
    'mix-highest',
    'all-low',
    'all-mid',
  ],
  feasibleArms: [
    'mix-easy',
    'mix-standard',
    'mix-hard',
    'mix-highest',
    'all-low',
    'all-mid',
  ],
  arms: [
    arm('mix-easy', [80, 20, 0]),
    arm('mix-standard', [50, 40, 10]),
    arm('mix-hard', [20, 50, 30]),
    arm('mix-highest', [0, 40, 60]),
    arm('all-low', [100, 0, 0]),
    arm('all-mid', [0, 100, 0]),
    arm('all-high', [0, 0, 100]),
  ],
  primaryPairs: [
    ['mix-easy', 'mix-standard'],
    ['mix-standard', 'mix-hard'],
    ['mix-hard', 'mix-highest'],
  ],
  secondaryPairs: [
    ['all-low', 'all-mid'],
    ['all-mid', 'all-high'],
    ['mix-highest', 'all-high'],
  ],
});
