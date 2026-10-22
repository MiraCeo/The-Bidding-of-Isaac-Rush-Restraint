import type { ReactNode } from 'react';

/** Shared hierarchy and alignment for utility pages, with page-specific actions. */
export function UtilityPageHeading({
  eyebrow,
  title,
  titleId,
  children,
  description,
  inlineDescription = false,
  className,
}: {
  eyebrow: string;
  title: string;
  titleId: string;
  children?: ReactNode;
  description?: ReactNode;
  inlineDescription?: boolean;
  className?: string;
}) {
  const titleContent = (
    <>
      <h2 id={titleId} tabIndex={-1}>
        {title}
      </h2>
      {description && <p className="utility-page-description">{description}</p>}
    </>
  );
  return (
    <div className={`ranking-page-heading${className ? ` ${className}` : ''}`}>
      <div
        className="utility-page-heading-copy"
        data-inline-description={inlineDescription || undefined}
      >
        <p className="eyebrow">{eyebrow}</p>
        {inlineDescription ? (
          <div className="utility-page-title-line">{titleContent}</div>
        ) : (
          titleContent
        )}
      </div>
      {children && (
        <div className="utility-page-heading-actions">{children}</div>
      )}
    </div>
  );
}
