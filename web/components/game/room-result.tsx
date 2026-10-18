import { GameHeader } from './game-header';
import { ItemIcon } from './item-icon';
import { ReplayMarket } from './replay-market';
import { useState, useContext, type ReactNode } from 'react';
import { SettlementNavigationContext } from './settlement-navigation';
import type { SettlementEvent } from '@/lib/game/item-types';
import { displayItemText } from '@/lib/ui/item-labels';
import { ArrowRight, Coins } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ScoreDisplayDecimals } from '@/lib/ui/game-preferences';
import {
  defaultRules,
  getItemDefinition,
  type ActiveClientGameState,
  type ClientRankingView,
  type PlayerAction,
} from '@/lib/game';

interface RoomResultProps {
  auxiliaryActions?: ReactNode;
  lifecycleActions?: ReactNode;
  scoreScope?: 'classic' | 'survival';
  rules?: import('@/lib/game/types').RulesConfig;
  advanceLabel?: string;
  finalRoom?: boolean;
  embedded?: boolean;
  game: ActiveClientGameState;
  onShowRanking: (view: ClientRankingView) => void;
  onAdvance: () => void;
  scoreDecimals?: ScoreDisplayDecimals;
}

const roomKindNames = {
  normal: '普通房',
  treasure: '宝箱房',
  shop: '商店',
  hidden: '隐藏房',
  boss: 'BOSS 房',
} as const;

function actionLabel(action: PlayerAction): string {
  if (action.type === 'withdraw') return '静观其变';
  return `${action.type === 'bid' ? '竞拍' : '扰乱'} ${action.group} · ${action.amount}`;
}

