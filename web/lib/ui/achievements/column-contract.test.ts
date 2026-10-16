import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import postcss from 'postcss';
import { expect, it } from 'vitest';

const document = new Window().document;
const sheet = postcss.parse(
  readFileSync(new URL('../../../app/globals.css', import.meta.url), 'utf8'),
);
// Evaluate the checked-in container rules, not a duplicate breakpoint table.
// This is a CSS contract test, not a browser rendered-layout certification.
function declaration(
  element: { matches(selector: string): boolean },
  width: number,
  property: string,
) {
  let result = '';
  sheet.walkRules((rule) => {
    if (
      !rule.selector.includes('achievement-grid') &&
      !rule.selector.includes('achievement-column-feedback')
    )
      return;
    if (!element.matches(rule.selector)) return;
    let parent = rule.parent;
    while (parent && parent.type !== 'root') {
      if (parent.type === 'atrule') {
        if (parent.name !== 'container') return;
        const min = /min-width:(\d+)px/.exec(parent.params);
        if (!min || width < Number(min[1])) return;
      }
      parent = parent.parent;
    }
    rule.walkDecls(property, (d) => {
      result = d.value;
    });
  });
  return result;
}
it.each([
  [619, 'auto', 1],
  [620, 'auto', 2],
  [979, 'auto', 2],
  [980, 'auto', 3],
  [1279, '4', 3],
  [1280, '4', 4],
  [1439, 'auto', 3],
  [1440, 'auto', 4],
  [2000, '1', 1],
  [2000, '2', 2],
  [2000, '3', 3],
  [2000, '4', 4],
  [600, '4', 1],
  [800, '4', 2],
] as const)(
  'uses %i CSS-pixel container width with %s preference for %i columns',
  (width, requested, actual) => {
    const grid = document.createElement('div');
    grid.className = 'achievement-grid';
    grid.setAttribute('data-columns', requested);
    const expected =
      actual === 1 ? 'minmax(0,1fr)' : `repeat(${actual},minmax(0,1fr))`;
    expect(declaration(grid, width, 'grid-template-columns')).toBe(expected);
  },
);
it.each([
  [600, '4', 1],
  [800, '4', 2],
  [1100, '4', 3],
  [1280, '4', 4],
  [2000, '3', 3],
  [2000, '2', 2],
  [2000, '1', 1],
] as const)(
  'only exposes actual column feedback at %i width and %s preference',
  (width, requested, actual) => {
    const group = document.createElement('span');
    group.className = 'achievement-column-feedback';
    group.dataset.columns = requested;
    const visible: number[] = [];
    for (let n = 1; n <= 4; n++) {
      const span = document.createElement('span');
      span.dataset.actual = String(n);
      group.append(span);
      if (declaration(span, width, 'display') === 'inline') visible.push(n);
    }
    expect(visible).toEqual([actual]);
  },
);
