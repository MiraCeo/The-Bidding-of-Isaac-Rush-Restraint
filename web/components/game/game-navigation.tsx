import type { RoomUtilityPanel } from './room-utilities';

interface GameNavigationProps {
  page: RoomUtilityPanel | null;
  onPageChange: (page: RoomUtilityPanel | null) => void;
}

const pages = [
  { page: null, label: '游戏' },
  { page: 'ranking', label: '排行' },
  { page: 'settings', label: '设置' },
  { page: 'rules', label: '规则' },
] as const;

export function GameNavigation({ page, onPageChange }: GameNavigationProps) {
  return (
    <nav className="main-nav" aria-label="主导航">
      {pages.map((entry) => (
        <button
          key={entry.page ?? 'game'}
          type="button"
          className={`nav-item ${page === entry.page ? 'nav-item-active' : ''}`}
          aria-current={page === entry.page ? 'page' : undefined}
          onClick={() => onPageChange(entry.page)}
        >
          {entry.label}
        </button>
      ))}
    </nav>
  );
}
