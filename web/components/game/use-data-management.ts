import { useEffect, useMemo, useRef, useState } from 'react';
import { useSessionTools } from './session-context';
import { getPreferenceStorage } from '@/lib/ui/game-preferences';
import {
  lastCompletedKey,
  serializeGameBackup,
  serializeGameCheckpoint,
} from '@/lib/ui/game-save';
import {
  parseReplay,
  serializeReplay,
  type ReplayDocument,
} from '@/lib/ui/game-replay';
import { readBuildVersion } from '@/lib/ui/game-version';
import { copySnapshot } from '@/lib/ui/replay-record';
import { readPlayerProfile, type PlayerProfile } from '@/lib/ui/player-profile';
import { downloadPortableJsonFile } from '@/lib/ui/json-download';
import { compressedFileSummary } from '@/lib/ui/compressed-file';
import {
  completedReplaySession,
  maxDataBytes,
  previewCompletedReplay,
  sameReplayResults,
} from '@/lib/ui/data-management';
import { readModeDataFile, type ModeDataCandidate } from '@/lib/ui/mode-data';
import type { GameSession } from '@/lib/ui/game-session';
import { useBackupProfileGuard } from './use-backup-profile-guard';

export function useDataManagement(
  onOpenReplay: () => void,
  onReturnGame: () => void,
  options: {
    onImport?: (
      candidate: ModeDataCandidate,
      profile: boolean,
      expectedProfileSource?: string | null,
    ) => void;
    onReplay?: (document: ReplayDocument) => void;
    onCurrentReplay?: () => void;
    profile?: { profile: PlayerProfile; message: string };
  } = {},
) {
  const originalTools = useSessionTools();
  const tools =
    originalTools && options.profile
      ? {
          ...originalTools,
          profile: options.profile.profile,
          profileMessage: options.profile.message,
        }
      : originalTools;
  const [recent] = useState(() => {
    try {
      const source = getPreferenceStorage()?.getItem(lastCompletedKey);
      return {
        source: source ?? null,
        document: source ? previewCompletedReplay(source) : null,
        error: '',
      };
    } catch (error) {
      return {
        source: null,
        document: null,
        error: error instanceof Error ? error.message : '最近对局未能读取。',
      };
    }
  });
  const [task, setTask] = useState<'settings' | 'import' | 'backup'>(
    'settings',
  );
  const [candidate, setCandidate] = useState<ModeDataCandidate | null>(null);
  const [backup, setBackup] = useState<{
    session: GameSession;
    profile: PlayerProfile;
    label: string;
  } | null>(null);
  const [restoreProfile, setRestoreProfile] = useState(false);
  const profileGuard = useBackupProfileGuard();
  const [message, setMessage] = useState('');
  const [reading, setReading] = useState(false);
  const request = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const exportController = useRef<AbortController | null>(null);
  const [exporting, setExporting] = useState(false);
  useEffect(
    () => () => {
      request.current++;
      readController.current?.abort();
      exportController.current?.abort();
    },
    [],
  );
  const activeSession =
    tools?.session.game.phase !== 'character_selection' ? tools?.session : null;
  const ongoing = !!activeSession && activeSession.game.phase !== 'game_result';
  const log = activeSession?.replay;
  const showRecent = useMemo(
    () => !!recent.document && !sameReplayResults(log, recent.document.replay),
    [log, recent.document],
  );
  const importedReplay = tools?.importedReplay;
  const showImported = useMemo(
    () =>
      !!importedReplay &&
      !sameReplayResults(log, importedReplay.replay) &&
      !sameReplayResults(recent.document?.replay, importedReplay.replay),
    [log, importedReplay, recent.document],
  );
  function cancel() {
    profileGuard.clear();
    readController.current?.abort();
    exportController.current?.abort();
    setExporting(false);
    request.current++;
    setTask('settings');
    setCandidate(null);
    setBackup(null);
    setRestoreProfile(false);
    setReading(false);
    setMessage('');
  }
  async function readFile(file: File | undefined) {
    profileGuard.clear();
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    const id = ++request.current;
    setCandidate(null);
    setRestoreProfile(false);
    setMessage('');
    if (!file) {
      setReading(false);
      return;
    }
    setReading(true);
    try {
      if (file.size > maxDataBytes)
        throw new Error('文件超过8 MiB，不能读取。');
      const source = await file.text();
      if (id !== request.current) return;
      const value = await readModeDataFile(source, file.name, {
        signal: controller.signal,
      });
      if (id === request.current) {
        if (value.kind === 'backup' || value.kind === 'survival-backup')
          profileGuard.capture();
        setCandidate(value);
      }
    } catch (error) {
      if (id === request.current)
        setMessage(
          (error instanceof Error ? error.message : '无法读取文件。') +
            ' 当前对局、玩家进度与已读取回放保持不变。',
        );
    } finally {
      if (id === request.current) setReading(false);
    }
  }
  function openImport() {
    profileGuard.clear();
    readController.current?.abort();
    exportController.current?.abort();
    setExporting(false);
    request.current++;
    setTask('import');
    setCandidate(null);
    setRestoreProfile(false);
    setMessage('');
    setReading(false);
  }
  function confirmImport() {
    if (!tools || !candidate) return;
    try {
      const expectedProfileSource =
        restoreProfile &&
        (candidate.kind === 'backup' || candidate.kind === 'survival-backup')
          ? profileGuard.expectedSource()
          : undefined;
      if (options.onImport) {
        options.onImport(candidate, restoreProfile, expectedProfileSource);
        return;
      }
      if (candidate.kind === 'survival-replay') {
        if (!tools.onSurvivalReplayImport)
          throw new Error('当前入口不支持生存文件。');
        tools.onSurvivalReplayImport(candidate.document);
        return;
      }
      if (
        candidate.kind === 'survival-checkpoint' ||
        candidate.kind === 'survival-backup'
      ) {
        if (!tools.onSurvivalRestore)
          throw new Error('当前入口不支持生存文件。');
        tools.onSurvivalRestore(
          candidate.kind === 'survival-backup'
            ? candidate.document.checkpoint
            : candidate.document,
          candidate.kind === 'survival-backup' && restoreProfile
            ? candidate.document.profile
            : undefined,
          expectedProfileSource,
        );
        return;
      }
      if (candidate.kind === 'replay') {
        tools.onReplayImport(candidate.document);
        onOpenReplay();
      } else {
        tools.onRestore(
          candidate.document.session,
          candidate.kind === 'backup' && restoreProfile
            ? candidate.document.profile
            : undefined,
          expectedProfileSource,
        );
        onReturnGame();
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '载入失败，当前对局未改变。',
      );
    }
  }
  function openCurrent() {
    if (tools && log?.rooms.length) {
      if (options.onCurrentReplay) {
        options.onCurrentReplay();
        return;
      }
      if (options.onReplay) {
        options.onReplay(parseReplay(serializeReplay(log, readBuildVersion())));
        return;
      }
      tools.onReplaySourceChange('current');
      onOpenReplay();
    }
  }
  function validatedRecent() {
    if (!recent.source) throw new Error('没有最近完成的对局。');
    return parseReplay(recent.source);
  }
  function openRecent() {
    if (!tools) return;
    try {
      if (options.onReplay) {
        options.onReplay(validatedRecent());
        return;
      }
      tools.onReplayImport(validatedRecent());
      onOpenReplay();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '最近对局校验失败。');
    }
  }
  function openImported() {
    if (tools?.importedReplay) {
      if (options.onReplay) {
        options.onReplay(tools.importedReplay);
        return;
      }
      tools.onReplaySourceChange('file');
      onOpenReplay();
    }
  }
  async function exportReplay(source: 'current' | 'recent' | 'file') {
    const controller = new AbortController();
    exportController.current?.abort();
    exportController.current = controller;
    setExporting(true);
    setMessage('正在无损压缩文件…');
    try {
      const replay =
        source === 'current'
          ? log
          : source === 'recent'
            ? validatedRecent().replay
            : tools?.importedReplay?.replay;
      if (!replay?.rooms.length) throw new Error('没有已结算房间。');
      const packed = await downloadPortableJsonFile(
        serializeReplay(replay, readBuildVersion()),
        '以撒的竞合-回放-' + replay.id + '.json',
        { signal: controller.signal },
      );
      if (!controller.signal.aborted)
        setMessage(
          '已请求下载这局的只读回放，不是续玩存档。' +
            compressedFileSummary(packed),
        );
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(error instanceof Error ? error.message : '无法导出回放。');
    } finally {
      if (!controller.signal.aborted) setExporting(false);
    }
  }
  async function exportCheckpoint() {
    if (!activeSession || !ongoing) return;
    const controller = new AbortController();
    exportController.current?.abort();
    exportController.current = controller;
    setExporting(true);
    setMessage('正在无损压缩文件…');
    try {
      const packed = await downloadPortableJsonFile(
        serializeGameCheckpoint(activeSession),
        '以撒的竞合-续玩-' + activeSession.game.seed.toString(16) + '.json',
        { signal: controller.signal },
      );
      if (!controller.signal.aborted)
        setMessage(
          '已请求下载存档，保存当前位置和未提交报价；玩家进度不随它覆盖。' +
            compressedFileSummary(packed),
        );
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(error instanceof Error ? error.message : '无法导出存档。');
    } finally {
      if (!controller.signal.aborted) setExporting(false);
    }
  }
  function openBackup() {
    if (!tools) return;
    try {
      if (tools.profileMessage)
        throw new Error('玩家进度未能读取，无法生成完整备份；原数据保留。');
      const session =
        activeSession ?? completedReplaySession(validatedRecent());
      setBackup({
        session: copySnapshot(session),
        profile: readPlayerProfile(tools.profile),
        label: activeSession ? '本局' : '最近对局',
      });
      setTask('backup');
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法准备备份。');
    }
  }
  async function confirmBackup() {
    if (!backup) return;
    const controller = new AbortController();
    exportController.current?.abort();
    exportController.current = controller;
    setExporting(true);
    setMessage('正在无损压缩文件…');
    try {
      const packed = await downloadPortableJsonFile(
        serializeGameBackup(backup.session, backup.profile),
        '以撒的竞合-完整备份-' +
          backup.session.game.seed.toString(16) +
          '.json',
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setTask('settings');
      setBackup(null);
      setMessage(
        '已请求下载完整备份：这局的进度、原始回放与玩家进度。' +
          compressedFileSummary(packed),
      );
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(error instanceof Error ? error.message : '无法导出备份。');
    } finally {
      if (!controller.signal.aborted) setExporting(false);
    }
  }
  return {
    tools,
    task,
    candidate,
    backup,
    restoreProfile,
    setRestoreProfile,
    profileGuard,
    recheckProfile: () => {
      profileGuard.capture();
      setRestoreProfile(false);
    },
    message,
    reading,
    exporting,
    activeSession,
    ongoing,
    recent,
    showRecent,
    showImported,
    cancel,
    openImport,
    readFile,
    confirmImport,
    openCurrent,
    openRecent,
    openImported,
    exportReplay,
    exportCheckpoint,
    openBackup,
    confirmBackup,
    onReturnGame,
  };
}
export type DataManagementController = ReturnType<typeof useDataManagement>;
