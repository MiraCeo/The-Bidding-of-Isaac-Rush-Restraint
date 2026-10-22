import { useCallback, useEffect, useRef, useState } from 'react';
import { getPreferenceStorage } from '@/lib/ui/game-preferences';
import { subscribePlayerProfileChanges } from '@/lib/ui/profile-events';
import { readCharacterAccess } from '@/lib/ui/achievements/character-access';
import {
  activateAchievementRegistry,
  manuallyUnlockAchievementCharacters,
} from '@/lib/ui/achievements/registry';
import {
  browserAchievementWriteCoordinator,
  persistAchievementProfile,
} from '@/lib/ui/achievements/persistence';

export function useCharacterAccess(initialize = true) {
  const [access, setAccess] = useState(() =>
    readCharacterAccess(getPreferenceStorage()),
  );
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const refresh = useCallback(
    () => setAccess(readCharacterAccess(getPreferenceStorage())),
    [],
  );
  useEffect(() => {
    let live = true;
    const onChange = () =>
      queueMicrotask(() => {
        if (live) refresh();
      });
    const unsubscribe = subscribePlayerProfileChanges(onChange);
    const coordinator = browserAchievementWriteCoordinator(),
      controller = new AbortController();
    if (coordinator && initialize)
      void persistAchievementProfile(
        getPreferenceStorage(),
        activateAchievementRegistry,
        coordinator,
        controller.signal,
      )
        .then(onChange)
        .catch((error) => {
          if (live && !controller.signal.aborted)
            setMessage(
              error instanceof Error ? error.message : '角色权限初始化未保存。',
            );
        });
    return () => {
      live = false;
      unsubscribe();
      controller.abort();
      operation.current?.abort();
    };
  }, [refresh, initialize]);
  const unlockAll = async () => {
    if (busy) return;
    const controller = new AbortController();
    operation.current?.abort();
    operation.current = controller;
    setBusy(true);
    setMessage('正在保存角色权限…');
    try {
      await persistAchievementProfile(
        getPreferenceStorage(),
        manuallyUnlockAchievementCharacters,
        browserAchievementWriteCoordinator(),
        controller.signal,
      );
      if (controller.signal.aborted) return;
      refresh();
      setMessage('全部角色已解锁；成就完成记录与统计进度未改变。');
    } catch (error) {
      if (!controller.signal.aborted) {
        refresh();
        setMessage(
          error instanceof Error
            ? error.message
            : '角色解锁未保存，原资料保留。',
        );
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return { ...access, busy, operationMessage: message, unlockAll };
}
