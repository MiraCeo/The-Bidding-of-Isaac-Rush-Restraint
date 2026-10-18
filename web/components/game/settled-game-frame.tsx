import { GameHeader } from './game-header';
import { classicDifficultyLabel } from '@/lib/game/classic-difficulty';
import type { ReactNode } from 'react';
import { Coins } from 'lucide-react';
import { characterNames, type ActiveClientGameState } from '@/lib/game';
import { GameNavigation } from './game-navigation';
import { RoomUtilities } from './room-utilities';
import { MatchRestartControl } from './match-restart-control';
import { useUtilityPages } from './use-utility-pages';
import { useSessionTools } from './session-context';

/** Utility navigation preserves the actual settled phase and never advances a room. */
export function SettledGameFrame({
  game,
  children,
}: {
  game: ActiveClientGameState;
  children: ReactNode;
}) {
  const tools = useSessionTools()!;
  const { utilityPanel, changeUtilityPanel } = useUtilityPages();
  const human = game.players.find((p) => p.isHuman)!;
  return (
    <main
      className={
        utilityPanel
          ? 'ranking-page'
          : game.phase === 'game_result'
            ? 'final-page'
            : game.phase === 'room_result'
              ? 'result-page'
              : 'ranking-page'
      }
    >
      <GameHeader
        showContext={utilityPanel !== 'settings' && utilityPanel !== 'rules'}
        navigation={
          <GameNavigation
            page={utilityPanel}
            onPageChange={changeUtilityPanel}
          />
        }
        context={
          <>
            <div className="round-status">
              <span className="status-chip">
                难度 {classicDifficultyLabel(game.classicAi?.difficulty)}
              </span>
              <span className="status-chip">
                第 {game.floorIndex + 1} 层 · 房间 {game.roomIndex + 1}/5
              </span>
              <button
                type="button"
                className="status-chip build-entry"
                aria-label="查看角色构筑"
                aria-current={utilityPanel === 'build' ? 'page' : undefined}
                onClick={() => changeUtilityPanel('build')}
              >
                {characterNames[game.selectedCharacter]}{' '}
                <span aria-hidden="true">▾</span>
              </button>
              <span className="status-chip status-chip-money">
                <Coins aria-hidden="true" />
                <strong>{human.money}</strong>
              </span>
            </div>
          </>
        }
      />
      <div
        className="settled-page-content"
        hidden={utilityPanel !== null}
        inert={utilityPanel !== null}
      >
        <nav className="settled-toolbar" aria-label="结算页面操作">
          {tools.onReturnMenu && (
            <button
              type="button"
              className="survival-menu-return"
              onClick={tools.onReturnMenu}
            >
              返回主菜单
            </button>
          )}
          {utilityPanel === null && <MatchRestartControl />}
        </nav>
        {children}
      </div>
      <RoomUtilities
        panel={utilityPanel}
        game={game}
        preferences={tools.preferences}
        saveStatus={tools.preferenceSaveStatus}
        onPanelChange={changeUtilityPanel}
        onPreferencesChange={tools.onPreferencesChange}
      />
    </main>
  );
}
