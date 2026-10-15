import type { ReactNode } from 'react';
import { appVersion } from '@/lib/ui/game-version';
import { GameBrand } from './game-brand';

/** One product/navigation/version row. Match context lives below, never in an
 * expanding third grid cell that competes with the page title or navigation. */
export function GameHeader({
  navigation,
  context,
}: {
  navigation: ReactNode;
  context?: ReactNode;
}) {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <GameBrand />
          {navigation}
          <span className="app-version" aria-label={`应用版本 ${appVersion}`}>
            v{appVersion}
          </span>
        </div>
      </header>
      {context && (
        <section className="page-context-bar" aria-label="页面上下文">
          {context}
        </section>
      )}
    </>
  );
}
