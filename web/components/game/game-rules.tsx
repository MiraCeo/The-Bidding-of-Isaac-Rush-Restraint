import { useRef, useState } from 'react';
import { ItemBadges } from './item-badges';

import { itemCatalog } from '@/lib/game/item-catalog';
import { itemPresentations } from '@/lib/game/item-presentation';
import {
  createGameRuleSections,
  type GameRuleSection,
} from '@/lib/ui/game-rules';
import { getItemBadges } from '@/lib/ui/item-badges';

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

export function GameRules() {
  const [query, setQuery] = useState('');
  const catalogRef = useRef<HTMLDetailsElement>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const items = itemCatalog.filter((item) =>
    `${item.name} ${itemPresentations[item.id].description} ${getItemBadges(
      item,
    )
      .map((badge) => badge.label)
      .join(' ')}`
      .toLowerCase()
      .includes(normalizedQuery),
  );

  return (
    <div className="game-rules-content rules-manual">
      <section
        id="rules-quick-start"
        className="rules-overview"
        aria-labelledby="rules-quick-start-title"
      >
        <div className="rules-overview-copy">
          <p className="rules-kicker">先知道怎样玩，再查具体规则</p>
          <h3 id="rules-quick-start-title">快速上手</h3>
          <p>
            目标是在整局结束时取得更高的最终积分。先选角色，再逐房报价、获取道具并完成构筑。
          </p>
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
              <p>提交后查看得分、道具与榜单，继续下一房间直到最终排行。</p>
            </div>
          </li>
        </ol>
      </section>
      <div className="rules-document-layout">
        <aside className="rules-contents">
          <nav aria-label="规则目录">
            <h3>阅读目录</h3>
            <a href="#rules-quick-start">快速上手</a>
            {sections.map((section, index) => (
              <a key={section.id} href={`#rule-${section.id}`}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                {section.title}
              </a>
            ))}
            <a
              href="#rule-items"
              onClick={() => {
                if (catalogRef.current) catalogRef.current.open = true;
              }}
            >
              <span>09</span>道具图鉴 <small>{itemCatalog.length}</small>
            </a>
          </nav>
          <p>先读行动和金额，再看市场、奖励与特殊效果。</p>
        </aside>
        <article className="rules-reading-column" aria-label="完整游戏规则">
          {sections.map((section, index) => (
            <RuleChapter key={section.id} section={section} index={index} />
          ))}
          <section
            id="rule-items"
            className="rule-item-directory"
            aria-label="道具图鉴"
          >
            <details ref={catalogRef} className="rule-catalog">
              <summary aria-label="道具图鉴，展开或收起查询">
                <span>
                  <strong>道具图鉴</strong>
                  <small>{itemCatalog.length} 件道具 · 点击展开查询</small>
                </span>
                <span className="rule-catalog-chevron" aria-hidden="true" />
              </summary>
              <div className="rule-catalog-body">
                <div className="rule-directory-heading">
                  <p>
                    这里是通用道具说明，不揭示本房隐藏奖励。非叠加道具的重复份数仍计入库存。
                  </p>
                  <label className="rule-search">
                    <span>查找道具</span>
                    <input
                      type="search"
                      placeholder="名称或效果关键词"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                </div>
                <div className="rule-item-grid">
                  {items.map((item) => (
                    <article key={item.id} className="rule-item-card">
                      <div className="rule-item-heading">
                        <span aria-hidden="true">
                          {itemPresentations[item.id].emoji}
                        </span>
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
            </details>
          </section>
          <p className="rules-source-note">
            公共参数与道具说明复用现行配置。阅读与查询不提交行动，也不改变本局状态。
          </p>
        </article>
      </div>
    </div>
  );
}
