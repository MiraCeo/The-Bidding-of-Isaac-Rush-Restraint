import type { ReactNode } from 'react';

/** Stable product identity across game and utility pages; page names belong below the header. */
export function GameBrand({ version }: { version?: ReactNode }) {
  return (
    <div className="brand-block">
      <div className="brand-kicker">
        <p className="eyebrow">THE BIDDING OF ISAAC</p>
        {version}
      </div>
      <h1>以撒的竞合：冲 · 慎</h1>
    </div>
  );
}
