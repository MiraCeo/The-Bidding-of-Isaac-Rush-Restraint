import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useSessionTools } from './session-context';

/** Match lifecycle belongs to the game view, never to file import/export controls. */
export function MatchRestartControl() {
  const tools = useSessionTools();
  const [confirm, setConfirm] = useState(false);
  if (
    !tools ||
    tools.session.game.phase === 'character_selection' ||
    tools.session.game.phase === 'game_result'
  )
    return null;
  return (
    <div className="match-restart-control">
      {!confirm ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => setConfirm(true)}
        >
          重新选角
        </Button>
      ) : (
        <div className="match-restart-confirm">
          <p>
            重新选角会放弃本局自动进度；需要保留时先在设置中导出存档。玩家进度和已完成对局记录不清除。
          </p>
          <div className="data-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirm(false)}
            >
              保留当前对局
            </Button>
            <Button type="button" onClick={tools.onNewGame}>
              确认重新选角
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
