import type { ReactNode } from 'react';

/** Shared hierarchy and alignment for utility pages, with page-specific actions. */
export function UtilityPageHeading({
  eyebrow,
  title,
  titleId,
  children,
  description,
}: {
  eyebrow: string;
  title: string;
  titleId: string;
  children?: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="ranking-page-heading">
      <div className="utility-page-heading-copy">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={titleId} tabIndex={-1}>
          {title}
        </h2>
        {description && (
          <p className="utility-page-description">{description}</p>
        )}
      </div>
      {children && (
        <div className="utility-page-heading-actions">{children}</div>
      )}
    </div>
  );
}
