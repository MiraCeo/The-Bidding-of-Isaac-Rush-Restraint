import { useEffect, useRef, useState } from 'react';

import type { RoomUtilityPanel } from './room-utilities';

/** Interface navigation only: never creates a game or submits a turn. */
export function useUtilityPages() {
  const [utilityPanel, setUtilityPanel] = useState<RoomUtilityPanel | null>(
    null,
  );
  const homeScrollRef = useRef(0);
  const previousPanelRef = useRef<RoomUtilityPanel | null>(null);
  useEffect(() => {
    if (utilityPanel) {
      window.scrollTo(0, 0);
      document
        .getElementById('room-utilities-title')
        ?.focus({ preventScroll: true });
    } else if (previousPanelRef.current) {
      window.scrollTo(0, homeScrollRef.current);
      document
        .querySelector<HTMLButtonElement>(
          'nav[aria-label="主导航"] button[aria-current="page"]',
        )
        ?.focus({ preventScroll: true });
    }
    previousPanelRef.current = utilityPanel;
  }, [utilityPanel]);

  function changeUtilityPanel(next: RoomUtilityPanel | null) {
    if (next && utilityPanel === null) homeScrollRef.current = window.scrollY;
    setUtilityPanel(next);
  }

  return { utilityPanel, changeUtilityPanel };
}
