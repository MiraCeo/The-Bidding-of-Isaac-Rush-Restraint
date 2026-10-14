import { Button } from '@/components/ui/button';
import type { BackupProfileGuard } from './use-backup-profile-guard';
import type { PlayerProfile } from '@/lib/ui/player-profile';

export function BackupProfileNotice({
  guard,
  incoming,
  onRecheck,
}: {
  guard: BackupProfileGuard;
  incoming: PlayerProfile;
  onRecheck: () => void;
}) {
  return (
    <div className="data-profile-preview">
      <p>
        本机已保留完成记录：
        {guard.current?.profile?.history.length ?? '无法核验'}
        ；文件已保留完成记录：{incoming.history.length}
        。恢复档案为替换，不合并累计。
      </p>
      {guard.blocked && (
        <p role="alert">
          预览后本机玩家档案已变化或无法读取。未覆盖，请重新核对；也可取消勾选，仅载入对局。
        </p>
      )}
      <Button variant="secondary" onClick={onRecheck}>
        重新核对本机档案
      </Button>
    </div>
  );
}
