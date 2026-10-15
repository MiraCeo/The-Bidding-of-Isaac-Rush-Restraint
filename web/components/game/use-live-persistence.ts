import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribePlayerProfileChanges } from '@/lib/ui/profile-events';
import { getPreferenceStorage } from '@/lib/ui/game-preferences';
import {
  browserProfileWriteCoordinator,
  readProfileReplacementEpoch,
} from '@/lib/ui/profile-write-coordinator';
import { gameSaveKey } from '@/lib/ui/game-save';
import { survivalSaveKey } from '@/lib/ui/survival-persistence';
import {
  saveClassicClient,
  saveSurvivalClient,
} from '@/lib/ui/achievements/client-persistence';
import type { GameSession } from '@/lib/ui/game-session';
import type { SurvivalClientSession } from '@/lib/ui/survival-client';
import type { GrowthContext } from '@/lib/ui/achievements/lifecycle';
import type { CompletionOrigin } from '@/lib/ui/completion-registry';
import type { SurvivalReplayLog } from '@/lib/ui/survival-record';

/** Effect cancellation controls waiting tasks; committed writes still update the
 * owned baseline synchronously. Other-tab source changes never silently rebase. */
export function useLivePersistence(options: {
  mode: 'classic' | 'survival';
  session: GameSession | SurvivalClientSession | null;
  initialSource?: { source: string | null };
  revision: number;
  origin: () => CompletionOrigin;
  enabled?: () => boolean;
  survivalLog?: SurvivalReplayLog | null;
  onAcknowledged: (
    snapshot: GameSession | SurvivalClientSession,
    context: GrowthContext,
  ) => void;
}) {
  const key = options.mode === 'classic' ? gameSaveKey : survivalSaveKey;
  const anchor = options.session
    ? `${options.session.game.seed}:${options.session.game.phase === 'character_selection' ? '-' : options.session.game.selectedCharacter}:${options.revision}`
    : `empty:${options.revision}`;
  const baseline = useRef<{ anchor: string; source: string | null }>({
    anchor: '',
    source: null,
  });
  const controller = useRef<AbortController | null>(null),
    acknowledgement = useRef(options.onAcknowledged);
  useEffect(() => {
    acknowledgement.current = options.onAcknowledged;
  }, [options.onAcknowledged]);
  const policy = useRef({
    origin: options.origin,
    enabled: options.enabled,
    hasGrowth: !!options.session?.growth && !options.session.growthIssue,
  });
  useEffect(() => {
    policy.current = {
      origin: options.origin,
      enabled: options.enabled,
      hasGrowth: !!options.session?.growth && !options.session.growthIssue,
    };
  }, [options.origin, options.enabled, options.session]);
  const [retryRevision, setRetryRevision] = useState(0);
  const [status, setStatus] = useState({
    saved: false,
    busy: false,
    message: '',
  });
  useEffect(() => {
    let live = true,
      epoch = currentGrowthEpoch();
    const unsubscribe = subscribePlayerProfileChanges(() =>
      queueMicrotask(() => {
        if (!live) return;
        const next = currentGrowthEpoch();
        if (next === undefined || next === epoch) return;
        epoch = next;
        // A replacement invalidates only operational receipt interpretation, never
        // gameplay. Persist the ignored prefix even before the next user action so
        // paired export immediately reflects the explicitly restored profile.
        if (policy.current.hasGrowth) setRetryRevision((n) => n + 1);
      }),
    );
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  const incomingSource = useRef<{ source: string | null } | null>(null);
  const invalidate = useCallback(() => {
    controller.current?.abort();
  }, []);
  const acceptSource = useCallback((source: string | null) => {
    incomingSource.current = { source };
  }, []);
  const retry = useCallback(() => setRetryRevision((n) => n + 1), []);
  useEffect(() => {
    if (!options.session || policy.current.enabled?.() === false) return;
    const storage = getPreferenceStorage(),
      snapshot = options.session;
    if (baseline.current.anchor !== anchor) {
      try {
        const specified = incomingSource.current ?? options.initialSource;
        baseline.current = {
          anchor,
          source: specified
            ? specified.source
            : (storage?.getItem(key) ?? null),
        };
      } catch {
        baseline.current = { anchor, source: null };
      }
      incomingSource.current = null;
    }
    const owned = baseline.current,
      abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    let live = true;
    queueMicrotask(() => {
      if (live) setStatus({ saved: false, busy: true, message: '' });
    });
    const saveOptions = {
      expectedSource: owned.source,
      origin: policy.current.origin(),
      coordinator: browserProfileWriteCoordinator(),
      signal: abort.signal,
      survivalLog: options.survivalLog,
      onCommitted: (source: string | null) => {
        if (baseline.current === owned) owned.source = source;
      },
    };
    const job =
      options.mode === 'classic'
        ? saveClassicClient(storage, snapshot as GameSession, saveOptions)
        : saveSurvivalClient(
            storage,
            snapshot as SurvivalClientSession,
            saveOptions,
          );
    void job
      .then((result) => {
        if (!live) return;
        const issue = snapshot.growthIssue
          ? `本局成长捕获已暂停：${snapshot.growthIssue}`
          : '';
        setStatus({
          saved: true,
          busy: false,
          message:
            result.message ||
            issue ||
            (result.newlyAchieved.length
              ? `已保存并达成${result.newlyAchieved.length}项成就。`
              : ''),
        });
        if (result.session.growth && result.message === '')
          acknowledgement.current(snapshot, result.session.growth);
      })
      .catch((error) => {
        if (live && !abort.signal.aborted)
          setStatus({
            saved: false,
            busy: false,
            message: `${options.mode === 'survival' ? '生存' : '经典'}自动保存失败，当前仅在本页运行，请先导出存档；浏览器中可能仍是较早进度。${error instanceof Error ? error.message : ''}`,
          });
      });
    return () => {
      live = false;
      abort.abort();
    };
  }, [
    options.session,
    options.mode,
    options.revision,
    options.initialSource,
    options.survivalLog,
    anchor,
    key,
    retryRevision,
  ]);
  return { ...status, retry, invalidate, acceptSource };
}
/** Temporary read failures never stop the game; the writer re-checks the epoch
 * inside its lock before awarding anything. */
export function currentGrowthEpoch(): string | null | undefined {
  try {
    return readProfileReplacementEpoch(getPreferenceStorage());
  } catch {
    return undefined;
  }
}
