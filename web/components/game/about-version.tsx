import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  appVersion,
  appReleaseNotes,
  saveCompatibility,
  readBuildVersion,
  saveFormatVersion,
  replayFormatVersion,
  versionFeedbackText,
} from '@/lib/ui/game-version';

export function AboutVersion() {
  const [message, setMessage] = useState('');
  const feedback = versionFeedbackText();
  async function copy() {
    try {
      await navigator.clipboard.writeText(feedback);
      setMessage('版本信息已复制，可与截图或回放一起反馈。');
    } catch {
      setMessage('剪贴板不可用，可选中下面的版本信息手动复制。');
    }
  }
  return (
    <section
      className="about-version settings-group"
      aria-labelledby="version-title"
    >
      <h3 id="version-title">版本与更新</h3>
      <dl className="version-values">
        <div>
          <dt>游戏版本</dt>
          <dd>{appVersion}</dd>
        </div>
        <div>
          <dt>当前实际构建</dt>
          <dd>{readBuildVersion()}</dd>
        </div>
        <div>
          <dt>规则兼容标识</dt>
          <dd>{saveCompatibility}</dd>
        </div>
        <div>
          <dt>文件格式</dt>
          <dd>
            存档 v{saveFormatVersion} · 回放 v{replayFormatVersion}
          </dd>
        </div>
      </dl>
      <p>界面版本与规则版本分开：{appReleaseNotes[0]!.compatibility}</p>
      <label htmlFor="version-feedback">反馈时附上这段信息</label>
      <textarea
        id="version-feedback"
        aria-label="版本反馈信息"
        readOnly
        value={feedback}
        rows={4}
        onFocus={(e) => e.target.select()}
      />
      <Button type="button" variant="secondary" onClick={() => void copy()}>
        复制版本信息
      </Button>
      {message && <output>{message}</output>}
      <div className="version-history">
        {appReleaseNotes.map((release, i) => (
          <details key={release.version} open={i === 0}>
            <summary>
              {release.version} · {release.title}
              <small>{release.date}</small>
            </summary>
            <ul>
              {release.highlights.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
            <p>{release.compatibility}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
