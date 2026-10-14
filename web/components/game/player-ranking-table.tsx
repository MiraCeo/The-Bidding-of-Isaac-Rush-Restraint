import type { ClientRoomSettlementRecord } from '@/lib/game/client-session';
import type { PlayerAction } from '@/lib/game/types';
import type { ScoreDisplayDecimals } from '@/lib/ui/game-preferences';
import type { PublicRankingEntry } from '@/lib/ui/public-ranking';

interface PlayerRankingTableProps {
  entries: readonly PublicRankingEntry[];
  scoreDecimals: ScoreDisplayDecimals;
  caption: string;
  settlement?: ClientRoomSettlementRecord;
}

function actionLabel(action: PlayerAction): string {
  if (action.type === 'withdraw') return '静观其变';
  return `${action.type === 'bid' ? '竞拍' : '扰乱'} ${action.group} · ${action.amount}`;
}

/** Both views use the existing ranking table; secret columns require a settlement. */
export function PlayerRankingTable({
  entries,
  scoreDecimals,
  caption,
  settlement,
}: PlayerRankingTableProps) {
  return (
    <section className="result-panel round-ranking-panel ranking-page-panel">
      <div className="result-table-wrap">
        <table className="result-table ranking-table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">排名</th>
              <th scope="col">玩家</th>
              <th scope="col">角色</th>
              {settlement && (
                <>
                  <th scope="col">本轮行动</th>
                  <th scope="col">本房积分</th>
                  <th scope="col">获得道具</th>
                </>
              )}
              <th scope="col">{settlement ? '总分' : '累计积分'}</th>
              <th scope="col">{settlement ? '资金' : '剩余资金'}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const turn = settlement?.turns.find(
                (candidate) => candidate.playerId === entry.playerId,
              );
              const gained = settlement
                ? entry.score -
                  (settlement.playersBefore.find(
                    (player) => player.id === entry.playerId,
                  )?.score ?? 0)
                : 0;
              const copies =
                settlement?.awards
                  .filter((award) => award.playerId === entry.playerId)
                  .reduce((sum, award) => sum + award.copies, 0) ?? 0;
              return (
                <tr
                  key={entry.playerId}
                  className={entry.isHuman ? 'result-self-row' : ''}
                >
                  <td>{entry.rank}</td>
                  <td>
                    <strong>{entry.name}</strong>
                  </td>
                  <td>{entry.characterName}</td>
                  {settlement && (
                    <>
                      <td>
                        {turn?.actions.map(actionLabel).join(' / ') ?? '—'}
                      </td>
                      <td>+{gained.toFixed(scoreDecimals)}</td>
                      <td>{copies > 0 ? `+${copies}` : '—'}</td>
                    </>
                  )}
                  <td>{entry.score.toFixed(scoreDecimals)}</td>
                  <td>{entry.money}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
