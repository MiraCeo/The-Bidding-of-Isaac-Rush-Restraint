import { createContext, type ReactNode } from 'react';

export const SettlementNavigationContext = createContext<{
  auxiliaryActions?: ReactNode;
  lifecycleActions?: ReactNode;
} | null>(null);

/** Compact, disclosed status. It never changes the current match. */
export function SettlementStatus({
  brief,
  children,
}: {
  brief: string;
  children?: ReactNode;
}) {
  return (
    <details className="settlement-status">
      <summary
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            const details = event.currentTarget.closest('details');
            if (details) details.open = false;
            event.stopPropagation();
          }
        }}
      >
        {brief} <span aria-hidden="true">▾</span>
      </summary>
      <div className="settlement-status-body">{children}</div>
    </details>
  );
}
