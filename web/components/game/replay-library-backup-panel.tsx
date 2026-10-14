import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { characterNames } from '@/lib/game';
import { replayLibrary, replayLibraryChanged } from '@/lib/ui/replay-library';
import {
  libraryBackupLimits,
  LibraryBackupChangedError,
  type LibraryRestorePreview,
} from '@/lib/ui/replay-library-backup-format';
import { downloadJsonFile } from '@/lib/ui/json-download';

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '整库操作未完成，原资料保留。';
const size = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MiB`;
export function ReplayLibraryBackupPanel({
  disabled,
  onBusyChange,
}: {
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [phase, setPhase] = useState<
    'idle' | 'reading' | 'exporting' | 'restoring'
  >('idle');
  const [message, setMessage] = useState('');
  const [candidate, setCandidate] = useState<{
    filename: string;
    source: string;
    preview: LibraryRestorePreview;
  } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false),
    [stale, setStale] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    state = useRef({
      live: true,
      token: 0,
      controller: null as AbortController | null,
    });
  const busy = phase !== 'idle';
  const cancel = useCallback(() => {
    const current = state.current;
    current.token++;
    current.controller?.abort();
    setPhase('idle');
    onBusyChange(false);
    setCandidate(null);
    setAcknowledged(false);
    setStale(false);
    setMessage('已取消整库读取／导出／预览，未执行增量恢复。');
  }, [onBusyChange]);
  useEffect(() => {
    const current = state.current;
    current.live = true;
    const node = input.current;
    node?.addEventListener('cancel', cancel);
    return () => {
      current.live = false;
      current.token++;
      current.controller?.abort();
      node?.removeEventListener('cancel', cancel);
      onBusyChange(false);
    };
  }, [cancel, onBusyChange]);
  useEffect(() => {
    if (!candidate || phase === 'restoring') return;
    let live = true;
    const observe = async () => {
      try {
        if (
          !(await replayLibrary.isBackupPreviewCurrent(candidate.preview)) &&
          live
        ) {
          setStale(true);
          setAcknowledged(false);
          setMessage('预览后回放库已变化，请重新核对；未写入。');
        }
      } catch (error) {
        if (live) {
          setStale(true);
          setAcknowledged(false);
          setMessage(errorText(error));
        }
      }
    };
    const listener = () => {
      void observe();
    };
    window.addEventListener(replayLibraryChanged, listener);
    window.addEventListener('focus', listener);
    return () => {
      live = false;
      window.removeEventListener(replayLibraryChanged, listener);
      window.removeEventListener('focus', listener);
    };
  }, [candidate, phase]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        phase !== 'restoring' &&
        (candidate || busy)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel();
      }
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [candidate, busy, phase, cancel]);
  function begin(next: typeof phase) {
    const current = state.current;
    current.controller?.abort();
    current.controller = new AbortController();
    const token = ++current.token,
      signal = current.controller.signal;
    setPhase(next);
    onBusyChange(true);
    setAcknowledged(false);
    setStale(false);
    setMessage('正在核验整库资料…');
    const active = () =>
      current.live && current.token === token && !signal.aborted;
    return {
      signal,
      active,
      onProgress: (text: string) => {
        if (active()) setMessage(text);
      },
    };
  }
  function finish(active: () => boolean) {
    if (active()) {
      setPhase('idle');
      onBusyChange(false);
    }
  }
  async function exportAll() {
    setCandidate(null);
    const operation = begin('exporting');
    try {
      const exported = await replayLibrary.exportBackup(operation);
      if (operation.active()) {
        downloadJsonFile(
          exported.source,
          `isaac-library-${new Date().toISOString().slice(0, 10)}.json`,
        );
        setMessage(
          `已请求下载整库备份：${exported.document.entries.length} 份回放、${exported.document.removed.length} 条删除标记。包含两个模式，不受筛选影响；未改写本机数据。`,
        );
      }
    } catch (error) {
      if (operation.active())
        setMessage(
          `整库导出失败：${errorText(error)} 未生成缺失正文的半份备份。`,
        );
    } finally {
      finish(operation.active);
    }
  }
  async function read(
    file?: File,
    previous?: { source: string; filename: string },
  ) {
    setCandidate(null);
    if (!file && !previous) {
      cancel();
      return;
    }
    const operation = begin('reading');
    try {
      if (file && file.size > libraryBackupLimits.fileBytes)
        throw Error('整库文件超过160 MiB，未读取。');
      const source = previous?.source ?? (await file!.text()),
        filename = previous?.filename ?? file!.name;
      if (!operation.active()) return;
      const preview = await replayLibrary.previewBackup(source, operation);
      if (operation.active()) {
        setCandidate({ filename, source, preview });
        setMessage('整库文件与本机事实已核验，只预览；确认后才增量恢复。');
      }
    } catch (error) {
      if (operation.active())
        setMessage(
          `整库校验失败：${errorText(error)} 本批0写入；当前回放、对局与玩家档案保留。`,
        );
    } finally {
      finish(operation.active);
    }
  }
  async function restore() {
    if (!candidate || !acknowledged || stale || !candidate.preview.canRestore)
      return;
    const operation = begin('restoring');
    try {
      const result = await replayLibrary.restoreBackup(
        candidate.preview,
        operation,
      );
      if (operation.active()) {
        setCandidate(null);
        setMessage(
          `整库恢复完成：新增 ${result.added} 份、重复 ${result.duplicates} 份、保留本机删除决定 ${result.blocked} 份；新增删除标记 ${result.markersAdded} 条，冲突标记 ${result.markerConflicts} 条未覆盖。对局与玩家档案未改变。`,
        );
      }
    } catch (error) {
      if (operation.active()) {
        setAcknowledged(false);
        if (error instanceof LibraryBackupChangedError) setStale(true);
        setMessage(
          `整库恢复失败：${errorText(error)} 本批事务未提交，原资料保留。`,
        );
      }
    } finally {
      finish(operation.active);
    }
  }
  const preview = candidate?.preview;
  return (
    <section className="library-backup" aria-labelledby="library-backup-title">
      <h4 id="library-backup-title">整库备份与恢复</h4>
      <p className="utility-notice">
        包含经典＋生存全部原正文、首次来源、索引和删除证据，不受筛选影响。续玩存档、玩家档案与设置需分别备份。
      </p>
      <details className="data-technical">
        <summary>整库容量与文件边界</summary>
        <p>
          每份回放仍限8 MiB，整库正文64 MiB／100份；整库v1文件独立限160
          MiB，元数据16
          MiB／删除标记8192条，不静默截断。保留正文原有压缩容器，不再整批重复压缩。
        </p>
      </details>
      <div className="library-toolbar">
        <Button
          variant="secondary"
          disabled={disabled || busy}
          onClick={() => void exportAll()}
        >
          导出整库备份
        </Button>
        <label className="library-file">
          读取整库备份
          <input
            ref={input}
            type="file"
            accept=".json,application/json"
            aria-label="读取整库备份文件"
            disabled={disabled || busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              void read(file);
            }}
          />
        </label>
        {busy && phase !== 'restoring' && (
          <Button variant="secondary" onClick={cancel}>
            取消整库操作
          </Button>
        )}
      </div>
      {candidate && preview && (
        <section className="library-confirm" aria-label="整库增量恢复预览">
          <h4>{candidate.filename}</h4>
          <p>
            备份时间 {new Date(preview.exportedAt).toLocaleString('zh-CN')} ·
            构建 {preview.exportedBuild}
          </p>
          <p>
            回放：新增 {preview.added} 份／重复 {preview.duplicates}{' '}
            份／本机删除保护 {preview.blocked} 份。
          </p>
          <p>
            删除标记：新增 {preview.markerAdded} 条／已有{' '}
            {preview.markerDuplicates} 条／本机存活冲突{' '}
            {preview.markerConflicts} 条保留现状。
          </p>
          <p>
            预计恢复后 {preview.finalCount} / 100 份，{size(preview.finalBytes)}{' '}
            / 64 MiB。
          </p>
          <p>
            同键／等价记录保留本机首份正文与来源。本机删除保护不自动复活，导入的删除标记不删除本机存活记录。备份里已存在的不同原键历史副本，在空库中原样恢复；不按中间副本扩展相似关系。
          </p>
          <details>
            <summary>逐份核对（{preview.rows.length} 份）</summary>
            <ul>
              {preview.rows.map((row) => (
                <li key={row.entry.key}>
                  {row.entry.mode === 'classic' ? '经典' : '生存'} ·{' '}
                  {characterNames[row.entry.characterId]} · 种子{' '}
                  {row.entry.seed} · {row.entry.rooms} 房 ·{' '}
                  {row.status === 'add'
                    ? '新增'
                    : row.status === 'duplicate'
                      ? '重复，保留本机首份'
                      : '受本机删除保护，不恢复'}
                </li>
              ))}
            </ul>
          </details>
          {!preview.canRestore && <p role="alert">{preview.reason}</p>}
          {stale && (
            <p role="alert">本机回放库已变化，此预览已失效，请重新核对。</p>
          )}
          <label>
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={disabled || busy || stale || !preview.canRestore}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            确认按此预览增量恢复，不清空、不覆盖现有回放
          </label>
          <div className="data-actions">
            <Button
              disabled={
                disabled ||
                busy ||
                stale ||
                !acknowledged ||
                !preview.canRestore
              }
              onClick={() => void restore()}
            >
              确认增量恢复整库
            </Button>
            <Button
              variant="secondary"
              disabled={disabled || busy}
              onClick={() => void read(undefined, candidate)}
            >
              重新核对回放库
            </Button>
            <Button
              variant="secondary"
              disabled={phase === 'restoring'}
              onClick={cancel}
            >
              取消整库恢复
            </Button>
          </div>
        </section>
      )}
      <output className="save-message" aria-live="polite">
        {message}
      </output>
    </section>
  );
}
