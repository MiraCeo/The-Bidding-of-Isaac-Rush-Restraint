import { createContext, type ReactNode } from 'react';
import { Coins } from 'lucide-react';

export function SettlementStatusLabel({
  mode,
  floor,
  room,
  money,
}: {
  mode: string;
  floor: number;
  room: number;
  money: number;
}) {
  return (
    <>
      <span className="settlement-mode">{mode}</span>
      <span className="settlement-position">
        第{floor}层 · {room}/5房
      </span>
      <span className="settlement-funds">
        <Coins aria-hidden="true" />
        <span className="sr-only">资金</span>
        <strong>{money}</strong>
      </span>
    </>
  );
}

export const SettlementNavigationContext = createContext<{
  auxiliaryActions?: ReactNode;
  lifecycleActions?: ReactNode;
} | null>(null);

/** Compact, disclosed status. It never changes the current match. */
export function SettlementStatus({
  brief,
  children,
}: {
  brief: ReactNode;
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
