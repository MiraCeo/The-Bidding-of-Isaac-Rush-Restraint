import type { ReactNode } from 'react';

/** Shared hierarchy and alignment for utility pages, with page-specific actions. */
export function UtilityPageHeading({
  eyebrow,
  title,
  titleId,
  children,
}: {
  eyebrow: string;
  title: string;
  titleId: string;
  children?: ReactNode;
}) {
  return (
    <div className="ranking-page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={titleId} tabIndex={-1}>
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}
