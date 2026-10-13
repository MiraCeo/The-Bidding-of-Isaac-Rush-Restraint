import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  onReturnGame?: () => void;
}
export function GameSettings({
  preferences,
  saveStatus,
  onChange,
  beforeGame = false,
  onReturnGame = () => {},
}: GameSettingsProps) {
  return (
    <section
      id="room-utilities"
      className="ranking-stage game-tools-stage"
      aria-labelledby="room-utilities-title"
    >
      <div className="ranking-page-heading">
        <div>
          <p className="eyebrow">INTERFACE SETTINGS</p>
          <h2 id="room-utilities-title" tabIndex={-1}>
            设置
          </h2>
        </div>
        <Button type="button" variant="secondary" onClick={onReturnGame}>
          <ArrowLeft aria-hidden="true" />
          返回游戏
        </Button>
      </div>
      <div className="utility-page-content game-settings-content">
        {
          <>
            <fieldset className="settings-group settings-display">
              <legend>显示</legend>
              <div className="settings-display-grid">
                <label className="setting-select" aria-label="积分显示小数位">
                  <span>
                    <strong>积分显示小数位</strong>
                    <small>仅影响显示，不改变实际精度。</small>
                  </span>
                  <select
                    value={preferences.scoreDecimals}
                    onChange={(e) =>
                      onChange({
                        ...preferences,
                        scoreDecimals: e.target.value === '4' ? 4 : 2,
                      })
                    }
                  >
                    <option value="2">2位 · 简洁</option>
                    <option value="4">4位 · 精确</option>
                  </select>
                </label>
                <label className="setting-toggle" aria-label="减少界面动效">
                  <span>
                    <strong>减少界面动效</strong>
                    <small>关闭过渡；系统减少动效设置优先。</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={preferences.reduceMotion}
                    onChange={(e) =>
                      onChange({
                        ...preferences,
                        reduceMotion: e.target.checked,
                      })
                    }
                  />
                </label>
                <label className="setting-toggle" aria-label="默认展开资金排行">
                  <span>
                    <strong>默认展开资金排行</strong>
                    <small>
                      {beforeGame
                        ? '开始游戏时应用。'
                        : '立即应用，并用于下一房间。'}
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={preferences.rankingInitiallyOpen}
                    onChange={(e) =>
                      onChange({
                        ...preferences,
                        rankingInitiallyOpen: e.target.checked,
                      })
                    }
                  />
                </label>
                <label className="setting-toggle" aria-label="默认展开共同市场">
                  <span>
                    <strong>默认展开共同市场</strong>
                    <small>只预览自己的行动，不公开秘密报价。</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={preferences.marketInitiallyOpen}
                    onChange={(e) =>
                      onChange({
                        ...preferences,
                        marketInitiallyOpen: e.target.checked,
                      })
                    }
                  />
                </label>
              </div>
              <div className="settings-footer">
                <output>
                  {saveStatus === 'saved'
                    ? '界面偏好已保存到当前浏览器。'
                    : saveStatus === 'session'
                      ? '浏览器存储不可用；修改仅在当前会话生效。'
                      : '界面偏好与对局分别保存。'}
                </output>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onChange({ ...defaultGamePreferences })}
                >
                  恢复默认设置
                </Button>
              </div>
            </fieldset>
          </>
        }
        {
          <details className="settings-version-details">
            <summary>版本与更新</summary>
            <AboutVersion />
          </details>
        }
      </div>
    </section>
  );
}
