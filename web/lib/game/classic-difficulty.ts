export const classicDifficulties = [
  'easy',
  'standard',
  'hard',
  'highest',
] as const;
export type ClassicDifficulty = (typeof classicDifficulties)[number];
export const defaultClassicDifficulty: ClassicDifficulty = 'highest';
export const classicAiPolicy = 'classic-tiered-1' as const;
export interface ClassicAiSettings {
  policy: typeof classicAiPolicy;
  difficulty: ClassicDifficulty;
}
/** Classic-only attenuation, not survival policy/urgency or resource advantages. */
export const classicDifficultyProfiles = Object.freeze({
  easy: Object.freeze({ label: '简单', planning: 0.25, forecastError: 0.35 }),
  standard: Object.freeze({
    label: '标准',
    planning: 0.55,
    forecastError: 0.18,
  }),
  hard: Object.freeze({ label: '困难', planning: 0.85, forecastError: 0.06 }),
  highest: Object.freeze({ label: '最高', planning: 1, forecastError: 0 }),
});
export function readClassicAiSettings(value: unknown): ClassicAiSettings {
  const v = value as ClassicAiSettings;
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).length !== 2 ||
    !Object.hasOwn(v, 'policy') ||
    !Object.hasOwn(v, 'difficulty') ||
    v.policy !== classicAiPolicy ||
    !classicDifficulties.includes(v.difficulty)
  )
    throw Error('经典AI难度／策略版本无效，原对局与档案保留。');
  return { policy: v.policy, difficulty: v.difficulty };
}
export function classicDifficultyLabel(value?: ClassicDifficulty): string {
  return value === undefined
    ? '原版（未分档）'
    : value === 'highest'
      ? '最高（原版）'
      : classicDifficultyProfiles[value].label;
}
/** Absence preserves the exact pre-tier replay ID and all original receipts. */
export function classicReplayId(
  seed: number,
  character: string,
  rulesVersion: string,
  settings?: ClassicAiSettings,
) {
  const base = `ISAAC-${seed.toString(16).padStart(8, '0')}-${character}-${rulesVersion.split('-').at(-1)}`;
  return settings
    ? `${base}-CA1-${readClassicAiSettings(settings).difficulty}`
    : base;
}
