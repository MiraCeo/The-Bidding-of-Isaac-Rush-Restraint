import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ModeFilePreview } from './mode-file-preview';
import { readModeDataFile, type ModeDataCandidate } from '@/lib/ui/mode-data';
import type { SurvivalClientSession } from '@/lib/ui/survival-client';
import {
  serializeSurvivalCheckpoint,
  serializeSurvivalReplay,
  parseSurvivalReplay,
  survivalLastCompletedKey,
} from '@/lib/ui/survival-persistence';
import type { SurvivalReplayDocument } from '@/lib/ui/survival-persistence';
import { serializeSurvivalBackup } from '@/lib/ui/survival-backup';
import { createSurvivalReplay } from '@/lib/ui/survival-record';
import { getPreferenceStorage } from '@/lib/ui/game-preferences';
import { loadPlayerProfile } from '@/lib/ui/game-save';
import { downloadPortableJsonFile } from '@/lib/ui/json-download';
import { compressedFileSummary } from '@/lib/ui/compressed-file';
import { readBuildVersion } from '@/lib/ui/game-version';

export function SurvivalDataManagement({
  session,
  imported,
  onImport,
  onReplay,
  recentOverride,
}: {
  session: SurvivalClientSession | null;
  imported: SurvivalReplayDocument | null;
  onImport: (candidate: ModeDataCandidate, profile: boolean) => void;
  onReplay: (doc: SurvivalReplayDocument) => void;
  recentOverride?: { doc: SurvivalReplayDocument | null; error: string };
}) {
  const [candidate, setCandidate] = useState<ModeDataCandidate | null>(null);
  const [restoreProfile, setRestoreProfile] = useState(false);
  const [message, setMessage] = useState('');
  const [reading, setReading] = useState(false);
  const [backup, setBackup] = useState<{ source: string; name: string } | null>(
    null,
  );
  const request = useRef(0);
  const readController = useRef<AbortController | null>(null),
    exportController = useRef<AbortController | null>(null);
  const [exporting, setExporting] = useState(false);
  useEffect(
    () => () => {
      request.current++;
      readController.current?.abort();
      exportController.current?.abort();
    },
    [],
  );
  const phase = session?.game.phase;
  const [storedRecent] = useState(() => {
    try {
      const source = getPreferenceStorage()?.getItem(survivalLastCompletedKey);
      const doc = source ? parseSurvivalReplay(source) : null;
      if (doc && !doc.replay.final) throw new Error('最近生存记录未完成。');
      return { doc, error: '' };
    } catch (error) {
      return {
        doc: null,
        error:
          error instanceof Error ? error.message : '最近生存回放读取失败。',
      };
    }
  });
  const recent = recentOverride ?? storedRecent;
  const cancel = () => {
    request.current++;
    readController.current?.abort();
    exportController.current?.abort();
    setExporting(false);
    setCandidate(null);
    setBackup(null);
    setReading(false);
    setRestoreProfile(false);
    setMessage('');
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (candidate || backup || reading)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel();
      }
    };
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [candidate, backup, reading]);
  const run = (action: () => void | Promise<void>) => {
    try {
      const result = action();
      if (!(result instanceof Promise)) setMessage('操作完成。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '文件操作未完成。');
    }
  };
  async function read(file?: File) {
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    const id = ++request.current;
    setCandidate(null);
    setBackup(null);
    setRestoreProfile(false);
    setMessage('');
    if (!file) {
      setReading(false);
      return;
    }
    setReading(true);
    try {
      if (file.size > 8 * 1024 * 1024)
        throw new Error('文件超过8 MiB，不能读取。');
      const source = await file.text();
      if (id !== request.current) return;
      const parsed = await readModeDataFile(source, file.name, {
        signal: controller.signal,
      });
      if (id !== request.current) return;
      setCandidate(parsed);
    } catch (error) {
      if (id === request.current)
        setMessage(error instanceof Error ? error.message : '无法读取文件。');
    } finally {
      if (id === request.current) setReading(false);
    }
  }
  async function exportFile(source: string, name: string, done?: () => void) {
    exportController.current?.abort();
    const controller = new AbortController();
    exportController.current = controller;
    setExporting(true);
    setMessage('正在无损压缩文件…');
    try {
      const result = await downloadPortableJsonFile(source, name, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setMessage(`已请求下载：${compressedFileSummary(result)}。`);
      done?.();
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(error instanceof Error ? error.message : '文件导出未完成。');
    } finally {
      if (!controller.signal.aborted) setExporting(false);
    }
  }
  function confirm() {
    if (!candidate) return;
    try {
      onImport(candidate, restoreProfile);
      cancel();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '未载入文件。');
    }
  }
  function prepareBackup() {
    run(() => {
      if (!session) throw new Error('尚未开始生存对局。');
      const loaded = loadPlayerProfile(getPreferenceStorage());
      if (loaded.message) throw new Error(loaded.message);
      setBackup({
        source: serializeSurvivalBackup(
          session.game,
          session.draft,
          loaded.profile,
        ),
        name: `生存完整备份-${session.game.seed}.json`,
      });
    });
  }
  return (
    <section className="settings-group">
      <h3>生存模式 · 存档与文件</h3>
      <p>经典与生存分开保存。导入先预览，确认后才载入；回放只读。</p>
      <p>
        默认无损压缩导出，仍使用.json文件，读取自动识别压缩或旧JSON。日常继续游戏用续玩存档；回放保存过程，完整备份还包含玩家档案。自动保存格式不变。
      </p>
      <div className="data-actions">
        <Button
          disabled={!session || exporting}
          onClick={() =>
            run(() => {
              if (session)
                return exportFile(
                  serializeSurvivalCheckpoint(session.game, session.draft),
                  `生存续玩-${session.game.seed}.json`,
                );
            })
          }
        >
          导出生存续玩存档
        </Button>
        <Button
          disabled={!session?.game.roomRecords.length || exporting}
          onClick={() =>
            run(() => {
              if (session)
                return exportFile(
                  serializeSurvivalReplay(
                    createSurvivalReplay(session.game),
                    readBuildVersion(),
                  ),
                  `生存回放-${session.game.seed}.json`,
                );
            })
          }
        >
          导出生存回放
        </Button>
        <Button
          variant="secondary"
          disabled={!session || exporting}
          onClick={prepareBackup}
        >
          完整备份
        </Button>
      </div>
      <label className="survival-file-picker">
        读取对局文件
        <input
          type="file"
          disabled={exporting}
          accept=".json,application/json"
          onChange={(event) => {
            void read(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </label>
      {reading && (
        <output>
          正在验证文件…{' '}
          <Button variant="secondary" onClick={cancel}>
            取消读取
          </Button>
        </output>
      )}
      {candidate &&
      (candidate.kind === 'survival-replay' ||
        candidate.kind === 'survival-checkpoint' ||
        candidate.kind === 'survival-backup') ? (
        <ModeFilePreview
          candidate={candidate}
          restoreProfile={restoreProfile}
          onProfileChange={setRestoreProfile}
          onConfirm={confirm}
          onCancel={cancel}
        />
      ) : (
        candidate && (
          <section className="data-candidate">
            <h4>
              经典模式 · v{candidate.document.version} ·{' '}
              {candidate.kind === 'replay' ? '只读回放' : '载入对局'}
            </h4>
            <p>{candidate.filename}</p>
            <p>
              {candidate.kind === 'replay'
                ? '只读查看，不改变当前生存对局或玩家进度。'
                : '确认后切换并载入经典对局。生存存档独立保留。'}
            </p>
            {candidate.kind === 'backup' && (
              <label>
                <input
                  type="checkbox"
                  checked={restoreProfile}
                  onChange={(e) => setRestoreProfile(e.target.checked)}
                />
                同时恢复文件中的玩家进度
              </label>
            )}
            <div className="data-actions">
              <Button onClick={confirm}>
                确认{candidate.kind === 'replay' ? '打开回放' : '载入经典对局'}
              </Button>
              <Button variant="secondary" onClick={cancel}>
                取消
              </Button>
            </div>
          </section>
        )
      )}
      {backup && (
        <section className="data-candidate">
          <h4>完整备份预览</h4>
          <p>
            包含当前生存检查点、已结算事实回放和本机玩家进度。导入时默认不覆盖玩家进度。
          </p>
          <Button
            disabled={exporting}
            onClick={() =>
              run(() => {
                return exportFile(backup.source, backup.name, () =>
                  setBackup(null),
                );
              })
            }
          >
            确认导出完整备份
          </Button>
          <Button variant="secondary" onClick={cancel}>
            取消
          </Button>
        </section>
      )}
      {(phase === 'competition_complete' || recent.doc) && (
        <Button
          variant="secondary"
          disabled={exporting}
          onClick={() =>
            run(() => {
              // Read on activation, not only at mount: AI may have finished while settings stayed open.
              if (session?.game.phase === 'competition_complete')
                onReplay({
                  format: 'the-bidding-of-isaac-replay',
                  version: 4,
                  mode: 'survival',
                  exportedAt: new Date().toISOString(),
                  exportedBuild: readBuildVersion(),
                  replay: createSurvivalReplay(session.game),
                });
              else {
                const source = getPreferenceStorage()?.getItem(
                  survivalLastCompletedKey,
                );
                if (!source)
                  throw new Error('最近完成回放不存在，当前对局未改变。');
                onReplay(parseSurvivalReplay(source));
              }
            })
          }
        >
          查看最近完成的生存回放
        </Button>
      )}
      {imported && (
        <Button
          variant="secondary"
          disabled={exporting}
          onClick={() =>
            run(() =>
              exportFile(
                serializeSurvivalReplay(imported.replay, readBuildVersion()),
                '生存只读回放.json',
              ),
            )
          }
        >
          导出读取的生存回放
        </Button>
      )}
      {(message || recent.error) && (
        <output className="save-message">{message || recent.error}</output>
      )}
    </section>
  );
}
