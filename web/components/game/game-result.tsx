import { Coins, Crown, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  aiPersonalityNames,
  characterNames,
  type ActiveClientGameState,
  type AiDoctrine,
} from '@/lib/game';

interface GameResultProps {
  game: ActiveClientGameState;
  onRestart: () => void;
}

const doctrineNames: Readonly<Record<AiDoctrine, string>> = {
  balanced: '均衡主义',
  cooperative: '合作主义',
  chaotic: '混乱主义',
};

export function GameResult({ game, onRestart }: GameResultProps) {
  const playerById = new Map(game.players.map((player) => [player.id, player]));
  const playerName = (playerId: string) => playerId === game.humanPlayerId
    ? '你'
    : game.aiProfiles[playerId]?.name ?? playerId;
  const humanRank = game.finalRanking.findIndex((entry) => entry.playerId === game.humanPlayerId) + 1;
  const humanEntry = game.finalRanking.find((entry) => entry.playerId === game.humanPlayerId);

  return (
    <main className="final-page">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-block"><p className="eyebrow">THE BIDDING OF ISAAC</p><h1>以撒的竞合：冲 · 慎</h1></div>
          <div className="result-header-title"><span>三层 · 十五房间</span><strong>最终结算</strong></div>
          <div className="round-status"><span className="status-chip"><Crown aria-hidden="true" />挑战完成</span></div>
        </div>
      </header>

      <section className="final-stage">
        <div className="final-hero">
          <p className="eyebrow">FINAL RANKING</p>
          <h2>本局最终排行</h2>
          <p>你以 <strong>{humanEntry?.finalScore.toFixed(2) ?? '0.00'}</strong> 分位列第 <strong>{humanRank}</strong> 名。</p>
        </div>

        <div className="podium-grid">
          {game.finalRanking.slice(0, 3).map((entry, index) => {
            const player = playerById.get(entry.playerId);
            return (
              <article key={entry.playerId} className={`podium-card podium-${index + 1}`}>
                <span className="podium-rank">#{index + 1}</span>
                <span className="podium-avatar" aria-hidden="true">{playerName(entry.playerId).slice(0, 1)}</span>
                <h3>{playerName(entry.playerId)}</h3>
                <p>{player?.characterId ? characterNames[player.characterId] : '未知角色'}</p>
                <strong>{entry.finalScore.toFixed(2)}</strong>
                <small>{player?.items.length ?? 0} 件道具 · {player?.money ?? 0} 资金</small>
              </article>
            );
          })}
        </div>

        <section className="result-panel final-ranking-panel">
          <div className="result-panel-heading"><div><p className="eyebrow">ALL PLAYERS</p><h2>完整排行</h2></div><span>结算分包含黑王子之冠等整局倍率</span></div>
          <div className="result-table-wrap">
            <table className="result-table final-table">
              <thead><tr><th>排名</th><th>玩家</th><th>角色</th><th>主义</th><th>人格</th><th>道具数量</th><th>剩余资金</th><th>最终积分</th></tr></thead>
              <tbody>
                {game.finalRanking.map((entry, index) => {
                  const player = playerById.get(entry.playerId);
                  const profile = game.aiProfiles[entry.playerId];
                  return (
                    <tr key={entry.playerId} className={entry.playerId === game.humanPlayerId ? 'result-self-row' : ''}>
                      <td>{index + 1}</td>
                      <td><strong>{playerName(entry.playerId)}</strong></td>
                      <td>{player?.characterId ? characterNames[player.characterId] : '—'}</td>
                      <td>{profile ? doctrineNames[profile.doctrine] : '真人玩家'}</td>
                      <td>{profile ? profile.personalities.map((personality) => aiPersonalityNames[personality]).join('、') : '—'}</td>
                      <td>{player?.items.length ?? 0}</td>
                      <td><span className="money-cell"><Coins aria-hidden="true" />{player?.money ?? 0}</span></td>
                      <td><strong>{entry.finalScore.toFixed(2)}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="final-actions">
          <Button type="button" size="lg" onClick={onRestart}><RotateCcw aria-hidden="true" />重新开始</Button>
        </footer>
      </section>
    </main>
  );
}
