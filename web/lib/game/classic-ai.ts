import { assignClassicPopulation } from './classic-population';
import { applyClassicPopulationMistake } from './classic-mistake';
import {
  classicDifficultyProfiles,
  classicPopulationPolicy,
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
  gameSeed?: number,
) {
  if (settings) settings = readClassicAiSettings(settings);
  if (!settings || settings.difficulty === 'highest')
    return decide(player, floor, rules, random, options);
  if (settings.policy === classicPopulationPolicy) {
    if (gameSeed === undefined) throw Error('经典混合AI缺少对局种子。');
    const grade = assignClassicPopulation(gameSeed, settings.difficulty)
      .assignment[player.id];
    if (!grade) throw Error('经典混合AI缺少固定等级。');
    const decision = decide(player, floor, rules, random, options);
    return applyClassicPopulationMistake(
      decision,
      player,
      floor,
      rules,
      options,
      gameSeed,
      grade,
    );
  }
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
