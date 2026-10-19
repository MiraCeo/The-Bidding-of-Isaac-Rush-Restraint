import { useId } from 'react';
import { aiDoctrineWeights } from '@/lib/game/ai-decision';
import {
  aiPersonalityNames,
  aiPersonalityOrder,
  implementedAiPersonalityOrder,
} from '@/lib/game/ai-personality';
import {
  aiDoctrinePresentation,
  aiPersonalityPresentation,
} from '@/lib/ui/ai-personality-presentation';

const actions = [
  ['high_bid', '高价竞争'],
  ['cooperate', '合作'],
  ['disrupt_high', '最高价扰乱'],
  ['disrupt_cooperate', '合作区扰乱'],
  ['withdraw', '静观'],
] as const;

export function AiPersonalityGuide() {
  const id = useId();
  return (
    <article className="ai-personality-guide" aria-label="AI性格与流派说明">
      <header className="ai-guide-intro">
        <h3>看懂AI的选择倾向</h3>
        <p>
          流派决定行动底盘，人格在其上修正偏好；难度还会影响判断与执行。同一种人格不是固定剧本，也不会改变计分规则。
        </p>
        <p>
          AI只参考公开局势、自己的构筑及已结算历史，不读取你的本房秘密报价。多个兼容人格可以共同作用，最终仍有随机选择、资金和模式约束。
        </p>
      </header>
      <section aria-labelledby={id + '-doctrines'}>
        <h3 id={id + '-doctrines'}>流派 · 行动底盘</h3>
        <p className="ai-guide-caption">
          下列是基础权重，不是修正后的最终概率；人格、资金、奖励、局势与难度会继续影响选择，基础为0的策略不会因人格被开启。
        </p>
        <div className="ai-doctrine-grid">
          {(
            Object.keys(
              aiDoctrinePresentation,
            ) as (keyof typeof aiDoctrinePresentation)[]
          ).map((id) => (
            <article key={id} data-guide-doctrine={id}>
              <h4>
                <span className="final-doctrine-pill">
                  {aiDoctrinePresentation[id].name}
                </span>
              </h4>
              <p>{aiDoctrinePresentation[id].summary}</p>
              <dl>
                {actions.map(([strategy, label]) => (
                  <div key={strategy}>
                    <dt>{label}</dt>
                    <dd>{aiDoctrineWeights[id][strategy]}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
      </section>
      <section aria-labelledby={id + '-traits'}>
        <div className="ai-guide-section-heading">
          <h3 id={id + '-traits'}>人格 · 行为修正</h3>
          <span>
            {aiPersonalityOrder.length}项当前随机池词条 · 另有兼容说明
          </span>
        </div>
        <p className="ai-guide-caption">
          “稳定”和“稳健”、“守旧”和“固执”各有不同机制；胶囊名称相似，不代表作用相同。互斥人格不会在正常生成时一起出现。
        </p>
        <div className="ai-personality-grid">
          {implementedAiPersonalityOrder.map((id) => (
            <article
              key={id}
              data-guide-personality={id}
              data-compatibility-only={!aiPersonalityOrder.includes(id)}
            >
              <h4>
                <span className="final-personality-pill">
                  {aiPersonalityNames[id]}
                </span>
                {!aiPersonalityOrder.includes(id) && (
                  <small>兼容词条 · 当前不生成</small>
                )}
              </h4>
              <strong>{aiPersonalityPresentation[id].summary}</strong>
              <p>{aiPersonalityPresentation[id].detail}</p>
            </article>
          ))}
        </div>
      </section>
    </article>
  );
}
