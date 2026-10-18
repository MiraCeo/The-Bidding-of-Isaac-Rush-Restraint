import { useState } from 'react';
import { PlayerRankingTable } from './player-ranking-table';
import { RankingSelfSummary } from './ranking-self-summary';

import type { ActiveClientGameState } from '@/lib/game/client-session';
import type { ScoreDisplayDecimals } from '@/lib/ui/game-preferences';
import {
  getPublicPlayerRanking,
  type PublicRankingView,
} from '@/lib/ui/public-ranking';

interface PublicRankingProps {
  game?: ActiveClientGameState;
  scoreDecimals: ScoreDisplayDecimals;
}

export function PublicRanking({ game, scoreDecimals }: PublicRankingProps) {
  const [view, setView] = useState<PublicRankingView>('score');
  if (!game) {
    return (
      <section className="result-panel ranking-page-panel empty-ranking-state">
        <h3>暂无排行</h3>
        <p>
          尚未开始对局。选择角色并开始游戏后，这里会显示本局积分与资金排行。
        </p>
      </section>
    );
  }
  const ranking = getPublicPlayerRanking(game, view);
  const human = ranking.find((entry) => entry.isHuman);
  return (
    <div data-ranking-scope data-ranking-polish="public-table">
      <div className="public-ranking-heading">
        <div className="ranking-view-tabs" aria-label="公开排行类型">
          <button
            type="button"
            className={view === 'score' ? 'ranking-view-tab-active' : ''}
            aria-pressed={view === 'score'}
            onClick={() => setView('score')}
          >
            积分排行
          </button>
          <button
            type="button"
            className={view === 'money' ? 'ranking-view-tab-active' : ''}
            aria-pressed={view === 'money'}
            onClick={() => setView('money')}
          >
            资金排行
          </button>
        </div>
        <RankingSelfSummary
          label={`你的${view === 'score' ? '积分' : '资金'}排名`}
          rank={human?.rank}
        >
          {human &&
            (view === 'score'
              ? `${human.score.toFixed(scoreDecimals)} 分`
              : `${human.money} 资金`)}
        </RankingSelfSummary>
      </div>
      <p className="ranking-basis">
        {view === 'score'
          ? '累计积分降序 · 未含终局倍率'
          : '当前资金降序 · 非竞价能力'}
        {' · 相同数值并列 · 本房行动结算后公开'}
      </p>
      <PlayerRankingTable
        entries={ranking}
        scoreDecimals={scoreDecimals}
        caption={`当前公开${view === 'score' ? '积分' : '资金'}排行`}
        primaryMetric={view}
      />
    </div>
  );
}
