import { useContext } from 'react';
import { SettlementNavigationContext } from './settlement-navigation';
import { GameHeader } from './game-header';
import { Coins, Crown, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { LocateSelfButton, RankingScrollArea } from './ranking-self-summary';
import type { ScoreDisplayDecimals } from '@/lib/ui/game-preferences';
import {
  aiPersonalityNames,
  characterNames,
  type ActiveClientGameState,
  type AiDoctrine,
} from '@/lib/game';

interface GameResultProps {
  embedded?: boolean;
  game: ActiveClientGameState;
  onRestart: () => void;
  scoreDecimals?: ScoreDisplayDecimals;
}

const doctrineNames: Readonly<Record<AiDoctrine, string>> = {
  balanced: '均衡主义',
  cooperative: '合作主义',
  chaotic: '混乱主义',
};

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
        <section
          className="classic-final-outcomes"
          aria-label="你的经典最终结果"
        >
          <article>
            <span>你的最终名次</span>
            <strong className="complete-main-value">#{humanRank}</strong>
            <small>按本局已记录的最终顺序</small>
          </article>
          <article>
            <span>最终积分</span>
            <strong className="complete-main-value" data-classic-final-score>
              {(humanEntry?.finalScore ?? 0).toFixed(scoreDecimals)}
            </strong>
            <small>已包含整局倍率，不再重复乘算</small>
          </article>
          <article>
            <span>你的最终构筑</span>
            <strong className="classic-final-build">
              {human?.items.length ?? 0} 件道具 · {human?.money ?? 0} 资金
            </strong>
            <small>
              {human?.characterId ? characterNames[human.characterId] : '—'}
            </small>
          </article>
          <div className="final-actions">
            <Button type="button" size="lg" onClick={onRestart}>
              <RotateCcw aria-hidden="true" />
              重新开始
            </Button>
          </div>
        </section>
        <div className="podium-grid">
          {game.finalRanking.slice(0, 3).map((entry, index) => {
            const player = playerById.get(entry.playerId);
            return (
              <article
                key={entry.playerId}
                className={`podium-card podium-${index + 1}`}
              >
                <span className="podium-rank">#{index + 1}</span>

                <h3>{playerName(entry.playerId)}</h3>
                <p>
                  {player?.characterId
                    ? characterNames[player.characterId]
                    : '未知角色'}
                </p>
                <strong>{entry.finalScore.toFixed(scoreDecimals)}</strong>
                <small>
                  {player?.items.length ?? 0} 件道具 · {player?.money ?? 0} 资金
                </small>
              </article>
            );
          })}
        </div>

        <section
          className="result-panel final-ranking-panel"
          data-ranking-scope
        >
          <div className="result-panel-heading">
            <div>
              <h3>完整排行</h3>
            </div>
            <div className="final-ranking-tools">
              <span>最终积分已含整局倍率；按已记录的最终名次展示</span>
              <LocateSelfButton />
            </div>
          </div>
          <RankingScrollArea
            className="result-table-wrap ranking-data-scroll"
            label="完整最终排行表"
          >
            <table
              className="result-table final-table"
              aria-label="整局最终排行"
            >
              <thead>
                <tr>
                  <th scope="col">排名</th>
                  <th scope="col">玩家</th>
                  <th scope="col" className="ranking-metric-primary">
                    最终积分
                  </th>
                  <th scope="col" className="ranking-number">
                    剩余资金
                  </th>
                  <th scope="col" className="ranking-number">
                    道具数量
                  </th>
                  <th scope="col">AI信息</th>
                </tr>
              </thead>
              <tbody>
                {game.finalRanking.map((entry, index) => {
                  const player = playerById.get(entry.playerId);
                  const profile = game.aiProfiles[entry.playerId];
                  return (
                    <tr
                      key={entry.playerId}
                      data-player-id={entry.playerId}
                      data-rank={index + 1}
                      className={
                        entry.playerId === game.humanPlayerId
                          ? 'result-self-row'
                          : ''
                      }
                      data-ranking-self={entry.playerId === game.humanPlayerId}
                      tabIndex={
                        entry.playerId === game.humanPlayerId ? -1 : undefined
                      }
                    >
                      <td>
                        <span className="ranking-position">{index + 1}</span>
                      </td>
                      <th scope="row" className="ranking-player-cell">
                        <strong>{playerName(entry.playerId)}</strong>
                        {entry.playerId === game.humanPlayerId && (
                          <em className="ranking-self-badge">本人</em>
                        )}
                        <small>
                          {player?.characterId
                            ? characterNames[player.characterId]
                            : '—'}
                        </small>
                      </th>
                      <td
                        className="ranking-metric-primary"
                        title={String(entry.finalScore)}
                      >
                        <strong>
                          {entry.finalScore.toFixed(scoreDecimals)}
                        </strong>
                      </td>
                      <td className="ranking-number">
                        <span className="money-cell">
                          <Coins aria-hidden="true" />
                          {player?.money ?? 0}
                        </span>
                      </td>
                      <td className="ranking-number">
                        {player?.items.length ?? 0}
                      </td>
                      <td className="ranking-profile-cell">
                        {profile ? (
                          <details>
                            <summary>{doctrineNames[profile.doctrine]}</summary>
                            <p>
                              人格：
                              {profile.personalities
                                .map(
                                  (personality) =>
                                    aiPersonalityNames[personality],
                                )
                                .join('、') || '—'}
                            </p>
                          </details>
                        ) : (
                          '真人玩家'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </RankingScrollArea>
        </section>

        <footer className="settlement-lifecycle classic-final-lifecycle">
          {navigation?.lifecycleActions}
        </footer>
      </section>
    </Container>
  );
}
