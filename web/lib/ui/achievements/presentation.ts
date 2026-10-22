import type { AchievementId as V056Id } from './v056-catalog';
import { revision065Series } from './revision065-catalog';
import { achievementSeriesCopy } from './series-copy';
import { balance081Target } from './balance081-targets';
import { achievementNumber, compareAchievementNumbers } from './numbering';
import {
  achievementCatalog,
  achievementCategories,
  type AchievementDefinition,
  type AchievementCategory,
  type AchievementId,
} from './catalog';

import {
  achievementCollectionMetadata,
  type AchievementTier,
} from './collection-metadata';

/** Presentation only: does not add facts, evaluate achievements or write profiles. */
const legacyPresentation: Readonly<
  Record<V056Id, { summary: string; note: string }>
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
    note: '必须实际发放道具；同组同时具备最高价与合作区资格时，2种真实来源可分别计入对应成就。',
  },
  B02: {
    summary: '通过最高价资格累计获得10次道具',
    note: '按实际交付对应的最高价奖励机会计数，不按尾巴复制后的件数翻倍。同组也具备合作区资格时不排除最高价来源。',
  },
  B03: {
    summary: '更多选择取得2组资格后失去1件',
    note: '须先同时取得A、B 2组资格，再由更多选择真实随机舍弃；不根据最终道具数量倒推。',
  },
  B04: {
    summary: '观望时见证奖励因扰乱轮空',
    note: '真人在本房观望，且至少1个奖励名额确实因扰乱占位而轮空。',
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
    summary: '嗝屁猫的尾巴将奖励变为2份',
    note: '按尾巴真实复制事件判定；复制件数不增加最高价奖励机会次数。',
  },
  C06: {
    summary: '六面骰触发房间得分翻倍',
    note: '只检查六面骰真实翻倍原因事件；随后被其他效果清零也不撤销本项触发。',
  },
  C07: {
    summary: '同局触发2种道具的清零效果',
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
    summary: '全押竞拍，实际扣款达本层初始资金50%',
    note: '正常竞拍名义报价等于行动前全部正金额资金，折扣后实际扣款须至少为本层角色初始资金的50%；屏障或福袋等后续返还不撤销扣款。不要求获奖，缺少本金证据不倒推。',
  },
  E01: {
    summary: '正房间得分被永恒六面骰清零',
    note: '必须有真实清零原因，且正式4位精度未清零应得分大于0；缺少精确证据时不猜测、不补发。',
  },
  E02: {
    summary: '获得更多选择或更多选择?',
    note: '只计房间实际发放；角色初始自带道具与伊甸随机初始道具不算获得。',
  },
  E03: {
    summary: '获得1次BOSS房道具奖励',
    note: '以BOSS房实际发放为准，不是取得任意属于BOSS道具池的初始装备或其他房间道具。',
  },
  E04: {
    summary: '获得1次硫磺火',
    note: '只计房间实际发放的硫磺火；初始自带不计，短硫磺火不是本项要求的道具。',
  },
  E05: {
    summary: '累计获得3件宝箱房问号奖励',
    note: '以宝箱房原本隐藏的问号奖励实际发放件数累计；尾巴复制按实际件数计入，不计初始装备。',
  },
  E06: {
    summary: '完成1局正式经典模式',
    note: '以整局正式终局为准，房间结算、开局或只读查看不算；从0.5.3启用后的新完成事件统计，不追溯旧档案。',
  },
  E07: {
    summary: '取得经典最终第1名',
    note: '正式最终成绩没有其他玩家严格高于真人即满足，并列第1计入；不按排行数组下标排除并列。仅统计0.5.3启用后的新终局。',
  },
  E08: {
    summary: '分别用5名角色完成正式对局',
    note: '按5种角色去重，经典需整局正式完成；生存需正式终局存在该角色个人结果，淘汰也算。仅解锁角色或开局不增加进度，不追溯0.5.3前旧结果。',
  },
  F01: {
    summary: '在生存第1层淘汰结算中出局',
    note: '不限制AI难度；需要第1层真实的新淘汰事件，不统计AI个人或旧历史。',
  },
  F02: {
    summary: '最高难度下存活至生存正式终局',
    note: '以该局记录的最高AI难度与正式终局存活身份为准，不要求最终第1名。',
  },
  F03: {
    summary: '以存活者最低层成绩通过淘汰',
    note: '比较本层存活者的层结算成绩survivalScore，不是跨层累计分；并列最低的存活者都满足。',
  },
  F04: {
    summary: '同局连续通过前3层淘汰',
    note: '正式第1、2、3层均须产生合格的新通过事件，不跨局或借旧迁移前缀拼接；展示单局最高进度。',
  },
  F05: {
    summary: '在生存最后1次淘汰结算中出局',
    note: '由整场正式终局确认真正最后1次淘汰；必须匹配本人的新淘汰事件，不把最后可见层或AI后续淘汰误算。',
  },
  F06: {
    summary: '成为生存模式正式冠军',
    note: '以正式终局的真人冠军身份为准，任意AI难度均可；仅存活或排名数组第1不替代冠军事实。仅统计0.5.3启用后的新终局。',
  },
  A04: {
    summary: '同局失败后在后续房间实际获奖',
    note: '失败和实际获奖必须是启用后同一父分支内不同房间的新正常竞拍；不能跨局或借旧前缀拼接。',
  },
  A05: {
    summary: '同局失败后取得经典最终第1',
    note: '经典最终并列第1计入；失败与终局都须来自启用后的同一场、同一父分支，不用跨局的竞拍失败或经典第1名成就解锁状态代替。',
  },
  B07: {
    summary: '最高价资格实际获奖1次',
    note: '与B02和B08共用实际奖励机会；尾巴复制不增加次数，未交付不计；原可靠账本可继承，新徽章在新合格事件保存后确认。',
  },
  B08: {
    summary: '最高价资格累计实际获奖50次',
    note: '与B02共用最高价实际奖励机会，复制不多计。等级独立保存时间，不要求重新取得已拥有的银徽章。',
  },
  B09: {
    summary: '恰以本组最后高价名额实际获奖',
    note: '只认正常竞拍、本组正式高价排序第N位，N包含扰乱占位；实际交付且有最高价资格，不是最后1个正常获奖者。',
  },
  B11: {
    summary: '无最高价资格，凭合作胜过更高报价',
    note: '只认正常竞拍同组：无最高价资格、有合作来源并实际发奖，且至少另1名参与者市场等价报价严格更高；不比较名义金额。',
  },
  C08: {
    summary: '超凡升天转化资格并实际发奖',
    note: '必须把真人超凡升天资格转化和实际道具交付关联到同一奖励组；另一组获奖不能替代本组发奖。',
  },
  C09: {
    summary: '双扰乱令A、B名额分别轮空',
    note: '更多选择?允许的2份A、B扰乱，分别造成真实空位；AI占位不算真人、被超凡升天赎回不算轮空，不改实际预算或补位规则。',
  },
  D07: {
    summary: '累计通过利息获得100资金',
    note: '与D03、D08共用真实利息资金，包含有原因的层初增资和进房利息，不把本金或其他资金计入。',
  },
  D08: {
    summary: '累计通过利息获得5000资金',
    note: '同一可靠利息总数判定不同等级，5000是总累计而不是在1000之后再额外取得5000；原时间和等级不重置。',
  },
  D09: {
    summary: '全额正常报价并实际取得本组道具',
    note: '名义报价等于行动前全部正资金，且同份正常行动的本组实际获奖；打折或退款不撤销全额报价。',
  },
  D10: {
    summary: 'Steam大促累计节省100资金',
    note: '只累加本版新金额原因事实；旧D02布尔不能反推节省金额，不能扫描旧回放补录。',
  },
  D11: {
    summary: '偷钱袋累计实际窃取100资金',
    note: '合格entry凭据已保存的真实窃取金额可以继承；不能用D01已完成猜测曾窃取多少资金。',
  },
  D12: {
    summary: '同局新利息累计获得200资金',
    note: '仅启用后同一父分支的利息相加；不是跨局利息总数，不借升级前已发生的进房资金事件。',
  },
  E09: {
    summary: '累计完成5局正式经典模式',
    note: '只计合格classic complete，每个正式对局root计1次；恢复、同根分支或相同身份复玩不增加，旧history不补。',
  },
  E10: {
    summary: `累计完成${balance081Target('E10', 20)}局正式经典模式`,
    note: `与5局经典完成成就共用经典完成根集合，${balance081Target('E10', 20)}是总局数；只继承0.5.3起已记账的正式终局，不从首次完成布尔反推局数。`,
  },
  E11: {
    summary: '以撒取得经典最终第1名',
    note: '以本局complete记录的以撒与正式经典竞争第1为准，并列也算；仅新正式终局，不看现在选择的角色。',
  },
  E12: {
    summary: '游魂同局获屏障退款并完成经典',
    note: '仅新退款与新经典终局组成的同局分支；屏障必须退回正资金，不要求最终第1名，不借屏障退款成就的跨局解锁状态。',
  },
  E15: {
    summary: '雅阁2组不等报价且至少1次获奖',
    note: '2份正常bid分别面向A、B、名义金额不相等；至少本组实际交付1份即可。保留50%总预算与更多选择舍弃规则。',
  },
  F07: {
    summary: '完成1局正式生存，淘汰也算',
    note: '完整正式终局存在真人个人结果即可，被淘汰也计；按实际对局root去重，不能中途退出就计完成。',
  },
  F08: {
    summary: '累计完成5局正式生存',
    note: '与F07、F09共享生存完成根集合；淘汰也计，但须等正式终局，不能借角色解锁数推算局数。',
  },
  F09: {
    summary: '累计完成15局正式生存',
    note: '15局是总完成数；同一对局恢复或不同分支完成仍只算1次，等级各有独立时间和收藏札记。',
  },
  F10: {
    summary: '最高难度下取得正式生存冠军',
    note: '最高难度与正式冠军身份必须来自同一个新生存终局；不能把不同对局的最高难度存活和生存冠军成就合并。',
  },
  F12: {
    summary: '同局最低档存活后成为生存冠军',
    note: '同一启用后父分支至少1次以存活者最低层成绩通过淘汰，再成为正式冠军；并列最低可计，不借旧层通过或跨局解锁拼接。',
  },
};
export const achievementPresentation = {
  ...legacyPresentation,
  ...Object.fromEntries(
    achievementCatalog.flatMap((a) => {
      const series = revision065Series.find((s) => s.ids.includes(a.id));
      if (series)
        return [
          [
            a.id,
            {
              summary: achievementSeriesCopy[series.id]!.summary(a.target),
              note: a.condition,
            },
          ],
        ];
      const summary = (
        {
          B12: '同组1条获奖路径全部因扰乱轮空',
          B13: '同组2条获奖路径全部因扰乱轮空',
          E16: '游魂额外获得神圣屏障',
          C08: '同局2房将扰乱转为实际道具',
        } as Partial<Record<AchievementId, string>>
      )[a.id];
      return summary ? [[a.id, { summary, note: a.condition }]] : [];
    }),
  ),
} as Readonly<Record<AchievementId, { summary: string; note: string }>>;
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
export type AchievementSort = 'collection' | 'catalog' | 'recent' | 'progress';
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
          `${achievementNumber(a.id)} ${achievementListPresentation(a.id, !!achieved[a.id]).name}`
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
      return compareAchievementNumbers(a.id, b.id);
    });
}

/** All-view categories are real grid boundaries. Input order (selected sorting)
 * is retained inside each category; empty groups are never rendered. */
export function groupAchievementEntries(
  entries: readonly AchievementDefinition[],
) {
  return achievementCategories.flatMap((category) => {
    const items = entries.filter((a) => a.category === category.id);
    return items.length ? [{ category, items }] : [];
  });
}
