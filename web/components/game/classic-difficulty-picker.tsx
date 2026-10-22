import { useId, useState } from 'react';
import {
  classicDifficulties,
  classicDifficultyProfiles,
  type ClassicDifficulty,
} from '@/lib/game/classic-difficulty';
const descriptions: Record<ClassicDifficulty, string> = {
  easy: '19名AI中有15名低阶、4名中阶，适合熟悉经典竞拍。',
  standard: '19名AI中有4名低阶、13名中阶、2名高阶，以中阶对手为主。',
  hard: '19名AI中有2名低阶、6名中阶、11名高阶，高阶对手占多数。',
  highest: '19名AI全部为高阶，完整保留原版经典AI，不增加失误；默认使用此档。',
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
          四档只改变低／中／高阶AI的固定人数，不改变初始资金、角色、道具、市场或积分规则；等级与流派、性格独立。
        </p>
        <p>
          低阶每房有25%失误触发率，中阶15%，高阶0%；只有存在合法的有界失误时才实际改变行动，双行动不会增加触发次数。低阶触发后40%尝试中度失误，中阶为20%。
        </p>
        <p>
          等级按种子在开局固定，续玩不重抽。旧分档对局仍按旧策略续玩；最高与未分档旧对局保留原版，不同档位不保证每局名次单调变化。
        </p>
      </div>
    </section>
  );
}
