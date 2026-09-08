import { describe, expect, it } from 'vitest';

import {
  aiPersonalityOrder,
  implementedAiPersonalityOrder,
  calculatePersonalityGroupMultipliers,
  calculatePersonalityMultipliers,
  generateAiPersonalities,
  initialAiPersonalityOrder,
  personalityAnalysisInfluence,
  personalityCooperationPosition,
  personalityForcesMaximumQuote,
  personalityQuoteNoiseRatio,
  personalitiesConflict,
  reshapeWeightsForPersonalities,
} from './ai-personality';
import type { AiAnalysisResult, AiDecisionContext } from './ai-analysis';
import { createSeededRandom } from './random';

describe('AI personality module', () => {
  it('exposes all twenty-one personalities while preserving the original fifteen-person pool', () => {
    expect(initialAiPersonalityOrder).toHaveLength(15);
    expect(aiPersonalityOrder).toHaveLength(20);
    expect(aiPersonalityOrder).not.toContain('all_in');
    expect(implementedAiPersonalityOrder).toHaveLength(21);
    expect(implementedAiPersonalityOrder).toContain('all_in');
  });

  it('generates one to three personalities without conflicting pairs', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const personalities = generateAiPersonalities(createSeededRandom(seed), 1, 3);
      expect(personalities.length).toBeGreaterThanOrEqual(1);
      expect(personalities.length).toBeLessThanOrEqual(3);
      expect(new Set(personalities).size).toBe(personalities.length);
      expect(personalitiesConflict(personalities)).toBe(false);
    }
  });

  it('makes stable and disruptive personalities affect both disruption strategies oppositely', () => {
    const stable = calculatePersonalityMultipliers(['stable']);
    const disruptive = calculatePersonalityMultipliers(['disruptive']);
    expect(stable.disrupt_high).toBeLessThan(1);
    expect(stable.disrupt_cooperate).toBeLessThan(1);
    expect(disruptive.disrupt_high).toBeGreaterThan(1);
    expect(disruptive.disrupt_cooperate).toBeGreaterThan(1);
  });

  it('makes cautious and aggressive personalities affect competition and waiting oppositely', () => {
    const cautious = calculatePersonalityMultipliers(['cautious']);
    const aggressive = calculatePersonalityMultipliers(['aggressive']);
    expect(cautious.high_bid).toBeLessThan(aggressive.high_bid);
    expect(cautious.cooperate).toBeLessThan(aggressive.cooperate);
    expect(cautious.withdraw).toBeGreaterThan(aggressive.withdraw);
  });

  it('supports two to four personalities without selecting conflicts', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const personalities = generateAiPersonalities(createSeededRandom(seed), 2, 4);
      expect(personalities.length).toBeGreaterThanOrEqual(2);
      expect(personalities.length).toBeLessThanOrEqual(4);
      expect(personalitiesConflict(personalities)).toBe(false);
    }
  });

  it('applies score and economy item preferences to group selection', () => {
    const context = {
      room: {
        rewards: [
          { group: 'A', itemId: 'sacred_heart', hidden: false },
          { group: 'B', itemId: 'interest', hidden: false },
        ],
      },
    } as unknown as AiDecisionContext;
    expect(calculatePersonalityGroupMultipliers(['vain'], context)).toEqual({ A: 2.2, B: 1 });
    expect(calculatePersonalityGroupMultipliers(['greedy'], context)).toEqual({ A: 1, B: 2.2 });
  });

  it('makes generosity aim near the cooperation edge', () => {
    expect(personalityCooperationPosition(['common_good'])).toBe(0);
    expect(personalityCooperationPosition(['generous'])).toBe(-0.72);
  });

  it('makes speculation flatten weights while preserving hard-disabled strategies', () => {
    const reshaped = reshapeWeightsForPersonalities(
      { high_bid: 80, cooperate: 20, disrupt_high: 0, disrupt_cooperate: 4, withdraw: 1 },
      { high_bid: 20, cooperate: 50, disrupt_high: 0, disrupt_cooperate: 10, withdraw: 15 },
      ['speculative'],
    );
    expect(reshaped.high_bid / reshaped.withdraw).toBeLessThan(80);
    expect(reshaped.disrupt_high).toBe(0);
  });

  it('gives adaptive and rational personalities more analysis influence and arrogant less', () => {
    expect(personalityAnalysisInfluence(['adaptive']).situation).toBeGreaterThan(1);
    expect(personalityAnalysisInfluence(['rational']).situation).toBeGreaterThan(1);
    expect(personalityAnalysisInfluence(['arrogant']).situation).toBeLessThan(1);
    expect(personalityAnalysisInfluence(['stubborn']).items).toBeLessThan(1);
  });

  it('makes rational low-liquidity play reduce expensive competition', () => {
    const normal = calculatePersonalityMultipliers(['rational'], undefined, undefined, 1);
    const scarce = calculatePersonalityMultipliers(['rational'], undefined, undefined, 0.3);
    expect(scarce.high_bid).toBeLessThan(normal.high_bid);
    expect(scarce.disrupt_high).toBeLessThan(normal.disrupt_high);
    expect(scarce.cooperate).toBeGreaterThan(normal.cooperate);
    expect(scarce.disrupt_cooperate).toBeGreaterThan(normal.disrupt_cooperate);
  });

  it('makes all-in wait on weak first-floor rewards and force legal-limit quoting only there', () => {
    const context = {
      scoreRankPercentile: 0.5,
      history: { competitiveRounds: 0, failedCompetitiveRounds: 0 },
      room: { floorIndex: 0 },
    } as unknown as AiDecisionContext;
    const analysis = {
      groupValues: { A: 0.2, B: 0.3 },
    } as unknown as AiAnalysisResult;
    const multipliers = calculatePersonalityMultipliers(['all_in'], context, analysis, 1);
    expect(multipliers.withdraw).toBeGreaterThan(1);
    expect(multipliers.high_bid).toBeLessThan(1);
    expect(personalityForcesMaximumQuote(['all_in'], 0)).toBe(true);
    expect(personalityForcesMaximumQuote(['all_in'], 1)).toBe(false);
  });

  it('makes stubborn and gambler suppress other personality effects in different ways', () => {
    const aggressive = calculatePersonalityMultipliers(['aggressive']);
    const stubborn = calculatePersonalityMultipliers(['aggressive', 'stubborn']);
    const gambler = calculatePersonalityMultipliers(['aggressive', 'gambler']);
    expect(Math.abs(stubborn.high_bid - 1)).toBeLessThan(Math.abs(aggressive.high_bid - 1));
    expect(Math.abs(gambler.high_bid - 1)).toBeLessThan(Math.abs(aggressive.high_bid - 1));
    expect(personalityQuoteNoiseRatio(['gambler'])).toBe(0.15);
    expect(personalityQuoteNoiseRatio([])).toBe(0.05);
  });

  it('keeps the new semantic conflicts out of generated combinations', () => {
    expect(personalitiesConflict(['adaptive', 'arrogant'])).toBe(true);
    expect(personalitiesConflict(['rational', 'gambler'])).toBe(true);
    expect(personalitiesConflict(['all_in', 'cautious'])).toBe(true);
    expect(personalitiesConflict(['stubborn', 'speculative'])).toBe(true);
  });
});
