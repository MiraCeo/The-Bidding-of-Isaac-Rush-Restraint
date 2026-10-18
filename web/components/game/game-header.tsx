import { useContext, type ReactNode } from 'react';
import { appVersion } from '@/lib/ui/game-version';
import { GameBrand } from './game-brand';
import { AchievementFeedbackContext } from './achievement-feedback-context';

/** Shared product/navigation/version row. Ordinary match context stays below;
 * settlement may opt into a compact disclosed status, not an expanded HUD. */
export function GameHeader({
  navigation,
  context,
  showContext = true,
  status,
}: {
  navigation: ReactNode;
  context?: ReactNode;
  showContext?: boolean;
  status?: ReactNode;
}) {
  const achievementFeedback = useContext(AchievementFeedbackContext);
  return (
    <>
      <header className={`topbar${status ? ' topbar-with-session' : ''}`}>
        <div className="topbar-inner">
          <GameBrand />
          {navigation}
          {status ? (
            <div className="topbar-session">
              {status}
              <span
                className="app-version"
                aria-label={`应用版本 ${appVersion}`}
              >
                v{appVersion}
              </span>
            </div>
          ) : (
            <span className="app-version" aria-label={`应用版本 ${appVersion}`}>
              v{appVersion}
            </span>
          )}
        </div>
      </header>
      {showContext && context && (
        <section className="page-context-bar" aria-label="页面上下文">
          {context}
        </section>
      )}
      {achievementFeedback}
    </>
  );
}
