import {
  achievementCatalog,
  type AchievementCategory,
  type AchievementId,
} from './catalog';

import {
  achievementCollectionMetadata,
  type AchievementTier,
} from './collection-metadata';

/** Presentation only: does not add facts, evaluate achievements or write profiles. */
export const achievementPresentation: Readonly<
  Record<AchievementId, { summary: string; note: string }>
> = {
  A01: {
    summary: '正常竞拍失败1次',
    note: '按奖励资格判定失败；屏障退款仍计入。观望与扰乱不属于正常竞拍失败，双竞拍分别判断。',
  },
  A02: {
    summary: '累计正常竞拍失败10次',
    note: '跨正式对局累计。按奖励资格判定，屏障退款仍失败；观望和扰乱不计入。',
  },
  A03: {
    summary: '同局连续正常竞拍失败5次',
    note: '观望或扰乱保持连续数。双竞拍任一成功则整房清零，双败加2；展示已记录的单局最高进度，不是当前连续数。',
  },
  B01: {
    summary: '通过合作区资格获得道具',
    note: '必须实际发放道具；同组同时具备最高价与合作区资格时，两种真实来源可分别计入对应成就。',
  },
  B02: {
    summary: '通过最高价资格累计获得10次道具',
    note: '按实际交付对应的最高价奖励机会计数，不按尾巴复制后的件数翻倍。同组也具备合作区资格时不排除最高价来源。',
  },
  B03: {
    summary: '更多选择取得双组资格后失去一件',
    note: '须先同时取得A、B两组资格，再由更多选择真实随机舍弃；不根据最终道具数量倒推。',
  },
  B04: {
    summary: '观望时见证奖励因扰乱轮空',
    note: '真人在本房观望，且至少一个奖励名额确实因扰乱占位而轮空。',
  },
  B05: {
    summary: '进入合作区却与本组奖励无缘',
    note: '仅正常竞拍：进入合作区但合作名额落选，本组无其他奖励资格且未实际获奖。先取得资格再被道具消除不算；另一组获奖不影响，可与失之交臂同时达成。',
  },
  B06: {
    summary: '恰排在本组高价获奖名额之后',
    note: '仅正常竞拍，按实际市场等价与原同价决胜结果，恰为包含扰乱占位的正式高价排序第N＋1位；本组无其他资格且未获奖。另一组获奖不影响，可与和而不同同次达成。',
  },
  C01: {
    summary: '扰乱占据奖励名额并使其轮空',
    note: '按真人扰乱占位造成的实际轮空判定；名额被超凡升天转化为真实奖励时不算轮空。',
  },
  C02: {
    summary: '竞拍失败后通过屏障获得退款',
    note: '必须有屏障退回对应竞拍资金的真实效果事件；退款不撤销该次正常竞拍失败。',
  },
  C03: {
    summary: '超凡升天将扰乱名额变为道具资格',
    note: '按超凡升天真实转化资格的原因事件判定，不根据道具增加猜测。',
  },
  C04: {
    summary: '奖励资格被嗝屁猫的尾巴消除',
    note: '先获得资格，再由尾巴效果真实消除奖励；市场排名本就落选不属于此项。',
  },
  C05: {
    summary: '嗝屁猫的尾巴将奖励变为两份',
    note: '按尾巴真实复制事件判定；复制件数不增加最高价奖励机会次数。',
  },
  C06: {
    summary: '六面骰触发房间得分翻倍',
    note: '只检查六面骰真实翻倍原因事件；随后被其他效果清零也不撤销本项触发。',
  },
  C07: {
    summary: '同局触发两种道具的清零效果',
    note: '永恒六面骰与巴比伦大淫妇必须在同局真实触发，可以在同房出现；清零前为0仍可计入。展示单局最高的已触发种类数，不跨局拼接。',
  },
  D01: {
    summary: '偷钱袋实际偷取他人资金',
    note: '必须实际窃取其他玩家的正金额资金；仅持有道具或触发但未得到资金不计入。',
  },
  D02: {
    summary: 'Steam大促减少正常竞拍扣款',
    note: '按正常竞拍实际少扣款的效果事件判定，不把屏障退款当作打折。',
  },
  D03: {
    summary: '累计通过利息获得1000资金',
    note: '仅累计利息真实产生的资金，不统计原始本金、福袋或其他来源。',
  },
  D04: {
    summary: '低资金下获得穷人护符强化加成',
    note: '按现行低资金阈值及真实强化加算事件判定，不修改道具条件，也不从最终积分倒推。',
  },
  D05: {
    summary: '靠幸运脚获得原本无资格的奖励',
    note: '幸运脚必须是新增资格的必要原因，且道具真实发放；原本已有合作区或其他资格时不计入。',
  },
  D06: {
    summary: '正常竞拍投入全部可用资金',
    note: '行动前可用资金必须大于0，按正常竞拍名义报价核对；后续打折或屏障退款不取消全押事实。',
  },
  E01: {
    summary: '正房间得分被永恒六面骰清零',
    note: '必须有真实清零原因，且正式四位精度未清零应得分大于0；缺少精确证据时不猜测、不补发。',
  },
  E02: {
    summary: '获得更多选择或更多选择?',
    note: '只计房间实际发放；角色初始自带道具与伊甸随机初始道具不算获得。',
  },
  E03: {
    summary: '获得一次BOSS房道具奖励',
    note: '以BOSS房实际发放为准，不是取得任意属于BOSS道具池的初始装备或其他房间道具。',
  },
  E04: {
    summary: '获得一次硫磺火',
    note: '只计房间实际发放的硫磺火；初始自带不计，短硫磺火不是本项要求的道具。',
  },
  E05: {
    summary: '累计获得3件宝箱房问号奖励',
    note: '以宝箱房原本隐藏的问号奖励实际发放件数累计；尾巴复制按实际件数计入，不计初始装备。',
  },
  E06: {
    summary: '完成一局正式经典模式',
    note: '以整局正式终局为准，房间结算、开局或只读查看不算；从0.5.3启用后的新完成事件统计，不追溯旧档案。',
  },
  E07: {
    summary: '取得经典最终第一名',
    note: '正式最终成绩没有其他玩家严格高于真人即满足，并列第一计入；不按排行数组下标排除并列。仅统计0.5.3启用后的新终局。',
  },
  E08: {
    summary: '分别用五名角色完成正式对局',
    note: '按五种角色去重，经典需整局正式完成；生存需正式终局存在该角色个人结果，淘汰也算。仅解锁角色或开局不增加进度，不追溯0.5.3前旧结果。',
  },
  F01: {
    summary: '在生存第一层淘汰结算中出局',
    note: '不限制AI难度；需要第一层真实的新淘汰事件，不统计AI个人或旧历史。',
  },
  F02: {
    summary: '最高难度下存活至生存正式终局',
    note: '以该局记录的最高AI难度与正式终局存活身份为准，不要求最终第一名。',
  },
  F03: {
    summary: '以存活者最低层成绩通过淘汰',
    note: '比较本层存活者的层结算成绩survivalScore，不是跨层累计分；并列最低的存活者都满足。',
  },
  F04: {
    summary: '同局连续通过前三层淘汰',
    note: '正式第一、二、三层均须产生合格的新通过事件，不跨局或借旧迁移前缀拼接；展示单局最高进度。',
  },
  F05: {
    summary: '在生存最后一次淘汰结算中出局',
    note: '由整场正式终局确认真正最后一次淘汰；必须匹配本人的新淘汰事件，不把最后可见层或AI后续淘汰误算。',
  },
  F06: {
    summary: '成为生存模式正式冠军',
    note: '以正式终局的真人冠军身份为准，任意AI难度均可；仅存活或排名数组第一不替代冠军事实。仅统计0.5.3启用后的新终局。',
  },
};
/** Soft concealment is a list policy only. Opening details intentionally reveals
 * real conditions; no reveal bit is ever saved by browsing or searching. */
