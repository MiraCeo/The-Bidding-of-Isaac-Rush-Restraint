import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { characterNames } from '@/lib/game';
import { survivalDifficultyLabel } from '@/lib/game/survival-difficulty';
import { classicDifficultyLabel } from '@/lib/game/classic-difficulty';
import { downloadJsonFile } from '@/lib/ui/json-download';
import { maxFileBytes } from '@/lib/ui/file-json';
import { ReplayLibraryBackupPanel } from './replay-library-backup-panel';
import {
  replayLibrary,
  replayLibraryLimits,
  replayLibraryChanged,
  prepareLibraryReplay,
  replaySource,
  type LibraryReplay,
  type PreparedReplay,
  type ReplayLibraryEntry,
  type ClassicEquivalentGroup,
} from '@/lib/ui/replay-library';

const size = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MiB`
    : `${(bytes / 1024).toFixed(1)} KiB`;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '回放操作未完成，原记录保留。';
export interface LibraryFilters {
  role: string;
  difficulty: string;
  completion: string;
}
export function ReplayLibraryPanel({
  mode,
  current,
  recent,
  archiveStatus,
  onReplay,
  initialFilters,
  onFiltersChange,
  scoreDecimals = 2,
}: {
  mode: 'classic' | 'survival';
  current: LibraryReplay | null;
  recent: LibraryReplay | null;
  archiveStatus: string;
  onReplay: (document: LibraryReplay) => void;
  initialFilters?: LibraryFilters;
  onFiltersChange?: (filters: LibraryFilters) => void;
  scoreDecimals?: 2 | 4;
}) {
  const [entries, setEntries] = useState<ReplayLibraryEntry[]>([]);
  const [ready, setReady] = useState(false),
    [message, setMessage] = useState('');
  const [working, setBusy] = useState(false),
    [bulkBusy, setBulkBusy] = useState(false);
  const busy = working || bulkBusy;
  const [reading, setReading] = useState(false);
  const [equivalents, setEquivalents] = useState<
    ClassicEquivalentGroup[] | null
  >(null);
  const [checkingEquivalents, setCheckingEquivalents] = useState(false);
  const equivalenceToken = useRef(0),
    equivalenceActive = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState(initialFilters?.role ?? 'all'),
    [difficulty, setDifficulty] = useState(initialFilters?.difficulty ?? 'all');
  const [completion, setCompletion] = useState(
    initialFilters?.completion ?? 'all',
  );
  function filter(field: keyof LibraryFilters, value: string) {
    if (field === 'role') setRole(value);
    if (field === 'difficulty') setDifficulty(value);
    if (field === 'completion') setCompletion(value);
    onFiltersChange?.({ role, difficulty, completion, [field]: value });
  }
  const [candidate, setCandidate] = useState<PreparedReplay | null>(null);
  const [deleting, setDeleting] = useState<ReplayLibraryEntry | null>(null);
  const lifetime = useRef(true),
    readToken = useRef(0),
    refreshToken = useRef(0);
  const reload = useCallback(async () => {
    equivalenceToken.current++;
    setEquivalents(null);
    if (equivalenceActive.current) {
      equivalenceActive.current = false;
      setCheckingEquivalents(false);
      setBusy(false);
      setMessage('回放库已刷新，等价核验结果失效；请重新核对。');
    }
    const token = ++refreshToken.current;
    try {
      const rows = await replayLibrary.list();
      if (lifetime.current && token === refreshToken.current) {
        setEntries(rows);
        setReady(true);
      }
    } catch (error) {
      if (lifetime.current && token === refreshToken.current) {
        setReady(false);
        setMessage(errorText(error));
      }
    }
  }, []);
  useEffect(() => {
    lifetime.current = true;
    queueMicrotask(() => {
      if (lifetime.current) void reload();
    });
    const invalidate = () => {
      readToken.current++;
      refreshToken.current++;
      equivalenceToken.current++;
    };
    const refresh = () => {
      void reload();
    };
    window.addEventListener(replayLibraryChanged, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      lifetime.current = false;
      invalidate();
      window.removeEventListener(replayLibraryChanged, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [reload]);
  function cancelEquivalence() {
    equivalenceToken.current++;
    equivalenceActive.current = false;
    setCheckingEquivalents(false);
    setBusy(false);
    setEquivalents(null);
    setMessage('已取消等价核验，回放库未修改。');
  }
  async function checkEquivalents() {
    const token = ++equivalenceToken.current;
    equivalenceActive.current = true;
    setEquivalents(null);
    setCheckingEquivalents(true);
    setBusy(true);
    setMessage('正在只读核对经典等价副本…');
    try {
      const groups = await replayLibrary.classicEquivalentGroups();
      if (lifetime.current && token === equivalenceToken.current) {
        setEquivalents(groups);
        setMessage('经典等价核验完成，未删除、合并或改写任何原记录。');
      }
    } catch (error) {
      if (lifetime.current && token === equivalenceToken.current)
        setMessage(errorText(error));
    } finally {
      if (lifetime.current && token === equivalenceToken.current) {
        equivalenceActive.current = false;
        setCheckingEquivalents(false);
        setBusy(false);
      }
    }
  }
  const cancelRead = useCallback(() => {
    readToken.current++;
    setReading(false);
    setBusy(false);
    setCandidate(null);
    setMessage('已取消入库，未写入。');
  }, []);
  useEffect(() => {
    const input = fileInput.current;
    input?.addEventListener('cancel', cancelRead);
    return () => input?.removeEventListener('cancel', cancelRead);
  }, [cancelRead]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && checkingEquivalents) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelEquivalence();
        return;
      }
      if (
        event.key === 'Escape' &&
        (reading || candidate || deleting) &&
        (!busy || reading)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (deleting) setDeleting(null);
        else cancelRead();
      }
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [reading, candidate, deleting, busy, cancelRead, checkingEquivalents]);
  async function operation(action: () => Promise<string>) {
    setBusy(true);
    setMessage('正在处理回放…');
    try {
      const text = await action();
      if (lifetime.current) {
        setMessage(text);
        await reload();
      }
    } catch (error) {
      if (lifetime.current) setMessage(errorText(error));
    } finally {
      if (lifetime.current) setBusy(false);
    }
  }
  const add = (prepared: PreparedReplay) =>
    operation(async () => {
      const result = await replayLibrary.add(prepared);
      if (lifetime.current) setCandidate(null);
      return result === 'duplicate'
        ? '相同或等价回放已在库中，未重复保存或覆盖来源。'
        : '完整事实已入库；对局、草稿与玩家档案未改变。';
    });
  const save = (doc: LibraryReplay) =>
    operation(async () => {
      const result = await replayLibrary.add(
        await prepareLibraryReplay(replaySource(doc), 'manual'),
      );
      return result === 'duplicate'
        ? '相同或等价回放已在库中，未重复保存。'
        : '回放已入库。';
    });
  async function selectFile(file: File | undefined) {
    const token = ++readToken.current;
    setCandidate(null);
    if (!file) {
      setMessage('已取消文件选择，未写入。');
      return;
    }
    setBusy(true);
    setReading(true);
    setMessage('正在读取并核验回放…');
    try {
      if (file.size > maxFileBytes) throw Error('文件超过8 MiB，未读取。');
      const prepared = await prepareLibraryReplay(await file.text());
      if (lifetime.current && token === readToken.current) {
        setCandidate(prepared);
        setMessage('文件已核验；确认入库后才写入，不载入对局或玩家档案。');
      }
    } catch (error) {
      if (lifetime.current && token === readToken.current)
        setMessage(errorText(error));
    } finally {
      if (lifetime.current && token === readToken.current) {
        setBusy(false);
        setReading(false);
      }
    }
  }
  const filtered = entries.filter(
    (e) =>
      e.mode === mode &&
      (role === 'all' || role === e.characterId) &&
      (difficulty === 'all' || difficulty === (e.difficulty ?? 'ungraded')) &&
      (completion === 'all' || e.completed === (completion === 'complete')),
  );
  const used = entries.reduce((sum, e) => sum + e.bytes, 0);
  return (
    <section
      className="settings-group replay-library"
      aria-labelledby="replay-library-title"
    >
      <div className="library-heading">
        <div>
          <p className="eyebrow">REPLAY LIBRARY</p>
          <h3 id="replay-library-title">长期完整回放库</h3>
        </div>
        <span className="library-capacity">
          {ready
            ? `${entries.length} / ${replayLibraryLimits.count} 局 · ${size(used)} / 64 MiB`
            : '容量暂不可读取'}
        </span>
      </div>
      <p className="utility-notice">
        独立保存在此浏览器的IndexedDB中。完成局自动入库；也可保留进行中片段。达到应用上限时停止新增，不自动删除。大小为已存文本，不是磁盘或浏览器剩余额度。
      </p>
      {archiveStatus && <p className="library-auto-status">{archiveStatus}</p>}
      <div className="library-toolbar">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            void reload();
          }}
        >
          刷新回放库
        </Button>
        <Button
          disabled={busy || !current?.replay.rooms.length}
          onClick={() => current && void save(current)}
        >
          本局回放入库
        </Button>
        <Button
          variant="secondary"
          disabled={busy || !recent}
          onClick={() => recent && void save(recent)}
        >
          最近完成回放入库
        </Button>
        {mode === 'classic' && (
          <Button
            variant="secondary"
            disabled={busy || !ready || !!deleting}
            onClick={() => void checkEquivalents()}
          >
            检查经典等价副本
          </Button>
        )}
        <label className="library-file">
          导入回放文件
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            aria-label="导入回放库文件"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              void selectFile(file);
            }}
          />
        </label>
      </div>
      <ReplayLibraryBackupPanel
        disabled={working || !!deleting || !!candidate}
        onBusyChange={setBulkBusy}
      />
      {reading && (
        <Button variant="secondary" onClick={cancelRead}>
          取消读取回放
        </Button>
      )}
      {checkingEquivalents && (
        <Button variant="secondary" onClick={cancelEquivalence}>
          取消等价核验
        </Button>
      )}
      {mode === 'classic' && equivalents !== null && (
        <output className="utility-notice">
          {equivalents.length
            ? `发现 ${equivalents.length} 组等价记录、${equivalents.reduce((n, g) => n + g.copies.length, 0)} 份副本。以保存时间最早的记录为参照。`
            : '未发现经典等价副本。'}
          已有记录仍各自保留，可分别查看、导出；不自动删除或合并。新增等价入库保留旧键与首次正文。
        </output>
      )}
      {candidate && (
        <section className="library-confirm" aria-label="回放入库预览">
          <strong>
            {candidate.entry.mode === 'classic' ? '经典' : '生存'} ·{' '}
            {characterNames[candidate.entry.characterId]} ·{' '}
            {candidate.entry.completed ? '已完成' : '进行中片段'} ·{' '}
            {candidate.entry.rooms} 房
          </strong>
          <p>
            {size(candidate.entry.rawBytes)} → {size(candidate.entry.bytes)} ·
            种子 {candidate.entry.seed} · 仅保存回放事实
          </p>
          <Button
            disabled={busy}
            onClick={() => {
              void add(candidate);
            }}
          >
            确认入库
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              readToken.current++;
              setCandidate(null);
              setMessage('已取消入库，未写入。');
            }}
          >
            取消入库
          </Button>
        </section>
      )}
      <div className="library-filters">
        <label>
          角色
          <select
            aria-label="回放库角色"
            value={role}
            onChange={(e) => filter('role', e.target.value)}
          >
            <option value="all">全部角色</option>
            {Object.entries(characterNames).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          难度
          <select
            aria-label="回放库难度"
            value={difficulty}
            onChange={(e) => filter('difficulty', e.target.value)}
          >
            <option value="all">全部难度</option>
            {(['easy', 'standard', 'hard', 'highest'] as const).map((d) => (
              <option key={d} value={d}>
                {mode === 'classic'
                  ? classicDifficultyLabel(d)
                  : survivalDifficultyLabel(d)}
              </option>
            ))}
            <option value="ungraded">
              {mode === 'classic' ? '原版（未分档）' : '未分层'}
            </option>
          </select>
        </label>
        <label>
          状态
          <select
            aria-label="回放库状态"
            value={completion}
            onChange={(e) => filter('completion', e.target.value)}
          >
            <option value="all">全部状态</option>
            <option value="complete">已完成</option>
            <option value="partial">进行中片段</option>
          </select>
        </label>
        <span>{filtered.length} 条符合筛选</span>
      </div>
      <div className="library-table-wrap">
        <table className="survival-table">
          <caption className="sr-only">完整回放库</caption>
          <thead>
            <tr>
              <th>角色／种子</th>
              <th>状态／难度</th>
              <th>房间</th>
              <th>你的成绩</th>
              <th>大小</th>
              <th>入库时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => (
              <tr key={entry.key}>
                <td>
                  <strong>{characterNames[entry.characterId]}</strong>
                  <small>种子 {entry.seed}</small>
                  {mode === 'classic' &&
                    equivalents?.some((g) => g.keeper === entry.key) && (
                      <small>等价组参照</small>
                    )}
                  {mode === 'classic' &&
                    equivalents?.some((g) => g.copies.includes(entry.key)) && (
                      <small>等价副本</small>
                    )}
                </td>
                <td>
                  {entry.completed ? '已完成' : '进行中片段'}
                  <small>
                    {entry.mode === 'survival'
                      ? survivalDifficultyLabel(entry.difficulty ?? undefined)
                      : classicDifficultyLabel(entry.difficulty ?? undefined)}
                  </small>
                </td>
                <td>{entry.rooms} 房</td>
                <td>
                  {entry.score === null
                    ? '—'
                    : `${entry.score.toFixed(scoreDecimals)} 分`}
                  <small>
                    {entry.rank === null
                      ? '尚无终局名次'
                      : `第 ${entry.rank} 名`}
                  </small>
                </td>
                <td>
                  {size(entry.bytes)}
                  <small>{entry.compressed ? '无损压缩' : '原JSON'}</small>
                </td>
                <td>
                  {new Date(entry.savedAt).toLocaleString('zh-CN')}
                  <small>
                    {entry.origin === 'automatic'
                      ? '自动归档'
                      : entry.origin === 'import'
                        ? '文件入库'
                        : '手动保存'}
                  </small>
                </td>
                <td aria-label="回放操作">
                  <div className="library-row-actions">
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        void operation(async () => {
                          const read = await replayLibrary.read(entry.key);
                          if (lifetime.current) onReplay(read.document);
                          return '已打开只读回放。';
                        });
                      }}
                    >
                      查看
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        void operation(async () => {
                          const read = await replayLibrary.read(entry.key);
                          if (lifetime.current)
                            downloadJsonFile(
                              read.source,
                              `isaac-${entry.mode}-replay-${entry.seed}-${entry.key.slice(-8)}.json`,
                            );
                          return '已请求导出回放文件。';
                        });
                      }}
                    >
                      导出
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setDeleting(entry)}
                    >
                      删除
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ready && !filtered.length && (
        <p className="library-empty">
          暂无符合筛选的完整回放。已有的最近回放可手动入库，旧缓存不自动迁移。
        </p>
      )}
      {deleting && (
        <div
          className="library-confirm"
          role="alertdialog"
          aria-label="确认删除完整回放"
        >
          <h4>
            删除 {characterNames[deleting.characterId]} · 种子 {deleting.seed}{' '}
            的回放？
          </h4>
          <p>
            仅删除这一份完整回放，不能撤销。续玩存档、最近回放与玩家完成记录保留；刷新后不会自动重新入库。
          </p>
          <p>
            {deleting.rooms} 房 ·{' '}
            {deleting.mode === 'survival'
              ? survivalDifficultyLabel(deleting.difficulty ?? undefined)
              : classicDifficultyLabel(deleting.difficulty ?? undefined)}{' '}
            · 入库于 {new Date(deleting.savedAt).toLocaleString('zh-CN')}
          </p>
          <Button
            disabled={busy}
            onClick={() => {
              void operation(async () => {
                await replayLibrary.remove(deleting.key);
                if (lifetime.current) setDeleting(null);
                return '已删除所选完整回放，其余数据保留。';
              });
            }}
          >
            确认删除此回放
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setDeleting(null)}
          >
            保留回放
          </Button>
        </div>
      )}
      <output className="save-message" aria-live="polite">
        {message}
      </output>
    </section>
  );
}
