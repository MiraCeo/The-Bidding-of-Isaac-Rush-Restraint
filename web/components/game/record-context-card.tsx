import { useId, type ReactNode } from 'react';

/** One frame for the classic and survival record contexts; actions stay mode-owned. */
export function RecordContextCard({
  children,
  status,
  className = '',
  titleId,
}: {
  children?: ReactNode;
  status: ReactNode;
  className?: string;
  titleId?: string;
}) {
  const generated = useId(),
    id = titleId ?? generated;
  return (
    <section
      className={`settings-group records-context-card ${className}`}
      aria-labelledby={id}
    >
      <h3 id={id}>对局与记录</h3>
      {children}
      <details className="data-technical records-save-status">
        <summary>保存状态</summary>
        <div>{status}</div>
      </details>
    </section>
  );
}
