import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { characterNames } from '@/lib/game';
import { replayRoomLocator, type ReplayLog } from '@/lib/ui/replay-record';
import { replayFloorGroups } from '@/lib/ui/replay-view-model';
import { replayRoomNames, replayStrategyNames } from '@/lib/ui/replay-display';
import { serializeReplay } from '@/lib/ui/game-replay';
import { readBuildVersion } from '@/lib/ui/game-version';
import { downloadJsonFile } from '@/lib/ui/json-download';
import { useSessionTools } from './session-context';
import {
  ReplayRoomPanel,
  ReplayOverviewPanel,
  ReplayFieldPanel,
  ReplayFinalRanking,
} from './replay-panels';

type View = 'room' | 'overview' | 'field';
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
        <p className="utility-notice">暂无回放，请从设置页读取v2回放JSON。</p>
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
  const [view, setView] = useState<View>('room');
  const [message, setMessage] = useState('');
  const [locatorOpen, setLocatorOpen] = useState(false);
  const activeIndex = Math.min(index, Math.max(0, log.rooms.length - 1));
  const record = log.rooms[activeIndex];
  const score = (v: number) => v.toFixed(scoreDecimals);
  const name = (id: string) => log.playerNames[id] ?? id;
  const locator = record ? replayRoomLocator(log, record) : log.id;
  const floors = replayFloorGroups(log, playerId);
  const strategy = record?.aiChoices.find((c) => c.playerId === playerId);
  function chooseRoom(i: number) {
    setIndex(i);
    setView('room');
    setMessage('');
  }
  async function copyLocator() {
    try {
      await navigator.clipboard.writeText(locator);
      setMessage('房间定位已复制。');
    } catch {
      setLocatorOpen(true);
      setMessage('定位详情已展开，可选中文字手动复制。');
    }
  }
  function exportArchive() {
    try {
      downloadJsonFile(
        serializeReplay(log, readBuildVersion()),
        '以撒的竞合-回放-' + log.id + '.json',
      );
      setMessage('已请求下载v2只读回放。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法导出。');
    }
  }
  return (
    <>
      <div className="replay-identity">
        <div>
          <strong>
            {characterNames[log.characterId]} ·{' '}
            {log.final ? '已完成对局' : '进行中记录'}
          </strong>
          <span>已结算 {log.rooms.length} / 15 房间 · 只读复盘</span>
        </div>
        <details>
          <summary>档案详情</summary>
          <code>{log.id}</code>
          <p>
            开始构建：{log.startedBuild} · 规则：{log.rulesVersion}
          </p>
          <p>显示记录中的实际结果，v2文件；不恢复历史房间，不修改行动。</p>
        </details>
        <Button type="button" variant="secondary" onClick={exportArchive}>
          导出此回放
        </Button>
      </div>
      {!record ? (
        <p className="empty-ranking-state">此回放尚无已结算房间。</p>
      ) : (
        <div className="replay-workspace">
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
              显示{name(playerId)}的实际房分与获奖份数；未结算房间不显示。
            </small>
          </aside>
          <div className="replay-main">
            <div className="replay-toolbar">
              <div className="replay-selected-heading">
                <div>
                  <p className="eyebrow">ROOM REVIEW</p>
                  <h3>
                    {record.location} ·{' '}
                    {replayRoomNames[record.settlement.room.kind]} ·{' '}
                    {name(playerId)}
                  </h3>
                  <span>
                    {strategy
                      ? replayStrategyNames[strategy.strategy]
                      : '真人实际提交'}
                  </span>
                </div>
                <label>
                  查看玩家
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
              <div className="replay-controls-row">
                <div className="save-actions">
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
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void copyLocator()}
                >
                  复制房间定位
                </Button>
              </div>
              <nav className="replay-view-tabs" aria-label="回放视图">
                {(
                  [
                    { id: 'room', label: '房间复盘' },
                    { id: 'overview', label: '整局概览' },
                    { id: 'field', label: '全场明细' },
                  ] as const
                ).map((tab) => (
                  <button
                    type="button"
                    key={tab.id}
                    aria-current={view === tab.id ? 'page' : undefined}
                    onClick={() => setView(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
              {message && (
                <output className="save-message replay-feedback">
                  {message}
                </output>
              )}
            </div>
            <details
              className="replay-location"
              open={locatorOpen}
              onToggle={(e) => setLocatorOpen(e.currentTarget.open)}
            >
              <summary>定位与构建信息</summary>
              <label htmlFor="replay-locator">反馈定位 · 可直接复制</label>
              <input
                id="replay-locator"
                readOnly
                value={locator}
                onFocus={(e) => e.target.select()}
              />
              <small>
                本房构建：{record.build}
                {record.source === 'live'
                  ? ' · 原局提交时记录'
                  : record.source === 'checkpoint-reconstruction'
                    ? ' · v2检查点核验重建'
                    : ' · 保留的历史重建来源'}
              </small>
            </details>
            <div
              className="replay-view-content"
              aria-label={
                view === 'room'
                  ? '房间复盘内容'
                  : view === 'overview'
                    ? '整局概览内容'
                    : '全场明细内容'
              }
            >
              {view === 'room' ? (
                <>
                  <ReplayRoomPanel
                    record={record}
                    playerId={playerId}
                    name={name}
                    score={score}
                  />
                  {log.final && activeIndex === log.rooms.length - 1 && (
                    <details className="replay-final-details">
                      <summary>查看整局终局倍率与排行</summary>
                      <ReplayFinalRanking log={log} name={name} score={score} />
                    </details>
                  )}
                </>
              ) : view === 'overview' ? (
                <ReplayOverviewPanel
                  log={log}
                  playerId={playerId}
                  name={name}
                  score={score}
                  index={activeIndex}
                  onRoom={chooseRoom}
                />
              ) : (
                <ReplayFieldPanel
                  record={record}
                  playerId={playerId}
                  name={name}
                  score={score}
                  onInspect={(id) => {
                    setPlayerId(id);
                    setView('room');
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
