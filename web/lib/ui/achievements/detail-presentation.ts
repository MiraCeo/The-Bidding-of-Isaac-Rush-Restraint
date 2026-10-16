import { achievementCatalog, type AchievementDefinition } from './catalog';
import { achievementPresentation } from './presentation';
import { seriesForAchievement } from './series';

/** Display copy only. Thresholds and per-level progress still come from catalog. */
const seriesCopy: Readonly<Record<string, readonly [string, string]>> = {
  'S-FAILED-BIDS': ['累计正常竞拍失败。', '次'],
  'S-FAILED-STREAK': ['同一局内连续正常竞拍失败。', '次'],
  'S-LOSING-MATCHES': ['累计正式终局排名第6及以后的对局。', '局'],
  'S-RECOVERY-MATCHES': ['同局正常竞拍失败后，在后续房间竞拍获奖。', '局'],
  'S-COOPERATION': ['累计通过合作区资格实际获得道具。', '次'],
  'S-HIGH': ['累计通过最高价资格实际获得道具。', '次'],
  'S-WATCHED-VACANCIES': ['观望时见证奖励名额因扰乱实际轮空。', '房'],
  'S-MISSED-COOPERATION': ['正常竞拍进入合作区，但本组无资格且未获奖。', '次'],
  'S-MISSED-HIGH': [
    '正常竞拍在本组高价排序恰为第N＋1位，且无资格、未获奖。',
    '次',
  ],
  'S-LAST-HIGH': ['正常竞拍恰占本组高价最后一个名额，并实际获奖。', '次'],
  'S-ALTERNATIVE': [
    '无本组最高价资格，凭合作区资格战胜更高报价并实际获奖。',
    '次',
  ],
  'S-PERSONAL-VACANCIES': ['亲自扰乱占据本组奖励名额，并使其实际轮空。', '次'],
  'S-SHIELD-REFUNDS': ['正常竞拍失败后，通过屏障获得对应的正金额退款。', '次'],
  'S-D6-DOUBLES': ['六面骰实际触发房间积分翻倍。', '房'],
  'S-INTEREST': ['累计通过利息实际获得资金。', '资金'],
  'S-POOR-CHARM': ['低资金下实际触发穷人护符的强化积分加成。', '房'],
  'S-LUCKY-AWARDS': ['靠幸运脚新增必要资格，并实际取得本组道具。', '次'],
  'S-ALL-IN-AWARDS': ['正常竞拍投入全部可用资金，且同份行动实际获奖。', '次'],
  'S-SALE-SAVINGS': ['累计因Steam大促减少正常竞拍实际扣款。', '资金'],
  'S-STOLEN-MONEY': ['累计通过偷钱袋实际窃取其他玩家的资金。', '资金'],
  'S-HIDDEN-GIFTS': ['累计取得宝箱房原本隐藏的问号奖励。', '件'],
  'S-ASYMMETRIC-BIDS': [
    '使用雅阁和以扫双组不等额正常竞拍，且至少一组实际获奖。',
    '房',
  ],
  'S-LOWEST-SURVIVOR': ['以本层存活者最低层结算成绩通过正式淘汰。', '次'],
  'S-FIRST-FLOORS': ['同局从第一层起，连续通过前几层正式淘汰。', '层'],
  'S-SURVIVAL': ['累计完成正式生存对局，被淘汰也计入。', '局'],
};

export function achievementDetailPresentation(a: AchievementDefinition) {
  const series = seriesForAchievement(a.id);
  if (!series) {
    const note = achievementPresentation[a.id].note;
    return {
      summary: achievementPresentation[a.id].summary,
      rules: [a.condition, ...(!a.condition.includes(note) ? [note] : [])],
      unit: '',
    };
  }
  const copy = seriesCopy[series.id];
  if (!copy) throw Error(`缺少系列详情文案：${series.id}`);
  // Factor ONLY the first tier threshold, not the rest of the condition. This
  // retains first-sentence boundaries (same branch, actual grant, human etc.)
  // and unrelated numbers such as sixth place or Eden's three-item requirement.
  const rules = [
    ...new Set(
      series.ids.map((id) => {
        const level = achievementCatalog.find((d) => d.id === id)!;
        return level.condition.replace(String(level.target), '目标值');
      }),
    ),
  ].filter(Boolean);
  return { summary: copy[0], unit: copy[1], rules };
}
