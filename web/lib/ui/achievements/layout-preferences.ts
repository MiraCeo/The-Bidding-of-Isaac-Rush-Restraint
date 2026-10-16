export const achievementLayoutKey = 'bidding-achievement-layout-v1';
export const achievementColumns = ['auto', '1', '2', '3', '4'] as const;
export type AchievementColumns = (typeof achievementColumns)[number];
type LayoutStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function loadAchievementColumns(
  storage: LayoutStorage | null,
): AchievementColumns {
  try {
    const raw = storage?.getItem(achievementLayoutKey);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (
      value &&
      typeof value === 'object' &&
      'version' in value &&
      value.version === 1 &&
      'columns' in value &&
      achievementColumns.includes(value.columns as AchievementColumns)
    )
      return value.columns as AchievementColumns;
  } catch {
    /* Display-only preference; never repair or overwrite player data on read. */
  }
  return 'auto';
}
export function saveAchievementColumns(
  storage: LayoutStorage | null,
  columns: AchievementColumns,
) {
  if (!storage || !achievementColumns.includes(columns)) return false;
  try {
    storage.setItem(
      achievementLayoutKey,
      JSON.stringify({ version: 1, columns }),
    );
    return true;
  } catch {
    return false;
  }
}
