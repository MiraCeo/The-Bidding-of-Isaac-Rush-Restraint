import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SurvivalReplayLog } from '@/lib/ui/survival-record';
import { finalSurvivalBoard } from '@/lib/ui/survival-board';
import { SurvivalScoreBoard } from './survival-score-board';

/** Terminal facts only: personal results may be frozen before the final AI floor. */
export function SurvivalComplete({
  log,
  decimals = 2,
  onNew,
  onBuild,
  onReplay,
  onReturnMenu,
  profileMessage,
  saveMessage,
}: {
  log: SurvivalReplayLog;
  decimals?: 2 | 4;
  onNew: () => void;
  onBuild: () => void;
  onReplay: () => void;
  onReturnMenu: () => void;
  profileMessage?: ReactNode;
  saveMessage?: ReactNode;
}) {
  const final = log.final;
  if (!final) return <p>暂无最终生存结算。</p>;
  const model = finalSurvivalBoard(log);
  const own = model.rows.find((row) => row.playerId === 'human');
  const eliminated = final.eliminated.human;
  const ownFloorIndex =
    eliminated?.floorIndex ??
    own?.eliminationFloorIndex ??
    log.floors.at(-1)?.floorIndex;
  const ownFloor = log.floors.find(
    (floor) => floor.floorIndex === ownFloorIndex,
  );
  const ownScore = eliminated?.score ?? ownFloor?.scores.human;
  const removal =
    eliminated ??
    ownFloor?.plan.eliminations.find((entry) => entry.playerId === 'human');
  const reason =
    removal?.reason === 'lowest_score'
      ? '末位补淘汰'
      : removal?.reason === 'below_cut_line'
        ? '线下淘汰'
        : '淘汰原因未记录';
  const verdict = own?.active
    ? '存活至终局'
    : own
      ? ownFloorIndex === undefined
        ? '淘汰（层数未记录）'
        : `第 ${ownFloorIndex + 1} 层 · ${reason}`
      : '个人结果未记录';
  return (
    <section className="survival-complete">
      <header className="settlement-heading">
        <div>
          <p className="eyebrow">SURVIVAL COMPLETE</p>
          <h2>
            生存结算 <small>本局已结束</small>
          </h2>
        </div>
        <nav aria-label="终局辅助操作">
          <button type="button" onClick={onBuild}>
            查看构筑
          </button>
          <button type="button" onClick={onReplay}>
            本局回放
          </button>
        </nav>
      </header>
      <section
        className="survival-complete-outcomes"
        aria-label="你的最终生存结果"
      >
        <article>
          <span>你的最终名次</span>
          <strong className="complete-main-value">
            {own ? `#${own.rank}` : '—'}
          </strong>
          <small className={own?.active ? 'complete-alive' : 'complete-out'}>
            {verdict}
          </small>
        </article>
        <article>
          <span>累计积分</span>
          <strong className="complete-main-value" data-final-human-score>
            {own ? own.total.toFixed(decimals) : '—'}
          </strong>
          <small>各层新增之和，不重复计入继承分</small>
        </article>
        <article>
          <span>本局榜首</span>
          <strong className="complete-champion">
            {final.championId
              ? (log.playerNames[final.championId] ?? final.championId)
              : '无冠军'}
          </strong>
          <small>
            {final.championId
              ? `共完成 ${model.floorCount} 层比赛`
              : '团灭 · 本局没有存活者'}
          </small>
        </article>
        <div className="complete-primary-action">
          <Button type="button" size="lg" onClick={onNew}>
            再来一局生存
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </section>
      <p className="survival-complete-reason" aria-label="个人最终结果说明">
        {own?.active ? (
          `你存活至本局结束，共记录 ${model.floorCount} 层比赛。`
        ) : ownFloor && ownScore ? (
          <>
            第 {ownFloor.floorIndex + 1} 层：生存分{' '}
            <b>{ownScore.survivalScore.toFixed(decimals)}</b> ／ 斩杀线{' '}
            <b>{ownFloor.cutLine}</b>，原判定为{' '}
            <b className="complete-out">{reason}</b>。
            {removal?.reason === 'lowest_score' && (
              <>
                当层 {ownFloor.activePlayerIds.length} 人参与、
                {ownFloor.plan.survivorIds.length} 人存活；每层至少淘汰{' '}
                {log.ruleFacts.parameters.rules.minimumEliminations}{' '}
                人，达线仍可能末位补淘汰。
              </>
            )}
            {ownFloor.resolution.tieBreaks.some(
              (tie) => tie.playerId === 'human',
            ) && ' 末位同分已按记录的抽签事实裁定。'}
          </>
        ) : (
          '未记录完整的个人层末原因，不根据当前积分推测。'
        )}
      </p>
      <div className="survival-final-board">
        <SurvivalScoreBoard
          model={model}
          decimals={decimals}
          embedded
          selfSummaryOutside
        />
      </div>
      <footer className="settlement-lifecycle">
        <Button type="button" variant="secondary" onClick={onReturnMenu}>
          返回主菜单
        </Button>
        <output className="settlement-save-state">
          <span>{profileMessage}</span>
          <span>{saveMessage}</span>
        </output>
      </footer>
    </section>
  );
}
