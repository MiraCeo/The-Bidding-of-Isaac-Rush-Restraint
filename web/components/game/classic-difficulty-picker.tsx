import { useId, useState } from 'react';
import {
  classicDifficulties,
  classicDifficultyProfiles,
  type ClassicDifficulty,
} from '@/lib/game/classic-difficulty';
const descriptions: Record<ClassicDifficulty, string> = {
  easy: 'AI对局势与道具的判断影响较弱，市场预测偏差较大，适合熟悉经典竞拍。',
  standard: 'AI保留部分局势与道具判断，市场预测仍有明显偏差，适合逐步练习。',
  hard: 'AI较充分地考虑局势与道具，市场预测保留少量偏差，接近原版挑战。',
  highest: '完整保留原版经典AI，不额外削弱；默认使用此档，保持原有对局体验。',
};
export function ClassicDifficultyPicker({
  value,
  onChange,
}: {
  value: ClassicDifficulty;
  onChange?: (value: ClassicDifficulty) => void;
}) {
  const id = useId(),
    [helpOpen, setHelpOpen] = useState(false);
  return (
    <section
      className="survival-difficulty-picker classic-difficulty-picker"
      aria-label="经典AI难度设置"
    >
      <div className="survival-difficulty-main">
        <strong>AI难度</strong>
        <fieldset
          className="survival-difficulty-options"
          aria-describedby={`${id}-description`}
        >
          <legend className="sr-only">经典AI难度</legend>
          {classicDifficulties.map((d) => (
            <label key={d} data-selected={value === d}>
              <input
                type="radio"
                name={`${id}-difficulty`}
                value={d}
                checked={value === d}
                onChange={() => onChange?.(d)}
              />
              <span>{classicDifficultyProfiles[d].label}</span>
            </label>
          ))}
        </fieldset>
        <small>开局后锁定</small>
        <button
          type="button"
          className="survival-difficulty-help-toggle"
          aria-expanded={helpOpen}
          aria-controls={`${id}-help`}
          onClick={() => setHelpOpen((v) => !v)}
        >
          <span aria-hidden="true">{helpOpen ? '▾' : '▸'}</span>难度说明
        </button>
      </div>
      <p
        id={`${id}-description`}
        className="survival-difficulty-description"
        aria-live="polite"
      >
        {descriptions[value]}
      </p>
      <div
        id={`${id}-help`}
        className="survival-difficulty-help"
        hidden={!helpOpen}
      >
        <p>
          四档只改变经典AI判断与预测精度，不改变资金、角色、道具、市场或积分规则；不是生存斩杀线策略。
        </p>
        <p>
          最高为原版基线。旧对局未记录档位时仍使用原版，续玩不改难度；不同档位不保证每一局排名都单调变化。
        </p>
      </div>
    </section>
  );
}
