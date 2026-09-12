import { ArrowRight, Coins } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  characterNames,
  defaultRules,
  getItemDefinition,
  itemPresentations,
  type ActiveClientGameState,
  type ClientRankingView,
  type PlayerAction,
} from '@/lib/game';

interface RoomResultProps {
  game: ActiveClientGameState;
  onShowRanking: (view: ClientRankingView) => void;
  onAdvance: () => void;
}

const roomKindNames = {
  normal: '普通房', treasure: '宝箱房', shop: '商店', hidden: '隐藏房', boss: 'BOSS 房',
} as const;

function actionLabel(action: PlayerAction): string {
  if (action.type === 'withdraw') return '静观其变';
  return `${action.type === 'bid' ? '竞拍' : '扰乱'} ${action.group} · ${action.amount}`;
}

export function RoomResult({ game, onShowRanking, onAdvance }: RoomResultProps) {
  const settlement = game.roomSettlement;
  if (!settlement) throw new Error('结算页面缺少房间结算记录。');
  const humanBefore = settlement.playersBefore.find((player) => player.id === game.humanPlayerId);
  const humanAfter = settlement.players.find((player) => player.id === game.humanPlayerId);
  if (!humanBefore || !humanAfter) throw new Error('结算记录缺少真人玩家。');

  const playerName = (playerId: string) => playerId === game.humanPlayerId
    ? '你'
    : game.aiProfiles[playerId]?.name ?? playerId;
  const humanBreakdown = settlement.scoreBreakdowns[game.humanPlayerId];
  const humanResolved = settlement.resolvedActions.filter((action) => action.playerId === game.humanPlayerId);
  const humanEvents = settlement.events.filter((event) => event.playerId === game.humanPlayerId);
  const humanAwards = settlement.awards.filter((award) => award.playerId === game.humanPlayerId);
  const floorMoney = defaultRules.floorStartingMoney[game.floorIndex]!;
  const cooperationRadius = floorMoney * defaultRules.cooperationZoneRatio;
  const isFinalRoom = game.floorIndex === game.rooms.length - 1 &&
    game.roomIndex === game.rooms[game.floorIndex]!.length - 1;

  return (
    <main className="result-page">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-block"><p className="eyebrow">THE BIDDING OF ISAAC</p><h1>以撒的竞合：冲 · 慎</h1></div>
          <div className="result-header-title"><span>{roomKindNames[settlement.room.kind]}</span><strong>房间结算</strong></div>
          <div className="round-status">
            <span className="status-chip">第 {game.floorIndex + 1} 层 · 房间 {game.roomIndex + 1}/5</span>
            <span className="status-chip status-chip-money"><Coins aria-hidden="true" /><strong>{humanAfter.money}</strong></span>
          </div>
        </div>
      </header>

      <section className="result-stage">
        <div className="result-summary-grid">
          <article><span>共同基准线</span><strong>{settlement.baseline?.target.toFixed(2) ?? '无市场样本'}</strong><small>{settlement.baseline ? `均值 ${settlement.baseline.meanMarketBid.toFixed(2)} + 常量 ${settlement.baseline.floorConstant.toFixed(2)}` : '本房间无人参与市场'}</small></article>
          <article><span>合作区</span><strong>{settlement.baseline ? `${Math.max(0, settlement.baseline.target - cooperationRadius).toFixed(2)} – ${(settlement.baseline.target + cooperationRadius).toFixed(2)}` : '—'}</strong><small>基准线上下各 {cooperationRadius} 范围</small></article>
          <article><span>本房积分</span><strong className="summary-score">+{(humanAfter.score - humanBefore.score).toFixed(2)}</strong><small>当前总分 {humanAfter.score.toFixed(2)}</small></article>
          <article><span>资金变化</span><strong className={humanAfter.money - humanBefore.money < 0 ? 'summary-negative' : 'summary-score'}>{humanAfter.money - humanBefore.money >= 0 ? '+' : ''}{humanAfter.money - humanBefore.money}</strong><small>{humanBefore.money} → {humanAfter.money}</small></article>
        </div>

        {humanAwards.length > 0 && (
          <section className="reward-acquired-banner" aria-label="本房间获得的道具">
            <span className="reward-acquired-label">获得道具</span>
            {humanAwards.map((award) => (
              <div key={`${award.group}-${award.itemId}`}>
                <span className="reward-acquired-emoji" aria-hidden="true">{itemPresentations[award.itemId].emoji}</span>
                <span><small>道具 {award.group}</small><strong>{getItemDefinition(award.itemId).name}{award.copies > 1 ? ` ×${award.copies}` : ''}</strong></span>
              </div>
            ))}
          </section>
        )}

        <div className="result-main-grid result-main-grid-reversed">
          <section className="result-panel reward-settlement">
            <div className="result-panel-heading"><div><p className="eyebrow">REWARD RIGHTS</p><h2>道具资格与发放</h2></div></div>
            <div className="settled-rewards">
              {settlement.room.rewards.map((reward) => {
                const definition = getItemDefinition(reward.itemId);
                const high = settlement.highPricePlacements.filter((entry) => entry.group === reward.group);
                const cooperation = settlement.cooperationPlacements.filter((entry) => entry.group === reward.group);
                const awards = settlement.awards.filter((entry) => entry.group === reward.group);
                const humanAward = awards.find((entry) => entry.playerId === game.humanPlayerId);
                return (
                  <article key={reward.group} className={humanAward ? 'settled-reward-earned' : ''}>
                    {humanAward && <span className="earned-badge">你已获得{humanAward.copies > 1 ? ` ×${humanAward.copies}` : ''}</span>}
                    <div className="settled-reward-title"><span>{itemPresentations[reward.itemId].emoji}</span><div><small>道具 {reward.group}</small><h3>{definition.name}</h3></div></div>
                    <ResultLine label="最高价名额" values={high.map((entry) => `${playerName(entry.playerId)}${entry.actionType === 'disrupt' ? '（扰乱占据）' : ''}`)} />
                    <ResultLine label="合作区名额" values={cooperation.map((entry) => `${playerName(entry.playerId)}${entry.actionType === 'disrupt' ? '（扰乱占据）' : ''}`)} />
                    <ResultLine label="最终发放" values={awards.map((entry) => `${playerName(entry.playerId)}${entry.copies > 1 ? ` ×${entry.copies}` : ''}`)} />
                  </article>
                );
              })}
            </div>
          </section>

          <section className="result-panel player-settlement">
            <div className="result-panel-heading"><div><p className="eyebrow">YOUR SETTLEMENT</p><h2>你的行动与积分</h2></div><strong>{characterNames[game.selectedCharacter]}</strong></div>
            <div className="resolved-action-list">
              {humanResolved.map((resolved) => {
                const score = humanBreakdown?.actions.find((entry) => entry.actionIndex === resolved.actionIndex);
                return (
                  <article key={resolved.actionIndex}>
                    <div><strong>{actionLabel(resolved.action)}</strong><span>行动 {resolved.actionIndex + 1}</span></div>
                    <dl>
                      <div><dt>实际扣款</dt><dd>{resolved.actualCost}</dd></div>
                      <div><dt>市场等价</dt><dd>{resolved.marketEquivalent ?? '—'}</dd></div>
                      <div><dt>计分等价</dt><dd>{score?.scoringValue ?? resolved.scoringEquivalent ?? '—'}</dd></div>
                      <div><dt>基础积分</dt><dd>{score?.baseScore.toFixed(2) ?? '0.00'}</dd></div>
                      <div><dt>加算积分</dt><dd>{score?.additiveScore.toFixed(2) ?? '0.00'}</dd></div>
                    </dl>
                  </article>
                );
              })}
            </div>
            <div className="score-total-row"><span>积分乘算倍率</span><strong>×{humanBreakdown?.multiplier.toFixed(3) ?? '0.000'}</strong><span>最终房间积分</span><strong>{humanBreakdown?.score.toFixed(2) ?? '0.00'}</strong></div>
            {humanBreakdown?.cleared && <p className="score-cleared">本房间积分因道具效果被清零。</p>}
          </section>
        </div>

        <section className="result-panel event-panel">
          <div className="result-panel-heading"><div><p className="eyebrow">EFFECT LOG</p><h2>你的结算事件</h2></div><span>{humanEvents.length} 项</span></div>
          <div className="event-list">
            {humanEvents.length === 0
              ? <p className="empty-result">本房间没有与你相关的额外事件。</p>
              : humanEvents.map((event, index) => <span key={`${event.type}-${index}`}>{event.message}</span>)}
          </div>
        </section>

        <footer className="result-actions">
          <div className="result-actions-copy"><span>本房间结算已经完成</span><strong>查看榜单，或直接继续游戏</strong></div>
          <div className="result-action-buttons">
            <Button type="button" size="lg" variant="outline" onClick={() => onShowRanking('score')}>积分排行</Button>
            <Button type="button" size="lg" variant="outline" onClick={() => onShowRanking('contest')}>争夺榜</Button>
            <Button type="button" size="lg" onClick={onAdvance}>{isFinalRoom ? '最终排行' : '进入下一房间'}<ArrowRight aria-hidden="true" /></Button>
          </div>
        </footer>
      </section>
    </main>
  );
}

function ResultLine({ label, values }: { label: string; values: string[] }) {
  return <div className="result-line"><span>{label}</span><strong>{values.length > 0 ? values.join('、') : '无'}</strong></div>;
}
