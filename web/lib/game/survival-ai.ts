import {
  decideAiTurn,
  type AiDecisionOptions,
  type AiDecision,
} from './ai-decision';
import { planSurvivalAi } from './survival-ai-plan';
import type { RuntimePlayerState } from './item-types';
import type { RulesConfig, RandomSource } from './types';
import { survivalDifficultyProfiles } from './survival-difficulty';
import { createAiQuoteProfile } from './ai-quote';

/** Survival-only policy; doctrine zeros, personalities and random streams are retained. */
export function decideHighestSurvivalAiTurn(
  player: RuntimePlayerState,
  floorIndex: number,
  rules: RulesConfig,
  random: RandomSource,
  options: AiDecisionOptions = {},
): AiDecision {
  if (!options.survivalContext || !options.context)
    return decideAiTurn(player, floorIndex, rules, random, options);
  const plan = planSurvivalAi(
    player,
    options.context.room.roomIndex,
    options.context.room.kind,
    rules,
    rules.floorStartingMoney[floorIndex]!,
    options.survivalContext,
  );
  const modifiers = {
    high_bid: 1 + plan.urgency * 0.15,
    cooperate: 1 + plan.urgency * 0.7,
    disrupt_high: 1 + plan.urgency * 0.1,
    disrupt_cooperate: 1 + plan.urgency * 0.45,
    withdraw:
      plan.safe && options.remainingRooms === 1
        ? 1.6
        : Math.max(0.2, 1 - plan.urgency * 0.8),
  };
  const decision = decideAiTurn(player, floorIndex, rules, random, {
    ...options,
    context: {
      ...options.context,
      scoreRankPercentile: plan.scoreRankPercentile,
    },
    survivalPlan: plan,
    strategyMultipliers: Object.fromEntries(
      Object.entries(modifiers).map(([strategy, value]) => [
        strategy,
        value *
          (options.strategyMultipliers?.[strategy as keyof typeof modifiers] ??
            1),
      ]),
    ),
  });
  return { ...decision, survivalAnalysis: plan };
}

/** Difficulty defaults to the historical highest policy when omitted by old AI2 checkpoints. */
export function decideSurvivalAiTurn(
  player: RuntimePlayerState,
  floorIndex: number,
  rules: RulesConfig,
  random: RandomSource,
  options: AiDecisionOptions = {},
): AiDecision {
  const difficulty = options.survivalDifficulty ?? 'highest';
  if (difficulty === 'highest' || !options.survivalContext || !options.context)
    return decideHighestSurvivalAiTurn(
      player,
      floorIndex,
      rules,
      random,
      options,
    );
  const profile = survivalDifficultyProfiles[difficulty],
    errorRandom =
      options.survivalDifficultyRandom ?? options.quoteRandom ?? random;
  const forecastFactor =
    1 + (errorRandom.next() * 2 - 1) * profile.forecastError;
  const survivalExecutionFactor =
    1 + (errorRandom.next() * 2 - 1) * profile.quoteError;
  const ownProfile =
    options.quoteProfile ?? createAiQuoteProfile(options.quoteRandom ?? random);
  const raw = planSurvivalAi(
    player,
    options.context.room.roomIndex,
    options.context.room.kind,
    rules,
    rules.floorStartingMoney[floorIndex]!,
    options.survivalContext,
  );
  const plan = {
    ...raw,
    urgency: raw.urgency * profile.planning,
    utilityInfluence: profile.planning,
  };
  const modifiers = {
    high_bid: 1 + plan.urgency * 0.15,
    cooperate: 1 + plan.urgency * 0.7,
    disrupt_high: 1 + plan.urgency * 0.1,
    disrupt_cooperate: 1 + plan.urgency * 0.45,
    withdraw:
      raw.safe && options.remainingRooms === 1
        ? 1 + 0.6 * profile.planning
        : Math.max(0.2, 1 - plan.urgency * 0.8),
  };
  const decision = decideAiTurn(player, floorIndex, rules, random, {
    ...options,
    survivalPlan: plan,
    survivalExecutionFactor,
    context: {
      ...options.context,
      scoreRankPercentile:
        options.context.scoreRankPercentile * (1 - profile.planning) +
        raw.scoreRankPercentile * profile.planning,
    },
    quoteProfile: {
      ...ownProfile,
      targetPredictionBias: ownProfile.targetPredictionBias * forecastFactor,
      highestPredictionBias: ownProfile.highestPredictionBias * forecastFactor,
      qualificationPredictionBias:
        (ownProfile.qualificationPredictionBias ?? 1) * forecastFactor,
    },
    strategyMultipliers: Object.fromEntries(
      Object.entries(modifiers).map(([strategy, value]) => [
        strategy,
        value *
          (options.strategyMultipliers?.[strategy as keyof typeof modifiers] ??
            1),
      ]),
    ),
  });
  return { ...decision, survivalAnalysis: plan };
}
