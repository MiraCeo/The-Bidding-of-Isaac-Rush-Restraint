import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SurvivalReplayLog } from '@/lib/ui/survival-record';
import { finalSurvivalBoard } from '@/lib/ui/survival-board';
import { SurvivalFinalBoard } from './survival-final-board';
import { FinalPodium } from './final-podium';
import { characterNames } from '@/lib/game';
import type { AiClientProfile } from '@/lib/game/client-runtime';

/** Terminal facts only: personal results may be frozen before the final AI floor. */
export function SurvivalComplete({
  log,
  aiProfiles,
  decimals = 2,
  onNew,
  onBuild,
  onReplay,
  onReturnMenu,
  profileMessage,
  saveMessage,
}: {
  log: SurvivalReplayLog;
  aiProfiles?: Readonly<Record<string, AiClientProfile>>;
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
  const humanPlayer = final.players.find((player) => player.id === 'human');
  return (
    <section
      className="survival-complete classic-final survival-final"
      data-ranking-polish="survival-final"
    >
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
      <div className="classic-final-layout">
        <aside
          className="classic-final-showcase"
          aria-label="个人生存结果与领奖台"
        >
          <section
            className="classic-final-outcomes survival-complete-outcomes"
            aria-label="你的最终生存结果"
          >
            <article>
              <span>你的最终名次</span>
              <strong className="complete-main-value">
                {own ? `#${own.rank}` : '—'}
              </strong>
              <small
                className={own?.active ? 'complete-alive' : 'complete-out'}
              >
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
            <div className="classic-final-build">
              <span>
                {humanPlayer?.characterId
                  ? characterNames[humanPlayer.characterId]
                  : '—'}
              </span>
              <span>{humanPlayer?.items.length ?? 0} 件道具</span>
            </div>
            <div className="survival-final-verdict">
              <span>
                {own?.active
                  ? `存活至终局 · 共 ${model.floorCount} 层`
                  : ownFloor && ownScore
                    ? `个人第${ownFloor.floorIndex + 1}层：生存分S ${ownScore.survivalScore.toFixed(decimals)} ／ 斩杀线 ${ownFloor.cutLine}`
                    : '个人层末事实未完整记录'}
              </span>
              <details className="survival-reason-details">
                <summary>判定依据</summary>
                <p
                  className="survival-complete-reason"
                  aria-label="个人最终结果说明"
                >
                  {own?.active ? (
                    `你存活至本局结束，共记录 ${model.floorCount} 层比赛。`
                  ) : ownFloor && ownScore ? (
                    <>
                      第 {ownFloor.floorIndex + 1} 层：生存分{' '}
                      <b>{ownScore.survivalScore.toFixed(decimals)}</b> ／
                      斩杀线 <b>{ownFloor.cutLine}</b>。
                      <b className="complete-out">
                        {removal?.reason === 'lowest_score'
                          ? '已达斩杀线，但因当层末位补淘汰出局。'
                          : removal?.reason === 'below_cut_line'
                            ? '因生存分低于斩杀线出局。'
                            : reason}
                      </b>
                      {removal?.reason === 'lowest_score' && (
                        <>
                          当层 {ownFloor.activePlayerIds.length} 人参与、
                          {ownFloor.plan.survivorIds.length}{' '}
                          人存活；每层至少淘汰{' '}
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
              </details>
            </div>
          </section>
          <FinalPodium
            title="生存前三名"
            decimals={decimals}
            hasChampion={final.championId !== null}
            caption={
              <>
                {final.championId && '榜首 · '}
                <span className="complete-champion">
                  {final.championId
                    ? (log.playerNames[final.championId] ?? final.championId)
                    : '无冠军'}
                </span>
              </>
            }
            entries={model.rows.slice(0, 3).map((row) => {
              const player = final.players.find((p) => p.id === row.playerId);
              return {
                playerId: row.playerId,
                name: row.name,
                characterId: player?.characterId ?? null,
                score: row.total,
                itemCount: player?.items.length ?? 0,
                status: { label: row.statusLabel, active: row.active },
              };
            })}
          />
        </aside>
        <SurvivalFinalBoard
          log={log}
          model={model}
          decimals={decimals}
          aiProfiles={aiProfiles}
        />
      </div>
      <footer className="settlement-lifecycle classic-final-lifecycle">
        <Button type="button" variant="secondary" onClick={onReturnMenu}>
          返回主菜单
        </Button>
        <output className="settlement-save-state">
          <span>{profileMessage}</span>
          <span>{saveMessage}</span>
        </output>
        <div className="final-actions complete-primary-action">
          <Button type="button" size="lg" onClick={onNew}>
            再来一局生存
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </footer>
    </section>
  );
}
