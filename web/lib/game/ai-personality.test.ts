import { describe, expect, it } from 'vitest';

import {
  calculatePersonalityGroupMultipliers,
  calculatePersonalityMultipliers,
  generateAiPersonalities,
  personalityCooperationPosition,
  personalitiesConflict,
  reshapeWeightsForPersonalities,
} from './ai-personality';
import type { AiDecisionContext } from './ai-analysis';
import { createSeededRandom } from './random';

describe('AI personality module', () => {
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
});
