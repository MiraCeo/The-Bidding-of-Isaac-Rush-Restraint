import { ItemIcon } from './item-icon';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ItemBadges } from './item-badges';
import { Button } from '@/components/ui/button';

import { itemCatalog } from '@/lib/game/item-catalog';
import { itemPresentations } from '@/lib/game/item-presentation';
import {
  createGameRuleSections,
  type GameRuleSection,
} from '@/lib/ui/game-rules';
import { getItemBadges } from '@/lib/ui/item-badges';
import { itemVisualAlias } from '@/lib/ui/item-art';

const sections = createGameRuleSections();

function RuleParagraph({ text }: { text: string }) {
  const colon = text.indexOf('：');
  return (
    <p>
      {colon > 0 && colon < 16 ? (
        <>
          <strong>{text.slice(0, colon + 1)}</strong>
          {text.slice(colon + 1)}
        </>
      ) : (
        text
      )}
    </p>
  );
}

function RuleChapter({
  section,
  index,
}: {
  section: GameRuleSection;
  index: number;
}) {
  return (
    <section
      id={`rule-${section.id}`}
      className="rule-chapter"
      data-rule-target
      aria-labelledby={`rule-${section.id}-title`}
    >
      <header className="rule-chapter-heading">
        <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
        <h3 id={`rule-${section.id}-title`}>{section.title}</h3>
      </header>
      {section.formula && (
        <figure className="rule-formula">
          <code>{section.formula.expression}</code>
          <figcaption>{section.formula.caption}</figcaption>
        </figure>
      )}
      {section.comparison && (
        <div className="rule-comparison-wrap">
          <table className="rule-comparison">
            <caption>{section.comparison.caption}</caption>
            <thead>
              <tr>
                <th scope="col">数值</th>
                <th scope="col">用在哪里</th>
              </tr>
            </thead>
            <tbody>
              {section.comparison.rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>{row.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {section.id === 'actions' ? (
        <dl className="rule-actions">
          {section.paragraphs.map((paragraph) => {
            const colon = paragraph.indexOf('：');
            return (
              <div key={paragraph}>
                <dt>{paragraph.slice(0, colon)}</dt>
                <dd>{paragraph.slice(colon + 1)}</dd>
              </div>
            );
          })}
        </dl>
      ) : (
        section.paragraphs
          .filter(
            (_, paragraphIndex) => !section.comparison || paragraphIndex > 0,
          )
          .map((paragraph) => (
            <RuleParagraph key={paragraph} text={paragraph} />
          ))
      )}
    </section>
  );
}

export function GameRules({
  onOpenTutorial,
  gameplay,
  catalog = itemCatalog,
}: {
  onOpenTutorial?: () => void;
  gameplay?: ReactNode;
  catalog?: readonly (typeof itemCatalog)[number][];
} = {}) {
  const [query, setQuery] = useState('');
  const [activeChapter, setActiveChapter] = useState('rules-quick-start');
  const [tab, setTab] = useState<'rules' | 'items'>('rules');
  const panelId = useId();
  const manualRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (
      gameplay ||
      tab !== 'rules' ||
      typeof IntersectionObserver === 'undefined'
    )
      return;
    const targets = [
      ...(manualRef.current?.querySelectorAll<HTMLElement>(
        '[data-rule-target]',
      ) ?? []),
    ];
    let observer: IntersectionObserver | undefined;
    const watch = () => {
      observer?.disconnect();
      observer = new IntersectionObserver(
        () => {
          // Follow the reading edge, not only the changed entries (which can be stale after a jump).
          const atEnd =
            document.documentElement.scrollHeight > window.innerHeight &&
            window.scrollY + window.innerHeight >=
              document.documentElement.scrollHeight - 2;
          const current = atEnd
            ? targets.at(-1)
            : (targets
                .filter((target) => target.getBoundingClientRect().top <= 25)
                .at(-1) ?? targets[0]);
          if (current) setActiveChapter(current.id);
        },
        {
          rootMargin: `-24px 0px -${Math.max(0, window.innerHeight - 25)}px 0px`,
          threshold: 0,
        },
      );
      targets.forEach((target) => observer!.observe(target));
    };
    watch();
    window.addEventListener('resize', watch);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', watch);
    };
  }, [tab, gameplay]);
  const normalizedQuery = query.trim().toLowerCase();
  const items = catalog.filter((item) =>
    `${item.name} ${itemVisualAlias(item.id)} ${itemPresentations[item.id].description} ${getItemBadges(
      item,
    )
      .map((badge) => badge.label)
      .join(' ')}`
      .toLowerCase()
      .includes(normalizedQuery),
  );

  return (
    <div className="game-rules-content rules-manual" ref={manualRef}>
      <nav className="progress-tabs rules-tabs" aria-label="规则分类">
        {(
          [
            ['rules', '玩法规则'],
            ['items', '道具图鉴'],
          ] as const
        ).map(([key, label]) => (
          <button
            type="button"
            key={key}
            aria-current={tab === key ? 'page' : undefined}
            aria-controls={panelId + '-' + key}
            className={tab === key ? 'progress-tab-active' : ''}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div
        className={
          gameplay ? 'rules-tab-panel rules-custom-gameplay' : 'rules-tab-panel'
        }
        id={panelId + '-rules'}
        hidden={tab !== 'rules'}
        inert={tab !== 'rules'}
        aria-label="玩法规则"
      >
        {gameplay ?? (
          <>
            <section
              id="rules-quick-start"
              className="rules-overview"
              data-rule-target
              aria-labelledby="rules-quick-start-title"
            >
              <div className="rules-overview-heading">
                <div className="rules-overview-copy">
                  <h3 id="rules-quick-start-title">快速上手</h3>
                  <p className="rules-overview-description">
                    目标是在整局结束时取得更高的最终积分。先选角色，再逐房报价、获取道具并完成构筑。
                  </p>
                </div>
                {onOpenTutorial && (
                  <Button type="button" onClick={onOpenTutorial}>
                    进入交互式教程
                  </Button>
                )}
              </div>
              <ol className="rules-start-steps">
                <li>
                  <span aria-hidden="true">1</span>
                  <div>
                    <strong>选择角色</strong>
                    <p>在“游戏”首页选好角色，明确点击开始后才创建对局。</p>
                  </div>
                </li>
                <li>
                  <span aria-hidden="true">2</span>
                  <div>
                    <strong>选择行动</strong>
                    <p>选择 A／B 目标并输入整数报价，或选择静观其变。</p>
                  </div>
                </li>
                <li>
                  <span aria-hidden="true">3</span>
                  <div>
                    <strong>结算与推进</strong>
                    <p>
                      提交后查看得分、道具与榜单，继续下一房间直到最终排行。
                    </p>
                  </div>
                </li>
              </ol>
            </section>
            <div className="rules-document-layout">
              <aside className="rules-contents">
                <nav aria-label="规则目录">
                  <h3>阅读目录</h3>
                  <a
                    href="#rules-quick-start"
                    aria-current={
                      activeChapter === 'rules-quick-start'
                        ? 'location'
                        : undefined
                    }
                    onClick={() => setActiveChapter('rules-quick-start')}
                  >
                    快速上手
                  </a>
                  {sections.map((section, index) => (
                    <a
                      key={section.id}
                      href={`#rule-${section.id}`}
                      aria-current={
                        activeChapter === `rule-${section.id}`
                          ? 'location'
                          : undefined
                      }
                      onClick={() => setActiveChapter(`rule-${section.id}`)}
                    >
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      {section.title}
                    </a>
                  ))}
                </nav>
              </aside>
              <article
                className="rules-reading-column"
                aria-label="完整游戏规则"
              >
                {sections.map((section, index) => (
                  <RuleChapter
                    key={section.id}
                    section={section}
                    index={index}
                  />
                ))}
                <p className="rules-source-note">
                  公共参数与道具说明复用现行配置。阅读与查询不提交行动，也不改变本局状态。
                </p>
              </article>
            </div>
          </>
        )}
      </div>
      <section
        className="rules-tab-panel rule-item-directory"
        id={panelId + '-items'}
        hidden={tab !== 'items'}
        inert={tab !== 'items'}
        aria-label="道具图鉴"
      >
        <div className="rule-catalog-body">
          <div className="rule-directory-heading">
            <p>
              这里是通用道具说明，不揭示本房隐藏奖励。非叠加道具的重复份数仍计入库存。
            </p>
            <div className="rule-directory-tools">
              <label className="rule-search">
                <span>查找道具</span>
                <input
                  ref={searchRef}
                  type="search"
                  placeholder="名称或效果关键词"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <div className="rule-search-feedback">
                <output aria-live="polite">
                  显示 {items.length} / {catalog.length} 件道具
                </output>
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('');
                      searchRef.current?.focus();
                    }}
                  >
                    清除道具搜索
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="rule-item-grid">
            {items.map((item) => (
              <article key={item.id} className="rule-item-card">
                <div className="rule-item-heading">
                  <ItemIcon itemId={item.id} size="small" />
                  <h4>{item.name}</h4>
                </div>
                <p>{itemPresentations[item.id].description}</p>
                <ItemBadges item={item} />
              </article>
            ))}
            {items.length === 0 && (
              <output className="empty-result">
                没有匹配的道具，试试其他关键词。
              </output>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
