import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SurvivalReplayLog } from '@/lib/ui/survival-record';
import { SurvivalFloorFacts } from './survival-replay-viewer';
import { LocateSelfButton } from './ranking-self-summary';

/** Present the recorded floor result. Never recalculate the elimination plan. */
export function SurvivalFloorResult({
  log,
  index,
  decimals = 2,
  onAdvance,
  onBuild,
  onReplay,
  onReturnMenu,
  onRestart,
  saveMessage,
}: {
  log: SurvivalReplayLog;
  index: number;
  decimals?: 2 | 4;
  onAdvance: () => void;
  onBuild: () => void;
  onReplay: () => void;
  onReturnMenu: () => void;
  onRestart: () => void;
  saveMessage?: ReactNode;
}) {
  const floor = log.floors[index];
  if (!floor) return <p>暂无层末结算。</p>;
  const score = floor.scores.human;
  const removed = floor.plan.eliminations.find(
    (entry) => entry.playerId === 'human',
  );
  const survived = floor.plan.survivorIds.includes('human');
  const margin = score ? score.survivalScore - floor.cutLine : null;
  const signed = (value: number) =>
    `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}`;
  return (
    <section className="floor-settlement" data-ranking-scope>
      <header className="settlement-heading">
        <div>
          <p className="eyebrow">FLOOR SETTLEMENT</p>
          <h2>
            层末生存结算{' '}
            <small>
              第 {floor.floorIndex + 1} 层 · 斩杀线 {floor.cutLine}
            </small>
          </h2>
        </div>
        <nav aria-label="层末辅助操作">
          <button type="button" onClick={onBuild}>
            查看构筑
          </button>
          <button type="button" onClick={onReplay}>
            本局回放
          </button>
        </nav>
      </header>
      <section className="floor-outcomes" aria-label="你的层末结果">
        <article>
          <span>你的判定</span>
          <strong
            className={`floor-verdict ${survived ? 'is-alive' : 'is-out'}`}
          >
            {survived
              ? '本层存活'
              : removed
                ? removed.reason === 'below_cut_line'
                  ? '线下淘汰'
                  : '末位补淘汰'
                : '本层未参与'}
          </strong>
          <small>
            {margin === null ? '没有本层结算分' : `距斩杀线 ${signed(margin)}`}
          </small>
        </article>
        <article>
          <span>本层生存分 S</span>
          <strong className="floor-score">
            {score ? score.survivalScore.toFixed(decimals) : '—'}
          </strong>
          <small>
            {score
              ? `房间分 ${score.roomScore.toFixed(decimals)} ＋ 兑换 ${score.exchangedScore.toFixed(decimals)} ＋ 继承 ${score.inheritedScore.toFixed(decimals)}`
              : '不推算缺失记录'}
          </small>
        </article>
        <article>
          <span>新增累计积分</span>
          <strong className="floor-score">
            {score ? signed(score.newScore) : '—'}
          </strong>
          <small>不包含继承分</small>
        </article>
        <div className="floor-primary-action">
          <Button type="button" size="lg" onClick={onAdvance}>
            {floor.plan.shouldFinish ? '查看生存总榜' : '进入下一层'}
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </section>
      <div className="floor-ledger-toolbar">
        <p className="floor-population">
          <span>
            本层参与 <b>{floor.activePlayerIds.length}</b>
          </span>
          <span>
            线下淘汰{' '}
            <b>
              {
                floor.plan.eliminations.filter(
                  (e) => e.reason === 'below_cut_line',
                ).length
              }
            </b>
          </span>
          <span>
            末位补淘汰{' '}
            <b>
              {
                floor.plan.eliminations.filter(
                  (e) => e.reason === 'lowest_score',
                ).length
              }
            </b>
          </span>
          <span>
            存活人数 <b>{floor.plan.survivorIds.length}</b>
          </span>
        </p>
        <div className="floor-ledger-tools">
          <details className="floor-scoring-help">
            <summary>积分口径</summary>
            <p>
              生存分 = 房间分 R ＋ 余额兑换{' '}
              {log.ruleFacts.parameters.rules.moneyExchangeRatio * 100}% ＋
              上层生存分继承{' '}
              {log.ruleFacts.parameters.rules.scoreInheritanceRatio * 100}
              %。新增积分不包含继承分；是否淘汰以本层已记录判定为准，达线仍可能末位补淘汰。
            </p>
          </details>
          {score && <LocateSelfButton />}
        </div>
      </div>
      <div className="floor-ledger" aria-label="本层全体结果">
        <SurvivalFloorFacts
          log={log}
          index={index}
          decimals={decimals}
          compact
        />
      </div>
      <footer className="settlement-lifecycle">
        <Button type="button" variant="secondary" onClick={onReturnMenu}>
          返回主菜单
        </Button>
        <Button type="button" variant="ghost" onClick={onRestart}>
          重新开始
        </Button>
        <output className="settlement-save-state">{saveMessage}</output>
      </footer>
    </section>
  );
}
