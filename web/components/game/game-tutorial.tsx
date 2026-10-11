import { ItemIcon } from './item-icon';
import { useReducer } from 'react';
import { Button } from '@/components/ui/button';
import { getItemDefinition, defaultRules } from '@/lib/game';
import {
  createTutorialScene,
  createTutorialState,
  tutorialReducer,
  tutorialLessons,
  tutorialHumanId,
  tutorialPreviews,
  tutorialErrors,
  tutorialHumanAfter,
  tutorialPlayerName,
  type TutorialState,
} from '@/lib/ui/tutorial';
import { ItemBadges } from './item-badges';

const phaseNames = {
  quote: '选择与报价',
  market: '共同市场',
  rewards: '奖励资格',
  score: '积分与资金',
  floor: '换层演示',
  complete: '本次练习完成',
} as const;
const value = (n: number | null | undefined) =>
  n == null ? '—' : Number(n.toFixed(4));

export function GameTutorial({ scoreDecimals = 2 }: { scoreDecimals?: 2 | 4 }) {
  const [state, dispatch] = useReducer(tutorialReducer, undefined, () =>
    createTutorialState(),
  );
  const scene = createTutorialScene(state.lessonIndex);
  const lesson = tutorialLessons[state.lessonIndex]!;
  const result = state.result;
  const after = tutorialHumanAfter(state);
  const summary = result?.roomScoreSummaries[tutorialHumanId];
  const breakdown = result?.scoreBreakdowns[tutorialHumanId];
  const groups = lesson.id === 'double' ? (['A', 'B'] as const) : [state.group];
  const maximum =
    lesson.kind === 'disrupt'
      ? Math.floor(scene.human.money * defaultRules.disruptionMaxMoneyRatio)
      : scene.human.money;
  const doubleCap = Math.floor(scene.human.money * 0.5);
  const cooperationRadius =
    defaultRules.floorStartingMoney[0]! * defaultRules.cooperationZoneRatio;
  const errors = tutorialErrors(state);
  const stageIndex = ['quote', 'market', 'rewards', 'score', 'floor'].indexOf(
    state.phase,
  );
  const nextLabel =
    state.phase === 'market'
      ? '下一步：看奖励'
      : state.phase === 'rewards'
        ? '下一步：看积分'
        : state.phase === 'score' && lesson.id === 'withdraw'
          ? '演示换层'
          : state.phase === 'floor'
            ? '完成本次练习'
            : '下一课';
  return (
    <div className="tutorial-content">
      <p className="utility-notice">
        独立教学练习：1名教学玩家＋19名预设玩家。每课从独立固定样本开始，收益不带入下一课。使用正式结算规则和固定教学随机流，不读取、不覆盖你的角色、报价、存档或回放；预设报价不代表正式AI的行为。
      </p>
      <nav className="tutorial-lessons" aria-label="教学课程">
        {tutorialLessons.map((entry, index) => (
          <button
            key={entry.id}
            type="button"
            aria-current={state.lessonIndex === index ? 'step' : undefined}
            onClick={() => dispatch({ type: 'lesson', index })}
          >
            <span>
              {index + 1}. {entry.title}
            </span>
            <small>
              {state.completed.includes(index) ? '已练习' : '可随时进入'}
            </small>
          </button>
        ))}
      </nav>
      {state.phase === 'complete' ? (
        <section className="tutorial-complete">
          <h3>本次练习完成</h3>
          <p>
            本次已练习 {state.completed.length} / {tutorialLessons.length}{' '}
            课。正式对局仍保持原来的状态，返回游戏后自行选择角色或继续当前房间。
          </p>
          <ul>
            <li>竞拍同时争夺高价和合作资格；合作不是另一种行动按钮。</li>
            <li>名义报价、扣款、市场等价和计分等价各有用途。</li>
            <li>扰乱可以计分和占位，但没有赎回效果时不领取道具。</li>
            <li>双行动受资格、预算和计分修正限制，不等于两件奖励。</li>
            <li>观望保留资金；换层重置资金，保留积分与道具。</li>
          </ul>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              dispatch({
                type: 'lesson',
                index:
                  state.completed.length === tutorialLessons.length
                    ? 0
                    : tutorialLessons.findIndex(
                        (_, i) => !state.completed.includes(i),
                      ),
              })
            }
          >
            {state.completed.length === tutorialLessons.length
              ? '从第一课重做'
              : '继续未练习课程'}
          </Button>
        </section>
      ) : (
        <>
          <div className="tutorial-lesson-heading">
            <div>
              <p className="eyebrow">
                LESSON {state.lessonIndex + 1} / {tutorialLessons.length}
              </p>
              <h3>{lesson.title}</h3>
              <p>{lesson.task}</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => dispatch({ type: 'reset' })}
            >
              重做本课
            </Button>
          </div>
          <ol className="tutorial-stages" aria-label="本课步骤">
            {[
              'quote',
              'market',
              'rewards',
              'score',
              ...(lesson.id === 'withdraw' ? ['floor'] : []),
            ].map((phase, index) => (
              <li
                key={phase}
                className={
                  index === stageIndex
                    ? 'tutorial-stage-current'
                    : index < stageIndex
                      ? 'tutorial-stage-done'
                      : ''
                }
              >
                <span>{index + 1}</span>
                {phaseNames[phase as keyof typeof phaseNames]}
              </li>
            ))}
          </ol>
          {state.phase === 'quote' && (
            <section
              className="tutorial-panel tutorial-quote"
              aria-labelledby="tutorial-quote-title"
            >
              <h4 id="tutorial-quote-title">先决定这一房间如何行动</h4>
              <p>
                教学资金 <strong>{scene.human.money}</strong>，已有积分{' '}
                {scene.human.score.toFixed(scoreDecimals)}。
                {lesson.id === 'double'
                  ? `固定使用双竞拍；合计上限${doubleCap}。`
                  : lesson.kind === 'disrupt'
                    ? `本笔扰乱上限 ${maximum}。`
                    : lesson.kind === 'withdraw'
                      ? '本课演示观望，扣款为0。'
                      : '报价是正整数，不能超过当前资金。'}
              </p>
              {scene.human.items.length > 0 && (
                <div className="tutorial-owned-items">
                  <span>本例持有</span>
                  {scene.human.items.map((item) => (
                    <span
                      className="item-badge item-badge-steel"
                      key={item.instanceId}
                    >
                      {getItemDefinition(item.itemId).name}
                    </span>
                  ))}
                </div>
              )}
              <div className="tutorial-reward-pair">
                {scene.room.rewards.map((reward) => (
                  <article key={reward.group}>
                    <div className="build-item-heading">
                      <ItemIcon itemId={reward.itemId} size="medium" />
                      <h4>
                        {reward.group} · {getItemDefinition(reward.itemId).name}
                      </h4>
                    </div>
                    <ItemBadges
                      item={getItemDefinition(reward.itemId)}
                      compact
                    />
                    {lesson.kind !== 'withdraw' && lesson.id !== 'double' && (
                      <Button
                        type="button"
                        variant={
                          state.group === reward.group ? 'default' : 'secondary'
                        }
                        aria-pressed={state.group === reward.group}
                        onClick={() =>
                          dispatch({ type: 'group', group: reward.group })
                        }
                      >
                        选择奖励 {reward.group}
                      </Button>
                    )}
                  </article>
                ))}
              </div>
              {lesson.kind !== 'withdraw' && (
                <div className="tutorial-inputs">
                  {groups.map((group) => (
                    <div key={group}>
                      <label htmlFor={`tutorial-amount-${group}`}>
                        {group} · {lesson.kind === 'disrupt' ? '扰乱' : '竞拍'}
                        名义报价
                      </label>
                      <div>
                        <input
                          type="range"
                          min={1}
                          max={maximum}
                          value={state.amounts[group]}
                          aria-label={`教学 ${group} 报价滑条`}
                          onChange={(e) =>
                            dispatch({
                              type: 'amount',
                              group,
                              amount: Number(e.target.value),
                            })
                          }
                        />
                        <input
                          id={`tutorial-amount-${group}`}
                          type="number"
                          min={1}
                          max={maximum}
                          value={state.amounts[group]}
                          aria-label={`教学 ${group} 名义报价`}
                          onChange={(e) =>
                            dispatch({
                              type: 'amount',
                              group,
                              amount: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                      <small>
                        1 – {maximum}
                        {lesson.id === 'double'
                          ? `；两笔合计 ${state.amounts.A + state.amounts.B} / ${doubleCap}`
                          : ''}
                      </small>
                    </div>
                  ))}
                </div>
              )}
              <TutorialAmounts state={state} />
              <p className="tutorial-secret-note">
                提交前不显示预设玩家的本房报价、基准线、资格和最终积分。
              </p>
              {errors.length > 0 && (
                <p className="action-error" role="alert">
                  {errors[0]}
                </p>
              )}
              <Button
                type="button"
                size="lg"
                disabled={errors.length > 0}
                onClick={() => dispatch({ type: 'submit' })}
              >
                {lesson.kind === 'withdraw' ? '提交教学观望' : '提交教学行动'}
              </Button>
            </section>
          )}
          {state.phase === 'market' && result && (
            <section
              className="tutorial-panel"
              aria-labelledby="tutorial-market-title"
            >
              <h4 id="tutorial-market-title">提交后，才知道共同市场</h4>
              <TutorialAmounts state={state} />
              <div className="tutorial-market-metrics">
                <article>
                  <span>有效行动样本</span>
                  <strong>{result.baseline?.participantCount ?? 0}</strong>
                  <small>
                    {lesson.id === 'double'
                      ? '19份预设行动＋你的2份报价＝21份样本。'
                      : lesson.kind === 'withdraw'
                        ? '你的观望不进入市场样本。'
                        : 'A、B两组共同参与计算。'}
                  </small>
                </article>
                <article>
                  <span>市场等价总和</span>
                  <strong>
                    {value(result.baseline?.totalMarketEquivalent)}
                  </strong>
                </article>
                <article>
                  <span>市场均值 M</span>
                  <strong>{value(result.baseline?.meanMarketBid)}</strong>
                </article>
                <article>
                  <span>共同基准线 T</span>
                  <strong>{value(result.baseline?.target)}</strong>
                </article>
              </div>
              <figure className="rule-formula">
                <code>
                  T = {defaultRules.baselineMeanMultiplier.toFixed(4)} × M +{' '}
                  {defaultRules.floorStartingMoney[0]! *
                    defaultRules.targetConstantRatio}
                </code>
                <figcaption>
                  正式公式为2/3 × M + 10% ×
                  基础层资金。基准线按四位小数保存，不使用显示后的近似数重新计分。
                </figcaption>
              </figure>
              <p>
                合作区：
                <strong>
                  {value(
                    Math.max(0, result.baseline!.target - cooperationRadius),
                  )}{' '}
                  – {value(result.baseline!.target + cooperationRadius)}
                </strong>
                。
                {lesson.kind === 'bid'
                  ? '选择正常竞拍后，既可争高价，也可争合作资格；不是两个独立行动。'
                  : lesson.kind === 'disrupt'
                    ? '扰乱市场等价为报价的2.5倍，但原始计分等价只有1.25倍。'
                    : '观望没有市场或计分等价，保存资金但不从本房得分。'}
              </p>
              <details className="tutorial-market-table">
                <summary>查看已公开的全部实际行动</summary>
                <div className="replay-table-wrap">
                  <table className="result-table">
                    <caption className="sr-only">
                      固定教学样本的公开报价
                    </caption>
                    <thead>
                      <tr>
                        {[
                          '玩家',
                          '行动',
                          '名义',
                          '扣款',
                          '市场等价',
                          '计分等价',
                        ].map((text) => (
                          <th key={text} scope="col">
                            {text}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.resolvedActions.map((entry) => (
                        <tr key={`${entry.playerId}-${entry.actionIndex}`}>
                          <th scope="row">
                            {tutorialPlayerName(entry.playerId)}
                          </th>
                          <td>
                            {entry.action.type === 'withdraw'
                              ? '观望'
                              : `${entry.action.group} · ${entry.action.type === 'bid' ? '竞拍' : '扰乱'}`}
                          </td>
                          <td>
                            {entry.action.type === 'withdraw'
                              ? '—'
                              : entry.action.amount}
                          </td>
                          <td>{entry.actualCost}</td>
                          <td>{value(entry.marketEquivalent)}</td>
                          <td>{value(entry.scoringEquivalent)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
          )}
          {state.phase === 'rewards' && result && (
            <section
              className="tutorial-panel"
              aria-labelledby="tutorial-rewards-title"
            >
              <h4 id="tutorial-rewards-title">资格不等于最终发放</h4>
              <p>
                高价按市场等价排前20%，合作资格按区内距离取最近一半；两种资格重合不多领，不把重复名额顺延给别人。
              </p>
              <div className="tutorial-reward-pair">
                {scene.room.rewards.map((reward) => {
                  const occupants = (list: typeof result.highPricePlacements) =>
                    list
                      .filter((p) => p.group === reward.group)
                      .map(
                        (p) =>
                          `${tutorialPlayerName(p.playerId)}${p.actionType === 'disrupt' ? '（扰乱占位）' : ''}`,
                      )
                      .join('、') || '无';
                  const ownSources = result.entitlements.find(
                    (e) =>
                      e.playerId === tutorialHumanId &&
                      e.group === reward.group,
                  )?.sources;
                  const copies = result.awards
                    .filter(
                      (a) =>
                        a.playerId === tutorialHumanId &&
                        a.group === reward.group,
                    )
                    .reduce((n, a) => n + a.copies, 0);
                  return (
                    <article key={reward.group}>
                      <h4>
                        {reward.group} · {getItemDefinition(reward.itemId).name}
                      </h4>
                      <dl>
                        <div>
                          <dt>高价占位</dt>
                          <dd>{occupants(result.highPricePlacements)}</dd>
                        </div>
                        <div>
                          <dt>合作占位</dt>
                          <dd>{occupants(result.cooperationPlacements)}</dd>
                        </div>
                        <div>
                          <dt>你的最终资格</dt>
                          <dd>
                            {ownSources
                              ?.map((s) =>
                                s === 'highest'
                                  ? '高价'
                                  : s === 'cooperation'
                                    ? '合作'
                                    : s,
                              )
                              .join(' / ') || '无'}
                          </dd>
                        </div>
                        <div>
                          <dt>你实际获得</dt>
                          <dd>{copies} 份</dd>
                        </div>
                      </dl>
                    </article>
                  );
                })}
              </div>
              {lesson.kind === 'disrupt' && (
                <p className="tutorial-callout">
                  本例没有超凡升天：扰乱即使占据高价或合作名额，也不领取道具；仍可按自己的计分等价得分。
                </p>
              )}
              {lesson.id === 'double' && (
                <p className="tutorial-callout">
                  更多选择会在同时获得A、B资格时毁掉其中一组。两份行动、两份资格并不保证两件奖励。
                </p>
              )}
              {result.events.some(
                (e) => e.playerId === tutorialHumanId && e.type === 'destroy',
              ) && (
                <ul>
                  {result.events
                    .filter(
                      (e) =>
                        e.playerId === tutorialHumanId && e.type === 'destroy',
                    )
                    .map((e, i) => (
                      <li key={i}>{e.message}</li>
                    ))}
                </ul>
              )}
            </section>
          )}
          {state.phase === 'score' && summary && after && (
            <section
              className="tutorial-panel"
              aria-labelledby="tutorial-score-title"
            >
              <h4 id="tutorial-score-title">最后看得分与剩余资金</h4>
              <div className="tutorial-market-metrics">
                <article>
                  <span>实际总扣款</span>
                  <strong>
                    {result!.resolvedActions
                      .filter((a) => a.playerId === tutorialHumanId)
                      .reduce((n, a) => n + a.actualCost, 0)}
                  </strong>
                  <small>
                    {scene.human.money} → {after.money}
                  </small>
                </article>
                <article>
                  <span>原始房间分</span>
                  <strong>{summary.initialScore.toFixed(scoreDecimals)}</strong>
                </article>
                <article>
                  <span>追溯追加</span>
                  <strong>
                    {summary.retroactiveScore.toFixed(scoreDecimals)}
                  </strong>
                </article>
                <article>
                  <span>最终房间分</span>
                  <strong>{summary.finalScore.toFixed(scoreDecimals)}</strong>
                  <small>当前累计 {after.score.toFixed(scoreDecimals)}</small>
                </article>
              </div>
              <p>
                积分看计分等价与基准线的距离，不直接用名义报价或扣款当分数。单行动基础曲线最高
                {defaultRules.maximumBaseScore}，再应用加算、道具和房间倍率。
              </p>
              {breakdown?.actions.map((action) => (
                <p key={action.actionIndex}>
                  行动 {action.actionIndex + 1}：计分取值{' '}
                  {value(action.scoringValue)}，基础分{' '}
                  {action.baseScore.toFixed(scoreDecimals)}，加算{' '}
                  {action.additiveScore.toFixed(scoreDecimals)}。
                </p>
              ))}
              {lesson.id === 'double' && (
                <p className="tutorial-callout">
                  本例角色是雅阁和以扫，双行动积分修正为×1；其他角色双行动通常×0.75。市场样本仍是两份。
                </p>
              )}
              {lesson.kind === 'withdraw' && (
                <p className="tutorial-callout">
                  本房得分为0，但原有积分{' '}
                  {scene.human.score.toFixed(scoreDecimals)}
                  、道具和剩余资金保留。下一步只演示换层，不开始正式游戏。
                </p>
              )}
            </section>
          )}
          {state.phase === 'floor' && after && state.nextFloor && (
            <section
              className="tutorial-panel"
              aria-labelledby="tutorial-floor-title"
            >
              <h4 id="tutorial-floor-title">换层：资金重置，构筑留下</h4>
              {(() => {
                const next = state.nextFloor!.players.find(
                  (p) => p.id === tutorialHumanId,
                )!;
                return (
                  <div className="tutorial-market-metrics">
                    <article>
                      <span>第二层资金</span>
                      <strong>
                        {after.money} → {next.money}
                      </strong>
                      <small>
                        本例无角色加钱被动／利息，基础资金重置为
                        {defaultRules.floorStartingMoney[1]}。
                      </small>
                    </article>
                    <article>
                      <span>累计积分</span>
                      <strong>{next.score.toFixed(scoreDecimals)}</strong>
                      <small>原积分保留</small>
                    </article>
                    <article>
                      <span>临时屏障</span>
                      <strong>
                        {after.temporaryShields} → {next.temporaryShields}
                      </strong>
                      <small>按持有神圣屏障份数重置</small>
                    </article>
                    <article>
                      <span>持久屏障</span>
                      <strong>
                        {after.persistentShields} → {next.persistentShields}
                      </strong>
                      <small>消耗后不因换层重新补回</small>
                    </article>
                  </div>
                );
              })()}
              <p>
                本例两件道具继续保留。正式对局三层基础资金为
                {defaultRules.floorStartingMoney.join('／')}
                ，角色被动和经济道具会在原流程中继续生效。
              </p>
            </section>
          )}
          {state.phase !== 'quote' && (
            <div className="tutorial-step-actions">
              <Button
                type="button"
                variant="secondary"
                disabled={state.phase === 'market'}
                onClick={() => dispatch({ type: 'back' })}
              >
                上一步
              </Button>
              <span>{phaseNames[state.phase]}</span>
              <Button
                type="button"
                size="lg"
                onClick={() => dispatch({ type: 'next' })}
              >
                {nextLabel}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
function TutorialAmounts({ state }: { state: TutorialState }) {
  return (
    <div className="quote-preview">
      <div className="quote-preview-heading">
        <strong>你的行动 · 四种数值</strong>
        <small>不是最终积分预测</small>
      </div>
      {tutorialPreviews(state).map((preview, i) => (
        <div className="quote-preview-row" key={i}>
          <strong>
            {preview.action.type === 'withdraw' ? '观望' : preview.action.group}
          </strong>
          <dl>
            {[
              [
                '名义报价',
                preview.action.type === 'withdraw'
                  ? null
                  : preview.action.amount,
              ],
              ['实际扣款', preview.actualCost],
              ['市场等价', preview.marketEquivalent],
              ['计分等价', preview.scoringEquivalent],
            ].map(([label, number]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value(number as number | null)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
