import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getPreferenceStorage } from '@/lib/ui/game-preferences';
import { checkedJson } from '@/lib/ui/file-json';
import { playerProfileKey, readPlayerProfile } from '@/lib/ui/player-profile';
import { hasCurrentAchievementBaseline } from '@/lib/ui/achievements/baseline';
import { prepareAchievementBaseline } from '@/lib/ui/achievements/registry';
import {
  browserAchievementWriteCoordinator,
  persistAchievementProfile,
} from '@/lib/ui/achievements/persistence';
import { subscribePlayerProfileChanges } from '@/lib/ui/profile-events';

/** Runs on app startup/focus/explicit restore, never during replay evaluation.
 * Only the validated profile candidate is committed, under the shared lock. */
export function AchievementBaselineMaintenance() {
  const [message, setMessage] = useState('');
  const retry = useRef<() => void>(() => {});
  useEffect(() => {
    let live = true,
      busy = false;
    const controller = new AbortController();
    const run = async () => {
      if (!live || busy) return;
      busy = true;
      try {
        const storage = getPreferenceStorage();
        const raw = storage?.getItem(playerProfileKey);
        if (
          !raw ||
          hasCurrentAchievementBaseline(readPlayerProfile(checkedJson(raw)))
        ) {
          setMessage('');
          return;
        }
        await persistAchievementProfile(
          storage,
          prepareAchievementBaseline,
          browserAchievementWriteCoordinator(),
          controller.signal,
        );
        if (live) setMessage('');
      } catch (error) {
        if (live && !controller.signal.aborted)
          setMessage(
            `旧版本成就清理未保存：${error instanceof Error ? error.message : '原资料保留，请重试。'}`,
          );
      } finally {
        busy = false;
      }
    };
    retry.current = () => {
      void run();
    };
    const refresh = () =>
      queueMicrotask(() => {
        void run();
      });
    const unsubscribe = subscribePlayerProfileChanges(refresh);
    refresh();
    return () => {
      live = false;
      controller.abort();
      unsubscribe();
    };
  }, []);
  return message ? (
    <section className="settings-group" aria-label="旧成就清理状态">
      <output className="save-message">{message}</output>
      <Button variant="secondary" onClick={() => retry.current()}>
        重试旧成就清理
      </Button>
    </section>
  ) : null;
}
