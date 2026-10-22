/** Preregistered first trial: quote lapses only, no new capability attenuation. */
export const mistakePlan = Object.freeze({
  blocks: 60,
  roles: ['isaac', 'lost', 'azazel', 'eden', 'jacob_esau'],
  policies: ['pace', 'public-ai', 'explore'],
  seedStart: 3000,
  arms: [
    { id: 'original', base: 'highest', rate: 0, mediumShare: 0 },
    { id: 'mistake10', base: 'original', rate: 0.1, mediumShare: 0.2 },
    { id: 'mistake03', base: 'original', rate: 0.03, mediumShare: 0 },
    { id: 'current-easy', base: 'easy', rate: 0, mediumShare: 0 },
    { id: 'current-standard', base: 'standard', rate: 0, mediumShare: 0 },
    { id: 'current-hard', base: 'hard', rate: 0, mediumShare: 0 },
  ],
  mildFactors: [0.85, 0.9, 1.1, 1.15],
  mediumFactors: [0.7, 0.75, 1.25, 1.3],
  mildMaximumModelLoss: 0.15,
  mediumMaximumModelLoss: 0.35,
  primaryPolicies: ['pace', 'public-ai'],
  primaryPairs: [
    ['mistake10', 'original'],
    ['mistake03', 'original'],
    ['mistake10', 'mistake03'],
  ],
  bootstrapResamples: 10000,
  familywiseAlpha: 0.05,
});
