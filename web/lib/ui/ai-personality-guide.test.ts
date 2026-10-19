// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
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

const click = async (button: HTMLElement) => act(async () => button.click());
const fill = async (node: HTMLElement, value: string) =>
  act(async () => {
    const input = node.querySelector<HTMLInputElement>(
      '.ai-guide-search input',
    )!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const withGuide = async (check: (node: HTMLDivElement) => Promise<void>) => {
  const node = document.createElement('div');
  document.body.append(node);
  const root = createRoot(node);
  try {
    await act(async () => root.render(createElement(AiPersonalityGuide)));
    await check(node);
  } finally {
    await act(async () => root.unmount());
    node.remove();
  }
};
it('covers all personalities through a compact directory with one detail and a separate compatibility group', async () => {
  expect(Object.keys(aiPersonalityPresentation).sort()).toEqual(
    [...implementedAiPersonalityOrder].sort(),
  );
  await withGuide(async (node) => {
    expect(
      node.querySelectorAll(
        '.ai-guide-directory [data-ai-entry^="personality:"]',
      ),
    ).toHaveLength(21);
    expect(
      node.querySelector<HTMLDetailsElement>('.ai-guide-compatibility')!.open,
    ).toBe(false);
    expect(
      node.querySelectorAll('.ai-guide-reader [data-guide-personality]'),
    ).toHaveLength(1);
    for (const id of aiPersonalityOrder) {
      await click(node.querySelector(`[data-ai-entry="personality:${id}"]`)!);
      const detail = node.querySelector(`[data-guide-personality="${id}"]`)!;
      expect(detail.textContent).toContain(aiPersonalityNames[id]);
      expect(detail.textContent).toContain(
        aiPersonalityPresentation[id].summary,
      );
      expect(detail.textContent).toContain(
        aiPersonalityPresentation[id].detail,
      );
    }
    await fill(node, '孤注一掷');
    expect(
      node.querySelector<HTMLDetailsElement>('.ai-guide-compatibility')!.open,
    ).toBe(true);
    expect(
      node.querySelector('[data-compatibility-only="true"]')!.textContent,
    ).toContain('当前新局不生成');
    expect(
      node.querySelector('[data-guide-personality="all_in"]')!.textContent,
    ).toContain(aiPersonalityPresentation.all_in.detail);
  });
});
it('preserves all doctrine weights behind an explicit disclosure and explains non-obvious behavior', async () => {
  await withGuide(async (node) => {
    await click(
      [...node.querySelectorAll<HTMLElement>('.ai-guide-kinds button')].find(
        (e) => e.textContent === '流派',
      )!,
    );
    for (const id of Object.keys(
      aiDoctrinePresentation,
    ) as (keyof typeof aiDoctrinePresentation)[]) {
      await click(node.querySelector(`[data-ai-entry="doctrine:${id}"]`)!);
      expect(
        node.querySelector<HTMLDetailsElement>('.ai-guide-weights')!.open,
      ).toBe(false);
      expect(
        [...node.querySelectorAll(`[data-guide-doctrine="${id}"] dd`)].map(
          (e) => Number(e.textContent),
        ),
      ).toEqual(Object.values(aiDoctrineWeights[id]));
      expect(node.querySelector('.ai-guide-reader')!.textContent).toContain(
        '不是修正后的最终概率',
      );
    }
  });
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
it('searches names and effects, clears an empty result and switches a related reading target', async () => {
  await withGuide(async (node) => {
    await fill(node, '资金');
    expect(
      Number(
        node
          .querySelector('.ai-guide-directory output')!
          .textContent!.split('/')[0],
      ),
    ).toBeGreaterThan(0);
    await fill(node, 'greedy');
    expect(
      node.querySelector('[data-guide-personality="greedy"]'),
    ).not.toBeNull();
    await fill(node, '完全不存在的词条');
    expect(
      node.querySelector('.ai-guide-reader [data-guide-personality]'),
    ).toBeNull();
    expect(node.querySelector('.ai-guide-empty')!.textContent).toContain(
      '没有匹配',
    );
    await click(node.querySelector('.ai-guide-empty button')!);
    expect(
      node.querySelector('[data-guide-personality="stable"]'),
    ).not.toBeNull();
    await click(node.querySelector('.ai-guide-compare button')!);
    expect(
      node.querySelector('[data-guide-personality="steady"]'),
    ).not.toBeNull();
  });
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
      expect(
        ai.querySelectorAll('.ai-guide-reader [data-guide-personality]'),
      ).toHaveLength(1);
      expect(
        ai.querySelectorAll('.ai-guide-directory [data-ai-entry]'),
      ).toHaveLength(21);
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