export function achievementListPresentation(
  id: AchievementId,
  achieved: boolean,
) {
  const hidden = achievementCollectionMetadata[id].hidden && !achieved;
  return {
    hidden,
    name: hidden ? '???' : achievementCatalog.find((a) => a.id === id)!.name,
    summary: hidden
      ? '隐藏成就 · 点击查看详情'
      : achievementPresentation[id].summary,
  };
}
export type AchievementStatusFilter = 'all' | 'achieved' | 'pending';
export type AchievementSort = 'catalog' | 'recent' | 'progress';
export interface AchievementFilters {
  query: string;
  category: AchievementCategory | 'all';
  status: AchievementStatusFilter;
  sort: AchievementSort;
  tier?: AchievementTier | 'all';
}
export function selectAchievements(
  filters: AchievementFilters,
  progress: Partial<Record<AchievementId, number>>,
  achieved: Partial<Record<AchievementId, string>>,
) {
  const query = filters.query.trim().toLocaleLowerCase('zh-CN');
  return achievementCatalog
    .filter(
      (a) =>
        (filters.category === 'all' || a.category === filters.category) &&
        (!filters.tier ||
          filters.tier === 'all' ||
          achievementCollectionMetadata[a.id].tier === filters.tier) &&
        (filters.status === 'all' ||
          (filters.status === 'achieved'
            ? !!achieved[a.id]
            : !achieved[a.id])) &&
        (!query ||
          `${a.id} ${achievementListPresentation(a.id, !!achieved[a.id]).name}`
            .toLocaleLowerCase('zh-CN')
            .includes(query)),
    )
    .sort((a, b) => {
      if (filters.sort === 'recent') {
        const left = achieved[a.id],
          right = achieved[b.id];
        if (left !== right)
          return left && right ? right.localeCompare(left) : left ? -1 : 1;
      }
      if (filters.sort === 'progress') {
        const ratio = (id: AchievementId, target: number) =>
          achieved[id]
            ? 1
            : achievementCollectionMetadata[id].hidden
              ? 0
              : Math.min(progress[id] ?? 0, target) / target;
        const difference = ratio(b.id, b.target) - ratio(a.id, a.target);
        if (difference) return difference;
      }
      return a.id.localeCompare(b.id);
    });
}
