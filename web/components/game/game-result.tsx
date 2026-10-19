import { useContext } from 'react';
import { SettlementNavigationContext } from './settlement-navigation';
import { GameHeader } from './game-header';
import { CharacterArt } from './character-art';
import { Crown, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ClassicFinalRanking } from './classic-final-ranking';
import type { ScoreDisplayDecimals } from '@/lib/ui/game-preferences';
import { characterNames, type ActiveClientGameState } from '@/lib/game';

interface GameResultProps {
  embedded?: boolean;
  game: ActiveClientGameState;
  onRestart: () => void;
  scoreDecimals?: ScoreDisplayDecimals;
}

export function GameResult({
  game,
  onRestart,
  scoreDecimals = 2,
  embedded = false,
}: GameResultProps) {
  const navigation = useContext(SettlementNavigationContext);
  const human = game.players.find((p) => p.id === game.humanPlayerId);
  const Container = embedded ? 'div' : 'main';
  const playerById = new Map(game.players.map((player) => [player.id, player]));
  const playerName = (playerId: string) =>
    playerId === game.humanPlayerId
      ? '你'
      : (game.aiProfiles[playerId]?.name ?? playerId);
  const humanRank =
    game.finalRanking.findIndex(
      (entry) => entry.playerId === game.humanPlayerId,
    ) + 1;
  const humanEntry = game.finalRanking.find(
    (entry) => entry.playerId === game.humanPlayerId,
  );

  return (
    <Container className="final-page">
      {!embedded && (
        <GameHeader
          navigation={
            <div className="result-header-title">
              <span>三层 · 十五房间</span>
              <strong>最终结算</strong>
            </div>
          }
          context={
            <>
              <div className="round-status">
                <span className="status-chip">
                  <Crown aria-hidden="true" />
                  挑战完成
                </span>
              </div>
            </>
          }
        />
      )}

      <section
        className="final-stage classic-final"
        data-ranking-layout="classic-final"
        data-ranking-polish="classic-final"
      >
        <header className="settlement-heading">
          <div>
            <p className="eyebrow">FINAL RANKING</p>
            <h2>
              经典结算 <small>三层 · 十五房间已完成</small>
            </h2>
          </div>
          <nav aria-label="终局辅助操作">{navigation?.auxiliaryActions}</nav>
        </header>
        <div className="classic-final-layout">
          <aside
            className="classic-final-showcase"
            aria-label="个人成绩与领奖台"
          >
            <section
              className="classic-final-outcomes"
              aria-label="你的经典最终结果"
            >
              <article>
                <span>你的最终名次</span>
                <strong className="complete-main-value">#{humanRank}</strong>
              </article>
              <article>
                <span>最终积分</span>
                <strong
                  className="complete-main-value"
                  data-classic-final-score
                >
                  {(humanEntry?.finalScore ?? 0).toFixed(scoreDecimals)}
                </strong>
              </article>
              <div className="classic-final-build">
                <span>
                  {human?.characterId ? characterNames[human.characterId] : '—'}
                </span>
                <span>
                  {human?.items.length ?? 0} 件道具 · {human?.money ?? 0} 资金
                </span>
              </div>
            </section>
            <section
              className="classic-final-awards"
              aria-label="本局前三名领奖台"
            >
              <h3>
                <Crown aria-hidden="true" />
                本局领奖台
              </h3>
              <div className="podium-grid">
                {game.finalRanking.slice(0, 3).map((entry, index) => {
                  const player = playerById.get(entry.playerId);
                  return (
                    <article
                      key={entry.playerId}
                      className={`podium-card podium-${index + 1}`}
                      data-podium-player={entry.playerId}
                      aria-label={`第${index + 1}名 ${playerName(entry.playerId)}`}
                    >
                      <div className="podium-model">
                        {player?.characterId && (
                          <CharacterArt characterId={player.characterId} />
                        )}
                      </div>
                      <div className="podium-step">
                        <span className="podium-rank">{index + 1}</span>
                      </div>
                      <h3>{playerName(entry.playerId)}</h3>
                      <p>
                        {player?.characterId
                          ? characterNames[player.characterId]
                          : '未知角色'}
                      </p>
                      <strong>{entry.finalScore.toFixed(scoreDecimals)}</strong>
                      <small>
                        {player?.items.length ?? 0} 件道具 ·{' '}
                        {player?.money ?? 0} 资金
                      </small>
                    </article>
                  );
                })}
              </div>
            </section>
          </aside>

          <ClassicFinalRanking game={game} scoreDecimals={scoreDecimals} />
        </div>
        <footer className="settlement-lifecycle classic-final-lifecycle">
          {navigation?.lifecycleActions}
          <div className="final-actions">
            <Button type="button" size="lg" onClick={onRestart}>
              <RotateCcw aria-hidden="true" />
              重新开始
            </Button>
          </div>
        </footer>
      </section>
    </Container>
  );
}
