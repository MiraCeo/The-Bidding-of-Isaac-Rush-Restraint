import { hasItem } from './runtime';
import { getDoubleActionScoreMultiplier } from './characters';
import type { RuntimePlayerState } from './item-types';
import type { SurvivalAiPlan } from './survival-ai-plan';
/** Owned builds, not role-name buffs: Eden and later acquired items use the same adaptation. */
export function roleAwareSurvivalPlan(
  player: RuntimePlayerState,
  raw: SurvivalAiPlan,
  precision: number,
): SurvivalAiPlan {
  const double =
    hasItem(player, 'more_options') || hasItem(player, 'more_options_question');
  const gain = double
    ? Math.max(1, 2 * getDoubleActionScoreMultiplier(player))
    : 1;
  const expectedFutureScore =
    raw.expectedFutureScore * (1 + (gain - 1) * precision);
  const absoluteRisk = Math.max(
    0,
    Math.min(
      1,
      (raw.cutLine - raw.bankedScore - expectedFutureScore) /
        Math.max(50, raw.cutLine * 0.35),
    ),
  );
  return {
    ...raw,
    expectedFutureScore,
    urgency: Math.max(raw.relativeRisk, absoluteRisk),
  };
}
export function brimstoneCooperationEquivalent(
  amount: number,
  target: number,
  precision: number,
): number {
  // Prediction only: the real T is unknown. Preserve margin near the lower [0.8q,1.25q] edge.
  return (
    amount +
    (Math.max(1, Math.ceil((target / 1.25) * 1.04)) - amount) * precision
  );
}
