import { expect, it } from 'vitest';
import { observedFirstHits } from './analyze-current-achievement-study.mjs';
it('keeps censoring and inapplicable modes separate from observed timing', () => {
  const cells = [1, 7, null].map((firstCampaignGame) => ({
    achievements: {
      A: {
        applicable: true,
        firstCampaignGame,
        finalProgress: firstCampaignGame === null ? 2 : 5,
      },
    },
  }));
  cells.push({
    achievements: {
      A: { applicable: false, firstCampaignGame: null, finalProgress: 0 },
    },
  });
  expect(observedFirstHits(cells, 'A')).toEqual({
    paths: 3,
    hits: 2,
    censored: 1,
    firstHitGames: [1, 7],
    medianAmongHits: 1,
    hitBy: { 5: 1, 10: 2, 20: 2 },
    finalProgress: [5, 5, 2],
  });
});
