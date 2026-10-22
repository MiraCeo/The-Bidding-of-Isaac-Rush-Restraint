import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { characterNames } from '@/lib/game';
import type { SurvivalReplayLog } from '@/lib/ui/survival-record';
import {
  serializeSurvivalReplay,
  type SurvivalReplayDocument,
} from '@/lib/ui/survival-persistence';
import { readBuildVersion } from '@/lib/ui/game-version';
import { currentFileVersion } from '@/lib/ui/file-protocol';
import { downloadPortableJsonFile } from '@/lib/ui/json-download';
import { RecordContextCard } from './record-context-card';

export function SurvivalRecordCard({
  log,
  recent,
  error,
  saveStatus,
  onReplay,
  onReturnGame,
}: {
  log: SurvivalReplayLog | null;
  recent: SurvivalReplayDocument | null;
  error: string;
  saveStatus: string;
  onReplay: (doc: SurvivalReplayDocument) => void;
  onReturnGame: () => void;
}) {
  const [exporting, setExporting] = useState(false),
    [message, setMessage] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function exportReplay(target: SurvivalReplayLog) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setExporting(true);
    setMessage('正在无损压缩回放…');
    try {
      await downloadPortableJsonFile(
        serializeSurvivalReplay(target, readBuildVersion()),
        `生存回放-${target.seed}.json`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) setMessage('已请求导出回放文件。');
    } catch (e) {
      if (!controller.signal.aborted)
        setMessage(
          e instanceof Error ? e.message : '回放导出未完成，原记录保留。',
        );
    } finally {
      if (!controller.signal.aborted) setExporting(false);
    }
  }
  const showRecent =
    recent &&
    (recent.replay.id !== log?.id ||
      recent.replay.rooms.length !== log?.rooms.length ||
      !!recent.replay.final !== !!log?.final);
  const view = (target: SurvivalReplayLog): SurvivalReplayDocument => ({
    format: 'the-bidding-of-isaac-replay',
    version: currentFileVersion,
    kind: 'replay',
    mode: 'survival',
    exportedAt: new Date().toISOString(),
    exportedBuild: readBuildVersion(),
    replay: target,
  });
  function row(target: SurvivalReplayLog, source: 'current' | 'recent') {
    return (
      <div className="data-record-row" data-record-source={source}>
        <div className="data-record-info">
          <strong>
            {source === 'recent' ? '最近完成 · ' : ''}
            {characterNames[target.characterId]}
          </strong>
          <span
            className="data-state"
            data-phase={target.final ? 'complete' : 'active'}
          >
            {target.final ? '已结束' : '进行中'}
          </span>
          <small>已结算 {target.rooms.length} 房</small>
        </div>
        <div className="data-actions">
          <Button
            aria-label={
              source === 'current'
                ? '查看本局生存回放'
                : '查看最近完成的生存回放'
            }
            onClick={() =>
              onReplay(source === 'recent' && recent ? recent : view(target))
            }
          >
            查看对局
          </Button>
          <Button
            variant="secondary"
            disabled={exporting}
            onClick={() => void exportReplay(target)}
          >
            导出回放
          </Button>
        </div>
      </div>
    );
  }
  return (
    <RecordContextCard
      className="progress-replays"
      status={
        (!log && saveStatus === '生存进度待保存。' ? '' : saveStatus) ||
        '暂无需要保存的对局。'
      }
    >
      {log?.rooms.length
        ? row(log, 'current')
        : !showRecent && (
            <div className="data-record-row">
              <div className="data-record-info">
                <strong>没有已结算的对局记录</strong>
                <small>本局尚无已结算房间，可返回游戏继续。</small>
              </div>
              <Button variant="secondary" onClick={onReturnGame}>
                返回游戏
              </Button>
            </div>
          )}
      {showRecent && row(recent.replay, 'recent')}
      {error && <output className="save-message">{error}</output>}
      {saveStatus &&
        saveStatus !== '生存进度已自动保存。' &&
        saveStatus !== '生存进度待保存。' && (
          <output className="save-message">{saveStatus}</output>
        )}
      {message && (
        <output className="save-message" aria-live="polite">
          {message}
        </output>
      )}
    </RecordContextCard>
  );
}
