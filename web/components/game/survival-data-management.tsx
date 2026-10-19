import { useCallback, useEffect, useRef, useState } from 'react';
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
import { currentFileVersion } from '@/lib/ui/file-protocol';
import { useBackupProfileGuard } from './use-backup-profile-guard';
import { BackupProfileNotice } from './backup-profile-notice';
import { BackupObjectHeading } from './backup-object-heading';
import { CharacterArt } from './character-art';
import { characterNames } from '@/lib/game';

export function SurvivalDataManagement({
  session,
  imported,
  onImport,
  onReplay,
  recentOverride,
  saveStatus = '',
}: {
  session: SurvivalClientSession | null;
  imported: SurvivalReplayDocument | null;
  onImport: (
    candidate: ModeDataCandidate,
    profile: boolean,
    expectedProfileSource?: string | null,
    signal?: AbortSignal,
  ) => void | Promise<void>;
  onReplay: (doc: SurvivalReplayDocument) => void;
  recentOverride?: { doc: SurvivalReplayDocument | null; error: string };
  saveStatus?: string;
}) {
  const [candidate, setCandidate] = useState<ModeDataCandidate | null>(null);
  const [restoreProfile, setRestoreProfile] = useState(false);
  const profileGuard = useBackupProfileGuard();
  const clearProfileGuard = profileGuard.clear;
  const [message, setMessage] = useState('');
  const [reading, setReading] = useState(false);
  const [backup, setBackup] = useState<{ source: string; name: string } | null>(
    null,
  );
  const request = useRef(0);
  const panelRef = useRef<HTMLElement>(null);
  const hadPreview = useRef(false);
  useEffect(() => {
    const preview =
      panelRef.current?.querySelector<HTMLElement>('.data-candidate');
    if (preview && (candidate || backup)) {
      preview.tabIndex = -1;
      preview.focus({ preventScroll: true });
      preview.scrollIntoView?.({ block: 'start' });
    } else if (hadPreview.current)
      panelRef.current
        ?.querySelector<HTMLInputElement>('.survival-file-picker input')
        ?.focus();
    hadPreview.current = !!candidate || !!backup;
  }, [candidate, backup]);
  const readController = useRef<AbortController | null>(null),
    exportController = useRef<AbortController | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const confirmController = useRef<AbortController | null>(null);
  const recheckProfile = () => {
    confirmController.current?.abort();
    request.current++;
    setImporting(false);
    profileGuard.capture();
    setRestoreProfile(false);
  };
  useEffect(
    () => () => {
      request.current++;
      readController.current?.abort();
      confirmController.current?.abort();
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
  const cancel = useCallback(() => {
    clearProfileGuard();
    request.current++;
    readController.current?.abort();
    confirmController.current?.abort();
    exportController.current?.abort();
    setExporting(false);
    setImporting(false);
    setCandidate(null);
    setBackup(null);
    setReading(false);
    setRestoreProfile(false);
    setMessage('');
  }, [clearProfileGuard]);
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
  }, [candidate, backup, reading, cancel]);
  const run = (action: () => void | Promise<void>) => {
    try {
      const result = action();
      if (!(result instanceof Promise)) setMessage('操作完成。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '文件操作未完成。');
    }
  };
  async function read(file?: File) {
    profileGuard.clear();
    readController.current?.abort();
    confirmController.current?.abort();
    setImporting(false);
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
      if (parsed.kind === 'backup' || parsed.kind === 'survival-backup')
        profileGuard.capture();
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
  async function confirm() {
    if (!candidate || importing) return;
    const controller = new AbortController(),
      id = request.current;
    confirmController.current?.abort();
    confirmController.current = controller;
    setImporting(true);
    try {
      const expectedProfileSource =
        restoreProfile &&
        (candidate.kind === 'backup' || candidate.kind === 'survival-backup')
          ? profileGuard.expectedSource()
          : undefined;
      await onImport(
        candidate,
        restoreProfile,
        expectedProfileSource,
        controller.signal,
      );
      if (!controller.signal.aborted && id === request.current) cancel();
    } catch (error) {
      if (!controller.signal.aborted && id === request.current)
        setMessage(error instanceof Error ? error.message : '未载入文件。');
    } finally {
      if (!controller.signal.aborted && id === request.current)
        setImporting(false);
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
          new Date(),
          session.growthIssue ? undefined : session.growth,
        ),
        name: `生存完整备份-${session.game.seed}.json`,
      });
    });
  }
  return (
    <section
      ref={panelRef}
      className="settings-group backup-match backup-survival"
      aria-labelledby="survival-backup-title"
    >
      <BackupObjectHeading
        kind="match"
        title="当前对局"
        titleId="survival-backup-title"
        badge="生存模式"
        description={
          session
            ? phase === 'competition_complete'
              ? '本局已结束，可查看或导出回放；本局完整备份另含玩家档案，不是整库备份。'
              : '续玩存档保存当前位置与未提交报价；本局完整备份另含原始回放与玩家档案。'
            : '没有进行中的对局，可读取已有文件；最近完成记录与当前对局分开保留。'
        }
      />
      <div className="data-record-row">
        {session && (
          <CharacterArt characterId={session.game.selectedCharacter} />
        )}
        <div className="data-record-info">
          <strong>
            {session
              ? characterNames[session.game.selectedCharacter]
              : '没有进行中的对局'}
          </strong>
          {session && (
            <span className="data-state">
              {phase === 'competition_complete' ? '已结束' : '进行中'}
            </span>
          )}
          <small>
            {session
              ? `第 ${session.game.floorIndex + 1} 层 · 房间 ${session.game.roomIndex + 1}/5 · 已结算 ${session.game.roomRecords.length} 房`
              : '可读取已有续玩存档；最近完成的回放与当前对局分开保留。'}
          </small>
        </div>
      </div>
      {!!session && (
        <output className="backup-save-state">
          {saveStatus || '当前对局保留在会话中，请按需导出存档。'}
        </output>
      )}
      <div className="data-actions">
        <Button
          variant={phase === 'competition_complete' ? 'secondary' : 'default'}
          disabled={!session || exporting}
          onClick={() =>
            run(() => {
              if (session)
                return exportFile(
                  serializeSurvivalCheckpoint(
                    session.game,
                    session.draft,
                    new Date(),
                    session.growthIssue ? undefined : session.growth,
                  ),
                  `生存续玩-${session.game.seed}.json`,
                );
            })
          }
        >
          {phase === 'competition_complete'
            ? '导出生存存档'
            : '导出生存续玩存档'}
        </Button>
        <Button
          variant={phase === 'competition_complete' ? 'default' : 'secondary'}
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
      <details className="data-technical">
        <summary>格式与技术信息</summary>
        <p>
          经典与生存分开保存。导入先预览，确认后才载入；回放只读。对局文件统一为v5，默认无损压缩导出为.json，读取自动识别压缩容器或当前JSON。旧开发格式不读取、不迁移。
        </p>
      </details>
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
          profileGuard={profileGuard}
          onProfileRecheck={recheckProfile}
          onProfileChange={setRestoreProfile}
          busy={importing}
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
              <div className="data-profile-choice">
                <label>
                  <input
                    type="checkbox"
                    disabled={importing}
                    checked={restoreProfile}
                    onChange={(e) => setRestoreProfile(e.target.checked)}
                  />
                  同时恢复文件中的玩家进度
                </label>
                <BackupProfileNotice
                  guard={profileGuard}
                  incoming={candidate.document.profile!}
                  onRecheck={recheckProfile}
                />
              </div>
            )}
            <div className="data-actions">
              <Button
                onClick={confirm}
                disabled={importing || (restoreProfile && profileGuard.blocked)}
              >
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
                  version: currentFileVersion,
                  kind: 'replay',
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
