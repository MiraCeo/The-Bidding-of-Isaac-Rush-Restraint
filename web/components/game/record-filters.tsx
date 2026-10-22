import { characterNames } from '@/lib/game';
import { classicDifficultyLabel } from '@/lib/game/classic-difficulty';
import { survivalDifficultyLabel } from '@/lib/game/survival-difficulty';
import type { LibraryFilters } from './replay-library-panel';

export function RecordFilters({
  mode,
  filters,
  onChange,
  count,
  label = '回放库',
}: {
  mode: 'classic' | 'survival';
  filters: LibraryFilters;
  onChange: (field: keyof LibraryFilters, value: string) => void;
  count: number | null;
  label?: string;
}) {
  return (
    <div className="library-filters record-filters">
      <label>
        角色
        <select
          aria-label={`${label}角色`}
          value={filters.role}
          onChange={(e) => onChange('role', e.target.value)}
        >
          <option value="all">全部角色</option>
          {Object.entries(characterNames).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        难度
        <select
          aria-label={`${label}难度`}
          value={filters.difficulty}
          onChange={(e) => onChange('difficulty', e.target.value)}
        >
          <option value="all">全部难度</option>
          {(['easy', 'standard', 'hard', 'highest'] as const).map((d) => (
            <option key={d} value={d}>
              {mode === 'classic'
                ? classicDifficultyLabel(d)
                : survivalDifficultyLabel(d)}
            </option>
          ))}
          <option value="ungraded">
            {mode === 'classic' ? '原版（未分档）' : '未分层'}
          </option>
        </select>
      </label>
      <label>
        状态
        <select
          aria-label={`${label}状态`}
          value={filters.completion}
          onChange={(e) => onChange('completion', e.target.value)}
        >
          <option value="all">全部状态</option>
          <option value="complete">已完成</option>
          <option value="partial">进行中片段</option>
        </select>
      </label>
      <span>{count === null ? '记录暂不可核验' : `${count} 条符合筛选`}</span>
    </div>
  );
}
