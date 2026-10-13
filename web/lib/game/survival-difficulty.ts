export const survivalDifficulties = [
  'easy',
  'standard',
  'hard',
  'highest',
] as const;
export type SurvivalDifficulty = (typeof survivalDifficulties)[number];
export const defaultSurvivalDifficulty: SurvivalDifficulty = 'standard';
export const currentSurvivalAiPolicy = 'role-aware-1' as const;
export type SurvivalAiPolicy = typeof currentSurvivalAiPolicy;
/** v1 parameters above remain frozen for client3 continuation. */
export const survivalRoleDifficultyProfiles = Object.freeze({
  easy: Object.freeze({
    planning: 0.1,
    forecastError: 0.25,
    quoteError: 0.4,
    lapseRate: 0.18,
    rolePrecision: 0.2,
  }),
  standard: Object.freeze({
    planning: 0.4,
    forecastError: 0.14,
    quoteError: 0.25,
    lapseRate: 0.08,
    rolePrecision: 0.5,
  }),
  hard: Object.freeze({
    planning: 0.85,
    forecastError: 0.025,
    quoteError: 0.05,
    lapseRate: 0.02,
    rolePrecision: 0.85,
  }),
});
/** Highest delegates to the frozen AI2 policy. Lower tiers alter judgments, not game rules. */
export const survivalDifficultyProfiles = Object.freeze({
  easy: Object.freeze({
    label: '简单',
    planning: 0.15,
    forecastError: 0.16,
    quoteError: 0.32,
    description: '判断较粗、报价偏差较大，仍保留基本资金规划。',
  }),
  standard: Object.freeze({
    label: '标准',
    planning: 0.45,
    forecastError: 0.09,
    quoteError: 0.18,
    description: '中等判断精度，默认体验档。',
  }),
  hard: Object.freeze({
    label: '困难',
    planning: 0.75,
    forecastError: 0.035,
    quoteError: 0.08,
    description: '较强的生存判断，保留少量报价误差。',
  }),
  highest: Object.freeze({
    label: '最高',
    planning: 1,
    forecastError: 0,
    quoteError: 0,
    description: '完整保留0.3.1的生存AI，不额外削弱。',
  }),
});
export function isSurvivalDifficulty(
  value: unknown,
): value is SurvivalDifficulty {
  return (
    typeof value === 'string' &&
    survivalDifficulties.includes(value as SurvivalDifficulty)
  );
}
export function survivalDifficultyLabel(
  value?: SurvivalDifficulty,
  engineVersion?: string,
) {
  if (
    value === undefined &&
    engineVersion !== undefined &&
    engineVersion !== 'survival-client-2'
  )
    return engineVersion === 'survival-client-1' ? '未分层（旧AI）' : '未记录';
  return survivalDifficultyProfiles[value ?? 'highest'].label;
}
