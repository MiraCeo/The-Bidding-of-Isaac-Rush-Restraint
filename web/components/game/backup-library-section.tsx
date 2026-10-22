import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { BackupObjectHeading } from './backup-object-heading';
import { ReplayLibraryBackupPanel } from './replay-library-backup-panel';
import {
  replayLibrary,
  replayLibraryChanged,
  replayLibraryLimits,
} from '@/lib/ui/replay-library';

const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : `${(bytes / 1024 / 1024).toFixed(2)} MiB`;

export function BackupLibrarySection({ onRecords }: { onRecords: () => void }) {
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [summary, setSummary] = useState<{
    count: number;
    bytes: number;
  } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true,
      request = 0;
    const refresh = async () => {
      const token = ++request;
      setSummary(null);
      setError('');
      try {
        const entries = await replayLibrary.list();
        const bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
        if (!Number.isSafeInteger(bytes))
          throw Error('库容量超出安全计量范围，原资料保留。');
        if (live && token === request)
          setSummary({ count: entries.length, bytes });
      } catch (error) {
        if (live && token === request)
          setError(
            error instanceof Error
              ? error.message
              : '库状态未能读取，原资料保留。',
          );
      }
    };
    const listener = () => {
      void refresh();
    };
    void refresh();
    window.addEventListener(replayLibraryChanged, listener);
    window.addEventListener('focus', listener);
    return () => {
      live = false;
      request++;
      window.removeEventListener(replayLibraryChanged, listener);
      window.removeEventListener('focus', listener);
    };
  }, [revision]);
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
        description="备份两模式全部已入库回放与删除证据，不含续玩位置、玩家档案或设置。"
      />
      <div className="backup-library-summary" aria-live="polite">
        {summary ? (
          <>
            <span>
              全库记录 <strong>{summary.count}</strong> /{' '}
              {replayLibraryLimits.count} 份
            </span>
            <span>
              正文大小 <strong>{size(summary.bytes)}</strong> /{' '}
              {size(replayLibraryLimits.bytes)}
            </span>
          </>
        ) : error ? (
          <>
            <output className="save-message">库状态未能读取：{error}</output>
            <Button
              variant="secondary"
              onClick={() => setRevision((value) => value + 1)}
            >
              重试读取库状态
            </Button>
          </>
        ) : (
          <span>正在读取库状态…</span>
        )}
      </div>
      <ReplayLibraryBackupPanel
        disabled={false}
        onBusyChange={setBusy}
        focusPreview
        compact
      />
      <div className="backup-library-link">
        <span>索引统计；导出仍会核验正文。单份管理：</span>
        <Button variant="secondary" onClick={onRecords}>
          前往对局记录
        </Button>
      </div>
    </section>
  );
}
