import { useId, useState } from 'react';
import {
  survivalDifficulties,
  survivalDifficultyProfiles,
  type SurvivalDifficulty,
} from '@/lib/game/survival-difficulty';

// Selection-page copy only; the engine profiles and difficulty parameters stay frozen.
const difficultyDescriptions: Readonly<Record<SurvivalDifficulty, string>> = {
  easy: 'AI保留基本资金规划，但判断较粗、报价偏差和失误较多，适合熟悉竞拍与生存节奏。',
  standard:
    'AI具备中等判断与资金规划能力，报价仍有一定偏差，适合常规游玩，也是默认难度。',
  hard: 'AI对生存形势、角色能力和报价的判断更准确，保留少量失误，需要更仔细地分配资金。',
  highest:
    '使用完整强度的生存AI，不额外削弱其判断与报价能力，适合熟悉规则后挑战。',
};

export function SurvivalDifficultyPicker({
  value,
  onChange,
}: {
  value: SurvivalDifficulty;
  onChange?: (value: SurvivalDifficulty) => void;
}) {
  const id = useId();
  const [helpOpen, setHelpOpen] = useState(false);
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
        <button
          type="button"
          className="survival-difficulty-help-toggle"
          aria-expanded={helpOpen}
          aria-controls={`${id}-help`}
          onClick={() => setHelpOpen((open) => !open)}
        >
          <span aria-hidden="true">{helpOpen ? '▾' : '▸'}</span>
          难度说明
        </button>
      </div>
      <p
        id={`${id}-description`}
        className="survival-difficulty-description"
        aria-live="polite"
      >
        {difficultyDescriptions[value]}
      </p>
      <div
        id={`${id}-help`}
        className="survival-difficulty-help"
        hidden={!helpOpen}
      >
        <p>
          难度只影响AI的判断与决策，不改变斩杀线、角色能力或道具效果；开局后不能切换。
        </p>
        <p>“过关斩将”的金徽章要求在困难或最高难度下连续通过前5层。</p>
      </div>
    </section>
  );
}
