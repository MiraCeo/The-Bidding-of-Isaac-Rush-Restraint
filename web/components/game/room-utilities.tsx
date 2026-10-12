import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';

import { GameRules } from './game-rules';
import { PlayerBuild } from './player-build';
import { ReplayViewer } from './replay-viewer';
import { GameTutorial } from './game-tutorial';
import { useSessionTools } from './session-context';
import { draftTurn } from '@/lib/ui/player-build';
import type { PlayerTurn } from '@/lib/game/item-types';
import { GameSettings, type PreferenceSaveStatus } from './game-settings';
import { RoomRanking } from './room-ranking';
import { Button } from '@/components/ui/button';
import type { ActiveClientGameState } from '@/lib/game/client-session';
import type { GamePreferences } from '@/lib/ui/game-preferences';

export type RoomUtilityPanel =
  | 'ranking'
  | 'settings'
  | 'rules'
  | 'build'
  | 'replay'
  | 'tutorial';
// Tutorial is a utility page, not another live-game phase.
const panelNames: Readonly<Record<RoomUtilityPanel, string>> = {
  ranking: '排行',
  settings: '设置',
  rules: '规则',
  build: '构筑与当前状态',
  replay: '逐房回放',
  tutorial: '新手教程',
};

interface RoomUtilitiesProps {
  panel: RoomUtilityPanel | null;
  game?: ActiveClientGameState;
  turn?: PlayerTurn;
  preferences: GamePreferences;
  saveStatus: PreferenceSaveStatus;
  onPanelChange: (panel: RoomUtilityPanel | null) => void;
  onPreferencesChange: (preferences: GamePreferences) => void;
}

export function RoomUtilities({
  panel,
  game,
  turn,
  preferences,
  saveStatus,
  onPanelChange,
  onPreferencesChange,
}: RoomUtilitiesProps) {
  const tools = useSessionTools();
  const buildTurn =
    turn ??
    (game && tools?.session.draft
      ? draftTurn(game.humanPlayerId, tools.session.draft)
      : undefined);
  useEffect(() => {
    if (!panel) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onPanelChange(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [panel, onPanelChange]);

  if (!panel) return null;
  if (panel === 'settings')
    return (
      <GameSettings
        preferences={preferences}
        saveStatus={saveStatus}
        onChange={onPreferencesChange}
        beforeGame={!game}
        onOpenReplay={() => onPanelChange('replay')}
        onReturnGame={() => onPanelChange(null)}
      />
    );
  if (panel === 'ranking') {
    return (
      <RoomRanking
        variant="public"
        game={game}
        scoreDecimals={preferences.scoreDecimals}
        onReturn={() => onPanelChange(null)}
      />
    );
  }

  return (
    <section
      id="room-utilities"
      className="ranking-stage game-tools-stage"
      aria-labelledby="room-utilities-title"
    >
      <div className="ranking-page-heading">
        <div>
          <p className="eyebrow">
            {panel === 'build'
              ? 'YOUR BUILD'
              : panel === 'replay'
                ? 'ROOM REPLAY'
                : panel === 'tutorial'
                  ? 'LEARN BY PLAYING'
                  : 'GAME RULES'}
          </p>
          <h2 id="room-utilities-title" tabIndex={-1}>
            {panelNames[panel]}
          </h2>
        </div>
        <p>
          {panel === 'build'
            ? '已持有道具 · 实时状态 · 报价影响'
            : panel === 'replay'
              ? '已结算记录 · 只读查看 · 问题定位'
              : panel === 'tutorial'
                ? '独立练习 · 固定样本 · 不影响存档'
                : '现行机制与道具说明'}
        </p>
      </div>
      <div className="utility-page-content">
        {panel === 'build' && game ? (
          <PlayerBuild game={game} turn={buildTurn} />
        ) : panel === 'replay' ? (
          <ReplayViewer />
        ) : panel === 'tutorial' ? (
          <GameTutorial scoreDecimals={preferences.scoreDecimals} />
        ) : (
          <GameRules onOpenTutorial={() => onPanelChange('tutorial')} />
        )}
      </div>
      <footer className="result-actions utility-page-actions">
        <p>
          {game
            ? game.phase === 'room_action'
              ? '当前报价保留，返回后可继续修改。Esc 可返回。'
              : '返回当前结算阶段，不重新计算本房间。Esc 可返回。'
            : '返回后继续选择角色，不会自动开始对局。Esc 可返回。'}
        </p>
        <Button type="button" size="lg" onClick={() => onPanelChange(null)}>
          <ArrowLeft aria-hidden="true" />
          返回游戏
        </Button>
      </footer>
    </section>
  );
}
