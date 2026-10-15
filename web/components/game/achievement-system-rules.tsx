import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
/** Shared player-facing rules, not repeated in each collectible's personal note. */
export function AchievementSystemRules() {
  return (
    <>
      <div className="achievement-detail-heading">
        <div>
          <span className="achievement-eyebrow">ACHIEVEMENT RULES</span>
          <Dialog.Title>成就统计规则</Dialog.Title>
        </div>
        <Dialog.Close
          className="achievement-detail-close"
          aria-label="关闭成就详情"
        >
          <X aria-hidden="true" size={20} />
        </Dialog.Close>
      </div>
      <Dialog.Description className="achievement-detail-condition">
        成就记录已成功保存的正式游玩经历；收藏札记在对应成就达成后解锁。
      </Dialog.Description>
      <section className="achievement-detail-note">
        <h4>哪些对局参与统计</h4>
        <p>
          仅统计真人的新正式结算，不统计教学或AI的个人事件。适用模式以每项详情为准；单局型进度展示已记录的单局最高值，不代表当前连续数。
        </p>
        <h4>保存、恢复与历史</h4>
        <p>
          结算进度保存成功后才永久入账并提示。只读回放、重复导入、重复恢复和重复登记不额外增加进度；未保存的成长可在原检查点重试。
        </p>
        <p>
          新增六项从0.5.3启用后的新正式结算开始，不追溯已有0.5档案或导入旧结果；原30项也不回溯未纳入统计的旧历史。明确替换玩家档案允许成就、进度、札记与角色权限回到快照，不自动合并被替换的成果。
        </p>
        <h4>徽章等级与隐藏成就</h4>
        <p>
          现有60枚铜、银或金徽章，三组单卡三级合为54张卡片；各等级独立计完成数和时间；部分完成显示1/3或2/3。筛选按同一枚子徽章匹配，不能用铜的完成状态匹配“银＋已达成”。原36项条件／时间和角色前置保留。
        </p>
        <p>
          隐藏成就未达成时在列表显示问号和统一图标，不显示进度；点击详情仍可查看真实名称与条件。名称搜索不会提前暴露，编号可查找。已达成自动恢复完整展示，查看详情不永久揭示或写入档案。
        </p>
        <p>
          0.5.6累计阶梯仅继承已核验账本，首次新正式成长事件成功保存时确认新等级，不改旧徽章时间；新单局复合只组合启用后的同一父分支事件。Steam节省金额从新增原因记录开始，不从旧D02布尔补造。经典／生存完成按正式对局身份去重，同根分支不多算。
        </p>
        <h4>角色与收藏</h4>
        <p>
          默认开放以撒，其余角色保留各自的成就前置。一键解锁全部角色只改变角色权限，不完成任何成就，也不计为使用角色完成对局。
        </p>
        <p>成就及收藏札记不提供永久资金、积分或其他数值加成。</p>
      </section>
      <Dialog.Close className="achievement-detail-done">返回列表</Dialog.Close>
    </>
  );
}
