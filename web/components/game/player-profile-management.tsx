import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getPreferenceStorage } from '@/lib/ui/game-preferences';
import { maxFileBytes } from '@/lib/ui/file-json';
import { downloadPortableJsonFile } from '@/lib/ui/json-download';
import { compressedFileSummary } from '@/lib/ui/compressed-file';
import {
  readPlayerProfileSnapshot,
  readPlayerProfileBackup,
  serializePlayerProfileBackup,
  PlayerProfileChangedError,
  type PlayerProfileSnapshot,
  type PlayerProfileBackupDocument,
} from '@/lib/ui/player-profile-file';
import { replacePlayerProfileCoordinated } from '@/lib/ui/profile-operations';
import { subscribePlayerProfileChanges } from '@/lib/ui/profile-events';
import type { PlayerProfile } from '@/lib/ui/player-profile';
import {
  readCompletionRegistry,
  sumCounters,
} from '@/lib/ui/completion-registry';

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '玩家档案操作未完成，原资料保留。';
const localTime = (date: string) => new Date(date).toLocaleString('zh-CN');
function count(profile: PlayerProfile | null, mode: 'classic' | 'survival') {
  return profile
    ? profile.history.filter((row) => (row.mode ?? 'classic') === mode).length
    : null;
}
function ProfileSummary({
  profile,
  empty = false,
}: {
  profile: PlayerProfile | null;
  empty?: boolean;
}) {
  const registry = profile ? readCompletionRegistry(profile) : null;
  return (
    <dl className="profile-summary">
      <dt>创建时间</dt>
      <dd>{profile && !empty ? localTime(profile.createdAt) : '—'}</dd>
      <dt>更新时间</dt>
      <dd>{profile && !empty ? localTime(profile.updatedAt) : '—'}</dd>
      <dt>已保留完成记录</dt>
      <dd>{profile ? profile.history.length : '无法核验'}</dd>
      <dt>经典／生存记录</dt>
      <dd>
        {profile
          ? `${count(profile, 'classic')} / ${count(profile, 'survival')}`
          : '无法核验'}
      </dd>
      <dt>统一登记累计</dt>
      <dd>
        {!profile
          ? '无法核验'
          : registry
            ? sumCounters(Object.values(registry.groups)).completed
            : '未启用（仅含历史）'}
      </dd>
      <dt>去重凭据</dt>
      <dd>
        {!profile
          ? '无法核验'
          : registry
            ? Object.keys(registry.receipts).length
            : '—'}
      </dd>
    </dl>
  );
}
export function PlayerProfileManagement() {
  const [snapshot, setSnapshot] = useState(() =>
    readPlayerProfileSnapshot(getPreferenceStorage()),
  );
  const [candidate, setCandidate] = useState<{
    document: PlayerProfileBackupDocument;
    filename: string;
    local: PlayerProfileSnapshot;
  } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState('');
  const [reading, setReading] = useState(false),
    [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const operations = useRef({
    live: false,
    id: 0,
    read: null as AbortController | null,
    export: null as AbortController | null,
    confirm: null as AbortController | null,
  });
  const cancel = useCallback(() => {
    const state = operations.current;
    state.id++;
    state.read?.abort();
    state.confirm?.abort();
    state.export?.abort();
    setCandidate(null);
    setAcknowledged(false);
    setReading(false);
    setExporting(false);
    setImporting(false);
    setMessage('已取消档案操作，未替换本机档案。');
  }, []);
  useEffect(() => {
    const state = operations.current;
    state.live = true;
    const refresh = () =>
      queueMicrotask(() => {
        if (state.live)
          setSnapshot(readPlayerProfileSnapshot(getPreferenceStorage()));
      });
    const unsubscribe = subscribePlayerProfileChanges(refresh);
    const node = input.current;
    node?.addEventListener('cancel', cancel);
    return () => {
      state.live = false;
      state.id++;
      state.read?.abort();
      state.confirm?.abort();
      state.export?.abort();
      unsubscribe();
      node?.removeEventListener('cancel', cancel);
    };
  }, [cancel]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (candidate || reading || exporting)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel();
      }
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [candidate, reading, exporting, cancel]);
  async function read(file?: File) {
    const state = operations.current;
    state.read?.abort();
    state.confirm?.abort();
    setImporting(false);
    const controller = new AbortController();
    state.read = controller;
    const id = ++state.id;
    setCandidate(null);
    setAcknowledged(false);
    setMessage('');
    if (!file) {
      setReading(false);
      return;
    }
    setReading(true);
    try {
      if (file.size > maxFileBytes) throw Error('档案文件超过8 MiB，未读取。');
      const source = await file.text();
      if (!state.live || id !== state.id) return;
      const document = await readPlayerProfileBackup(source, {
        signal: controller.signal,
      });
      if (!state.live || id !== state.id) return;
      const local = readPlayerProfileSnapshot(getPreferenceStorage());
      setSnapshot(local);
      setCandidate({ document, filename: file.name, local });
      setMessage(
        '文件已核验；只恢复玩家档案，不载入对局、不合并或额外登记成绩。',
      );
    } catch (error) {
      if (state.live && id === state.id) setMessage(errorText(error));
    } finally {
      if (state.live && id === state.id) setReading(false);
    }
  }
  async function exportProfile() {
    const state = operations.current;
    const controller = new AbortController();
    state.export?.abort();
    state.export = controller;
    setExporting(true);
    setMessage('正在无损压缩玩家档案…');
    try {
      const current = readPlayerProfileSnapshot(getPreferenceStorage());
      setSnapshot(current);
      if (!current.profile)
        throw Error(current.message || '当前档案不可读取，未导出空档案。');
      const result = await downloadPortableJsonFile(
        serializePlayerProfileBackup(current.profile),
        `以撒的竞合-玩家档案-${new Date().toISOString().slice(0, 10)}.json`,
        { signal: controller.signal },
      );
      if (state.live && !controller.signal.aborted)
        setMessage(
          `已请求下载独立玩家档案：${compressedFileSummary(result)}。不包含对局、完整回放或设置。`,
        );
    } catch (error) {
      if (state.live && !controller.signal.aborted)
        setMessage(errorText(error));
    } finally {
      if (state.live && !controller.signal.aborted) setExporting(false);
    }
  }
  function recheck() {
    if (!candidate) return;
    operations.current.confirm?.abort();
    operations.current.id++;
    setImporting(false);
    const local = readPlayerProfileSnapshot(getPreferenceStorage());
    setSnapshot(local);
    setCandidate({ ...candidate, local });
    setAcknowledged(false);
    setMessage('已重新核对本机档案；请查看两份档案，再明确确认替换。');
  }
  async function confirm() {
    if (!candidate || !acknowledged || !candidate.local.available || importing)
      return;
    const state = operations.current,
      id = state.id,
      controller = new AbortController();
    state.confirm?.abort();
    state.confirm = controller;
    setImporting(true);
    try {
      const restored = await replacePlayerProfileCoordinated(
        getPreferenceStorage(),
        candidate.document.profile,
        candidate.local.source,
        { signal: controller.signal },
      );
      if (!state.live || id !== state.id || controller.signal.aborted) return;
      setSnapshot({ ...restored, available: true, message: '' });
      setCandidate(null);
      setAcknowledged(false);
      setMessage(
        restored.changed
          ? '已恢复玩家档案。两种模式的对局、草稿、完整回放库与设置保持不变。'
          : '档案内容一致，未重复写入；对局与回放库保持不变。',
      );
    } catch (error) {
      if (!state.live || id !== state.id || controller.signal.aborted) return;
      if (error instanceof PlayerProfileChangedError) {
        setSnapshot(readPlayerProfileSnapshot(getPreferenceStorage()));
        setAcknowledged(false);
      }
      setMessage(errorText(error));
    } finally {
      if (state.live && id === state.id && !controller.signal.aborted)
        setImporting(false);
    }
  }
  const changed =
    !!candidate &&
    snapshot.available &&
    candidate.local.source !== snapshot.source;
  return (
    <section
      className="settings-group profile-management"
      aria-labelledby="profile-management-title"
    >
      <div className="profile-management-heading">
        <div>
          <p className="eyebrow">PLAYER PROFILE BACKUP</p>
          <h3 id="profile-management-title">独立玩家档案</h3>
        </div>
        <span>两种模式共用 · 不依附对局</span>
      </div>
      <p className="utility-notice">
        备份已保留的完成记录与档案扩展数据，不包含续玩位置、完整回放或显示设置。最多200条轻量记录，不代表终身总局数；恢复操作不额外发放成就；角色权限按恢复后的档案快照生效。
      </p>
      <div className="profile-local">
        <strong>
          {snapshot.profile
            ? snapshot.source === null
              ? '本机尚无已保存的档案'
              : '本机已保存的玩家档案'
            : '本机档案不可核验'}
        </strong>
        <ProfileSummary
          profile={snapshot.profile}
          empty={snapshot.source === null}
        />
        {snapshot.message && <p className="save-message">{snapshot.message}</p>}
      </div>
      <div className="data-actions">
        <Button
          disabled={reading || exporting || !snapshot.profile}
          onClick={() => {
            void exportProfile();
          }}
        >
          导出玩家档案
        </Button>
        <label className="profile-file-picker">
          读取玩家档案文件
          <input
            ref={input}
            type="file"
            accept=".json,application/json"
            aria-label="读取玩家档案文件"
            disabled={exporting}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              void read(file);
            }}
          />
        </label>
      </div>
      {(reading || exporting) && (
        <div className="data-actions">
          <span>
            {reading ? '正在读取并核验玩家档案…' : '正在准备玩家档案文件…'}
          </span>
          <Button variant="secondary" onClick={cancel}>
            取消档案操作
          </Button>
        </div>
      )}
      {candidate && (
        <section className="profile-candidate" aria-label="玩家档案恢复预览">
          <h4>独立玩家档案恢复预览</h4>
          <p>
            {candidate.filename} · 档案备份v1 · 导出于{' '}
            {localTime(candidate.document.exportedAt)}
          </p>
          <div className="profile-comparison">
            <article>
              <h5>本机档案 · 确认后将被替换</h5>
              <ProfileSummary
                profile={candidate.local.profile}
                empty={candidate.local.source === null}
              />
              {candidate.local.message && <p>{candidate.local.message}</p>}
            </article>
            <article>
              <h5>文件中的档案</h5>
              <ProfileSummary profile={candidate.document.profile} />
            </article>
          </div>
          <p>
            这是替换，不是合并；不会载入对局、清除回放库或额外登记成绩。原始文件不修改。
          </p>
          {changed && (
            <output className="save-message">
              预览后本机档案已更新，未替换。请重新核对，避免覆盖新增的完成记录。
            </output>
          )}
          {!candidate.local.available && (
            <p className="save-message">无法读取本机档案，不能确认替换。</p>
          )}
          <label className="profile-restore-ack">
            <input
              type="checkbox"
              checked={acknowledged && !changed}
              disabled={importing || changed || !candidate.local.available}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            确认用文件档案替换本机档案（不合并）
          </label>
          <div className="data-actions">
            <Button
              disabled={
                importing ||
                !acknowledged ||
                changed ||
                !candidate.local.available
              }
              onClick={confirm}
            >
              确认恢复玩家档案
            </Button>
            <Button variant="secondary" onClick={recheck}>
              重新核对本机档案
            </Button>
            <Button variant="secondary" onClick={cancel}>
              取消恢复档案
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
