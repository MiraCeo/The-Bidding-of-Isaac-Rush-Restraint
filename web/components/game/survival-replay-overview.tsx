import { useMemo } from 'react';
import type { SurvivalReplayLog } from '@/lib/ui/survival-record';
import {
  survivalReplayDisplayLog,
  survivalReplayOverview,
  survivalReplayTimeline,
} from '@/lib/ui/survival-replay-display';
import { ReplayScoreTimeline } from './replay-score-timeline';
import { ReplayMoneyTimeline } from './replay-money-timeline';
import { replayRoomNames } from '@/lib/ui/replay-display';

export function SurvivalReplayOverview({
  log,
  playerId,
  index,
  decimals,
  onRoom,
  onPlayer,
  onReference,
}: {
  log: SurvivalReplayLog;
  playerId: string;
  index: number;
  decimals: 2 | 4;
  onRoom: (index: number, playerId?: string) => void;
  onPlayer: (id: string) => void;
  onReference: (index: number) => void;
}) {
  const display = useMemo(() => survivalReplayDisplayLog(log), [log]);
  const timeline = useMemo(() => survivalReplayTimeline(log), [log]);
  const overview = useMemo(
    () => survivalReplayOverview(log, playerId),
    [log, playerId],
  );
  const moneyLog = {
    ...display,
    rooms: display.rooms.filter((r) =>
      r.settlement.players.some((p) => p.id === playerId),
    ),
  };
  const ranking = timeline.series
    .map((s) => ({
      playerId: s.playerId,
      value: s.points[index + 1]?.value ?? 0,
      rank: 0,
    }))
    .sort((a, b) => b.value - a.value);
  ranking.forEach((r, i) => {
    r.rank = i + 1;
  });
  const score = (n: number) => n.toFixed(decimals),
    name = (id: string) => log.playerNames[id] ?? id;
  return (
    <section className="replay-overview-panel">
      <div className="replay-overview-metrics survival-overview-metrics">
        {[
          ['累计新增积分', score(overview.cumulative)],
          ['实际参与房间', overview.participatingRooms],
          ['总实际扣款', overview.cost],
          ['总返款', overview.refund],
          ['获奖道具份数', overview.awards],
        ].map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>
      <p className="utility-notice">
        {overview.final
          ? `最终第 ${overview.final.rank} 名 · ${overview.final.status === 'survived' ? '存活' : `第 ${overview.final.eliminationFloorIndex! + 1} 层淘汰`}`
          : '对局尚未结束，不预判最终存活或名次。'}{' '}
        累计分为房间分＋已结算层余额兑换，不重复累加继承。
      </p>
      <section className="replay-floor-totals">
        <h3>逐层生存表现 · {name(playerId)}</h3>
        <div>
          {Array.from(new Set(log.rooms.map((r) => r.room.floorIndex))).map(
            (floorIndex) => {
              const floor = log.floors.find((f) => f.floorIndex === floorIndex),
                fact = floor?.scores[playerId],
                removed = floor?.plan.eliminations.find(
                  (e) => e.playerId === playerId,
                ),
                rooms = log.rooms.filter(
                  (r) =>
                    r.room.floorIndex === floorIndex &&
                    r.activePlayerIds.includes(playerId),
                );
              return (
                <article key={floorIndex}>
                  <span>
                    第 {floorIndex + 1} 层 ·{' '}
                    {rooms.length ? `${rooms.length} 房` : '未参与'}
                  </span>
                  <strong>
                    {fact
                      ? score(fact.newScore)
                      : rooms.length
                        ? score(
                            rooms.reduce(
                              (sum, r) =>
                                sum +
                                r.roomScoreSummaries[playerId]!.finalScore,
                              0,
                            ),
                          )
                        : '—'}
                  </strong>
                  <small>
                    {fact
                      ? `S ${score(fact.survivalScore)} / 斩杀线 ${floor!.cutLine}`
                      : rooms.length
                        ? '进行中 · 已结算房间分'
                        : '淘汰后未参与'}
                  </small>
                  <small>
                    {removed
                      ? removed.reason === 'below_cut_line'
                        ? '线下淘汰'
                        : '末位补淘汰'
                      : fact
                        ? '存活'
                        : ''}
                  </small>
                </article>
              );
            },
          )}
        </div>
      </section>
      <ReplayScoreTimeline
        log={display}
        roomIndex={index}
        playerId={playerId}
        name={name}
        score={score}
        timelineModel={timeline}
        referenceRanking={ranking}
        onFocusPlayer={onPlayer}
        onReferenceRoom={onReference}
        onInspectAt={(id, i) => onRoom(i, id)}
        footnote="各已结算房间分累计；已发生的层末余额兑换计在该层BOSS节点，继承不重复计入。淘汰后的水平线表示冻结分数，不表示继续参与。右侧为该节点积分顺位，不是最终生存排名。支持缩放、拖动和点击房间点复盘。"
      />
      {moneyLog.rooms.length > 0 && (
        <ReplayMoneyTimeline
          log={moneyLog}
          roomIndex={Math.min(index, moneyLog.rooms.length - 1)}
          playerId={playerId}
          name={name}
          onRoom={(i) => onRoom(i)}
        />
      )}
      <section className="replay-table-wrap">
        <table className="result-table replay-table">
          <caption>
            逐房记录 · {name(playerId)}（淘汰后不伪造行动与资金）
          </caption>
          <thead>
            <tr>
              {[
                '房间',
                '参与状态',
                '本房得分',
                '累计新增积分',
                '入房 → 结算资金',
                '实际扣款',
                '道具份数',
              ].map((t) => (
                <th key={t} scope="col">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {log.rooms.map((room, i) => {
              const before = room.playersBefore.find((p) => p.id === playerId),
                after = room.players.find((p) => p.id === playerId),
                fact = room.roomScoreSummaries[playerId];
              return (
                <tr key={i}>
                  <th scope="row">
                    <button
                      className="replay-player-link"
                      onClick={() => onRoom(i)}
                    >
                      F{room.room.floorIndex + 1}-R{room.room.roomIndex + 1} ·{' '}
                      {replayRoomNames[room.room.kind]}
                    </button>
                  </th>
                  <td>{after ? '参与' : '未参与'}</td>
                  <td>{fact ? score(fact.finalScore) : '—'}</td>
                  <td>
                    {score(
                      timeline.series.find((s) => s.playerId === playerId)!
                        .points[i + 1]!.value,
                    )}
                  </td>
                  <td>
                    {before && after ? `${before.money} → ${after.money}` : '—'}
                  </td>
                  <td>
                    {after
                      ? room.resolvedActions
                          .filter((a) => a.playerId === playerId)
                          .reduce((sum, a) => sum + a.actualCost, 0)
                      : '—'}
                  </td>
                  <td>
                    {after
                      ? room.awards
                          .filter((a) => a.playerId === playerId)
                          .reduce((sum, a) => sum + a.copies, 0)
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </section>
  );
}
