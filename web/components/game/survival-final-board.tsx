import { useState } from 'react';
import type { AiClientProfile } from '@/lib/game/client-runtime';
import type { SurvivalReplayLog } from '@/lib/ui/survival-record';
import type {
  SurvivalBoardModel,
  SurvivalBoardRow,
} from '@/lib/ui/survival-board';
import { classicFinalGapLabel } from './classic-final-ranking';
import { FinalPlayerRanking } from './final-player-ranking';
import { SurvivalScoreBoard } from './survival-score-board';

/** Final placement includes survival priority; a point gap cannot override it. */
export function survivalFinalGapLabel(
  row: SurvivalBoardRow,
  previous: SurvivalBoardRow | undefined,
  decimals: 2 | 4,
) {
  if (!previous) return '最终第1名';
  if (row.active !== previous.active) return '存活状态优先排序';
  if (
    !row.active &&
    row.eliminationFloorIndex !== previous.eliminationFloorIndex
  )
    return '淘汰层数优先排序';
  return classicFinalGapLabel(row.total, previous.total, decimals);
}

export function SurvivalFinalBoard({
  log,
  model,
  decimals,
  aiProfiles,
}: {
  log: SurvivalReplayLog;
  model: SurvivalBoardModel;
  decimals: 2 | 4;
  aiProfiles?: Readonly<Record<string, AiClientProfile>>;
}) {
  const [view, setView] = useState<'players' | 'floors'>('players');
  const finalPlayers = new Map(
    log.final?.players.map((player) => [player.id, player]),
  );
  const tabs = (
    <nav className="survival-final-tabs" aria-label="生存终局榜单视图">
      <button
        type="button"
        aria-pressed={view === 'players'}
        onClick={() => setView('players')}
      >
        玩家与构筑
      </button>
      <button
        type="button"
        aria-pressed={view === 'floors'}
        onClick={() => setView('floors')}
      >
        分层成绩
      </button>
    </nav>
  );
  return (
    <div className="survival-final-board" data-final-view={view}>
      {view === 'players' ? (
        <FinalPlayerRanking
          title="生存总榜"
          scoreLabel="累计积分"
          caption="生存最终排行"
          scoreNote="存活／淘汰层数优先，累计不含继承"
          scoreDecimals={decimals}
          tools={tabs}
          rows={model.rows.map((row, index) => ({
            playerId: row.playerId,
            rank: row.rank,
            name: row.name,
            isHuman: row.playerId === 'human',
            finalScore: row.total,
            player: finalPlayers.get(row.playerId),
            profile: aiProfiles?.[row.playerId],
            status: { label: row.statusLabel, active: row.active },
            gapLabel: survivalFinalGapLabel(
              row,
              model.rows[index - 1],
              decimals,
            ),
          }))}
        />
      ) : (
        <>
          {tabs}
          <SurvivalScoreBoard
            model={model}
            decimals={decimals}
            embedded
            selfSummaryOutside
          />
        </>
      )}
    </div>
  );
}
