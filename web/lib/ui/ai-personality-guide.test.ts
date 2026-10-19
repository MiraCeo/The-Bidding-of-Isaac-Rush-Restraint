// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AiPersonalityGuide } from '@/components/game/ai-personality-guide';
import { GameRules } from '@/components/game/game-rules';
import { aiDoctrineWeights } from '../game/ai-decision';
import {
  aiPersonalityNames,
  aiPersonalityOrder,
  implementedAiPersonalityOrder,
  personalityAnalysisInfluence,
  personalityCooperationPosition,
  personalityQuoteNoiseRatio,
} from '../game/ai-personality';
import {
  aiDoctrinePresentation,
  aiPersonalityPresentation,
} from './ai-personality-presentation';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it('covers all current personalities and explicitly distinguishes the excluded compatibility entry', () => {
  expect(Object.keys(aiPersonalityPresentation).sort()).toEqual(
    [...implementedAiPersonalityOrder].sort(),
  );
  const node = document.createElement('div');
  node.innerHTML = renderToStaticMarkup(createElement(AiPersonalityGuide));
  expect(node.querySelectorAll('[data-guide-personality]')).toHaveLength(21);
  expect(
    node.querySelectorAll('[data-compatibility-only="false"]'),
  ).toHaveLength(aiPersonalityOrder.length);
  for (const id of implementedAiPersonalityOrder) {
    const card = node.querySelector(`[data-guide-personality="${id}"]`)!;
    expect(card.textContent).toContain(aiPersonalityNames[id]);
    expect(card.textContent).toContain(aiPersonalityPresentation[id].summary);
    expect(card.textContent).toContain(aiPersonalityPresentation[id].detail);
  }
  const compatibility = node.querySelector('[data-compatibility-only="true"]')!;
  expect(compatibility.getAttribute('data-guide-personality')).toBe('all_in');
  expect(compatibility.textContent).toContain('当前不生成');
});

it('shows engine doctrine weights as weights, preserves zero strategies and explains non-obvious traits', () => {
  const node = document.createElement('div');
  node.innerHTML = renderToStaticMarkup(createElement(AiPersonalityGuide));
  for (const id of Object.keys(
    aiDoctrinePresentation,
  ) as (keyof typeof aiDoctrinePresentation)[]) {
    expect(
      [...node.querySelectorAll(`[data-guide-doctrine="${id}"] dd`)].map((e) =>
        Number(e.textContent),
      ),
    ).toEqual(Object.values(aiDoctrineWeights[id]));
  }
  expect(node.textContent).toContain('不是修正后的最终概率');
  expect(aiDoctrineWeights.cooperative.disrupt_high).toBe(0);
  expect(aiDoctrinePresentation.cooperative.summary).toContain(
    '仍可能使用合作区扰乱',
  );
  expect(personalityCooperationPosition(['common_good'])).toBe(0);
  expect(personalityCooperationPosition(['generous'])).toBeLessThan(0);
  expect(aiPersonalityPresentation.generous.detail).toContain(
    '不会直接给其他玩家转移资金',
  );
  expect(personalityAnalysisInfluence(['arrogant']).situation).toBeLessThan(1);
  expect(personalityAnalysisInfluence(['rational']).situation).toBeGreaterThan(
    1,
  );
  expect(aiPersonalityPresentation.speculative.detail).toContain(
    '不是专指低价捡漏',
  );
  expect(aiPersonalityPresentation.gambler.detail).toContain(
    `${Math.round(personalityQuoteNoiseRatio(['gambler']) * 100)}%`,
  );
});

it('makes the guide available in both modes without activating hidden peer panels or writing storage', async () => {
  for (const mode of ['classic', 'survival'] as const) {
    const node = document.createElement('div');
    document.body.append(node);
    const root = createRoot(node);
    const stored = () =>
      JSON.stringify(
        Object.keys(localStorage)
          .sort()
          .map((key) => [key, localStorage.getItem(key)]),
      );
    const before = stored();
    try {
      await act(async () =>
        root.render(
          createElement<{ mode?: 'classic' | 'survival' }>(GameRules, { mode }),
        ),
      );
      const tabs = [
        ...node.querySelectorAll<HTMLButtonElement>('.rules-tabs button'),
      ];
      const ai = node.querySelector<HTMLElement>(
        '.rules-tab-panel[aria-label="AI性格"]',
      )!;
      expect(ai.hidden).toBe(true);
      expect(ai.hasAttribute('inert')).toBe(true);
      await act(async () =>
        tabs.find((e) => e.textContent === 'AI性格')!.click(),
      );
      expect(ai.hidden).toBe(false);
      expect(ai.hasAttribute('inert')).toBe(false);
      for (const peer of node.querySelectorAll<HTMLElement>(
        '.rules-tab-panel:not([aria-label="AI性格"])',
      )) {
        expect(peer.hidden).toBe(true);
        expect(peer.hasAttribute('inert')).toBe(true);
      }
      expect(ai.querySelectorAll('[data-guide-personality]')).toHaveLength(21);
      await act(async () =>
        tabs.find((e) => e.textContent === '道具图鉴')!.click(),
      );
      expect(ai.hidden).toBe(true);
      expect(ai.hasAttribute('inert')).toBe(true);
      expect(stored()).toBe(before);
    } finally {
      await act(async () => root.unmount());
      node.remove();
    }
  }
});
