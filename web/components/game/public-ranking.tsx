import { useState } from 'react';
import { PlayerRankingTable } from './player-ranking-table';

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
    <div>
      <p className="utility-notice">
        累计积分未含终局倍率；本房行动与争夺结果在提交结算后公开。相同数值并列。
      </p>
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
        <p className="public-ranking-self">
          你的{view === 'score' ? '积分' : '资金'}排名{' '}
          <strong>#{human?.rank ?? '—'}</strong>
        </p>
      </div>
      <PlayerRankingTable
        entries={ranking}
        scoreDecimals={scoreDecimals}
        caption={`当前公开${view === 'score' ? '积分' : '资金'}排行`}
      />
    </div>
  );
}