export function RoomResult({
  rules = defaultRules,
  advanceLabel,
  finalRoom,
  game,
  onShowRanking,
  onAdvance,
  scoreDecimals = 2,
  embedded = false,
  auxiliaryActions,
  lifecycleActions,
  scoreScope = 'classic',
}: RoomResultProps) {
  const [marketOpen, setMarketOpen] = useState(false);
  const navigation = useContext(SettlementNavigationContext);
  const Container = embedded ? 'div' : 'main';
  const settlement = game.roomSettlement;
  if (!settlement) throw new Error('结算页面缺少房间结算记录。');
  const humanBefore = settlement.playersBefore.find(
    (player) => player.id === game.humanPlayerId,
  );
  const humanAfter = settlement.players.find(
    (player) => player.id === game.humanPlayerId,
  );
  if (!humanBefore || !humanAfter) throw new Error('结算记录缺少真人玩家。');

  const playerName = (playerId: string) =>
    playerId === game.humanPlayerId
      ? '你'
      : (game.aiProfiles[playerId]?.name ?? playerId);
  const humanBreakdown = settlement.scoreBreakdowns[game.humanPlayerId];
  const humanScore = settlement.roomScoreSummaries[game.humanPlayerId]!;
  const humanResolved = settlement.resolvedActions.filter(
    (action) => action.playerId === game.humanPlayerId,
  );
  const humanEvents = settlement.events.filter(
    (event) => event.playerId === game.humanPlayerId,
  );
  const humanAwards = settlement.awards.filter(
    (award) => award.playerId === game.humanPlayerId,
  );
  const actualCost = humanResolved.reduce(
    (sum, resolved) => sum + resolved.actualCost,
    0,
  );
  const moneyDelta = humanAfter.money - humanBefore.money;
  const refunded = humanEvents
    .filter((event) => event.type === 'refund')
    .reduce((sum, event) => sum + (event.amount ?? 0), 0);
  const otherMoney = moneyDelta + actualCost - refunded;
  const subtotal = (humanBreakdown?.actions ?? []).reduce(
    (sum, action) => sum + action.subtotal,
    0,
  );
  const actionText =
    settlement.turns
      .find((turn) => turn.playerId === game.humanPlayerId)
      ?.actions.map(actionLabel)
      .join(' / ') ?? '—';
  const floorMoney = rules.floorStartingMoney[game.floorIndex]!;
  const cooperationRadius = floorMoney * rules.cooperationZoneRatio;
  const isFinalRoom =
    finalRoom ??
    (game.floorIndex === game.rooms.length - 1 &&
      game.roomIndex === game.rooms[game.floorIndex]!.length - 1);

  return (
    <Container className="result-page settlement-room">
      {!embedded && (
        <GameHeader
          navigation={
            <div className="result-header-title">
              <span>{roomKindNames[settlement.room.kind]}</span>
              <strong>房间结算</strong>
            </div>
          }
          context={
            <>
              <div className="round-status">
                <span className="status-chip">
                  第 {game.floorIndex + 1} 层 · 房间 {game.roomIndex + 1}/5
                </span>
                <span className="status-chip status-chip-money">
                  <Coins aria-hidden="true" />
                  <strong>{humanAfter.money}</strong>
                </span>
              </div>
            </>
          }
        />
      )}

      <section className="result-stage">
        <header className="settlement-heading">
          <div>
            <p className="eyebrow">ROOM SETTLEMENT</p>
            <h2>
              房间结算 <small>{roomKindNames[settlement.room.kind]}</small>
            </h2>
          </div>
          <nav aria-label="结算辅助入口">
            {auxiliaryActions ?? navigation?.auxiliaryActions}
          </nav>
        </header>
        <section className="settlement-overview" aria-label="本房个人结果">
          <div className="settlement-outcome-grid result-summary-grid">
            <article>
              <span>本房积分</span>
              <strong className="summary-score">
                +{humanScore.finalScore.toFixed(scoreDecimals)}
              </strong>
              <small
                className="settlement-score-equation"
                title="显示值按精度四舍五入；本房倍率已计入箭头右侧积分，不再重复乘算。"
              >
                {humanBreakdown?.cleared
                  ? '道具效果使本房积分清零'
                  : `计分小计 ${subtotal.toFixed(scoreDecimals)} × ${(humanBreakdown?.multiplier ?? 1).toFixed(3)} → ${humanScore.initialScore.toFixed(scoreDecimals)}`}
                {humanScore.retroactiveScore !== 0 &&
                  `；追溯追加 +${humanScore.retroactiveScore.toFixed(scoreDecimals)}`}
              </small>
              <small>
                {scoreScope === 'survival' ? '累计房间分' : '累计积分'}{' '}
                {humanAfter.score.toFixed(scoreDecimals)}
              </small>
            </article>
            <article>
              <span>资金净变化</span>
              <strong
                className={
                  moneyDelta < 0 ? 'summary-negative' : 'summary-score'
                }
              >
                {moneyDelta >= 0 ? '+' : ''}
                {moneyDelta}
              </strong>
              <small className="settlement-money-equation">
                {moneyDelta > 0
                  ? `返还 ${refunded}${otherMoney !== 0 ? ` ${otherMoney > 0 ? '+ 收入' : '− 其他支出'} ${Math.abs(otherMoney)}` : ''} − 扣款 ${actualCost} = 净收入 ${moneyDelta}`
                  : `扣款 ${actualCost}${refunded !== 0 ? ` − 返还 ${refunded}` : ''}${otherMoney !== 0 ? ` ${otherMoney > 0 ? '− 收入' : '+ 其他支出'} ${Math.abs(otherMoney)}` : ''} = 净支出 ${-moneyDelta}`}
              </small>
              <small>
                资金 {humanBefore.money} → {humanAfter.money}
              </small>
            </article>
            <article className="settlement-earned">
              <span>获得道具</span>
              <div className="settlement-earned-items">
                {humanAwards.length ? (
                  humanAwards.map((award) => (
                    <div key={`${award.group}-${award.itemId}`}>
                      <ItemIcon itemId={award.itemId} size="large" />
                      <strong>
                        {getItemDefinition(award.itemId).name}
                        {award.copies > 1 && ` ×${award.copies}`}
                        <small>目标 {award.group}</small>
                      </strong>
                    </div>
                  ))
                ) : (
                  <strong className="settlement-no-award">本房未获道具</strong>
                )}
              </div>
              <small>{actionText}</small>
            </article>
          </div>
          <div className="settlement-primary-actions">
            <div>
              <span>本房已结算</span>
              <strong>准备好就继续</strong>
            </div>
            <Button type="button" size="lg" onClick={onAdvance}>
              {advanceLabel ?? (isFinalRoom ? '最终排行' : '进入下一房间')}
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </section>
        <section
          className="settlement-market-summary"
          aria-label="本房市场摘要"
        >
          <span>
            共同基准线{' '}
            <strong>
              {settlement.baseline?.target.toFixed(2) ?? '无市场样本'}
            </strong>
          </span>
          <span>
            合作区{' '}
            <strong>
              {settlement.baseline
                ? `${Math.max(0, settlement.baseline.target - cooperationRadius).toFixed(2)} – ${(settlement.baseline.target + cooperationRadius).toFixed(2)}`
                : '—'}
            </strong>
          </span>
          <span className="settlement-ranking-links">
            <Button
              type="button"
              variant="outline"
              onClick={() => onShowRanking('score')}
            >
              积分排行
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onShowRanking('contest')}
            >
              争夺榜
            </Button>
          </span>
        </section>
        <div className="settlement-disclosures">
          <details className="result-panel reward-settlement settlement-detail">
            <summary>
              道具资格与发放 <span>查看全部名额与最终结果</span>
            </summary>
            <div className="settlement-detail-body">
              <div className="settled-rewards">
                {settlement.room.rewards.map((reward) => {
                  const definition = getItemDefinition(reward.itemId);
                  const high = settlement.highPricePlacements.filter(
                    (entry) => entry.group === reward.group,
                  );
                  const cooperation = settlement.cooperationPlacements.filter(
                    (entry) => entry.group === reward.group,
                  );
                  const awards = settlement.awards.filter(
                    (entry) => entry.group === reward.group,
                  );
                  const humanAward = awards.find(
                    (entry) => entry.playerId === game.humanPlayerId,
                  );
                  return (
                    <article
                      key={reward.group}
                      className={humanAward ? 'settled-reward-earned' : ''}
                    >
                      <div className="settled-reward-heading">
                        {humanAward && (
                          <span className="earned-badge">
                            你已获得
                            {humanAward.copies > 1
                              ? ` ×${humanAward.copies}`
                              : ''}
                          </span>
                        )}
                        <div className="settled-reward-title">
                          <ItemIcon itemId={reward.itemId} size="large" />
                          <div>
                            <small>道具 {reward.group}</small>
                            <h3>{definition.name}</h3>
                          </div>
                        </div>
                      </div>
                      <ResultLine
                        label="最高价名额"
                        values={high.map((entry) => ({
                          name: playerName(entry.playerId),
                          badge:
                            entry.actionType === 'disrupt'
                              ? '扰乱占位'
                              : undefined,
                        }))}
                      />
                      <ResultLine
                        label="合作区名额"
                        values={cooperation.map((entry) => ({
                          name: playerName(entry.playerId),
                          badge:
                            entry.actionType === 'disrupt'
                              ? '扰乱占位'
                              : undefined,
                        }))}
                      />
                      <ResultLine
                        label="最终发放"
                        values={awards.map((entry) => ({
                          name: playerName(entry.playerId),
                          badge:
                            entry.copies > 1 ? `×${entry.copies}` : undefined,
                        }))}
                      />
                      <EventNotes
                        events={humanEvents.filter(
                          (event) =>
                            event.group === reward.group &&
                            (event.type === 'destroy' ||
                              event.type === 'duplicate'),
                        )}
                      />
                    </article>
                  );
                })}
              </div>
              <EventNotes
                events={humanEvents.filter(
                  (event) =>
                    event.group === undefined &&
                    (event.type === 'destroy' || event.type === 'duplicate'),
                )}
              />
            </div>
          </details>

          <details className="result-panel player-settlement settlement-detail">
            <summary>
              积分计算明细 <span>名义报价、实际扣款与计分依据</span>
            </summary>
            <div className="settlement-detail-body">
              <div className="resolved-action-list">
                {humanResolved.map((resolved) => {
                  const score = humanBreakdown?.actions.find(
                    (entry) => entry.actionIndex === resolved.actionIndex,
                  );
                  const adjustmentNames =
                    score?.scoringValue != null &&
                    score.scoringValue !== resolved.scoringEquivalent
                      ? [
                          ...new Set(
                            (humanBreakdown?.triggers ?? [])
                              .filter(
                                (trigger) =>
                                  trigger.kind === 'scoring_adjustment' &&
                                  ((resolved.action.type === 'bid' &&
                                    trigger.itemId === 'brimstone') ||
                                    (resolved.action.type === 'disrupt' &&
                                      trigger.itemId === 'short_brimstone')),
                              )
                              .map(
                                (trigger) =>
                                  getItemDefinition(trigger.itemId).name,
                              ),
                          ),
                        ]
                      : [];
                  return (
                    <article key={resolved.actionIndex}>
                      <div>
                        <strong>{actionLabel(resolved.action)}</strong>
                        <span>行动 {resolved.actionIndex + 1}</span>
                      </div>
                      <dl>
                        <div>
                          <dt>实际扣款</dt>
                          <dd>{resolved.actualCost}</dd>
                        </div>
                        <div>
                          <dt>市场等价</dt>
                          <dd>{resolved.marketEquivalent ?? '—'}</dd>
                        </div>
                        <div>
                          <dt>计分取值</dt>
                          <dd>
                            {score?.scoringValue ??
                              resolved.scoringEquivalent ??
                              '—'}
                          </dd>
                        </div>
                        <div>
                          <dt>基础积分</dt>
                          <dd>
                            {(score?.baseScore ?? 0).toFixed(scoreDecimals)}
                          </dd>
                        </div>
                        <div>
                          <dt>加算积分</dt>
                          <dd>
                            {(score?.additiveScore ?? 0).toFixed(scoreDecimals)}
                          </dd>
                        </div>
                      </dl>
                      {adjustmentNames.length > 0 && (
                        <p className="settlement-scoring-note">
                          {adjustmentNames
                            .map(
                              (name) =>
                                `${name}计分修正：合作判定 ${resolved.scoringEquivalent} → 计分取值 ${score!.scoringValue}，市场等价 ${resolved.marketEquivalent} 不变。`,
                            )
                            .join(' ')}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
              <div
                className="settlement-calculation-line"
                aria-label="本房积分计算"
                title="数值按显示精度四舍五入，以原结算记录为准"
              >
                <span>
                  计分小计 <strong>{subtotal.toFixed(scoreDecimals)}</strong>
                </span>
                <span>
                  × 本房倍率{' '}
                  <strong>
                    {(humanBreakdown?.multiplier ?? 1).toFixed(3)}
                  </strong>
                </span>
                <span>→</span>
                {humanScore.retroactiveScore !== 0 && (
                  <>
                    <span>
                      倍率后{' '}
                      <strong>
                        {humanScore.initialScore.toFixed(scoreDecimals)}
                      </strong>
                    </span>
                    <span>
                      ＋ 追溯追加{' '}
                      <strong>
                        {humanScore.retroactiveScore.toFixed(scoreDecimals)}
                      </strong>
                    </span>
                    <span>→</span>
                  </>
                )}
                <span>
                  本房积分{' '}
                  <strong>
                    {humanScore.finalScore.toFixed(scoreDecimals)}
                  </strong>
                </span>
              </div>
              <ul className="settlement-effect-notes">
                {[
                  ...new Set(
                    (humanBreakdown?.triggers ?? [])
                      .filter(
                        (trigger) => trigger.kind !== 'scoring_adjustment',
                      )
                      .map(
                        (trigger) =>
                          `${getItemDefinition(trigger.itemId).name}：${({ additive_score: `单次加算 ${trigger.amount ?? 0} 分`, multiplier_applied: '计入本房倍率', boss_multiplier_applied: '本房倍率增益', double_score: '积分翻倍', clear_score: '积分清零' } as Record<string, string>)[trigger.kind] ?? '触发计分效果'}`,
                      ),
                  ),
                ].map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
              <EventNotes
                events={humanEvents.filter(
                  (event) =>
                    event.type === 'trigger' ||
                    (event.type === 'score' &&
                      event.itemId !== undefined &&
                      event.amount !== 0),
                )}
              />
              {(refunded !== 0 ||
                otherMoney !== 0 ||
                humanEvents.some((event) => event.type === 'money')) && (
                <div className="settlement-fund-notes">
                  <h4>资金效果</h4>
                  <EventNotes
                    events={humanEvents.filter(
                      (event) =>
                        event.type === 'refund' || event.type === 'money',
                    )}
                  />
                </div>
              )}
              {humanBreakdown?.cleared && (
                <p className="score-cleared">本房间积分因道具效果被清零。</p>
              )}
            </div>
          </details>

          <details
            className="result-market-details settlement-detail"
            onToggle={(event) => setMarketOpen(event.currentTarget.open)}
          >
            <summary>本房共同市场 · 查看已公开行动</summary>
            {marketOpen && (
              <ReplayMarket
                compact
                record={{ settlement }}
                playerId={game.humanPlayerId}
                name={playerName}
                radius={cooperationRadius}
              />
            )}
          </details>
        </div>
        <footer className="settlement-lifecycle" aria-label="对局操作">
          {lifecycleActions ?? navigation?.lifecycleActions}
        </footer>
      </section>
    </Container>
  );
}

function ResultLine({
  label,
  values,
}: {
  label: string;
  values: { name: string; badge?: string }[];
}) {
  return (
    <div className="result-line">
      <span>{label}</span>
      <strong
        aria-label={values
          .map(
            (value) => `${value.name}${value.badge ? ` ${value.badge}` : ''}`,
          )
          .join('、')}
      >
        {values.length
          ? values.map((value, index) => (
              <span className="settlement-person" key={index}>
                {value.name}
                {value.badge && <em>{value.badge}</em>}
              </span>
            ))
          : '无'}
      </strong>
    </div>
  );
}
function EventNotes({ events }: { events: readonly SettlementEvent[] }) {
  if (!events.length) return null;
  return (
    <ul className="settlement-effect-notes">
      {events.map((event, index) => (
        <li key={`${event.type}-${index}`}>
          {displayItemText(
            event.itemId
              ? event.message.replaceAll(
                  event.itemId,
                  getItemDefinition(event.itemId).name,
                )
              : event.message,
          )}
        </li>
      ))}
    </ul>
  );
}
