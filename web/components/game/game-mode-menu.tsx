import { GameHeader } from './game-header';
import { Button } from '@/components/ui/button';
import { GameNavigation } from './game-navigation';
import { RoomUtilities } from './room-utilities';
import { useUtilityPages } from './use-utility-pages';
import { useSessionTools } from './session-context';
import type { GamePreferences } from '@/lib/ui/game-preferences';
import type { PreferenceSaveStatus } from './game-settings';

export function GameModeMenu({
  onClassic,
  onSurvival,
  hasSurvival,
  preferences,
  status,
  survivalNotice,
  onPreferencesChange,
}: {
  onClassic: () => void;
  onSurvival: () => void;
  hasSurvival: boolean;
  preferences: GamePreferences;
  status: PreferenceSaveStatus;
  survivalNotice?: string;
  onPreferencesChange: (next: GamePreferences) => void;
}) {
  const { utilityPanel, changeUtilityPanel } = useUtilityPages();
  const tools = useSessionTools();
  return (
    <main className={utilityPanel ? 'ranking-page' : 'character-page'}>
      <GameHeader
        navigation={
          <GameNavigation
            page={utilityPanel}
            onPageChange={changeUtilityPanel}
          />
        }
      />
      <section
        className="mode-menu-stage"
        hidden={utilityPanel !== null}
        inert={utilityPanel !== null}
      >
        <p className="eyebrow">CHOOSE YOUR CHALLENGE</p>
        <h2>选择你的竞合方式</h2>
        <p>秘密报价，共同市场。选择经典积分赛，或在逐层淘汰中存活。</p>
        <div className="mode-menu-grid">
          <article>
            <span className="mode-symbol" aria-hidden>
              ◇
            </span>
            <h3>教程</h3>
            <p>基础五课与生存六课独立练习，掌握报价、构筑和层末淘汰。</p>
            <small>不创建正式对局 · 不影响存档</small>
            <Button onClick={() => changeUtilityPanel('tutorial')}>
              新手教程
            </Button>
          </article>
          <article>
            <span className="mode-symbol" aria-hidden>
              ♜
            </span>
            <h3>经典模式</h3>
            <p>三层十五房，100／500／1000资金。保留原版道具与积分规则。</p>
            <small>
              {tools?.session.game.phase !== 'character_selection'
                ? '已有经典对局，可继续或重新选角'
                : '1名真人＋19名AI'}
            </small>
            <Button onClick={onClassic}>经典模式</Button>
          </article>
          <article className="mode-survival">
            <span className="mode-symbol" aria-hidden>
              ✦
            </span>
            <h3>生存模式</h3>
            <p>每层五房，至少淘汰两人。发展构筑，争取存活至总榜结算。</p>
            <small>1000基础资金 · 四档AI难度 · 默认标准</small>
            <Button onClick={onSurvival}>
              {hasSurvival ? '继续生存模式' : '生存模式'}
            </Button>
          </article>
        </div>
        {tools?.restoreMessage && (
          <output className="save-message">{tools.restoreMessage}</output>
        )}
        {survivalNotice && (
          <output className="save-message">{survivalNotice}</output>
        )}
      </section>
      <RoomUtilities
        returnLabel="返回主菜单"
        panel={utilityPanel}
        preferences={preferences}
        saveStatus={status}
        onPanelChange={changeUtilityPanel}
        onPreferencesChange={onPreferencesChange}
      />
    </main>
  );
}
