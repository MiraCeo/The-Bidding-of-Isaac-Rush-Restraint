import { describe, it, expect } from 'vitest';
import {
  survivalTutorialScore,
  survivalTutorialElimination,
  survivalTutorialRanking,
} from './survival-tutorial';
describe('isolated survival teaching uses formal score, elimination and ranking', () => {
  it('separates S and new score, without repeating inheritance or multipliers', () => {
    expect(survivalTutorialScore(420, 500, 300)).toMatchObject({
      roomScore: 420,
      exchangedScore: 50,
      inheritedScore: 60,
      newScore: 470,
      survivalScore: 530,
    });
  });
  it('eliminates at least two despite everyone passing', () => {
    const result = survivalTutorialElimination('passed');
    expect(result.resolution.plan.eliminations).toHaveLength(2);
    expect(
      result.resolution.plan.eliminations.every(
        (e) => e.reason === 'lowest_score',
      ),
    ).toBe(true);
  });
  it('eliminates all five below the line, not just two', () => {
    expect(
      survivalTutorialElimination('below').resolution.plan.eliminations,
    ).toHaveLength(5);
  });
  it('makes tie examples repeatable without global RNG', () => {
    expect(survivalTutorialElimination('tie')).toEqual(
      survivalTutorialElimination('tie'),
    );
    expect(
      survivalTutorialElimination('tie').resolution.tieBreaks,
    ).toHaveLength(20);
  });
  it('shows a wipeout and a survivor-threshold ending distinctly', () => {
    const wipe = survivalTutorialElimination('wipeout'),
      six = survivalTutorialElimination('six');
    expect(wipe.resolution.plan.survivorIds).toEqual([]);
    expect(wipe.resolution.plan.shouldFinish).toBe(true);
    expect(six.resolution.plan.survivorIds).toHaveLength(6);
    expect(six.resolution.plan.shouldFinish).toBe(true);
  });
  it('ranks a surviving player ahead of a wealthy early elimination', () => {
    expect(survivalTutorialRanking().map((r) => r.playerId)).toEqual([
      'survivor',
      'late-rich',
      'late',
      'early-rich',
    ]);
  });
});
