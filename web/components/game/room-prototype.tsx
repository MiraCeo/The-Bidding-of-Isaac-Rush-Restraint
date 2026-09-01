import { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Coins,
  Gauge,
  Menu,
  Scale,
} from 'lucide-react';

import { Button } from '@/components/ui/button';

type Group = 'A' | 'B';
type ActionKind = 'bid' | 'disrupt' | 'withdraw';
type SelectedAction = { kind: ActionKind; group?: Group };

interface PlayerRanking {
  id: string;
  name: string;
  money: number;
  isHuman?: boolean;
}

const rewards = {
  A: { emoji: '❤️', name: '谨慎者的存钱罐', description: '把今天的余裕，留给下一次抉择。' },
  B: { emoji: '🔥', name: '冲锋者的筹码', description: '把风险推高，也把机会握在手中。' },
} as const;

const players: PlayerRanking[] = [
  { id: 'p07', name: '守夜人', money: 100 },
  { id: 'p12', name: '纸冠', money: 100 },
  { id: 'human', name: '你', money: 100, isHuman: true },
  { id: 'p03', name: '红桃六', money: 96 },
  { id: 'p15', name: '长尾猫', money: 94 },
  { id: 'p01', name: '阿贝尔', money: 91 },
  { id: 'p18', name: '旧钥匙', money: 89 },
  { id: 'p09', name: '灯芯', money: 86 },
  { id: 'p05', name: '灰骰子', money: 82 },
  { id: 'p14', name: '盐柱', money: 80 },
  { id: 'p04', name: '羊皮卷', money: 76 },
  { id: 'p17', name: '小石子', money: 73 },
  { id: 'p02', name: '木勺', money: 69 },
  { id: 'p11', name: '空口袋', money: 65 },
  { id: 'p19', name: '黑烛', money: 62 },
  { id: 'p08', name: '铜纽扣', money: 58 },
  { id: 'p16', name: '蓝火柴', money: 53 },
  { id: 'p06', name: '玻璃眼', money: 48 },
  { id: 'p13', name: '断羽', money: 44 },
  { id: 'p10', name: '无名者', money: 39 },
];

const marketPlayers = [
  { value: 14, group: 'A' },
  { value: 22, group: 'B' },
  { value: 31, group: 'A' },
  { value: 38, group: 'B' },
  { value: 45, group: 'A' },
  { value: 55, group: 'A' },
  { value: 63, group: 'B' },
  { value: 72, group: 'A' },
  { value: 81, group: 'B' },
  { value: 92, group: 'A' },
  { value: 104, group: 'B' },
] as const;

