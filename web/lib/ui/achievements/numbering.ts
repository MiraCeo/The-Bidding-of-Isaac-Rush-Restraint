import type { AchievementCategory, AchievementId } from './catalog';

/** Public 0.5.12 numbers are NOT persistence keys. Keep the latter stable so
 * receipts, independent timestamps, pending growth and role grants inherit
 * without rewriting verified historical data. Never search both number
 * spaces implicitly: B02 now unambiguously means the public B02. */
export const achievementNumberOrder = {
  A: [
    'A01',
    'A08',
    'A09',
    'A06',
    'A03',
    'A07',
    'A05',
    'A10',
    'A11',
    'A12',
    'A13',
    'A14',
    'A15',
  ],
  B: [
    'B01',
    'B14',
    'B15',
    'B07',
    'B02',
    'B08',
    'B03',
    'B04',
    'B16',
    'B17',
    'B05',
    'B18',
    'B19',
    'B06',
    'B20',
    'B21',
    'B09',
    'B22',
    'B23',
    'B11',
    'B24',
    'B25',
    'B12',
    'B13',
  ],
  C: [
    'C01',
    'C10',
    'C11',
    'C02',
    'C12',
    'C13',
    'C03',
    'C04',
    'C05',
    'C06',
    'C14',
    'C15',
    'C07',
    'C08',
    'C09',
  ],
  D: [
    'D01',
    'D02',
    'D07',
    'D03',
    'D08',
    'D04',
    'D17',
    'D18',
    'D05',
    'D19',
    'D20',
    'D06',
    'D09',
    'D13',
    'D14',
    'D10',
    'D21',
    'D22',
    'D11',
    'D15',
    'D16',
    'D12',
  ],
  E: [
    'E01',
    'E02',
    'E03',
    'E04',
    'E05',
    'E17',
    'E18',
    'E06',
    'E07',
    'E08',
    'E09',
    'E10',
    'E11',
    'E12',
    'E15',
    'E19',
    'E20',
    'E16',
  ],
  F: [
    'F01',
    'F02',
    'F03',
    'F13',
    'F14',
    'F15',
    'F04',
    'F16',
    'F05',
    'F06',
    'F07',
    'F08',
    'F09',
    'F10',
    'F12',
  ],
} as const satisfies Record<AchievementCategory, readonly AchievementId[]>;

export type AchievementNumber = `${AchievementCategory}${number}`;
export const achievementNumbering = Object.entries(
  achievementNumberOrder,
).flatMap(([category, ids]) =>
  ids.map((id, index) => ({
    id,
    number:
      `${category}${String(index + 1).padStart(2, '0')}` as AchievementNumber,
  })),
);
const byId = new Map<AchievementId, AchievementNumber>(
  achievementNumbering.map(({ id, number }) => [id, number]),
);
const byNumber = new Map<string, AchievementId>(
  achievementNumbering.map(({ id, number }) => [number, id]),
);

/** Retired keys intentionally have no public number and must not be displayed
 * as a current medal. A broken current reference is an error, not a fallback. */
export function achievementNumber(id: AchievementId): AchievementNumber {
  const number = byId.get(id);
  if (!number) throw Error(`成就没有正式编号：${id}`);
  return number;
}
export function achievementIdForNumber(
  number: string,
): AchievementId | undefined {
  return byNumber.get(number.trim().toUpperCase());
}
export function compareAchievementNumbers(a: AchievementId, b: AchievementId) {
  return achievementNumber(a).localeCompare(achievementNumber(b));
}
