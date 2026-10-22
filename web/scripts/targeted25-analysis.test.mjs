import { it as test } from 'vitest';
import assert from 'node:assert/strict';
import {
  summarizeTargeted25,
  targetDiagnostics,
  targeted25Distribution,
} from './analyze-targeted25.mjs';
test('full completion and censored paths never confuse an average with all117', () => {
  const rows = [20, 25, 30].map((index) => ({
    block: 0,
    route: 'targeted',
    index,
    actualEarned: Array(80).fill('a'),
    candidateEarned: Array(index === 30 ? 116 : 100).fill('a'),
    candidateMissing: ['z'],
    progress: {},
    choice: { mode: 'classic', role: 'isaac', difficulty: 'easy' },
  }));
  const result = summarizeTargeted25(rows, [
    { id: 'z', number: 'C13', name: 'test', target: 1, candidateTarget: 1 },
  ]);
  assert.equal(result.checkpoints[2].candidateCount.mean, 116);
  assert.equal(result.checkpoints[2].candidateComplete, 0);
  assert.equal(result.endpoints[0].firstCandidateComplete, null);
  assert.equal(result.bottlenecks[2].items[0].missing, 1);
  assert.throws(() => targeted25Distribution([NaN]));
});
test('intent, qualification, delivery and cost deltas are separate denominators', () => {
  const a = {
      goal: 'double-bid',
      actualCost: 20,
      baseCost: 10,
      predictedScore: 50,
      basePredictedScore: 70,
      lowestConfirmedBefore: false,
      eligible: { doubleBid: true },
      visibleTarget: null,
      result: {
        actualScore: 42,
        doubleQualified: true,
        success: [],
        redeemed: false,
        watchedVacancy: false,
        awards: [],
      },
    },
    result = targetDiagnostics([
      { attempts: [a], champion: false, floorConfirmations: [] },
    ]);
  assert.equal(result.goals[0].rooms, 1);
  assert.equal(result.goals[0].actualEvents.doubleQualified, 1);
  assert.equal(result.goals[0].actualEvents.optionsDestroyed, 0);
  assert.equal(result.goals[0].extraCostVsScoreBase, 10);
  assert.equal(result.goals[0].predictedScoreDeltaVsBase, -20);
  assert.equal(result.lowestThenChampion, 0);
});
