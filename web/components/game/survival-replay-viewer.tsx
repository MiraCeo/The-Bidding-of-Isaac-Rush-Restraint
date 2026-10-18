import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ReplayRoomPanel, ReplayFieldPanel } from './replay-panels';
import { SurvivalReplayOverview } from './survival-replay-overview';
import {
  survivalReplayDisplayLog,
  survivalReplayOverview,
} from '@/lib/ui/survival-replay-display';
import { replayRoomNames, replayStrategyNames } from '@/lib/ui/replay-display';
import { serializeSurvivalReplay } from '@/lib/ui/survival-persistence';
import { downloadPortableJsonFile } from '@/lib/ui/json-download';
import { compressedFileSummary } from '@/lib/ui/compressed-file';
import { readBuildVersion } from '@/lib/ui/game-version';
import type { SurvivalReplayLog } from '@/lib/ui/survival-record';
import { survivalDifficultyLabel } from '@/lib/game/survival-difficulty';
import { finalSurvivalBoard } from '@/lib/ui/survival-board';
import { SurvivalScoreBoard } from './survival-score-board';

export function SurvivalTotalBoard({
  log,
  decimals = 2,
}: {
  log: SurvivalReplayLog;
  decimals?: 2 | 4;
}) {
  return (
    <SurvivalScoreBoard model={finalSurvivalBoard(log)} decimals={decimals} />
  );
}
export function SurvivalFloorFacts({
  log,
  index,
  decimals = 2,
  compact = false,
}: {
  log: SurvivalReplayLog;
  index: number;
  decimals?: 2 | 4;
  compact?: boolean;
}) {
  const floor = log.floors[index];
  if (!floor) return <p>暂无层末结算。</p>;
  return (
    <>
      {!compact && (
        <>
          <h3>
            第 {floor.floorIndex + 1} 层 · 斩杀线 {floor.cutLine} · 剩余{' '}
            {floor.plan.survivorIds.length} 人
          </h3>
          <p>
            生存分 = 房间分 R ＋ 余额兑换{' '}
            {log.ruleFacts.parameters.rules.moneyExchangeRatio * 100}% ＋
            上层生存分继承{' '}
            {log.ruleFacts.parameters.rules.scoreInheritanceRatio * 100}
            %。新增积分不包含继承分。
          </p>
          <div className="replay-overview-metrics survival-floor-stats">
            {[
              ['本层参与', floor.activePlayerIds.length],
              [
                '线下淘汰',
                floor.plan.eliminations.filter(
                  (e) => e.reason === 'below_cut_line',
                ).length,
              ],
              [
                '末位补淘汰',
                floor.plan.eliminations.filter(
                  (e) => e.reason === 'lowest_score',
                ).length,
              ],
              ['存活人数', floor.plan.survivorIds.length],
            ].map(([label, value]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
        </>
      )}
      <div
        className={
          compact
            ? 'survival-table-wrap floor-ledger-scroll'
            : 'survival-table-wrap'
        }
        role={compact ? 'region' : undefined}
        aria-label={compact ? '本层完整结算账本' : undefined}
        tabIndex={compact ? 0 : undefined}
      >
        <table className="survival-table">
          <caption className="sr-only">
            第 {floor.floorIndex + 1} 层淘汰账本
          </caption>
          <thead>
            <tr>
              <th scope="col">玩家</th>
              <th scope="col">房间分</th>
              <th scope="col">余额兑换</th>
              <th scope="col">继承分</th>
              <th scope="col">新增积分</th>
              <th scope="col">生存分</th>
              <th scope="col">距斩杀线</th>
              <th scope="col">判定</th>
            </tr>
          </thead>
          <tbody>
            {floor.activePlayerIds
              .slice()
              .sort(
                (a, b) =>
                  floor.scores[b]!.survivalScore -
                  floor.scores[a]!.survivalScore,
              )
              .map((id) => {
                const score = floor.scores[id]!;
                const removed = floor.plan.eliminations.find(
                  (entry) => entry.playerId === id,
                );
                return (
                  <tr
                    key={id}
                    data-human={id === 'human'}
                    data-ranking-self={id === 'human'}
                    tabIndex={id === 'human' && compact ? -1 : undefined}
                  >
                    <th scope="row">{log.playerNames[id]}</th>
                    <td>{score.roomScore.toFixed(decimals)}</td>
                    <td>{score.exchangedScore.toFixed(decimals)}</td>
                    <td>{score.inheritedScore.toFixed(decimals)}</td>
                    <td>{score.newScore.toFixed(decimals)}</td>
                    <td>{score.survivalScore.toFixed(decimals)}</td>
                    <td>
                      {(score.survivalScore - floor.cutLine).toFixed(decimals)}
                    </td>
                    <td>
                      {removed
                        ? removed.reason === 'below_cut_line'
                          ? '线下淘汰'
                          : '末位补淘汰'
                        : '存活'}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      {floor.resolution.tieBreaks.length > 0 && (
        <details>
          <summary>末位同分抽签事实</summary>
          {floor.resolution.tieBreaks.map((tie) => (
            <p key={tie.playerId}>
              {log.playerNames[tie.playerId]}：{tie.value}（较小值优先补淘汰）
            </p>
          ))}
        </details>
      )}
    </>
  );
}
export function SurvivalReplayViewer({
  log,
  decimals = 2,
}: {
  log: SurvivalReplayLog;
  decimals?: 2 | 4;
}) {
  const [index, setIndex] = useState(0),
    [playerId, setPlayerId] = useState('human');
  const [scope, setScope] = useState<'room' | 'match' | 'floors' | 'total'>(
      'room',
    ),
    [roomView, setRoomView] = useState<'personal' | 'field'>('personal');
  const [floorIndex, setFloorIndex] = useState(0),
    [message, setMessage] = useState('');
  const [exporting, setExporting] = useState(false),
    exportController = useRef<AbortController | null>(null);
  useEffect(() => () => exportController.current?.abort(), []);
  const heading = useRef<HTMLHeadingElement>(null),
    content = useRef<HTMLDivElement>(null),
    toolbar = useRef<HTMLDivElement>(null),
    focusRequested = useRef(false);
  const display = useMemo(() => survivalReplayDisplayLog(log), [log]);
  const activeIndex = Math.min(index, Math.max(0, log.rooms.length - 1)),
    record = display.rooms[activeIndex],
    room = log.rooms[activeIndex];
  const participating = !!room?.activePlayerIds.includes(playerId);
  const overview = useMemo(
    () => survivalReplayOverview(log, playerId),
    [log, playerId],
  );
  const name = (id: string) => log.playerNames[id] ?? id,
    score = (n: number) => n.toFixed(decimals);
  const floors = Array.from(new Set(log.rooms.map((r) => r.room.floorIndex)));
  const strategy = room?.aiChoices.find((c) => c.playerId === playerId);
  function focusContent() {
    heading.current?.focus({ preventScroll: true });
    content.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  useEffect(() => {
    const element = toolbar.current;
    if (!element) return;
    const update = () =>
      element.parentElement?.style.setProperty(
        '--replay-toolbar-height',
        (element.getBoundingClientRect().height || 96) + 'px',
      );
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [scope, roomView]);
  useEffect(() => {
    if (focusRequested.current) {
      focusContent();
      focusRequested.current = false;
    }
  }, [scope, roomView, index, playerId, floorIndex]);
  function chooseRoom(i: number, id?: string) {
    focusRequested.current = true;
    setIndex(i);
    if (id) setPlayerId(id);
    setScope('room');
    setRoomView('personal');
  }
  function chooseScope(next: typeof scope) {
    if (next === scope) focusContent();
    else focusRequested.current = true;
    setScope(next);
  }
  function inspectPlayer(id: string) {
    focusRequested.current = true;
    setPlayerId(id);
    setRoomView('personal');
  }
  async function exportReplay() {
    const controller = new AbortController();
    exportController.current?.abort();
    exportController.current = controller;
    setExporting(true);
    setMessage('正在无损压缩文件…');
    try {
      const packed = await downloadPortableJsonFile(
        serializeSurvivalReplay(log, readBuildVersion()),
        `以撒的竞合-生存回放-${log.id}.json`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted)
        setMessage(
          '已请求下载v5生存只读回放。' + compressedFileSummary(packed),
        );
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(error instanceof Error ? error.message : '无法导出。');
    } finally {
      if (!controller.signal.aborted) setExporting(false);
    }
  }
  return (
    <div className="survival-replay replay-page-content">
      <div className="replay-identity" data-replay-id={log.id}>
        <div>
          <strong>
            生存事实回放 · {log.final ? '已完成对局' : '进行中记录'}
          </strong>
          <span>
            AI难度：
            {survivalDifficultyLabel(
              log.ruleFacts.parameters.aiDifficulty,
              log.ruleFacts.engineVersion,
            )}{' '}
            ·{' '}
            {log.ruleFacts.parameters.aiPolicy === 'role-aware-1'
              ? '角色适配版（最高保持原基线）'
              : '历史原策略'}{' '}
            · 已结算 {log.rooms.length} 房 · 只读记录
          </span>
        </div>
        <nav className="replay-scope-tabs" aria-label="生存回放范围">
          {(
            [
              ['room', '本房复盘'],
              ['match', '整局概览'],
              ['floors', '层末结算'],
              ['total', '生存总榜'],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-current={scope === value ? 'page' : undefined}
              disabled={
                value === 'room' || value === 'match'
                  ? !log.rooms.length
                  : value === 'floors'
                    ? !log.floors.length
                    : !log.final
              }
              onClick={() => chooseScope(value)}
            >
              {label}
            </button>
          ))}
        </nav>
        <Button
          variant="secondary"
          disabled={exporting}
          onClick={() => void exportReplay()}
        >
          导出此回放
        </Button>
      </div>
      <p className="utility-notice">
        不重新运行 AI，不改变对局或玩家进度。仅展示已发生的房间和层末事实。
      </p>
      <details className="survival-replay-provenance">
        <summary>记录来源与版本</summary>
        <p className="survival-id">{log.id}</p>
        <p>
          初始构建 {log.startedBuild} · 引擎 {log.ruleFacts.engineVersion}
        </p>
      </details>
      {message && <output className="save-message">{message}</output>}
      <div
        className={
          'replay-workspace' +
          (scope === 'room' ? '' : ' replay-workspace-overview')
        }
      >
        {scope === 'room' && record && (
          <aside className="replay-sidebar">
            <div className="replay-directory-title">
              <strong>房间目录</strong>
              <span>{log.rooms.length} 房</span>
            </div>
            <nav className="replay-room-nav" aria-label="生存回放房间">
              {floors.map((floor) => (
                <section className="replay-floor-group" key={floor}>
                  <div className="replay-floor-heading">
                    <h3>第 {floor + 1} 层</h3>
                    <span>
                      {log.floors.find((f) => f.floorIndex === floor)?.plan
                        .survivorIds.length ?? '待结算'}{' '}
                      人
                    </span>
                  </div>
                  {log.rooms.map(
                    (r, i) =>
                      r.room.floorIndex === floor && (
                        <button
                          type="button"
                          key={i}
                          aria-current={activeIndex === i ? 'step' : undefined}
                          onClick={() => chooseRoom(i)}
                        >
                          <span className="replay-room-number">
                            {r.room.roomIndex + 1}
                          </span>
                          <span className="replay-room-label">
                            {replayRoomNames[r.room.kind]}
                            <small>
                              {r.activePlayerIds.includes(playerId)
                                ? `${r.activePlayerIds.length} 人参与`
                                : '该玩家未参与'}
                            </small>
                          </span>
                          <b>
                            {r.roomScoreSummaries[playerId]
                              ? score(
                                  r.roomScoreSummaries[playerId]!.finalScore,
                                )
                              : '—'}
                          </b>
                        </button>
                      ),
                  )}
                </section>
              ))}
            </nav>
          </aside>
        )}
        <div className="replay-main">
          <div className="replay-toolbar" ref={toolbar}>
            <div className="replay-selected-heading">
              <h3 tabIndex={-1} ref={heading}>
                {scope === 'room'
                  ? `${record?.location ?? '暂无房间'} · ${room ? replayRoomNames[room.room.kind] : ''} · ${roomView === 'field' ? `全场${room?.activePlayerIds.length ?? 0}人` : name(playerId)}`
                  : scope === 'match'
                    ? `整局概览 · ${name(playerId)}`
                    : scope === 'floors'
                      ? '层末生存结算'
                      : '生存总榜'}
              </h3>
              {scope === 'room' && record && (
                <div className="replay-step-controls">
                  <Button
                    variant="secondary"
                    disabled={activeIndex === 0}
                    onClick={() => chooseRoom(activeIndex - 1)}
                  >
                    上一房
                  </Button>
                  <strong>
                    {activeIndex + 1} / {log.rooms.length}
                  </strong>
                  <Button
                    variant="secondary"
                    disabled={activeIndex === log.rooms.length - 1}
                    onClick={() => chooseRoom(activeIndex + 1)}
                  >
                    下一房
                  </Button>
                </div>
              )}
              {(scope === 'room' || scope === 'match') && (
                <label>
                  查看玩家{' '}
                  <select
                    aria-label="生存回放查看玩家"
                    value={playerId}
                    onChange={(e) => inspectPlayer(e.target.value)}
                  >
                    {Object.entries(log.playerNames).map(([id, label]) => (
                      <option value={id} key={id}>
                        {label}
                        {id === 'human' ? '（真人）' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {scope === 'floors' && (
                <label>
                  已结算层{' '}
                  <select
                    aria-label="生存回放结算层"
                    value={Math.min(
                      floorIndex,
                      Math.max(0, log.floors.length - 1),
                    )}
                    onChange={(e) => {
                      focusRequested.current = true;
                      setFloorIndex(Number(e.target.value));
                    }}
                  >
                    {log.floors.map((f, i) => (
                      <option key={i} value={i}>
                        第 {f.floorIndex + 1} 层 · 剩余{' '}
                        {f.plan.survivorIds.length} 人
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {scope === 'room' && record && (
              <div className="replay-toolbar-secondary">
                <nav className="replay-view-tabs" aria-label="生存本房视图">
                  {(
                    [
                      ['personal', '个人复盘'],
                      ['field', '全场明细'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      type="button"
                      key={value}
                      aria-current={roomView === value ? 'page' : undefined}
                      onClick={() => {
                        focusRequested.current = true;
                        setRoomView(value);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
                <span className="replay-room-context">
                  {roomView === 'field'
                    ? `本房实际参与 ${room!.activePlayerIds.length} 人${participating ? '' : ' · 关注玩家未参与，图表仅展示本房参与者'}`
                    : participating
                      ? strategy
                        ? replayStrategyNames[strategy.strategy]
                        : '真人实际提交'
                      : '该玩家已淘汰 · 本房未参与'}
                </span>
              </div>
            )}
          </div>
          <div
            ref={content}
            className="replay-view-content"
            aria-label="生存回放内容"
          >
            {scope === 'total' ? (
              log.final ? (
                <SurvivalTotalBoard log={log} decimals={decimals} />
              ) : (
                <p>对局尚未结束，暂无最终生存总榜。</p>
              )
            ) : scope === 'floors' ? (
              <div className="survival-replay-floor-card">
                <SurvivalFloorFacts
                  log={log}
                  index={Math.min(
                    floorIndex,
                    Math.max(0, log.floors.length - 1),
                  )}
                  decimals={decimals}
                />
              </div>
            ) : scope === 'match' ? (
              <SurvivalReplayOverview
                log={log}
                playerId={playerId}
                index={activeIndex}
                decimals={decimals}
                onRoom={chooseRoom}
                onPlayer={setPlayerId}
                onReference={setIndex}
              />
            ) : !record ? (
              <p className="empty-ranking-state">还没有已结算房间。</p>
            ) : roomView === 'field' ? (
              <ReplayFieldPanel
                record={record}
                playerId={playerId}
                name={name}
                score={score}
                onInspect={inspectPlayer}
              />
            ) : participating ? (
              <ReplayRoomPanel
                key={`${record.location}:${playerId}`}
                record={record}
                playerId={playerId}
                name={name}
                score={score}
                cooperationRadius={
                  log.ruleFacts.roomRules.floorStartingMoney[
                    room!.room.floorIndex
                  ]! * log.ruleFacts.roomRules.cooperationZoneRatio
                }
                scoreNote={`房间累计 ${score(room!.players.find((p) => p.id === playerId)!.score)} · 不含层末兑换与继承；生存累计请查看整局概览。`}
              />
            ) : (
              <section className="empty-ranking-state">
                <h3>{name(playerId)}已淘汰，不参与本房间</h3>
                <p>
                  不生成虚假行动、得分、资金或道具。可查看全场明细、切换玩家或定位该玩家最后参与的房间。
                </p>
                {overview.lastRoomIndex >= 0 && (
                  <Button onClick={() => chooseRoom(overview.lastRoomIndex)}>
                    定位最后参与房间
                  </Button>
                )}
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
