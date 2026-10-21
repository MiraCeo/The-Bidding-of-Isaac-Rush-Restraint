import { useCallback, useEffect, useRef, useState } from 'react';

import type { RoomUtilityPanel } from './room-utilities';
import { useProgressNavigation } from './progress-navigation';

/** Interface navigation only: never creates a game or submits a turn. */
export function useUtilityPages(enabled = true) {
  const navigation = useProgressNavigation();
  const [utilityPanel, setUtilityPanel] = useState<RoomUtilityPanel | null>(
    () => (enabled ? (navigation?.pendingPage ?? null) : null),
  );
  const homeScrollRef = useRef(0);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const previousPanelRef = useRef<RoomUtilityPanel | null>(null);
  useEffect(() => {
    if (!enabled || !navigation || navigation.pendingPage === undefined) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (navigation.pendingPage && utilityPanel === null) {
        homeScrollRef.current = window.scrollY;
        returnFocusRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
      }
      setUtilityPanel(navigation.pendingPage ?? null);
      navigation.consumePage();
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, navigation, utilityPanel]);
  useEffect(() => {
    if (utilityPanel) {
      window.scrollTo(0, 0);
      document
        .getElementById('room-utilities-title')
        ?.focus({ preventScroll: true });
    } else if (previousPanelRef.current) {
      window.scrollTo(0, homeScrollRef.current);
      const origin = returnFocusRef.current;
      if (
        origin?.isConnected &&
        origin !== document.body &&
        !origin.closest('[hidden], [inert]')
      ) {
        origin.focus({ preventScroll: true });
      } else
        document
          .querySelector<HTMLButtonElement>(
            'nav[aria-label="主导航"] button[aria-current="page"]',
          )
          ?.focus({ preventScroll: true });
    }
    previousPanelRef.current = utilityPanel;
  }, [utilityPanel]);

  const changeUtilityPanel = useCallback(
    (next: RoomUtilityPanel | null) => {
      if (next && utilityPanel === null) {
        homeScrollRef.current = window.scrollY;
        returnFocusRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
      }
      setUtilityPanel(next);
    },
    [utilityPanel],
  );

  return { utilityPanel, changeUtilityPanel };
}
