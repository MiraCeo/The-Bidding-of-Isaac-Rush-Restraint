import { useEffect, useRef } from 'react';

/** New match stages start at the top; utility-page round trips keep their own scroll. */
export function useMatchScroll(stage: string | undefined, enabled: boolean) {
  const lastShown = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!enabled || !stage || stage === lastShown.current) return;
    lastShown.current = stage;
    window.scrollTo(0, 0);
  }, [stage, enabled]);
}
