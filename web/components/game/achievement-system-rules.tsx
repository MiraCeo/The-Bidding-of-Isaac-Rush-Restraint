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
