import { Button } from '@/components/ui/button';
import { SaveControls } from './save-controls';
import { ReplayControls } from './replay-controls';
import { AboutVersion } from './about-version';
import {
  defaultGamePreferences,
  type GamePreferences,
} from '@/lib/ui/game-preferences';

export type PreferenceSaveStatus = 'unchanged' | 'saved' | 'session';

interface GameSettingsProps {
  preferences: GamePreferences;
  saveStatus: PreferenceSaveStatus;
  onChange: (preferences: GamePreferences) => void;
  beforeGame?: boolean;
  onOpenReplay?: () => void;
}

export function GameSettings({
  preferences,
  saveStatus,
  onChange,
  beforeGame = false,
  onOpenReplay,
}: GameSettingsProps) {
  return (
    <div className="game-settings-content">
      <p className="utility-notice">
        这里只调整显示与面板偏好，不修改资金、积分、角色、AI 或游戏规则。
        {beforeGame
          ? '侧栏默认状态会在开始游戏时应用。'
          : '侧栏默认状态立即应用，并用于下一房间。'}
      </p>
      <fieldset className="settings-group">
        <legend>面板默认状态</legend>
        <label className="setting-toggle" aria-label="默认展开资金排行">
          <span>
            <strong>默认展开资金排行</strong>
            <small>左侧资金面板；手动收起不修改这个默认值。</small>
          </span>
          <input
            type="checkbox"
            checked={preferences.rankingInitiallyOpen}
            onChange={(event) =>
              onChange({
                ...preferences,
                rankingInitiallyOpen: event.target.checked,
              })
            }
          />
        </label>
        <label className="setting-toggle" aria-label="默认展开共同市场">
          <span>
            <strong>默认展开共同市场</strong>
            <small>右侧仍只预览你的行动，不提前显示其他人的秘密报价。</small>
          </span>
          <input
            type="checkbox"
            checked={preferences.marketInitiallyOpen}
            onChange={(event) =>
              onChange({
                ...preferences,
                marketInitiallyOpen: event.target.checked,
              })
            }
          />
        </label>
      </fieldset>
      <fieldset className="settings-group">
        <legend>数值与动效</legend>
        <label className="setting-select" aria-label="积分显示小数位">
          <span>
            <strong>积分显示小数位</strong>
            <small>
              应用于当前积分排行、结算、房间榜单和最终排行；不改变实际精度。
            </small>
          </span>
          <select
            value={preferences.scoreDecimals}
            onChange={(event) =>
              onChange({
                ...preferences,
                scoreDecimals: event.target.value === '4' ? 4 : 2,
              })
            }
          >
            <option value="2">2 位 · 简洁</option>
            <option value="4">4 位 · 精确</option>
          </select>
        </label>
        <label className="setting-toggle" aria-label="减少界面动效">
          <span>
            <strong>减少界面动效</strong>
            <small>
              关闭卡片和侧栏的过渡动画；系统的减少动效设置仍优先生效。
            </small>
          </span>
          <input
            type="checkbox"
            checked={preferences.reduceMotion}
            onChange={(event) =>
              onChange({ ...preferences, reduceMotion: event.target.checked })
            }
          />
        </label>
      </fieldset>
      <div className="settings-footer">
        <output>
          {saveStatus === 'saved'
            ? '界面偏好已保存到当前浏览器。'
            : saveStatus === 'session'
              ? '当前浏览器无法保存偏好，本次修改仍在当前会话生效。'
              : beforeGame
                ? '浏览器允许时会保存界面偏好；查看和修改设置不会自动开始对局。'
                : '界面偏好与对局存档分别保存。'}
        </output>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onChange({ ...defaultGamePreferences })}
        >
          恢复默认设置
        </Button>
      </div>
      <SaveControls />
      <ReplayControls onOpen={onOpenReplay ?? (() => {})} />
      <AboutVersion />
    </div>
  );
}
