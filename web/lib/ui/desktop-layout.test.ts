import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
it('defines PC width/gutter/heading contracts without claiming DOM fixtures render actual pixels', () => {
  const css = readFileSync(
    new URL('../../app/globals.css', import.meta.url),
    'utf8',
  );
  for (const text of [
    '--desktop-shell-max: 1440px',
    '--desktop-shell-gutter: 32px',
    '@media (min-width:900px)',
    '--topbar-height:76px',
    'top: var(--topbar-height);',
    'width:var(--desktop-shell-width)',
    'grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)',
    'max-width:none; margin:0',
    '.game-stage { width:min(var(--game-content-width),1200px)',
  ])
    expect(css).toContain(text);
  // Width arithmetic is a static budget, not a browser/font/zoom measurement.
  for (const viewport of [900, 1024, 1280, 1440, 1920, 2560]) {
    const width = Math.min(1440, viewport - 64),
      brandBudget = (width - (62 * 5 + 3 * 4) - 24 * 2) / 2;
    expect(width).toBeLessThan(viewport);
    expect(brandBudget).toBeGreaterThanOrEqual(230);
  }
  for (const file of [
    'game-mode-menu',
    'character-selection',
    'room-prototype',
    'settled-game-frame',
    'progress-center',
    'game-result',
    'room-result',
    'room-ranking',
    'classic-game-app',
    'survival-game-app',
  ]) {
    const source = readFileSync(
      new URL(`../../components/game/${file}.tsx`, import.meta.url),
      'utf8',
    );
    expect(source).toContain('<GameHeader');
    expect(source).not.toContain('<header className="topbar">');
  }
});
