import type { SurvivalFloorRecord } from '@/lib/game/survival-session';
import type { SurvivalReplayLog } from '@/lib/ui/survival-record';
import { RankingScrollArea } from './ranking-self-summary';

/** Keep the existing ledger order, including the original stable order of ties. */
export function orderedFloorPlayers(floor: SurvivalFloorRecord): string[] {
  return floor.activePlayerIds
    .slice()
    .sort(
      (left, right) =>
        floor.scores[right]!.survivalScore - floor.scores[left]!.survivalScore,
    );
}

export function SurvivalFloorPlayers({
  log,
  index,
  decimals = 2,
}: {
  log: SurvivalReplayLog;
  index: number;
  decimals?: 2 | 4;
}) {
  const floor = log.floors[index];
  if (!floor) return null;
  return (
    <RankingScrollArea
      className="floor-ledger-scroll floor-player-scroll"
      label="本层完整结算账本"
    >
      <ol className="floor-player-grid" aria-label="按本层生存分排列的玩家结果">
        {orderedFloorPlayers(floor).map((id, position) => {
          const score = floor.scores[id]!;
          const removed = floor.plan.eliminations.find(
            (entry) => entry.playerId === id,
          );
          const verdict = removed
            ? removed.reason === 'below_cut_line'
              ? '线下淘汰'
              : '末位补淘汰'
            : '存活';
          const margin = score.survivalScore - floor.cutLine;
          const fields = [
            ['roomScore', '房间分', score.roomScore],
            ['exchangedScore', '余额兑换', score.exchangedScore],
            ['inheritedScore', '继承分', score.inheritedScore],
            ['newScore', '新增积分', score.newScore],
            ['margin', '距斩杀线', margin],
          ] as const;
          return (
            <li
              key={id}
              className="floor-player-card"
              data-player-id={id}
              data-floor-position={position + 1}
              data-top-place={position < 3 ? position + 1 : undefined}
              data-ranking-self={id === 'human'}
              tabIndex={id === 'human' ? -1 : undefined}
            >
              <header className="floor-card-head">
                <span
                  className="floor-card-position"
                  aria-label={`本层第 ${position + 1} 位`}
                >
                  {position + 1}
                </span>
                <h3 className="floor-player-name">
                  <span data-floor-field="name">{log.playerNames[id]}</span>
                  {id === 'human' && (
                    <em className="ranking-self-badge">本人</em>
                  )}
                </h3>
                <div className="floor-card-score">
                  <small>生存分 S</small>
                  <strong data-floor-field="survivalScore">
                    {score.survivalScore.toFixed(decimals)}
                  </strong>
                </div>
                <span
                  className={`floor-card-verdict ${removed ? 'is-out' : 'is-alive'}`}
                  data-floor-field="verdict"
                >
                  {verdict}
                </span>
              </header>
              <dl className="floor-card-metrics">
                {fields.map(([key, label, value]) => (
                  <div
                    key={key}
                    className={
                      key === 'margin'
                        ? margin < 0
                          ? 'negative-margin'
                          : 'positive-margin'
                        : key
                    }
                  >
                    <dt>{label}</dt>
                    <dd
                      data-floor-field={key}
                      data-zero={value === 0 || undefined}
                      data-floor-value={value.toFixed(decimals)}
                    >
                      {key === 'margin' && value >= 0 ? '+' : ''}
                      {value.toFixed(decimals)}
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ol>
    </RankingScrollArea>
  );
}
