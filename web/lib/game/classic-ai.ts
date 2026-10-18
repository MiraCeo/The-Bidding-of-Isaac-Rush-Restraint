import {
  classicDifficultyProfiles,
  readClassicAiSettings,
  type ClassicAiSettings,
} from './classic-difficulty';
import { createSeededRandom } from './random';
import { decideAiTurn, type AiDecisionOptions } from './ai-decision';
import type { RuntimePlayerState } from './item-types';
import type { RandomSource, RulesConfig } from './types';

/** Highest/legacy uses the identical function/options and consumes no extra RNG.
 * Lower-tier error uses its own per-player/per-room stream, never a secret turn. */
export function decideClassicAiTurn(
  player: RuntimePlayerState,
  floor: number,
  rules: RulesConfig,
  random: RandomSource,
  options: AiDecisionOptions,
  settings: ClassicAiSettings | undefined,
  errorSeed: number,
  decide = decideAiTurn,
) {
  if (settings) settings = readClassicAiSettings(settings);
  if (!settings || settings.difficulty === 'highest')
    return decide(player, floor, rules, random, options);
  const profile = classicDifficultyProfiles[settings.difficulty];
  const error = createSeededRandom(errorSeed);
  const factor = () => 1 + (error.next() * 2 - 1) * profile.forecastError;
  const own = options.quoteProfile;
  return decide(player, floor, rules, random, {
    ...options,
    classicPlanningFactor: profile.planning,
    ...(own
      ? {
          quoteProfile: {
            ...own,
            highestPredictionBias: own.highestPredictionBias * factor(),
            targetPredictionBias: own.targetPredictionBias * factor(),
            qualificationPredictionBias:
              (own.qualificationPredictionBias ?? 1) * factor(),
          },
        }
      : {}),
  });
}
