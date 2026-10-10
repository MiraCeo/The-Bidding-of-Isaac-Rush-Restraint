import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';

import { GameRules } from './game-rules';
import { GameSettings, type PreferenceSaveStatus } from './game-settings';
import { RoomRanking } from './room-ranking';
import { Button } from '@/components/ui/button';
import type { ActiveClientGameState } from '@/lib/game/client-session';
import type { GamePreferences } from '@/lib/ui/game-preferences';

export type RoomUtilityPanel = 'ranking' | 'settings' | 'rules';
const panelNames: Readonly<Record<RoomUtilityPanel, string>> = {
  ranking: '排行',
  settings: '设置',
  rules: '规则',
};

interface RoomUtilitiesProps {
  panel: RoomUtilityPanel | null;
  game?: ActiveClientGameState;
  preferences: GamePreferences;
  saveStatus: PreferenceSaveStatus;
  onPanelChange: (panel: RoomUtilityPanel | null) => void;
  onPreferencesChange: (preferences: GamePreferences) => void;
}

export function RoomUtilities({
  panel,
  game,
  preferences,
  saveStatus,
  onPanelChange,
  onPreferencesChange,
}: RoomUtilitiesProps) {
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
            {panel === 'settings' ? 'INTERFACE SETTINGS' : 'GAME RULES'}
          </p>
          <h2 id="room-utilities-title" tabIndex={-1}>
            {panelNames[panel]}
          </h2>
        </div>
        <p>
          {panel === 'settings'
            ? '显示偏好 · 不改变对局规则'
            : '现行机制与道具说明'}
        </p>
      </div>
      <div className="utility-page-content">
        {panel === 'settings' ? (
          <GameSettings
            preferences={preferences}
            saveStatus={saveStatus}
            onChange={onPreferencesChange}
            beforeGame={!game}
          />
        ) : (
          <GameRules />
        )}
      </div>
      <footer className="result-actions utility-page-actions">
        <p>
          {game
            ? '当前报价保留，返回后可继续修改。Esc 可返回。'
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
