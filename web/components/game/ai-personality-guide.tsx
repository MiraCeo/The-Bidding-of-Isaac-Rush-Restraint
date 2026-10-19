import { useEffect, useId, useState } from 'react';
import { Search, X, ArrowRight } from 'lucide-react';
import { aiDoctrineWeights, type AiDoctrine } from '@/lib/game/ai-decision';
import {
  aiPersonalityNames,
  aiPersonalityOrder,
  implementedAiPersonalityOrder,
} from '@/lib/game/ai-personality';
import {
  aiDoctrinePresentation,
  aiPersonalityPresentation,
  aiPersonalityComparisons,
} from '@/lib/ui/ai-personality-presentation';
import type { AiGuideTarget } from '@/lib/ui/ai-guide-target';

const actions = [
  ['high_bid', '高价竞争'],
  ['cooperate', '合作'],
  ['disrupt_high', '最高价扰乱'],
  ['disrupt_cooperate', '合作区扰乱'],
  ['withdraw', '静观'],
] as const;
const doctrines = Object.keys(aiDoctrinePresentation) as AiDoctrine[];
const compatibility = implementedAiPersonalityOrder.filter(
  (id) => !aiPersonalityOrder.includes(id),
);
const keyOf = (target: AiGuideTarget) => `${target.kind}:${target.id}`;
const nameOf = (target: AiGuideTarget) =>
  target.kind === 'personality'
    ? aiPersonalityNames[target.id]
    : aiDoctrinePresentation[target.id].name;
const textOf = (target: AiGuideTarget) =>
  target.kind === 'personality'
    ? `${target.id} ${aiPersonalityNames[target.id]} ${aiPersonalityPresentation[target.id].summary} ${aiPersonalityPresentation[target.id].detail}`
    : `${target.id} ${aiDoctrinePresentation[target.id].name} ${aiDoctrinePresentation[target.id].summary}`;

