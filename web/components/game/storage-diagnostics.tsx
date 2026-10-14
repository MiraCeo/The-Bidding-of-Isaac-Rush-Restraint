import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getPreferenceStorage } from '@/lib/ui/game-preferences';
import {
  inspectStorage,
  siteStorageEstimate,
  type StorageInspection,
  type SiteEstimate,
  type StorageGroup,
} from '@/lib/ui/storage-inspection';
import {
  persistenceMetrics,
  type PersistenceMetric,
} from '@/lib/ui/persistence-metrics';

const size = (value: number | null) =>
  value === null
    ? '不可用'
    : value >= 1024 * 1024 * 1024
      ? `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`
      : value < 1024 * 1024
        ? `${(value / 1024).toFixed(1)} KiB`
        : `${(value / 1024 / 1024).toFixed(2)} MiB`;
const groups: Record<StorageGroup, string> = {
  classic: '经典',
  survival: '生存',
  profile: '档案',
  preferences: '偏好',
  legacy: '旧开发缓存',
  other: '其他',
};
const phases: Record<string, string> = {
  startup: '启动读取',
  character_selection: '选角／清理当前键',
  room_action: '行动草稿',
  room_result: '房间结算',
  room_ranking: '房间排行',
  floor_result: '层末结算',
  game_result: '经典终局',
  competition_complete: '生存终局',
};
interface Snapshot {
  inspection: StorageInspection;
  metrics: PersistenceMetric[];
  site: SiteEstimate | null;
}
/** Explicit read-only refresh. Never probes/fills quota or removes user/legacy data. */
export function StorageDiagnostics() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [busy, setBusy] = useState(false),
    request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  async function refresh() {
    const id = ++request.current;
    setBusy(true);
    const inspection = inspectStorage(getPreferenceStorage()),
      metrics = persistenceMetrics();
    setSnapshot({ inspection, metrics, site: null });
    let manager: Pick<StorageManager, 'estimate'> | null = null;
    try {
      manager =
        typeof navigator === 'undefined' ? null : (navigator.storage ?? null);
    } catch {
      /* Browser capability not accessible. */
    }
    const site = await siteStorageEstimate(manager);
    if (id === request.current) {
      setSnapshot({ inspection, metrics, site });
      setBusy(false);
    }
  }
  return (
    <details
      className="settings-group storage-diagnostics"
      onToggle={(event) => {
        if (event.currentTarget.open && !snapshot && !busy) void refresh();
      }}
    >
      <summary>浏览器存储与保存开销</summary>
      <div className="storage-diagnostics-heading">
        <p>仅测量当前浏览器来源。不会写入测试数据、清空存档或删除旧缓存。</p>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void refresh()}
        >
          {busy ? '正在测量存储…' : '刷新存储测量'}
        </Button>
      </div>
      {snapshot && (
        <>
          <div className="storage-diagnostics-metrics">
            <div>
              <span>已读条目</span>
              <strong>
                {snapshot.inspection.scannedCount} /{' '}
                {snapshot.inspection.reportedCount ?? '未知'}
              </strong>
            </div>
            <div>
              <span>文本UTF8大小（含键）</span>
              <strong>
                {snapshot.inspection.status === 'unavailable'
                  ? '不可用'
                  : size(snapshot.inspection.totalUtf8Bytes)}
              </strong>
            </div>
            <div>
              <span>UTF16文本占用估算（含键）</span>
              <strong>
                {snapshot.inspection.status === 'unavailable'
                  ? '不可用'
                  : size(snapshot.inspection.totalUtf16EstimateBytes)}
              </strong>
            </div>
          </div>
          {snapshot.inspection.message && (
            <p className="utility-notice">{snapshot.inspection.message}</p>
          )}
          <p>
            这两种文本口径不能相加，也不是磁盘实际占用或剩余容量。自动存档仍是原JSON，下载文件压缩不等于自动存储变小。
          </p>
          {snapshot.inspection.entries.some(
            (entry) => entry.group === 'legacy',
          ) && (
            <p className="utility-notice">
              旧开发缓存也占用本来源空间；新版不读取、不迁移，本页不会自动清理。
            </p>
          )}
          <div className="storage-diagnostics-table">
            <table className="survival-table">
              <caption className="sr-only">当前来源存储文本占用</caption>
              <thead>
                <tr>
                  <th>内容</th>
                  <th>分类</th>
                  <th>UTF8</th>
                  <th>UTF16估算</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.inspection.entries.map((entry, i) => (
                  <tr key={i}>
                    <td>{entry.label}</td>
                    <td>{groups[entry.group]}</td>
                    <td>{size(entry.utf8Bytes)}</td>
                    <td>{size(entry.utf16EstimateBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {snapshot.inspection.status === 'available' &&
            !snapshot.inspection.entries.length && (
              <p>本来源当前没有可读取的存储条目。</p>
            )}
          <p>
            站点级估算：使用{' '}
            {snapshot.site ? size(snapshot.site.usageBytes) : '读取中'} ／额度{' '}
            {snapshot.site ? size(snapshot.site.quotaBytes) : '读取中'}
            。不是localStorage的可用空间或上限。
            <br />
            {snapshot.site &&
              (snapshot.site.usageBytes === null ||
                snapshot.site.quotaBytes === null) &&
              snapshot.site.message}
          </p>
          <h4>本次页面会话的保存／读取耗时</h4>
          <p>
            最多保留最近60次，以下显示最近12次；只在内存中记录，刷新页面后重置。包括序列化／验证和同步存储调用，不等于纯磁盘耗时或帧率。
          </p>
          {snapshot.metrics.length ? (
            <div className="storage-diagnostics-table">
              <table className="survival-table">
                <caption className="sr-only">最近保存读取耗时</caption>
                <thead>
                  <tr>
                    <th>模式</th>
                    <th>操作</th>
                    <th>阶段</th>
                    <th>总耗时</th>
                    <th>结果</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.metrics
                    .slice(-12)
                    .reverse()
                    .map((metric, i) => (
                      <tr key={i}>
                        <td>{metric.mode === 'classic' ? '经典' : '生存'}</td>
                        <td>{metric.operation === 'save' ? '保存' : '读取'}</td>
                        <td>{phases[metric.phase] ?? metric.phase}</td>
                        <td>
                          {metric.durationMs === null
                            ? '计时不可用'
                            : `${metric.durationMs.toFixed(2)} ms`}
                        </td>
                        <td>{metric.success ? '完成' : '未完成'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>本次页面会话暂无保存／读取测量。</p>
          )}
        </>
      )}
    </details>
  );
}
