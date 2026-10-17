import { useId } from 'react';
import {
  survivalDifficulties,
  survivalDifficultyProfiles,
  type SurvivalDifficulty,
} from '@/lib/game/survival-difficulty';

export function SurvivalDifficultyPicker({
  value,
  onChange,
}: {
  value: SurvivalDifficulty;
  onChange?: (value: SurvivalDifficulty) => void;
}) {
  const id = useId();
  return (
    <section className="survival-difficulty-picker" aria-label="生存AI难度设置">
      <div className="survival-difficulty-main">
        <strong>AI难度</strong>
        <fieldset
          className="survival-difficulty-options"
          aria-describedby={`${id}-description`}
        >
          <legend className="sr-only">生存AI难度</legend>
          {survivalDifficulties.map((difficulty) => (
            <label key={difficulty} data-selected={value === difficulty}>
              <input
                type="radio"
                name={`${id}-difficulty`}
                value={difficulty}
                checked={value === difficulty}
                onChange={() => onChange?.(difficulty)}
              />
              <span>{survivalDifficultyProfiles[difficulty].label}</span>
            </label>
          ))}
        </fieldset>
        <small>开局后锁定</small>
        <details className="survival-difficulty-help">
          <summary>难度说明</summary>
          <p>
            仅影响AI判断，不改变斩杀线、角色或道具。
            “过关斩将”的金徽章要求在困难或最高难度下连续通过前5层。
          </p>
        </details>
      </div>
      <p
        id={`${id}-description`}
        className="survival-difficulty-description"
        aria-live="polite"
      >
        {value === 'highest'
          ? '完整强度的生存AI，不额外削弱。'
          : survivalDifficultyProfiles[value].description}
      </p>
    </section>
  );
}
