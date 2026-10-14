import { useCallback, useEffect, useState } from 'react';
import { getPreferenceStorage } from '@/lib/ui/game-preferences';
import {
  readPlayerProfileSnapshot,
  PlayerProfileChangedError,
  type PlayerProfileSnapshot,
} from '@/lib/ui/player-profile-file';
import { subscribePlayerProfileChanges } from '@/lib/ui/profile-events';

/** Capture at validated file preview, not at the final click. Compare raw bytes, including null. */
export function useBackupProfileGuard() {
  const [baseline, setBaseline] = useState<PlayerProfileSnapshot | null>(null);
  const [current, setCurrent] = useState<PlayerProfileSnapshot | null>(null);
  useEffect(() => {
    if (!baseline) return;
    let live = true;
    const unsubscribe = subscribePlayerProfileChanges(() => {
      queueMicrotask(() => {
        if (live) setCurrent(readPlayerProfileSnapshot(getPreferenceStorage()));
      });
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [baseline]);
  function capture() {
    const local = readPlayerProfileSnapshot(getPreferenceStorage());
    setBaseline(local);
    setCurrent(local);
  }
  const clear = useCallback(() => {
    setBaseline(null);
    setCurrent(null);
  }, []);
  function expectedSource(): string | null {
    const local = readPlayerProfileSnapshot(getPreferenceStorage());
    setCurrent(local);
    if (!baseline?.available || !local.available)
      throw Error('本机玩家档案无法读取，未覆盖对局与玩家进度。');
    if (baseline.source !== local.source) throw new PlayerProfileChangedError();
    return baseline.source;
  }
  return {
    baseline,
    current,
    capture,
    clear,
    expectedSource,
    blocked:
      !baseline?.available ||
      !current?.available ||
      baseline.source !== current.source,
  };
}
export type BackupProfileGuard = ReturnType<typeof useBackupProfileGuard>;