export function RoomPrototype() {
  const [rankingOpen, setRankingOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState<SelectedAction>({ kind: 'bid', group: 'A' });
  const [amounts, setAmounts] = useState({
    A: { bid: 24, disrupt: 18 },
    B: { bid: 24, disrupt: 18 },
  });

  const ranking = useMemo(
    () => [...players].sort((left, right) => right.money - left.money || left.name.localeCompare(right.name, 'zh-CN')),
    [],
  );

  const selectedAmount = selectedAction.group
    ? amounts[selectedAction.group][selectedAction.kind === 'withdraw' ? 'bid' : selectedAction.kind]
    : 0;
  const marketEquivalent = selectedAction.kind === 'disrupt' ? selectedAmount * 2.5 : selectedAmount;
  const marketPosition = Math.min((marketEquivalent / 125) * 100, 100);

  function selectAction(kind: Exclude<ActionKind, 'withdraw'>, group: Group) {
    setSelectedAction({ kind, group });
  }

  function setAmount(group: Group, kind: 'bid' | 'disrupt', amount: number) {
    setAmounts((current) => ({
      ...current,
      [group]: { ...current[group], [kind]: amount },
    }));
    selectAction(kind, group);
  }

  const selectedLabel = selectedAction.kind === 'withdraw'
    ? '静观其变，保存全部资金'
    : `${selectedAction.kind === 'bid' ? '竞拍' : '扰乱'}奖励 ${selectedAction.group} · 支付 ${selectedAmount}`;
  const confirmLabel = selectedAction.kind === 'bid'
    ? '出价竞拍'
    : selectedAction.kind === 'disrupt'
      ? '扰乱市场'
      : '静观其变';

  return (
    <main className="game-page">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-block">
            <p className="eyebrow">THE BIDDING OF ISAAC</p>
            <h1>以撒的竞合：冲 · 慎</h1>
          </div>

          <nav className="main-nav" aria-label="主导航">
            <button type="button" className="nav-item nav-item-active" aria-current="page">游戏</button>
            <button type="button" className="nav-item" disabled>排行</button>
            <button type="button" className="nav-item" disabled>设置</button>
            <button type="button" className="nav-item" disabled>规则</button>
          </nav>

          <div className="round-status">
            <span className="status-chip"><Gauge aria-hidden="true" />第 1 层 · 房间 1/5</span>
            <span className="status-chip status-chip-money"><Coins aria-hidden="true" /><strong>100</strong></span>
          </div>
        </div>
      </header>

      <button
        type="button"
        className={`drawer-tab drawer-tab-left ${rankingOpen ? 'drawer-tab-expanded' : ''}`}
        onClick={() => setRankingOpen((open) => !open)}
        aria-controls="ranking-drawer"
        aria-expanded={rankingOpen}
      >
        <Menu aria-hidden="true" />
        <span>{rankingOpen ? '收起排行' : '排行'}</span>
        {rankingOpen ? <ChevronLeft aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
      </button>

      <button
        type="button"
        className={`drawer-tab drawer-tab-right ${marketOpen ? 'drawer-tab-expanded' : ''}`}
        onClick={() => setMarketOpen((open) => !open)}
        aria-controls="market-drawer"
        aria-expanded={marketOpen}
      >
        {marketOpen ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}
        <span>{marketOpen ? '收起市场' : '市场'}</span>
        <Scale aria-hidden="true" />
      </button>

      <aside id="ranking-drawer" className={`side-drawer ranking-drawer ${rankingOpen ? 'drawer-open' : ''}`} aria-hidden={!rankingOpen} inert={!rankingOpen}>
        <div className="drawer-heading">
          <div><p className="eyebrow">PLAYER RANKING</p><h2>资金排行</h2></div>
        </div>
        <p className="drawer-description">按照当前剩余资金从高到低排列。</p>
        <ol className="ranking-list">
          {ranking.map((player, index) => (
            <li key={player.id} className={player.isHuman ? 'ranking-self' : ''}>
              <span className="ranking-position">{index + 1}</span>
              <span className="ranking-avatar" aria-hidden="true">{player.name.slice(0, 1)}</span>
              <span className="ranking-name">{player.name}{player.isHuman && <small>当前玩家</small>}</span>
              <strong><Coins aria-hidden="true" />{player.money}</strong>
            </li>
          ))}
        </ol>
      </aside>

      <aside id="market-drawer" className={`side-drawer market-drawer ${marketOpen ? 'drawer-open' : ''}`} aria-hidden={!marketOpen} inert={!marketOpen}>
        <div className="drawer-heading">
          <div><p className="eyebrow">SHARED MARKET</p><h2>全房间共同市场</h2></div>
        </div>
        <p className="drawer-description">A、B 两组共同影响一条市场基准线。</p>

        <div className="vertical-market-wrap">
          <span className="market-top-label">高投入 · 125</span>
          <div className="vertical-market" aria-label="纵向共同市场示意">
            <div className="vertical-cooperation-zone" />
            <div className="vertical-baseline"><span>共同基准线</span></div>
            {[0, 25, 50, 75, 100, 125].map((tick) => (
              <span key={tick} className="market-tick" style={{ bottom: `${(tick / 125) * 100}%` }}>{tick}</span>
            ))}
            {marketPlayers.map((player, index) => (
              <span
                key={`${player.value}-${index}`}
                className={`vertical-player-marker market-group-${player.group.toLowerCase()}`}
                style={{ bottom: `${(player.value / 125) * 100}%`, left: `${index % 3 === 0 ? 38 : index % 3 === 1 ? 50 : 62}%` }}
              />
            ))}
            {selectedAction.kind !== 'withdraw' && (
              <span className="vertical-self-marker" style={{ bottom: `${marketPosition}%` }}><b>你</b></span>
            )}
          </div>
          <span className="market-bottom-label">低投入 · 0</span>
        </div>

        <div className="market-legend">
          <span><i className="legend-dot market-group-a" />A 组</span>
          <span><i className="legend-dot market-group-b" />B 组</span>
          <span><i className="legend-dot legend-self" />你</span>
        </div>
        <div className="market-readout">
          <span>你的市场等价出价</span>
          <strong>{selectedAction.kind === 'withdraw' ? '—' : marketEquivalent}</strong>
        </div>
      </aside>

      <section className="game-stage" aria-label="房间行动区">
        <div className="room-intro">
          <div><p className="eyebrow">ROOM REWARDS</p><h2>选择这一房间的目标</h2></div>
          <p>所有行动将同时秘密提交</p>
        </div>

        <div className="reward-grid">
          {(Object.keys(rewards) as Group[]).map((group) => {
            const reward = rewards[group];
            const groupSelected = selectedAction.group === group && selectedAction.kind !== 'withdraw';
            return (
              <section key={group} className={`reward-column reward-column-${group.toLowerCase()}`}>
                <article className={`item-card ${groupSelected ? 'item-card-selected' : ''}`}>
                  <span className="item-emoji" aria-hidden="true">{reward.emoji}</span>
                  <h3>{reward.name}</h3>
                  <p>{reward.description}</p>
                </article>

                <fieldset className="action-pair">
                  <legend className="sr-only">奖励 {group} 的行动</legend>
                  <ActionOption
                    group={group}
                    kind="bid"
                    amount={amounts[group].bid}
                    maximum={100}
                    selected={selectedAction.kind === 'bid' && selectedAction.group === group}
                    onSelect={() => selectAction('bid', group)}
                    onAmountChange={(amount) => setAmount(group, 'bid', amount)}
                  />
                  <ActionOption
                    group={group}
                    kind="disrupt"
                    amount={amounts[group].disrupt}
                    maximum={50}
                    selected={selectedAction.kind === 'disrupt' && selectedAction.group === group}
                    onSelect={() => selectAction('disrupt', group)}
                    onAmountChange={(amount) => setAmount(group, 'disrupt', amount)}
                  />
                </fieldset>
              </section>
            );
          })}
        </div>

        <footer className="action-footer">
          <div className="action-summary">
            <span>当前选择</span>
            <strong>{selectedLabel}</strong>
          </div>
          <Button
            type="button"
            size="lg"
            className={`confirm-button confirm-button-${selectedAction.kind}`}
          >
            {confirmLabel}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="observe-button"
            onClick={() => setSelectedAction({ kind: 'withdraw' })}
          >
            静观其变
          </Button>
        </footer>
      </section>
    </main>
  );
}

interface ActionOptionProps {
  group: Group;
  kind: 'bid' | 'disrupt';
  amount: number;
  maximum: number;
  selected: boolean;
  onSelect: () => void;
  onAmountChange: (amount: number) => void;
}

function ActionOption({ group, kind, amount, maximum, selected, onSelect, onAmountChange }: ActionOptionProps) {
  const id = `${kind}-${group}`;
  const isDisruption = kind === 'disrupt';

  function changeAmount(nextAmount: number) {
    onSelect();
    onAmountChange(Math.min(maximum, Math.max(1, nextAmount)));
  }

  return (
    <div className={`action-option ${isDisruption ? 'action-option-disrupt' : ''} ${selected ? 'action-option-selected' : ''}`}>
      <label className="action-option-label" htmlFor={id} aria-label={`${isDisruption ? '扰乱' : '竞拍'}奖励 ${group}`}>
        <input id={id} type="radio" name="room-action" checked={selected} onChange={onSelect} />
        <span>
          <strong>{isDisruption ? '扰乱市场' : '出价竞拍'}</strong>
          <small>{isDisruption ? '2.5× 市场影响，放弃奖励' : '争夺最高价与合作区奖励'}</small>
        </span>
      </label>
      <div className="action-control-row">
        <div className="slider-block">
          <input
            type="range"
            min="1"
            max={maximum}
            value={amount}
            aria-label={`${isDisruption ? '扰乱' : '竞拍'}奖励 ${group} 的出价`}
            onFocus={onSelect}
            onPointerDown={onSelect}
            onChange={(event) => changeAmount(Number(event.target.value))}
          />
          <div className="range-limits"><span>1</span><span>{maximum} 上限</span></div>
        </div>
        <div className="number-stepper">
          <button type="button" onClick={() => changeAmount(amount - 1)} disabled={amount <= 1} aria-label="出价减一">−1</button>
          <input
            type="number"
            min="1"
            max={maximum}
            value={amount}
            onFocus={onSelect}
            onChange={(event) => changeAmount(Number(event.target.value))}
            aria-label={`${isDisruption ? '扰乱' : '竞拍'}奖励 ${group} 的数值`}
          />
          <button type="button" onClick={() => changeAmount(amount + 1)} disabled={amount >= maximum} aria-label="出价加一">+1</button>
        </div>
      </div>
    </div>
  );
}
