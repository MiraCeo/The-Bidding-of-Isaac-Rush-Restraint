import { Archive, HardDrive, UserRound } from 'lucide-react';

/** Shared visual framing only; file actions and confirmation guards stay with their owners. */
export function BackupObjectHeading({
  kind,
  title,
  titleId,
  badge,
  description,
}: {
  kind: 'match' | 'profile' | 'library';
  title: string;
  titleId: string;
  badge: string;
  description: string;
}) {
  const Icon = { match: HardDrive, profile: UserRound, library: Archive }[kind];
  return (
    <header className="backup-object-heading">
      <div className="backup-object-title">
        <span className="backup-object-icon">
          <Icon aria-hidden="true" />
        </span>
        <h3 id={titleId}>{title}</h3>
        <span className="backup-object-badge">{badge}</span>
      </div>
      <p>{description}</p>
    </header>
  );
}
