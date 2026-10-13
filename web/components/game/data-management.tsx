import { Check, AlertCircle, FileJson } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { characterNames } from '@/lib/game';
import { describeSave } from '@/lib/ui/game-save';
import { describeDataProgress } from '@/lib/ui/data-management';
import type { ReplayDocument } from '@/lib/ui/game-replay';
import type { DataManagementController } from './use-data-management';
import { ModeFilePreview } from './mode-file-preview';

export function dataTaskTitle(data: DataManagementController) {
  if (data.task === 'backup') return '完整备份';
  if (data.task === 'settings') return '设置';
  return data.candidate?.kind === 'replay'
    ? '查看回放'
    : data.candidate?.kind === 'backup'
      ? '载入完整备份'
      : data.candidate
        ? '载入对局'
        : '导入文件';
}
export function DataManagement({
  data,
  scope = 'all',
}: {
  data: DataManagementController;
  scope?: 'all' | 'records';
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const { tools } = data;
  if (!tools) return null;
  const picker = (
    <input
      ref={fileInput}
      hidden
      className="data-file-input"
      type="file"
      accept=".json,application/json"
      aria-label="导入对局文件"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        void data.readFile(file);
      }}
    />
  );
  const message = (data.message || data.reading) && (
    <output className="save-message data-message">
      {data.reading ? '正在独立校验文件…' : data.message}
    </output>
  );
  const chooseFile = () => fileInput.current?.click();
  if (data.task === 'import') {
    const candidate = data.candidate;
    if (
      candidate &&
      (candidate.kind === 'survival-checkpoint' ||
        candidate.kind === 'survival-replay' ||
        candidate.kind === 'survival-backup')
    )
      return (
        <div className="data-task-page">
          {picker}
          <ModeFilePreview
            candidate={candidate}
            restoreProfile={data.restoreProfile}
            onProfileChange={data.setRestoreProfile}
            onConfirm={data.confirmImport}
            onCancel={data.cancel}
          />
          {message}
        </div>
      );
    const save =
      candidate && candidate.kind !== 'replay' ? candidate.document : null;
    const replay =
      candidate?.kind === 'replay'
        ? candidate.document.replay
        : save?.session.replay;
    return (
      <div className="data-task-page">
        {picker}
        {candidate ? (
          <section className="settings-group save-candidate data-candidate">
            <div className="data-file-heading">
              <FileJson aria-hidden="true" />
              {candidate.filename}
              <Button type="button" variant="secondary" onClick={chooseFile}>
                更换文件
              </Button>
            </div>
            <dl>
              <dt>文件类型</dt>
              <dd>
                {candidate.kind === 'replay'
                  ? '只读回放'
                  : candidate.kind === 'backup'
                    ? '对局＋回放＋玩家进度'
                    : save?.session.game.phase === 'game_result'
                      ? '已结束的对局存档'
                      : '可继续的对局存档'}
              </dd>
              <dt>角色</dt>
              <dd>{replay ? characterNames[replay.characterId] : '—'}</dd>
              <dt>对局进度</dt>
              <dd>
                {save
                  ? describeDataProgress(save.session)
                  : replay?.final
                    ? '15 / 15房间 · 已结束'
                    : '部分回放'}
              </dd>
              <dt>已有回放</dt>
              <dd>{replay?.rooms.length ?? 0}个已结算房间</dd>
              <dt>文件时间</dt>
              <dd>
                {new Date(
                  candidate.kind === 'replay'
                    ? candidate.document.exportedAt
                    : candidate.document.savedAt,
                ).toLocaleString('zh-CN')}
              </dd>
            </dl>
            {candidate.kind === 'backup' && (
              <div className="data-profile-choice">
                <label>
                  <input
                    type="checkbox"
                    checked={data.restoreProfile}
                    onChange={(e) => data.setRestoreProfile(e.target.checked)}
                  />
                  同时恢复文件中的玩家进度
                </label>
                <p>
                  {data.restoreProfile
                    ? '将替换本机玩家进度，包含解锁、成就与扩展数据。'
                    : '保留本机玩家进度，只载入这局与原始回放。'}
                </p>
              </div>
            )}
            <p className="data-impact">
              {candidate.kind === 'replay'
                ? '只打开回放，不替换当前对局或玩家进度。'
                : (data.activeSession
                    ? '确认后替换当前这局；取消则保持原样。'
                    : '确认后回到文件中保存的阶段。') +
                  (candidate.kind === 'checkpoint' ? ' 玩家进度不变。' : '')}
            </p>
            <div className="data-actions">
              <Button type="button" onClick={data.confirmImport}>
                {candidate.kind === 'replay'
                  ? '打开回放'
                  : candidate.kind === 'backup' && data.restoreProfile
                    ? '恢复完整备份'
                    : '载入这局'}
              </Button>
              <Button type="button" variant="secondary" onClick={data.cancel}>
                取消
              </Button>
            </div>
            <details className="data-technical">
              <summary>文件技术信息</summary>
              <p>
                v{data.candidate?.document.version}对局文件 · 对局种子
                {replay?.seed.toString(16)}
                ；校验结果不会写入当前对局。
              </p>
            </details>
          </section>
        ) : (
          <section className="settings-group data-file-prompt">
            <h3>{data.message ? '文件无法读取' : '选择要读取的文件'}</h3>
            <p>
              对局存档、回放和完整备份使用同一个入口，自动识别压缩容器或原JSON，选择后识别用途。
            </p>
            <div className="data-actions">
              <Button
                type="button"
                disabled={data.reading}
                onClick={chooseFile}
              >
                {data.message ? '重新选择文件' : '选择文件'}
              </Button>
              <Button type="button" variant="secondary" onClick={data.cancel}>
                返回进度
              </Button>
            </div>
          </section>
        )}
        {message}
      </div>
    );
  }
  if (data.task === 'backup' && data.backup) {
    const backup = data.backup;
    return (
      <section className="settings-group data-backup-preview">
        <h3>这次包含什么</h3>
        <ul>
          <li>
            <Check aria-hidden="true" />
            {backup.label}：{describeSave(backup.session)}
          </li>
          <li>
            <Check aria-hidden="true" />
            原始回放：{backup.session.replay?.rooms.length ?? 0}个已结算房间
          </li>
          <li>
            <Check aria-hidden="true" />
            玩家进度：已保存的解锁、成就及扩展数据
          </li>
        </ul>
        {data.activeSession && data.showRecent && (
          <p className="data-impact">
            上一局完整回放不在这份本局备份中，可在“上一局”行单独导出。
          </p>
        )}
        <div className="data-actions">
          <Button
            type="button"
            disabled={data.exporting}
            onClick={() => void data.confirmBackup()}
          >
            导出完整备份
          </Button>
          <Button type="button" variant="secondary" onClick={data.cancel}>
            取消
          </Button>
        </div>
        {message}
      </section>
    );
  }
  const log = data.activeSession?.replay;
  const recent = data.recent.document;
  const canBackup = !!data.activeSession || !!recent;
  const finished = data.activeSession?.game.phase === 'game_result';
  const status = data.ongoing && (
    <output
      className={
        'data-autosave ' +
        (tools.autoSaveStatus === 'session' ? 'data-autosave-unavailable' : '')
      }
    >
      {tools.autoSaveStatus === 'session' ? (
        <>
          <AlertCircle aria-hidden="true" />
          本局尚未保存到浏览器，请导出存档后再关闭页面。
        </>
      ) : (
        <>
          <Check aria-hidden="true" />
          {tools.autoSaveStatus === 'saved'
            ? '本局与未提交报价已自动保存。'
            : '正在准备自动保存…'}
        </>
      )}
    </output>
  );
  function recordRow(
    document: ReplayDocument,
    label: string,
    source: 'recent' | 'file',
    primary = false,
  ) {
    const r = document.replay;
    return (
      <div className="data-record-row" data-record-source={source}>
        <div className="data-record-info">
          <strong>
            {label} · {characterNames[r.characterId]}
          </strong>
          <span className="data-state">{r.final ? '已结束' : '部分回放'}</span>
          <small>
            {r.rooms.length} / 15房间
            {source === 'recent' ? ' · 最近一局已保留' : ' · 本次打开期间保留'}
          </small>
        </div>
        <div className="data-actions">
          <Button
            type="button"
            variant={primary ? 'default' : 'secondary'}
            onClick={source === 'recent' ? data.openRecent : data.openImported}
          >
            查看对局
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={data.exporting}
            onClick={() => void data.exportReplay(source)}
          >
            导出回放
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="data-management">
      {picker}
      <section
        className="save-panel settings-group data-records"
        aria-labelledby="data-records-title"
      >
        <h3 id="data-records-title">对局与记录</h3>
        {data.activeSession ? (
          <div className="data-record-row" data-record-source="current">
            <div className="data-record-info">
              <strong>
                {
                  characterNames[
                    data.activeSession.game.phase !== 'character_selection'
                      ? data.activeSession.game.selectedCharacter
                      : 'isaac'
                  ]
                }
              </strong>
              <span className="data-state">
                {finished ? '已结束' : '进行中'}
              </span>
              <small>
                {finished
                  ? '15 / 15房间 · ' +
                    (tools.autoSaveStatus === 'saved'
                      ? '回放已保留'
                      : '尚未自动归档，请导出回放')
                  : describeDataProgress(data.activeSession) +
                    ' · 已结算' +
                    (log?.rooms.length ?? 0) +
                    ' / 15房间'}
              </small>
            </div>
            <div className="data-actions">
              {finished ? (
                <>
                  <Button
                    type="button"
                    variant={
                      tools.autoSaveStatus === 'session'
                        ? 'secondary'
                        : 'default'
                    }
                    onClick={data.openCurrent}
                  >
                    查看对局
                  </Button>
                  <Button
                    type="button"
                    variant={
                      tools.autoSaveStatus === 'session'
                        ? 'default'
                        : 'secondary'
                    }
                    disabled={data.exporting}
                    onClick={() => void data.exportReplay('current')}
                  >
                    导出回放
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant={
                      tools.autoSaveStatus === 'session'
                        ? 'secondary'
                        : 'default'
                    }
                    onClick={data.onReturnGame}
                  >
                    返回游戏
                  </Button>
                  <Button
                    type="button"
                    variant={
                      tools.autoSaveStatus === 'session'
                        ? 'default'
                        : 'secondary'
                    }
                    disabled={data.exporting}
                    onClick={() => void data.exportCheckpoint()}
                  >
                    导出存档
                  </Button>
                  {!!log?.rooms.length && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={data.openCurrent}
                    >
                      查看回放
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          !recent && (
            <div className="data-record-row">
              <div className="data-record-info">
                <strong>没有进行中的对局</strong>
                <small>可返回游戏选择角色，或从下方导入已有文件。</small>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={data.onReturnGame}
              >
                返回游戏
              </Button>
            </div>
          )
        )}
        {status}
        {data.showRecent &&
          recent &&
          recordRow(
            recent,
            data.activeSession ? '上一局' : '最近对局',
            'recent',
            !data.activeSession,
          )}
        {data.showImported &&
          tools.importedReplay &&
          recordRow(
            tools.importedReplay,
            '文件回放',
            'file',
            !data.activeSession && !recent,
          )}
        {data.recent.error && (
          <output className="save-message">
            最近对局未能读取，原记录保留。{data.recent.error}
          </output>
        )}
        {tools.restoreMessage && (
          <details className="data-technical">
            <summary>恢复状态</summary>
            <p>{tools.restoreMessage}</p>
          </details>
        )}
      </section>
      {scope !== 'records' && (
        <section className="settings-group data-files">
          <h3>数据管理</h3>
          <p>
            当前文件统一为v5，默认无损压缩导出为.json，读取自动识别压缩容器或当前JSON。旧开发格式不读取、不迁移。
          </p>
          <div className="data-file-row">
            <div>
              <strong>导入文件</strong>
              <small>选择后识别为对局、回放或备份，再确认操作。</small>
            </div>
            <Button type="button" variant="secondary" onClick={data.openImport}>
              导入文件
            </Button>
          </div>
          {canBackup && (
            <div className="data-file-row">
              <div>
                <strong>
                  {data.activeSession ? '本局完整备份' : '最近对局备份'}
                </strong>
                <small>
                  {data.activeSession
                    ? '本局进度、回放和玩家进度一起保存。'
                    : '最近对局与玩家进度一起保存。'}
                </small>
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={!!tools.profileMessage || data.exporting}
                onClick={data.openBackup}
              >
                完整备份
              </Button>
            </div>
          )}
          {tools.profileMessage && (
            <output className="save-message">{tools.profileMessage}</output>
          )}
          <details className="data-technical">
            <summary>格式与技术信息</summary>
            <p>
              经典与生存文件统一使用v5，旧v2/v3/v4不读取或自动迁移；玩家档案版本独立。存档不写入HTML，显示偏好单独保留。
            </p>
            {data.activeSession && (
              <p>对局种子：{data.activeSession.game.seed.toString(16)}</p>
            )}
            <p>
              玩家档案预留角色解锁、成就和扩展模块；当前不限制角色选择或发放成就。
            </p>
          </details>
        </section>
      )}
      {message}
    </div>
  );
}
