import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  maxReplayBytes,
  parseReplay,
  serializeReplay,
} from '@/lib/ui/game-replay';
import { readBuildVersion } from '@/lib/ui/game-version';
import { downloadJsonFile } from '@/lib/ui/json-download';
import { useSessionTools } from './session-context';

export function ReplayControls({ onOpen }: { onOpen: () => void }) {
  const tools = useSessionTools();
  const [message, setMessage] = useState('');
  const [reading, setReading] = useState(false);
  const requestId = useRef(0);
  useEffect(
    () => () => {
      requestId.current += 1;
    },
    [],
  );
  if (!tools) return null;
  const log = tools.session.replay;
  const count = log?.rooms.length ?? 0;
  async function readFile(file: File | undefined) {
    const id = ++requestId.current;
    if (!file) {
      setReading(false);
      return;
    }
    setReading(true);
    setMessage('');
    try {
      if (file.size > maxReplayBytes)
        throw new Error('回放文件超过8 MiB，不能读取。');
      const source = await file.text();
      if (id !== requestId.current) return;
      const archive = parseReplay(source);
      if (id === requestId.current) {
        tools!.onReplayImport(archive);
        setReading(false);
        onOpen();
      }
    } catch (error) {
      if (id === requestId.current)
        setMessage(
          `${error instanceof Error ? error.message : '无法读取回放。'} 当前对局和已读取回放保持不变。`,
        );
    } finally {
      if (id === requestId.current) setReading(false);
    }
  }
  function exportReplay() {
    if (!log) return;
    try {
      downloadJsonFile(
        serializeReplay(log, readBuildVersion()),
        `以撒的竞合-回放-${log.id}.json`,
      );
      setMessage(
        '已请求下载回放JSON，仅包含已结算房间；它不是可继续游戏的存档。',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法导出回放。');
    }
  }
  return (
    <section
      className="save-panel replay-controls settings-group"
      aria-labelledby="replay-controls-title"
    >
      <h3 id="replay-controls-title">逐房回放</h3>
      <p>
        查看已经结算的行动、随机结果与状态快照。读取回放只打开只读记录，不替换对局，不恢复到历史房间。
      </p>
      <div className="save-summary">
        <strong>
          {count
            ? `本局已记录 ${count} / 15 房间${log?.final ? ' · 含终局' : ''}`
            : '尚无已结算房间'}
        </strong>
        {log && <small>对局标识：{log.id}</small>}
      </div>
      <div className="save-actions">
        <Button
          type="button"
          disabled={count === 0}
          onClick={() => {
            tools.onReplaySourceChange('current');
            onOpen();
          }}
        >
          查看本局回放
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={count === 0}
          onClick={exportReplay}
        >
          导出回放 JSON
        </Button>
        <label className="save-file-picker">
          读取回放 JSON
          <input
            type="file"
            aria-label="读取回放 JSON"
            accept=".json,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              void readFile(file);
            }}
          />
        </label>
        {tools.importedReplay && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              tools.onReplaySourceChange('file');
              onOpen();
            }}
          >
            查看已读取回放
          </Button>
        )}
      </div>
      {(message || reading) && (
        <output className="save-message">
          {reading ? '正在独立校验回放…' : message}
        </output>
      )}
      <small>
        未提交报价、当前问号奖励和未来房间不进入回放。存档／回放分别导出；本局逐房记录随自动存档保存。
      </small>
    </section>
  );
}
