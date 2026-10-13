import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  survivalTutorialLessons,
  survivalTutorialScore,
  survivalTutorialElimination,
  survivalTutorialRanking,
  type TutorialEliminationCase,
} from '@/lib/ui/survival-tutorial';
import {
  survivalDifficulties,
  survivalDifficultyProfiles,
} from '@/lib/game/survival-difficulty';
import { survivalOfficialCutLines } from '@/lib/game/survival-rules';
import { characterCatalog, characterNames } from '@/lib/game/characters';
import { ItemIcon } from './item-icon';
import { getItemDefinition } from '@/lib/game/item-catalog';

const questions = [
  {
    question: '本层新增积分是否包含上层S的20%继承？',
    choices: ['不包含，只累计R和余额兑换', '包含，继承每层重复累加'],
    answer: 0,
  },
  {
    question: '所有人都超过斩杀线，会不会有人淘汰？',
    choices: ['仍至少淘汰末位两人', '全员都存活'],
    answer: 0,
  },
  {
    question: '存活者600分、第一层淘汰者9000分，谁在前？',
    choices: ['存活者', '9000分淘汰者'],
    answer: 0,
  },
  {
    question: 'AI的角色适配会给角色增加额外资金吗？',
    choices: ['不会，只根据已有构筑规划', '会增加隐藏资金'],
    answer: 0,
  },
  {
    question: '降低难度是否降低斩杀线？',
    choices: ['不会，四档规则完全相同', '会降低每层门槛'],
    answer: 0,
  },
  {
    question: '只读回放能否继续比赛或覆盖正在玩的对局？',
    choices: ['不能，续玩需要检查点或完整备份', '可以，回放就是续玩存档'],
    answer: 0,
  },
];
export function SurvivalTutorial({ decimals = 2 }: { decimals?: 2 | 4 }) {
  const [lesson, setLesson] = useState(0),
    [completed, setCompleted] = useState<number[]>([]),
    [answer, setAnswer] = useState<number | null>(null);
  const [r, setR] = useState(420),
    [money, setMoney] = useState(500),
    [previous, setPrevious] = useState(300),
    [scenario, setScenario] = useState<TutorialEliminationCase>('passed'),
    [calculated, setCalculated] = useState(false);
  const score = survivalTutorialScore(r, money, previous),
    elimination = survivalTutorialElimination(scenario),
    question = questions[lesson]!;
  const name = (id: string) =>
    id === 'human'
      ? '你'
      : id === 'survivor'
        ? '存活者'
        : id === 'early-rich'
          ? '早淘汰高分者'
          : id === 'late-rich'
            ? '第五层800分者'
            : id === 'late'
              ? '第五层700分者'
              : id;
  const choose = (i: number) => {
    setLesson(i);
    setAnswer(null);
    setCalculated(false);
  };
  return (
    <div className="tutorial-content survival-teaching">
      <p className="utility-notice">
        生存独立教学 ·
        固定示例与正式层末计算函数，不创建正式对局，不运行AI，不读取或改写存档、回放、难度和玩家进度。已练习{' '}
        {completed.length}/6 课。
      </p>
      <nav className="tutorial-lessons" aria-label="生存教学课程">
        {survivalTutorialLessons.map((entry, i) => (
          <button
            key={entry.id}
            aria-current={lesson === i ? 'step' : undefined}
            onClick={() => choose(i)}
          >
            <span>
              {i + 1}. {entry.title}
            </span>
            <small>{completed.includes(i) ? '已练习' : '可随时进入'}</small>
          </button>
        ))}
      </nav>
      <div className="tutorial-lesson-heading">
        <div>
          <p className="eyebrow">SURVIVAL LESSON {lesson + 1} / 6</p>
          <h3>{survivalTutorialLessons[lesson]!.title}</h3>
          <p>{survivalTutorialLessons[lesson]!.task}</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            setAnswer(null);
            setCalculated(false);
            setR(420);
            setMoney(500);
            setPrevious(300);
            setScenario('passed');
          }}
        >
          重做本课
        </Button>
      </div>
      <section className="tutorial-panel">
        {lesson === 0 && (
          <>
            <p>
              S = R＋10%余额＋20%上层S；新增积分 =
              R＋10%余额。例子输入的是五房最终分之和，不再次乘房间或道具倍率。
            </p>
            <div className="survival-tutorial-inputs">
              {[
                ['房间分R', r, setR, 5000],
                ['层末余额', money, setMoney, 3000],
                ['上层S', previous, setPrevious, 5000],
              ].map(([label, value, change, max]) => (
                <label key={label as string}>
                  {label as string}
                  <input
                    type="number"
                    aria-label={label as string}
                    min={0}
                    max={max as number}
                    step="1"
                    value={value as number}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n))
                        (change as (n: number) => void)(
                          Math.min(max as number, Math.max(0, Math.round(n))),
                        );
                      setCalculated(false);
                    }}
                  />
                </label>
              ))}
            </div>
            <Button onClick={() => setCalculated(true)}>计算本层分数</Button>
            {calculated && (
              <dl className="survival-tutorial-ledger">
                {[
                  ['房间分', score.roomScore],
                  ['余额兑换', score.exchangedScore],
                  ['继承分', score.inheritedScore],
                  ['本层新增积分', score.newScore],
                  ['本层生存分S', score.survivalScore],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{(value as number).toFixed(decimals)}</dd>
                  </div>
                ))}
              </dl>
            )}
            <p>
              默认例子：420＋50＋60=530，但累计只新增470。进行中的房间不提前结算余额兑换。
            </p>
          </>
        )}
        {lesson === 1 && (
          <>
            <label>
              淘汰示例{' '}
              <select
                aria-label="淘汰示例"
                value={scenario}
                onChange={(e) =>
                  setScenario(e.target.value as TutorialEliminationCase)
                }
              >
                {[
                  ['passed', '全员达标'],
                  ['below', '五人线下'],
                  ['tie', '全员同分'],
                  ['wipeout', '全员线下'],
                  ['six', '剩余8人达标'],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <p>
              教学斩杀线200；当前参与{elimination.participants.length}人，淘汰
              {elimination.resolution.plan.eliminations.length}人，剩余
              {elimination.resolution.plan.survivorIds.length}人。
              {elimination.resolution.plan.shouldFinish
                ? '本层后结束比赛'
                : '继续下一层'}
              。{scenario === 'wipeout' ? '团灭无冠军。' : ''}
            </p>
            <div className="survival-table-wrap">
              <table className="survival-table">
                <caption>正式淘汰函数的固定教学结果</caption>
                <thead>
                  <tr>
                    <th>玩家</th>
                    <th>S</th>
                    <th>结果</th>
                  </tr>
                </thead>
                <tbody>
                  {elimination.participants.map((p) => {
                    const removed =
                      elimination.resolution.plan.eliminations.find(
                        (e) => e.playerId === p.playerId,
                      );
                    return (
                      <tr key={p.playerId}>
                        <th scope="row">{name(p.playerId)}</th>
                        <td>{p.survivalScore.toFixed(decimals)}</td>
                        <td>
                          {removed
                            ? removed.reason === 'below_cut_line'
                              ? '线下淘汰'
                              : '末位补淘汰'
                            : '存活'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p>
              线下全部淘汰；不足两人从达标末位补足。同分按固定教学种子抽签，重做结果一致，不影响正式随机流。
            </p>
          </>
        )}
        {lesson === 2 && (
          <>
            <p>
              积分排行查看已结算房间积分、行动与道具；争夺榜看本房A/B报价与资格；生存榜看状态、各层新增积分和累计。最终生存顺位不等于累计分排序。
            </p>
            <ol className="survival-teaching-ranking">
              {survivalTutorialRanking().map((row) => (
                <li key={row.playerId}>
                  第{row.rank}名 · {name(row.playerId)} ·{' '}
                  {row.eliminationFloorIndex === null
                    ? '存活'
                    : `第${row.eliminationFloorIndex + 1}层淘汰`}{' '}
                  · {row.finalScore.toFixed(decimals)}
                </li>
              ))}
            </ol>
          </>
        )}
        {lesson === 3 && (
          <>
            <p>
              每层基础1000，之后才应用角色／道具经济；五房中最后一房BOSS，要留出实际现金。打折影响扣款，不放宽名义报价上限；双行动预算不是两份全额。
            </p>
            <div className="survival-items">
              {characterCatalog.map((c) => (
                <article key={c.id}>
                  <b>{characterNames[c.id]}</b>
                  <p>
                    {c.id === 'isaac'
                      ? '每层基础资金提高10%，六面骰触发是随机事件，不保证翻倍。'
                      : c.id === 'lost'
                        ? '屏障保护失败竞拍，永恒六面骰仍是随机收益；不能把返款当成一定发生。'
                        : c.id === 'azazel'
                          ? '硫磺火允许计分靠近目标区间，但报价更高不一定更有效，市场奖励资格另算。'
                          : c.id === 'jacob_esau'
                            ? '每层基础资金提高20%，双行动免0.75积分修正；仍受实际现金和名义合计限制。'
                            : '每层资金±10%，两件随机起始道具；生存不抽取福袋与黑王子之冠，规划要看实际构筑。'}
                  </p>
                  {c.fixedStartingItems.map((id) => (
                    <span className="survival-teaching-item" key={id}>
                      <ItemIcon itemId={id} />
                      {getItemDefinition(id).name}
                    </span>
                  ))}
                </article>
              ))}
            </div>
          </>
        )}
        {lesson === 4 && (
          <>
            <div className="survival-items">
              {survivalDifficulties.map((d) => (
                <article key={d}>
                  <b>{survivalDifficultyProfiles[d].label}</b>
                  <p>
                    {d === 'highest'
                      ? '保留0.3.1原最高策略与随机流。'
                      : d === 'hard'
                        ? '较高预测精度与角色构筑适配，少量机会判断失误。'
                        : d === 'standard'
                          ? '默认档，适中的预测／报价误差及角色判断。'
                          : '较粗预测与报价，更多错过出手机会，仍不透支现金。'}
                  </p>
                </article>
              ))}
            </div>
            <p>
              正式斩杀线四档相同：{survivalOfficialCutLines.join('／')}
              。开局后锁定难度；旧存档继续其原策略，不悄悄升级。AI不读你的本房秘密报价、未揭示奖励或未来结果。
            </p>
          </>
        )}
        {lesson === 5 && (
          <>
            <ol className="survival-teaching-ranking">
              <li>层末淘汰：冻结真人资金、道具和已获得积分。</li>
              <li>AI-only续赛：其余AI继续提交与结算，不伪造真人观望。</li>
              <li>剩余≤6人：生成20人总榜；全部线下则无冠军。</li>
              <li>续玩检查点／完整备份：恢复原阶段、草稿、难度及策略。</li>
              <li>只读回放：只查看事实，不续玩、不改当前局、不登记进度。</li>
            </ol>
            <p>
              保存失败时先导出当前内存局。归档失败但检查点成功时仍可恢复终局；完成回放可单独导出。备份中的玩家进度默认不恢复。
            </p>
          </>
        )}
      </section>
      <section className="tutorial-panel">
        <h4>本课理解检查</h4>
        <p>{question.question}</p>
        <div className="data-actions">
          {question.choices.map((choice, i) => (
            <Button
              key={choice}
              variant="secondary"
              onClick={() => {
                setAnswer(i);
                if (i === question.answer)
                  setCompleted((old) =>
                    old.includes(lesson) ? old : [...old, lesson],
                  );
              }}
            >
              {choice}
            </Button>
          ))}
        </div>
        {answer !== null && (
          <output>
            {answer === question.answer
              ? '回答正确，本课已练习。'
              : '再看本课示例，正确答案不会改变正式对局。'}
          </output>
        )}
        <div className="data-actions">
          <Button
            variant="secondary"
            disabled={lesson === 0}
            onClick={() => choose(lesson - 1)}
          >
            上一课
          </Button>
          <Button disabled={lesson === 5} onClick={() => choose(lesson + 1)}>
            下一课
          </Button>
        </div>
      </section>
    </div>
  );
}
