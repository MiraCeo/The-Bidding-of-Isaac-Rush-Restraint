import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useSessionTools } from './session-context';

/** Match lifecycle belongs to the game view, never to file import/export controls. */
export function MatchRestartControl({
  label = '重新选角',
}: {
  label?: string;
}) {
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
          {label}
        </Button>
      ) : (
        <div className="match-restart-confirm">
          <p>
            {label === '重新开始'
              ? '结束当前对局，重新选择角色并开始新局？这会放弃本局自动进度；'
              : '重新选角会放弃本局自动进度；'}
            需要保留时先在进度 →
            存档与备份中导出续玩存档。玩家档案和已完成对局记录不清除。
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
              确认{label}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
