import { useEffect, useState } from 'react';
import type { GameSession } from '@/lib/ui/game-session';
import type { SurvivalGameState } from '@/lib/game/survival-session';
import { createSurvivalReplay } from '@/lib/ui/survival-record';
import {
  newLibraryDocument,
  prepareLibraryReplay,
  replayLibrary,
  replaySource,
} from '@/lib/ui/replay-library';

/** Separate from synchronous checkpoints/profile writes. Viewing imported facts never enters here. */
export function useReplayArchive(
  classic: GameSession | undefined,
  survival: SurvivalGameState | undefined,
) {
  const [status, setStatus] = useState({ classic: '', survival: '' });
  const classicLog =
    classic?.game.phase === 'game_result' ? classic.replay : null;
  const survivalFinal =
    survival?.phase === 'competition_complete' ? survival : null;
  useEffect(() => {
    if (!classicLog?.final) return;
    let live = true;
    const timer = setTimeout(() => {
      setStatus((old) => ({ ...old, classic: '完整回放正在独立入库…' }));
      void (async () => {
        const doc = newLibraryDocument({ mode: 'classic', replay: classicLog });
        return replayLibrary.add(
          await prepareLibraryReplay(replaySource(doc), 'automatic'),
        );
      })().then(
        (result) => {
          if (live)
            setStatus((old) => ({
              ...old,
              classic:
                result === 'removed'
                  ? '此回放曾明确删除，不再自动入库。'
                  : '完整回放已入库（相同或等价事实不重复保存）。',
            }));
        },
        (error) => {
          if (live)
            setStatus((old) => ({
              ...old,
              classic: `完整回放未入库，可在进度页手动重试；续玩不受影响。${error instanceof Error ? error.message : ''}`,
            }));
        },
      );
    }, 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [classicLog]);
  useEffect(() => {
    if (!survivalFinal) return;
    let live = true;
    const timer = setTimeout(() => {
      setStatus((old) => ({ ...old, survival: '完整回放正在独立入库…' }));
      void (async () => {
        const doc = newLibraryDocument({
          mode: 'survival',
          replay: createSurvivalReplay(survivalFinal),
        });
        return replayLibrary.add(
          await prepareLibraryReplay(replaySource(doc), 'automatic'),
        );
      })().then(
        (result) => {
          if (live)
            setStatus((old) => ({
              ...old,
              survival:
                result === 'removed'
                  ? '此回放曾明确删除，不再自动入库。'
                  : '完整回放已入库（相同事实只保留一份）。',
            }));
        },
        (error) => {
          if (live)
            setStatus((old) => ({
              ...old,
              survival: `完整回放未入库，可在进度页手动重试；续玩不受影响。${error instanceof Error ? error.message : ''}`,
            }));
        },
      );
    }, 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [survivalFinal]);
  return status;
}
