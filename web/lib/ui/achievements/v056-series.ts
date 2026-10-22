import type { AchievementId } from './v056-catalog';
export const achievementSeries: readonly {
  id: string;
  name: string;
  anchor: AchievementId;
  ids: readonly AchievementId[];
}[] = [
  { id: 'S-HIGH', name: '财大气粗', anchor: 'B02', ids: ['B07', 'B02', 'B08'] },
  {
    id: 'S-INTEREST',
    name: '钱生钱',
    anchor: 'D03',
    ids: ['D07', 'D03', 'D08'],
  },
  {
    id: 'S-SURVIVAL',
    name: '生存历程',
    anchor: 'F07',
    ids: ['F07', 'F08', 'F09'],
  },
];
