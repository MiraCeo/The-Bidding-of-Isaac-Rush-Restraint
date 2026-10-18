import type { ReactNode } from 'react';

/** A named overflow region needs a tab stop so keyboard users can scroll it. */
export function RankingScrollArea({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: ReactNode;
}) {
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard access to overflow content
    <section className={className} aria-label={label} tabIndex={0}>
      {children}
    </section>
  );
}

/** Only the explicitly clicked board is scrolled; opening a board never moves it. */
export function LocateSelfButton() {
  return (
    <button
      type="button"
      className="ranking-locate-self"
      onClick={(event) => {
        const scope = event.currentTarget.closest('[data-ranking-scope]');
        const row = scope?.querySelector<HTMLElement>(
          '[data-ranking-self="true"]',
        );
        row?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        row?.focus({ preventScroll: true });
      }}
    >
      定位本人
    </button>
  );
}

export function RankingSelfSummary({
  label,
  rank,
  children,
}: {
  label: string;
  rank?: number;
  children?: ReactNode;
}) {
  return (
    <div className="ranking-self-summary">
      <p>
        {label} <strong>{rank === undefined ? '—' : `#${rank}`}</strong>
      </p>
      {children && <span>{children}</span>}
      {rank !== undefined && <LocateSelfButton />}
    </div>
  );
}
