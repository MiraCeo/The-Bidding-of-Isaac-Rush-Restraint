import { describe, expect, it } from 'vitest';
import { survivalEliminationStudyConfig } from './survival-elimination-study-config';
import { survivalEntryCutLines } from '../../ui/survival-client';
import { proposedSurvivalCutLines } from './survival-elimination-probe';
describe('research curve input preserves the formal seven-floor upper bound', () => {
  it('preserves the requested eighth line without pretending it will be played', () => {
    const config = survivalEliminationStudyConfig(
      '150,225,325,475,650,850,1100,1500',
    );
    expect(config.requestedCutLines).toEqual([
      150, 225, 325, 475, 650, 850, 1100, 1500,
    ]);
    expect(config.effectiveCutLines).toEqual([
      150, 225, 325, 475, 650, 850, 1100,
    ]);
    expect(config.unusedCutLines).toEqual([1500]);
    expect(config.maximumFloors).toBe(7);
    expect(config.outputSuffix).not.toBe('');
    expect(survivalEntryCutLines).toEqual([
      200, 325, 500, 750, 1050, 1500, 2500,
    ]);
  });
  it('retains the previous study default and output identity', () => {
    const config = survivalEliminationStudyConfig();
    expect(config.effectiveCutLines).toEqual(proposedSurvivalCutLines);
    expect(config.unusedCutLines).toEqual([]);
    expect(config.outputSuffix).toBe('');
  });
  it.each([
    '150,225',
    '150,,325,475,650,850,1100',
    '150,225,325,475,650,850,NaN',
    '150,225,325,475,650,850,-1',
    '150,225,325,475,650,850,0.00001',
  ])('rejects invalid study schedule %s', (source) => {
    expect(() => survivalEliminationStudyConfig(source)).toThrow();
  });
});
