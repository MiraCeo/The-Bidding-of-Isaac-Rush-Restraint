import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useSessionTools } from './session-context';
import {
  describeSave,
  maxSaveBytes,
  parseGameSave,
  serializeGameSave,
  type SaveDocument,
} from '@/lib/ui/game-save';

export function SaveControls() {
  const tools = useSessionTools();
  const [candidate, setCandidate] = useState<SaveDocument | null>(null);
  const [message, setMessage] = useState('');
  const [reading, setReading] = useState(false);
  const [newGamePending, setNewGamePending] = useState(false);
  const requestId = useRef(0);
  if (!tools) return null;
  const game = tools.session.game;
  const active = game.phase !== 'character_selection';
  async function readFile(file: File | undefined) {
    const id = ++requestId.current;
    setCandidate(null);
    setMessage('');
    if (!file) {
      setReading(false);
      return;
    }
    setReading(true);
    try {
      if (file.size > maxSaveBytes) throw new Error('存档文件过大，不能读取。');
      const save = parseGameSave(await file.text());
      if (id === requestId.current) {
        setCandidate(save);
        setMessage('校验通过；载入前请核对下面的角色与进度。');
      }
    } catch (error) {
      if (id === requestId.current)
        setMessage(error instanceof Error ? error.message : '无法读取文件。');
    } finally {
      if (id === requestId.current) setReading(false);
    }
  }
  function exportSave() {
    let url: string | null = null;
    try {
      const blob = new Blob([serializeGameSave(tools!.session)], {
        type: 'application/json;charset=utf-8',
      });
      url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `以撒的竞合-${game.seed.toString(16)}-${active ? `${game.floorIndex + 1}-${game.roomIndex + 1}` : '新游戏'}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setMessage('已请求下载存档；保存 JSON 文件后，可从这里读取继续同一局。');
      const release = url;
      window.setTimeout(() => URL.revokeObjectURL(release), 1000);
    } catch (error) {
      if (url) URL.revokeObjectURL(url);
      setMessage(error instanceof Error ? error.message : '无法导出存档。');
    }
  }
  return (
    <section className="save-panel settings-group" aria-labelledby="save-title">
      <h3 id="save-title">对局存档</h3>
      <p>
        JSON 文件随离线 HTML 携带；读取文件 → 核对进度 →
        载入。界面偏好单独保留，不随对局覆盖。
      </p>
      <div className="save-summary">
        <strong>{describeSave(tools.session)}</strong>
        <small>对局种子 {game.seed.toString(16).padStart(8, '0')}</small>
      </div>
      <output className="save-storage-status">
        {tools.autoSaveStatus === 'saved'
          ? '本局及未提交报价已自动保存到当前浏览器。刷新可继续。'
          : tools.autoSaveStatus === 'session'
            ? '浏览器存储不可用；本局仍可游玩，请通过 JSON 文件保存。'
            : '开始对局后自动保存；也可读取已有 JSON 存档。'}
        {tools.restoreMessage && <span>{tools.restoreMessage}</span>}
      </output>
      <div className="save-actions">
        <Button type="button" disabled={!active} onClick={exportSave}>
          导出 JSON 存档
        </Button>
        <label className="save-file-picker">
          读取 JSON 存档
          <input
            aria-label="读取 JSON 存档"
            type="file"
            accept=".json,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              void readFile(file);
            }}
          />
        </label>
        {active && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setNewGamePending(true)}
          >
            开始新对局
          </Button>
        )}
      </div>
      {newGamePending && (
        <div className="save-candidate">
          <p>
            开始新对局会返回角色选择，并清除旧局自动存档。需要继续旧局时，请先导出
            JSON。
          </p>
          <div className="save-actions">
            <Button type="button" onClick={tools.onNewGame}>
              确认开始新对局
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setNewGamePending(false)}
            >
              保留当前对局
            </Button>
          </div>
        </div>
      )}
      {(message || reading) && (
        <output className="save-message">
          {reading ? '正在校验存档…' : message}
        </output>
      )}
      {candidate && (
        <div className="save-candidate">
          <strong>{describeSave(candidate.session)}</strong>
          <span>
            保存时间：{new Date(candidate.savedAt).toLocaleString('zh-CN')}
          </span>
          <span>
            种子：{candidate.session.game.seed.toString(16).padStart(8, '0')} ·
            已提交 {candidate.session.turns.length} 房间
          </span>
          <p>
            {active
              ? '载入将替换当前对局。需要保留当前进度时，先导出。'
              : '载入后直接回到保存的阶段，不重新抽取角色、道具或人格。'}
          </p>
          <div className="save-actions">
            <Button
              type="button"
              onClick={() => tools.onRestore(candidate.session)}
            >
              载入此存档
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setCandidate(null);
                setMessage('已取消读取，当前对局未改变。');
              }}
            >
              取消读取
            </Button>
          </div>
        </div>
      )}
      <small>
        重新开始会清除旧局自动存档；已经导出的 JSON
        不受影响。同一浏览器不同时编辑多个副本，最后一次保存会覆盖自动存档。
      </small>
    </section>
  );
}
