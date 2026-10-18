import type { ClientRoomSettlementRecord } from '@/lib/game/client-session';
import type { PlayerAction } from '@/lib/game/types';
import type { ScoreDisplayDecimals } from '@/lib/ui/game-preferences';
import type { PublicRankingEntry } from '@/lib/ui/public-ranking';
import { RankingScrollArea } from './ranking-self-summary';

interface PlayerRankingTableProps {
  entries: readonly PublicRankingEntry[];
  scoreDecimals: ScoreDisplayDecimals;
  caption: string;
  settlement?: ClientRoomSettlementRecord;
  primaryMetric?: 'score' | 'money';
  scoreLabel?: string;
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
  primaryMetric = 'score',
  scoreLabel = '累计积分',
}: PlayerRankingTableProps) {
  const moneyFirst = primaryMetric === 'money';
  return (
    <section className="result-panel round-ranking-panel ranking-page-panel">
      <RankingScrollArea
        className="result-table-wrap ranking-data-scroll"
        label={caption}
      >
        <table className="result-table ranking-table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{settlement ? '顺位' : '排名'}</th>
              <th scope="col">玩家</th>
              <th
                scope="col"
                className="ranking-metric-primary"
                aria-sort="descending"
              >
                {moneyFirst ? '当前资金' : scoreLabel}{' '}
                <span aria-hidden="true">↓</span>
              </th>
              <th scope="col" className="ranking-number">
                {moneyFirst ? scoreLabel : '剩余资金'}
              </th>
              {settlement && (
                <>
                  <th scope="col">本房积分</th>
                  <th scope="col">本房行动</th>
                  <th scope="col">获得道具</th>
                </>
              )}
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
                  data-player-id={entry.playerId}
                  className={entry.isHuman ? 'result-self-row' : ''}
                  data-ranking-self={entry.isHuman}
                  tabIndex={entry.isHuman ? -1 : undefined}
                >
                  <td>{entry.rank}</td>
                  <th scope="row" className="ranking-player-cell">
                    <strong>{entry.name}</strong>
                    {entry.isHuman && (
                      <em className="ranking-self-badge">本人</em>
                    )}
                    <small>{entry.characterName}</small>
                  </th>
                  <td
                    className="ranking-metric-primary"
                    title={String(moneyFirst ? entry.money : entry.score)}
                  >
                    <strong>
                      {moneyFirst
                        ? entry.money
                        : entry.score.toFixed(scoreDecimals)}
                    </strong>
                  </td>
                  <td
                    className="ranking-number"
                    title={String(moneyFirst ? entry.score : entry.money)}
                  >
                    {moneyFirst
                      ? entry.score.toFixed(scoreDecimals)
                      : entry.money}
                  </td>
                  {settlement && (
                    <>
                      <td className="ranking-number">
                        {gained >= 0 ? '+' : ''}
                        {gained.toFixed(scoreDecimals)}
                      </td>
                      <td className="ranking-action-cell">
                        {turn?.actions.map(actionLabel).join(' / ') ?? '—'}
                      </td>
                      <td className="ranking-number">
                        {copies > 0 ? `+${copies}` : '—'}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </RankingScrollArea>
    </section>
  );
}
