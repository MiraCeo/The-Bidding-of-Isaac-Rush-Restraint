import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { characterNames } from '@/lib/game';
import type { ReplayLog } from '@/lib/ui/replay-record';
import { replayFloorGroups } from '@/lib/ui/replay-view-model';
import { replayRoomNames, replayStrategyNames } from '@/lib/ui/replay-display';
import { serializeReplay } from '@/lib/ui/game-replay';
import { replayRuleFacts } from '@/lib/ui/replay-facts-codec';
import { readBuildVersion } from '@/lib/ui/game-version';
import { downloadJsonFile } from '@/lib/ui/json-download';
import { useSessionTools } from './session-context';
import {
  ReplayRoomPanel,
  ReplayOverviewPanel,
  ReplayFieldPanel,
} from './replay-panels';

export function ReplayViewer() {
  const tools = useSessionTools();
  if (!tools) return <p className="utility-notice">当前没有可读取的回放。</p>;
  const log =
    tools.replaySource === 'file'
      ? tools.importedReplay?.replay
      : tools.session.replay;
  return (
    <div className="replay-page-content">
      <div className="replay-source-tabs" aria-label="回放来源">
        <Button
          type="button"
          variant={tools.replaySource === 'current' ? 'default' : 'secondary'}
          disabled={!tools.session.replay?.rooms.length}
          onClick={() => tools.onReplaySourceChange('current')}
        >
          本局记录
        </Button>
        <Button
          type="button"
          variant={tools.replaySource === 'file' ? 'default' : 'secondary'}
          disabled={!tools.importedReplay}
          onClick={() => tools.onReplaySourceChange('file')}
        >
          读取的回放文件
        </Button>
        <span>
          {tools.replaySource === 'file'
            ? '文件只读查看，不替换当前对局'
            : '本局只显示已结算房间'}
        </span>
      </div>
      {log ? (
        <ReplayArchive
          key={
            tools.replaySource +
            ':' +
            log.id +
            ':' +
            (tools.replaySource === 'file'
              ? tools.importedReplay?.exportedAt
              : 'live')
          }
          log={log}
          scoreDecimals={tools.preferences.scoreDecimals}
        />
      ) : (
        <p className="utility-notice">
          暂无回放，请从设置页读取v3或v2回放JSON。
        </p>
      )}
    </div>
  );
}
export function ReplayArchive({
  log,
  scoreDecimals = 2,
}: {
  log: ReplayLog;
  scoreDecimals?: 2 | 4;
}) {
  const [index, setIndex] = useState(0);
  const [playerId, setPlayerId] = useState('human');
  const [scope, setScope] = useState<'room' | 'match'>('room');
  const [roomView, setRoomView] = useState<'personal' | 'field'>('personal');
  const [message, setMessage] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const focusRequested = useRef(false);
  const activeIndex = Math.min(index, Math.max(0, log.rooms.length - 1)),
    record = log.rooms[activeIndex];
  const score = (v: number) => v.toFixed(scoreDecimals),
    name = (id: string) => log.playerNames[id] ?? id;
  const floors = replayFloorGroups(log, playerId);
  const strategy = record?.aiChoices.find((c) => c.playerId === playerId);
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
  }, [scope, roomView, playerId, index]);
  function chooseRoom(i: number, personal = false) {
    if (
      i === index &&
      scope === 'room' &&
      (!personal || roomView === 'personal')
    )
      focusContent();
    else focusRequested.current = true;
    setIndex(i);
    setScope('room');
    if (personal) setRoomView('personal');
    setMessage('');
  }
  function inspectPlayer(id: string) {
    focusRequested.current = true;
    setPlayerId(id);
    setRoomView('personal');
  }
  function chooseScope(next: 'room' | 'match') {
    if (next === scope) focusContent();
    else focusRequested.current = true;
    setScope(next);
    setMessage('');
  }
  function chooseView(next: 'personal' | 'field') {
    if (next === roomView) focusContent();
    else focusRequested.current = true;
    setRoomView(next);
  }
  function exportArchive() {
    try {
      downloadJsonFile(
        serializeReplay(log, readBuildVersion()),
        '以撒的竞合-回放-' + log.id + '.json',
      );
      setMessage('已请求下载v3只读回放。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法导出。');
    }
  }
  return (
    <>
      <div className="replay-identity" data-replay-id={log.id}>
        <div>
          <strong>
            {characterNames[log.characterId]} ·{' '}
            {log.final ? '已完成对局' : '进行中记录'}
          </strong>
          <span>已结算 {log.rooms.length} / 15 房间 · 只读复盘</span>
        </div>
        {record && (
          <nav className="replay-scope-tabs" aria-label="回放范围">
            <button
              type="button"
              aria-current={scope === 'room' ? 'page' : undefined}
              onClick={() => chooseScope('room')}
            >
              本房复盘
            </button>
            <button
              type="button"
              aria-current={scope === 'match' ? 'page' : undefined}
              onClick={() => chooseScope('match')}
            >
              整局概览
            </button>
          </nav>
        )}
        <Button type="button" variant="secondary" onClick={exportArchive}>
          导出此回放
        </Button>
      </div>
      {message && (
        <output className="save-message replay-feedback">{message}</output>
      )}
      {!record ? (
        <p className="empty-ranking-state">此回放尚无已结算房间。</p>
      ) : (
        <div
          className={
            'replay-workspace' +
            (scope === 'match' ? ' replay-workspace-overview' : '')
          }
        >
          {scope === 'room' && (
            <aside className="replay-sidebar">
              <div className="replay-directory-title">
                <strong>房间目录</strong>
                <span>{log.rooms.length} / 15</span>
              </div>
              <nav className="replay-room-nav" aria-label="回放房间">
                {floors.map((floor) => (
                  <section className="replay-floor-group" key={floor.floor}>
                    <div className="replay-floor-heading">
                      <h3>第 {floor.floor + 1} 层</h3>
                      <span>+{score(floor.total)}</span>
                    </div>
                    {floor.rooms.map((r) => (
                      <button
                        type="button"
                        key={r.record.location}
                        aria-current={
                          activeIndex === r.index ? 'step' : undefined
                        }
                        onClick={() => chooseRoom(r.index)}
                      >
                        <span className="replay-room-number">
                          {r.record.settlement.room.roomIndex + 1}
                        </span>
                        <span className="replay-room-label">
                          {replayRoomNames[r.record.settlement.room.kind]}
                          <small>
                            {r.awards ? '获奖 ' + r.awards + '份' : '未获奖'}
                          </small>
                        </span>
                        <b>+{score(r.score)}</b>
                      </button>
                    ))}
                  </section>
                ))}
              </nav>
              <small>
                目录显示{name(playerId)}的房分与获奖；
                {roomView === 'field'
                  ? '右侧全场明细覆盖本房20人。'
                  : '右侧查看这个房间的个人结果。'}
              </small>
            </aside>
          )}
          <div className="replay-main">
            <div
              ref={toolbar}
              className={
                'replay-toolbar' +
                (scope === 'match' ? ' replay-overview-toolbar' : '')
              }
            >
              <div className="replay-selected-heading">
                <h3 ref={heading} tabIndex={-1}>
                  {scope === 'match'
                    ? '整局概览 · ' + name(playerId)
                    : record.location +
                      ' · ' +
                      replayRoomNames[record.settlement.room.kind] +
                      ' · ' +
                      (roomView === 'field' ? '全场20人' : name(playerId))}
                </h3>
                {scope === 'room' && (
                  <div className="replay-step-controls">
                    <Button
                      type="button"
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
                      type="button"
                      variant="secondary"
                      disabled={activeIndex >= log.rooms.length - 1}
                      onClick={() => chooseRoom(activeIndex + 1)}
                    >
                      下一房
                    </Button>
                  </div>
                )}
                <label>
                  {roomView === 'field' && scope === 'room'
                    ? '关注玩家'
                    : '查看玩家'}
                  <select
                    aria-label="回放查看玩家"
                    value={playerId}
                    onChange={(e) => setPlayerId(e.target.value)}
                  >
                    {Object.entries(log.playerNames).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                        {id === 'human' ? '（真人）' : ' · ' + id}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="replay-toolbar-secondary">
                {scope === 'room' && (
                  <nav className="replay-view-tabs" aria-label="本房视图">
                    <button
                      type="button"
                      aria-current={
                        roomView === 'personal' ? 'page' : undefined
                      }
                      onClick={() => chooseView('personal')}
                    >
                      个人复盘
                    </button>
                    <button
                      type="button"
                      aria-current={roomView === 'field' ? 'page' : undefined}
                      onClick={() => chooseView('field')}
                    >
                      全场明细
                    </button>
                  </nav>
                )}
                <span className="replay-room-context">
                  {scope === 'match'
                    ? '全部' + log.rooms.length + '个已结算房间 · 只读查看'
                    : roomView === 'field'
                      ? '仅本房20人的行动与结算'
                      : (strategy
                          ? replayStrategyNames[strategy.strategy]
                          : '真人实际提交') + ' · 仅本房个人结果'}
                </span>
              </div>
            </div>
            <div
              ref={content}
              className="replay-view-content"
              aria-label={
                scope === 'match'
                  ? '整局概览内容'
                  : roomView === 'personal'
                    ? '个人复盘内容'
                    : '全场明细内容'
              }
            >
              {scope === 'match' ? (
                <ReplayOverviewPanel
                  log={log}
                  roomIndex={activeIndex}
                  playerId={playerId}
                  name={name}
                  score={score}
                  onRoom={(i) => chooseRoom(i, true)}
                  onFocusPlayer={setPlayerId}
                  onReferenceRoom={setIndex}
                  onInspectAt={(id, i) => {
                    setPlayerId(id);
                    chooseRoom(i, true);
                  }}
                />
              ) : roomView === 'personal' ? (
                <ReplayRoomPanel
                  record={record}
                  cooperationRadius={
                    replayRuleFacts(log).cooperationRadii[
                      record.settlement.room.floorIndex
                    ]!
                  }
                  playerId={playerId}
                  name={name}
                  score={score}
                />
              ) : (
                <ReplayFieldPanel
                  record={record}
                  playerId={playerId}
                  name={name}
                  score={score}
                  onInspect={inspectPlayer}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
