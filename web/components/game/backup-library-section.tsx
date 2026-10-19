import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { BackupObjectHeading } from './backup-object-heading';
import { ReplayLibraryBackupPanel } from './replay-library-backup-panel';

export function BackupLibrarySection({ onRecords }: { onRecords: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <section
      className="backup-library-section"
      aria-labelledby="backup-library-title"
      aria-busy={busy}
    >
      <BackupObjectHeading
        kind="library"
        title="完整回放库"
        titleId="backup-library-title"
        badge="两模式共用"
        description="整库备份保留经典与生存的全部已入库回放及删除证据；不包含续玩位置、玩家档案或设置。"
      />
      <ReplayLibraryBackupPanel
        disabled={false}
        onBusyChange={setBusy}
        focusPreview
      />
      <div className="backup-library-link">
        <span>单份回放的查看、导出、入库与删除在对局记录中管理。</span>
        <Button variant="secondary" onClick={onRecords}>
          前往对局记录
        </Button>
      </div>
    </section>
  );
}
