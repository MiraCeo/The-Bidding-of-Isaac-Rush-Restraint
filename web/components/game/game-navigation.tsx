import type { RoomUtilityPanel } from './room-utilities';
import { useProgressNavigation } from './progress-navigation';

interface GameNavigationProps {
  page: RoomUtilityPanel | 'progress' | null;
  onPageChange: (page: RoomUtilityPanel | null) => void;
}

const pages = [
  { page: null, label: '游戏' },
  { page: 'ranking', label: '排行' },
  { page: 'progress', label: '进度' },
  { page: 'settings', label: '设置' },
  { page: 'rules', label: '规则' },
] as const;

export function GameNavigation({ page, onPageChange }: GameNavigationProps) {
  const progress = useProgressNavigation();
  return (
    <nav className="main-nav" aria-label="主导航">
      {pages.map((entry) => (
        <button
          key={entry.page ?? 'game'}
          type="button"
          className={`nav-item ${page === entry.page ? 'nav-item-active' : ''}`}
          aria-current={page === entry.page ? 'page' : undefined}
          disabled={entry.page === 'progress' && !progress}
          onClick={() =>
            entry.page === 'progress'
              ? progress?.openProgress()
              : onPageChange(entry.page)
          }
        >
          {entry.label}
        </button>
      ))}
    </nav>
  );
}