export function AiPersonalityGuide({
  target,
  onTargetApplied,
}: { target?: AiGuideTarget; onTargetApplied?: () => void } = {}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<AiGuideTarget['kind']>(
    target?.kind ?? 'personality',
  );
  const [selected, setSelected] = useState<AiGuideTarget>(
    target ?? { kind: 'personality', id: aiPersonalityOrder[0]! },
  );
  const [compatOpen, setCompatOpen] = useState(
    target?.kind === 'personality' && compatibility.includes(target.id),
  );
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setQuery('');
      setKind(target.kind);
      setSelected(target);
      setCompatOpen(
        target.kind === 'personality' && compatibility.includes(target.id),
      );
      onTargetApplied?.();
    });
    return () => {
      cancelled = true;
    };
  }, [target, onTargetApplied]);
  const normalized = query.trim().toLowerCase();
  const matches = (entry: AiGuideTarget) =>
    textOf(entry).toLowerCase().includes(normalized);
  const primary: AiGuideTarget[] =
    kind === 'personality'
      ? aiPersonalityOrder.map((id) => ({ kind: 'personality', id }))
      : doctrines.map((id) => ({ kind: 'doctrine', id }));
  const legacy: AiGuideTarget[] =
    kind === 'personality'
      ? compatibility.map((id) => ({ kind: 'personality', id }))
      : [];
  const filtered = primary.filter(matches),
    legacyMatches = legacy.filter(matches);
  const legacyVisible = kind === 'personality' && (compatOpen || !!normalized);
  const visible = [...filtered, ...(legacyVisible ? legacyMatches : [])];
  const current =
    visible.find((entry) => keyOf(entry) === keyOf(selected)) ?? visible[0];
  const choose = (entry: AiGuideTarget) => {
    setSelected(entry);
    setKind(entry.kind);
  };
  const switchKind = (next: AiGuideTarget['kind']) => {
    setKind(next);
    setQuery('');
    setSelected(
      next === 'personality'
        ? { kind: next, id: aiPersonalityOrder[0]! }
        : { kind: next, id: doctrines[0]! },
    );
  };
  const related =
    current?.kind === 'personality'
      ? aiPersonalityComparisons.find((pair) => pair.ids.includes(current.id))
      : undefined;
  const directoryButton = (entry: AiGuideTarget) => (
    <button
      type="button"
      key={keyOf(entry)}
      data-ai-entry={keyOf(entry)}
      aria-current={
        current && keyOf(current) === keyOf(entry) ? 'true' : undefined
      }
      onClick={() => choose(entry)}
    >
      {nameOf(entry)}
    </button>
  );
  return (
    <article className="ai-personality-guide" aria-label="AI性格与流派说明">
      <div className="ai-guide-intro">
        <p>流派决定基础倾向，人格修正行为。</p>
        <details className="ai-guide-help">
          <summary>如何理解AI</summary>
          <p>
            流派决定行动底盘，人格在其上修正偏好；难度还会影响判断与执行。同一种人格不是固定剧本，也不会改变计分规则。
          </p>
          <p>
            AI只参考公开局势、自己的构筑及已结算历史，不读取你的本房秘密报价。多个兼容人格可以共同作用，最终仍有随机选择、资金和模式约束。
          </p>
        </details>
      </div>
      <div className="ai-guide-toolbar">
        <div className="ai-guide-search-wrap">
          <label className="ai-guide-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">搜索AI词条</span>
            <input
              type="search"
              value={query}
              placeholder="搜索名称或作用，例如：贪婪、合作、资金"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {query && (
            <button
              type="button"
              className="ai-guide-clear"
              aria-label="清除AI搜索"
              onClick={() => setQuery('')}
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        <nav className="ai-guide-kinds" aria-label="AI词条类型">
          <button
            type="button"
            aria-pressed={kind === 'personality'}
            onClick={() => switchKind('personality')}
          >
            人格
          </button>
          <button
            type="button"
            aria-pressed={kind === 'doctrine'}
            onClick={() => switchKind('doctrine')}
          >
            流派
          </button>
        </nav>
      </div>
      <div className="ai-guide-workspace">
        <nav className="ai-guide-directory" aria-label="AI词条目录">
          <header>
            <strong>{kind === 'personality' ? '人格词条' : '流派词条'}</strong>
            <output aria-live="polite">
              {filtered.length} / {primary.length}
            </output>
          </header>
          <div className="ai-guide-entry-grid">
            {filtered.map(directoryButton)}
          </div>
          {kind === 'personality' && (
            <details
              className="ai-guide-compatibility"
              open={legacyVisible}
              onToggle={(event) => {
                if (!normalized) setCompatOpen(event.currentTarget.open);
              }}
            >
              <summary>兼容词条 · {legacyMatches.length}</summary>
              <div className="ai-guide-entry-grid">
                {legacyMatches.map(directoryButton)}
              </div>
            </details>
          )}
        </nav>
        <div className="ai-guide-mobile-picker">
          <label>
            <span>当前词条</span>
            <select
              aria-label="选择AI词条"
              value={current ? keyOf(current) : ''}
              disabled={!visible.length}
              onChange={(event) => {
                const entry = visible.find(
                  (e) => keyOf(e) === event.target.value,
                );
                if (entry) choose(entry);
              }}
            >
              {!visible.length && <option value="">没有匹配词条</option>}
              <optgroup label={kind === 'personality' ? '当前人格' : '流派'}>
                {filtered.map((entry) => (
                  <option key={keyOf(entry)} value={keyOf(entry)}>
                    {nameOf(entry)}
                  </option>
                ))}
              </optgroup>
              {legacyVisible && legacyMatches.length > 0 && (
                <optgroup label="兼容词条 · 当前不生成">
                  {legacyMatches.map((entry) => (
                    <option key={keyOf(entry)} value={keyOf(entry)}>
                      {nameOf(entry)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          {kind === 'personality' && (
            <button
              type="button"
              className="ai-guide-compat-toggle"
              aria-expanded={legacyVisible}
              onClick={() => setCompatOpen((value) => !value)}
            >
              兼容词条 · {compatibility.length}
            </button>
          )}
        </div>
        <section className="ai-guide-reader" aria-label="AI词条详情">
          {!current ? (
            <div className="ai-guide-empty" aria-live="polite">
              <h3>没有匹配的词条</h3>
              <p>试试当前类型的名称或作用关键词，也可切换人格／流派。</p>
              <button type="button" onClick={() => setQuery('')}>
                清除搜索
              </button>
            </div>
          ) : (
            <article
              key={keyOf(current)}
              data-guide-personality={
                current.kind === 'personality' ? current.id : undefined
              }
              data-guide-doctrine={
                current.kind === 'doctrine' ? current.id : undefined
              }
              data-compatibility-only={
                current.kind === 'personality'
                  ? !aiPersonalityOrder.includes(current.id)
                  : undefined
              }
            >
              <header className="ai-guide-detail-heading">
                <span>
                  {current.kind === 'personality'
                    ? '人格 · 行为修正'
                    : '流派 · 行动底盘'}
                </span>
                <h3 id={id + '-detail'}>{nameOf(current)}</h3>
                {current.kind === 'personality' &&
                  !aiPersonalityOrder.includes(current.id) && (
                    <small>兼容词条 · 当前新局不生成</small>
                  )}
              </header>
              <p className="ai-guide-summary">
                {current.kind === 'personality'
                  ? aiPersonalityPresentation[current.id].summary
                  : aiDoctrinePresentation[current.id].summary}
              </p>
              {current.kind === 'personality' ? (
                <>
                  <section className="ai-guide-effect">
                    <h4>具体影响</h4>
                    <p>{aiPersonalityPresentation[current.id].detail}</p>
                  </section>
                  {related && (
                    <section className="ai-guide-compare">
                      <h4>对照阅读</h4>
                      <p>{related.text}</p>
                      {related.ids
                        .filter((other) => other !== current.id)
                        .map((other) => (
                          <button
                            type="button"
                            key={other}
                            onClick={() => {
                              setQuery('');
                              choose({ kind: 'personality', id: other });
                            }}
                          >
                            查看{aiPersonalityNames[other]}
                            <ArrowRight size={14} aria-hidden="true" />
                          </button>
                        ))}
                    </section>
                  )}
                </>
              ) : (
                <details className="ai-guide-weights">
                  <summary>查看基础权重</summary>
                  <p>
                    这是基础权重，不是修正后的最终概率；人格、资金、奖励、局势与难度会继续影响选择，基础为0的策略不会因人格被开启。
                  </p>
                  <dl>
                    {actions.map(([strategy, label]) => (
                      <div key={strategy}>
                        <dt>{label}</dt>
                        <dd>
                          {
                            aiDoctrineWeights[current.id as AiDoctrine][
                              strategy
                            ]
                          }
                        </dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
            </article>
          )}
        </section>
      </div>
    </article>
  );
}
