import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GameRules } from '@/components/game/game-rules';
import { defaultRules } from '../game/config';
import { itemCatalog } from '../game/item-catalog';
import { itemPresentations } from '../game/item-presentation';
import { createGameRuleSections } from './game-rules';

describe('in-game rule reference', () => {
  it('uses the current market, scoring, room and floor configuration', () => {
    const text = JSON.stringify(createGameRuleSections());
    expect(text).toContain('2/3 × M + 10% × F');
    expect(text).toContain('2.5 倍');
    expect(text).toContain('1.25 倍');
    expect(text).toContain('四舍五入');
    expect(text).toContain('ceil(k / 2)');
    expect(text).toContain('100 / 500 / 1000');
    expect(text).toContain('双行动贡献两个市场样本');
    expect(text).toContain('不向后顺延');
  });

  it('reads configurable constants instead of another fixed copy of the rules', () => {
    const rules = {
      ...defaultRules,
      playerCount: 8,
      roomsPerFloor: [2, 3],
      floorStartingMoney: [120, 600],
      disruptionMarketMultiplier: 3,
      disruptionScoringMultiplier: 1.5,
      cooperationZoneRatio: 0.15,
      targetConstantRatio: 0.2,
      highPriceWinnerRatio: 0.25,
    };
    const sections = createGameRuleSections(rules);
    const text = JSON.stringify(sections);
    expect(text).toContain('8 人共同市场');
    expect(text).toContain('共 5 房');
    expect(text).toContain('120 / 600');
    expect(text).toContain('T ± 15% × F');
    expect(text).toContain('2/3 × M + 20% × F');
    expect(text).toContain('人数的 25%');
    expect(text).toContain('市场等价为 3 倍');
    expect(
      sections.find((section) => section.id === 'market')?.formula?.expression,
    ).toBe('T = 2/3 × M + 20% × F');
    expect(
      sections.find((section) => section.id === 'market')?.formula?.caption,
    ).toContain('T ± 15% × F');
  });

  it('renders every catalog item and its existing presentation with nonstack labels', () => {
    const html = renderToStaticMarkup(createElement(GameRules));
    const text = html.replace(/<[^>]+>/g, '');
    for (const item of itemCatalog) {
      expect(text).toContain(item.name);
      expect(text).toContain(itemPresentations[item.id].description);
    }
    expect(html.match(/class="rule-item-card"/g)).toHaveLength(
      itemCatalog.length,
    );
    expect(html.match(/data-kind="stacking">效果不叠加<\/li>/g)).toHaveLength(
      itemCatalog.filter((item) => !item.effectStacks).length,
    );
    expect(text).toContain('不影响尾巴自身');
    expect(text).toContain('扰乱获得不返款');
    expect(text).toContain('不重掷其他随机效果');
  });

  it('provides a complete, unique table of contents instead of a wall of unstructured cards', () => {
    const html = renderToStaticMarkup(createElement(GameRules));
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    const targets = [...html.matchAll(/href="#([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(targets).toHaveLength(10);
    for (const target of targets) expect(ids).toContain(target);
    expect(html).toContain('aria-label="规则目录"');
    expect(html.match(/class="rule-chapter"/g)).toHaveLength(8);
    expect(html).not.toContain('class="rule-card"');
    expect(html).not.toContain('class="utility-notice"');
  });

  it('renders quick-start steps, action definitions, comparison table and formulas while keeping the catalog collapsed', () => {
    const html = renderToStaticMarkup(createElement(GameRules));
    expect(html).toContain('class="rules-start-steps"');
    expect(html).toContain('<dl class="rule-actions">');
    expect(html.match(/<dt>/g)).toHaveLength(3);
    expect(html).toContain('<table class="rule-comparison">');
    expect(html.match(/<th scope="row">/g)).toHaveLength(4);
    expect(html.match(/<figure class="rule-formula">/g)).toHaveLength(2);
    expect(html).toContain('T = 2/3 × M + 10% × F');
    expect(html.match(/<details[^>]*>/)?.[0]).not.toMatch(/\bopen\b/);
  });
});
