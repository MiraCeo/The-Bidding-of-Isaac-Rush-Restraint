import { Button } from '@/components/ui/button';
import type { ModeDataCandidate } from '@/lib/ui/mode-data';
import { survivalDifficultyLabel } from '@/lib/game/survival-difficulty';
import { BackupProfileNotice } from './backup-profile-notice';
import type { BackupProfileGuard } from './use-backup-profile-guard';

export function ModeFilePreview({
  candidate,
  restoreProfile,
  onProfileChange,
  onConfirm,
  onCancel,
  profileGuard,
  onProfileRecheck,
}: {
  candidate: Extract<
    ModeDataCandidate,
    { kind: 'survival-checkpoint' | 'survival-replay' | 'survival-backup' }
  >;
  restoreProfile: boolean;
  onProfileChange: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
  profileGuard: BackupProfileGuard;
  onProfileRecheck: () => void;
}) {
  const game =
    candidate.kind === 'survival-checkpoint'
      ? candidate.document.game
      : candidate.kind === 'survival-backup'
        ? candidate.document.checkpoint.game
        : null;
  const log =
    candidate.kind === 'survival-replay' ? candidate.document.replay : null;
  return (
    <section className="settings-group data-candidate">
      <h3>
        生存模式 · v5{' '}
        {candidate.kind === 'survival-replay'
          ? '只读回放'
          : candidate.kind === 'survival-backup'
            ? '完整备份'
            : '续玩检查点'}
      </h3>
      <p>{candidate.filename}</p>
      <dl>
        <dt>AI难度</dt>
        <dd>
          {survivalDifficultyLabel(
            game?.aiDifficulty ?? log?.ruleFacts.parameters.aiDifficulty,
            log?.ruleFacts.engineVersion,
          )}
        </dd>
        <dt>AI策略</dt>
        <dd>
          {(game?.aiPolicy ?? log?.ruleFacts.parameters.aiPolicy) ===
          'role-aware-1'
            ? '角色适配版（最高保持原基线）'
            : '历史原策略'}
        </dd>
        <dt>已结算房间</dt>
        <dd>{game?.roomRecords.length ?? log?.rooms.length ?? 0}</dd>
        <dt>进度</dt>
        <dd>
          {game
            ? `第 ${game.floorIndex + 1} 层 · 房间 ${game.roomIndex + 1}/5`
            : log?.final
              ? '整场已结束'
              : '部分事实回放'}
        </dd>
      </dl>
      {candidate.kind === 'survival-backup' && (
        <div className="data-profile-choice">
          <label>
            <input
              type="checkbox"
              checked={restoreProfile}
              onChange={(event) => onProfileChange(event.target.checked)}
            />
            同时恢复文件中的玩家进度
          </label>
          <BackupProfileNotice
            guard={profileGuard}
            incoming={candidate.document.profile}
            onRecheck={onProfileRecheck}
          />
        </div>
      )}
      <p>
        {candidate.kind === 'survival-replay'
          ? '只读查看，不替换任何正在进行的对局，也不登记玩家进度。'
          : '确认后载入这局生存对局；未勾选时保留本机玩家进度。经典存档独立保留。'}
      </p>
      <div className="data-actions">
        <Button
          onClick={onConfirm}
          disabled={restoreProfile && profileGuard.blocked}
        >
          {candidate.kind === 'survival-replay'
            ? '打开生存回放'
            : '载入生存对局'}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          取消
        </Button>
      </div>
    </section>
  );
}
