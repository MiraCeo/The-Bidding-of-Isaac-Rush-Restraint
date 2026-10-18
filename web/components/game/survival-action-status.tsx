import { Button } from '@/components/ui/button';

interface SurvivalActionStatusProps {
  activePlayers: number;
  cutLine: number;
  roomScore: number;
  inheritedScore: number;
  balanceValue: number;
  decimals: 2 | 4;
  difficulty: string;
  policy: string;
  onReturnMenu: () => void;
  onRestart: () => void;
}

/** Action-stage presentation only. Do not combine provisional parts into a new score. */
export function SurvivalActionStatus(props: SurvivalActionStatusProps) {
  const parts = [
    ['本层房间分', props.roomScore],
    ['上层继承', props.inheritedScore],
    ['当前余额可兑', props.balanceValue],
  ] as const;
  return (
    <section
      className="survival-status survival-action-status"
      aria-label="生存进度"
    >
      <div className="survival-action-goal">
        <span>生存 · {props.activePlayers} 人</span>
        <strong>斩杀线 {props.cutLine}</strong>
      </div>
      <dl className="survival-score-parts" aria-label="本层积分构成">
        {parts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {' '}
              {value.toFixed(props.decimals)}
              {label === '当前余额可兑' && (
                <small className="survival-balance-hint">（层末为准）</small>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div className="survival-action-tools">
        <details className="survival-policy-details">
          <summary>难度 {props.difficulty}</summary>
          <p>AI策略 {props.policy}</p>
        </details>
        <Button type="button" variant="secondary" onClick={props.onReturnMenu}>
          返回主菜单
        </Button>
        <Button type="button" variant="secondary" onClick={props.onRestart}>
          重新选角
        </Button>
      </div>
    </section>
  );
}
