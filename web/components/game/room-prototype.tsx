import { useState } from 'react';
import { ChevronLeft, ChevronRight, Coins, Gauge, Menu, Scale } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  characterNames,
  defaultRules,
  getCurrentRoom,
  getItemDefinition,
  getRuntimeActionAmounts,
  hasItem,
  itemPresentations,
  validateTurn,
  type ActiveClientGameState,
  type PlayerAction,
  type PlayerTurn,
  type RewardGroup,
} from '@/lib/game';

type ActionKind = 'bid' | 'disrupt' | 'withdraw';
type ActiveActionKind = Exclude<ActionKind, 'withdraw'>;
type SelectedAction =
  | { kind: ActiveActionKind; groups: RewardGroup[] }
  | { kind: 'withdraw'; groups: [] };

interface RoomPrototypeProps {
  game: ActiveClientGameState;
  onSubmit: (turn: PlayerTurn) => void;
}

const roomKindNames = {
  normal: '普通房',
  treasure: '宝箱房',
  shop: '商店',
  hidden: '隐藏房',
  boss: 'BOSS 房',
} as const;
const poolNames = { common: '常见', boss: 'BOSS', curse: '诅咒' } as const;
const rarityNames = { normal: '普通', rare: '稀有' } as const;
function actionLabel(action: PlayerAction): string {
  if (action.type === 'withdraw') return '静观其变';
  return `${action.type === 'bid' ? '竞拍' : '扰乱'} ${action.group} · ${action.amount}`;
}

export function RoomPrototype({ game, onSubmit }: RoomPrototypeProps) {
  const floorMoney = defaultRules.floorStartingMoney[game.floorIndex]!;
  const [rankingOpen, setRankingOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState<SelectedAction>({ kind: 'bid', groups: ['A'] });
  const [amounts, setAmounts] = useState(() => ({
    A: { bid: Math.round(floorMoney * 0.25), disrupt: Math.round(floorMoney * 0.2) },
    B: { bid: Math.round(floorMoney * 0.25), disrupt: Math.round(floorMoney * 0.2) },
  }));

  const room = getCurrentRoom(game);
  const human = game.players.find((player) => player.id === game.humanPlayerId);
  if (!human) throw new Error('当前对局缺少真人玩家。');

  const locked = game.phase !== 'room_action';
  const canDoubleBid = hasItem(human, 'more_options');
  const canDoubleDisrupt = hasItem(human, 'more_options_question');
  const humanMoney = human.money;
  const humanEntryEvents = game.roomEntryEvents.filter(
    (event) => event.playerId === human.id || event.message.includes(human.id),
  );
  const ranking = [...game.players]
    .sort((left, right) => right.money - left.money || left.id.localeCompare(right.id))
    .map((player) => ({
      ...player,
      name: player.isHuman ? '你' : game.aiProfiles[player.id]?.name ?? player.id,
    }));

  const turn: PlayerTurn = {
    playerId: human.id,
    actions: selectedAction.kind === 'withdraw'
      ? [{ type: 'withdraw' }]
      : selectedAction.groups.map((group) => ({
          type: selectedAction.kind,
          group,
          amount: amounts[group][selectedAction.kind],
        })),
  };
  const turnErrors = validateTurn(human, turn, defaultRules);
  const resolvedPreviews = turn.actions
    .filter((action) => action.type !== 'withdraw')
    .map((action) => ({ action, amounts: getRuntimeActionAmounts(human, action, defaultRules) }));
  const totalActualCost = resolvedPreviews.reduce((sum, preview) => sum + preview.amounts.actualCost, 0);
  const publicMarketEntries = (game.pendingRoomTurns ?? [turn]).flatMap((publicTurn) => {
    const player = game.players.find((candidate) => candidate.id === publicTurn.playerId);
    if (!player) return [];
    return publicTurn.actions.flatMap((action, actionIndex) => action.type === 'withdraw'
      ? []
      : [{
          player,
          action,
          actionIndex,
          amounts: getRuntimeActionAmounts(player, action, defaultRules),
        }]);
  });
  const maximumMarketValue = Math.max(
    floorMoney * 1.25,
    ...publicMarketEntries.map((entry) => entry.amounts.marketEquivalent ?? 0),
  );

  function canDouble(kind: ActiveActionKind): boolean {
    return kind === 'bid' ? canDoubleBid : canDoubleDisrupt;
  }

  function selectAction(kind: ActiveActionKind, group: RewardGroup) {
    if (locked) return;
    if (selectedAction.kind !== kind || !canDouble(kind)) {
      setSelectedAction({ kind, groups: [group] });
      return;
    }
    if (selectedAction.groups.includes(group)) {
      if (selectedAction.groups.length === 2) {
        setSelectedAction({ kind, groups: selectedAction.groups.filter((value) => value !== group) });
      }
      return;
    }
    if (kind === 'bid') {
      const otherGroup = selectedAction.groups[0]!;
      const remaining = Math.floor(humanMoney * 0.5) - amounts[otherGroup].bid;
      if (remaining < 1) {
        setSelectedAction({ kind, groups: [group] });
        return;
      }
      setAmounts((current) => ({
        ...current,
        [group]: { ...current[group], bid: Math.min(current[group].bid, remaining) },
      }));
    }
    setSelectedAction({ kind, groups: [...selectedAction.groups, group] });
  }

  function maximumFor(group: RewardGroup, kind: ActiveActionKind): number {
    const legalMaximum = kind === 'bid'
      ? humanMoney
      : Math.floor(humanMoney * defaultRules.disruptionMaxMoneyRatio);
    if (
      kind !== 'bid' ||
      selectedAction.kind !== 'bid' ||
      !canDoubleBid ||
      selectedAction.groups.length !== 2 ||
      !selectedAction.groups.includes(group)
    ) return Math.max(1, legalMaximum);
    const otherGroup = group === 'A' ? 'B' : 'A';
    return Math.max(1, Math.floor(humanMoney * 0.5) - amounts[otherGroup].bid);
  }

  function setAmount(group: RewardGroup, kind: ActiveActionKind, amount: number) {
    if (locked) return;
    const maximum = maximumFor(group, kind);
    setAmounts((current) => ({
      ...current,
      [group]: { ...current[group], [kind]: Math.min(maximum, Math.max(1, amount)) },
    }));
    if (selectedAction.kind !== kind || !selectedAction.groups.includes(group)) {
      selectAction(kind, group);
    }
  }

  const actionDescription = selectedAction.kind === 'withdraw'
    ? '静观其变，保存全部资金'
    : `${selectedAction.kind === 'bid' ? '竞拍' : '扰乱'} ${selectedAction.groups.join('、')} · 实际扣款 ${totalActualCost}`;
  const confirmLabel = locked
    ? '行动已锁定'
    : selectedAction.kind === 'bid'
      ? '出价竞拍'
      : selectedAction.kind === 'disrupt'
        ? '扰乱市场'
        : '静观其变';

  return (
    <main className="game-page">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-block"><p className="eyebrow">THE BIDDING OF ISAAC</p><h1>以撒的竞合：冲 · 慎</h1></div>
          <nav className="main-nav" aria-label="主导航">
            <button type="button" className="nav-item nav-item-active" aria-current="page">游戏</button>
            <button type="button" className="nav-item" disabled>排行</button>
            <button type="button" className="nav-item" disabled>设置</button>
            <button type="button" className="nav-item" disabled>规则</button>
          </nav>
          <div className="round-status">
            <span className="status-chip"><Gauge aria-hidden="true" />第 {game.floorIndex + 1} 层 · 房间 {game.roomIndex + 1}/5</span>
            <span className="status-chip">{characterNames[game.selectedCharacter]}</span>
            <span className="status-chip status-chip-money"><Coins aria-hidden="true" /><strong>{human.money}</strong></span>
          </div>
        </div>
      </header>

      <button type="button" className={`drawer-tab drawer-tab-left ${rankingOpen ? 'drawer-tab-expanded' : ''}`} onClick={() => setRankingOpen((open) => !open)} aria-controls="ranking-drawer" aria-expanded={rankingOpen}>
        <Menu aria-hidden="true" /><span>{rankingOpen ? '收起排行' : '排行'}</span>{rankingOpen ? <ChevronLeft aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
      </button>
      <button type="button" className={`drawer-tab drawer-tab-right ${marketOpen ? 'drawer-tab-expanded' : ''}`} onClick={() => setMarketOpen((open) => !open)} aria-controls="market-drawer" aria-expanded={marketOpen}>
        {marketOpen ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}<span>{marketOpen ? '收起市场' : '市场'}</span><Scale aria-hidden="true" />
      </button>

      <aside id="ranking-drawer" className={`side-drawer ranking-drawer ${rankingOpen ? 'drawer-open' : ''}`} aria-hidden={!rankingOpen} inert={!rankingOpen}>
        <div className="drawer-heading"><div><p className="eyebrow">PLAYER RANKING</p><h2>资金排行</h2></div></div>
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
        <div className="drawer-heading"><div><p className="eyebrow">SHARED MARKET</p><h2>全房间共同市场</h2></div></div>
        <p className="drawer-description">{locked ? '本房间全部行动已经公开；共同基准线将在结算时生成。' : '玩家提交后才会公开本房间的共同基准线与全部行动。'}</p>
        <div className="vertical-market-wrap">
          <span className="market-top-label">预览上限 · {maximumMarketValue}</span>
          <div className="vertical-market" aria-label={locked ? '本房间公开市场等价出价' : '当前行动的市场等价出价预览'}>
            {!locked && <span className="market-pending">其他玩家尚未提交</span>}
            {[0, .25, .5, .75, 1].map((ratio) => <span key={ratio} className="market-tick" style={{ bottom: `${ratio * 100}%` }}>{Math.round(maximumMarketValue * ratio)}</span>)}
            {publicMarketEntries.map((entry) => (
              <span
                key={`${entry.player.id}-${entry.actionIndex}`}
                className={`vertical-action-marker ${entry.action.type === 'disrupt' ? 'vertical-action-marker-disrupt' : ''} ${entry.player.isHuman ? 'vertical-self-marker' : ''}`}
                style={{
                  bottom: `${((entry.amounts.marketEquivalent ?? 0) / maximumMarketValue) * 100}%`,
                  left: entry.player.isHuman
                    ? entry.action.group === 'A' ? '42%' : '58%'
                    : `${38 + ((Number(entry.player.id.replace('ai-', '')) * 17 + entry.actionIndex * 11) % 25)}%`,
                }}
                title={`${entry.player.isHuman ? '你' : game.aiProfiles[entry.player.id]?.name ?? entry.player.id}：${actionLabel(entry.action)}；市场等价 ${entry.amounts.marketEquivalent}`}
              >
                {entry.player.isHuman && <b>你{entry.action.group}</b>}
              </span>
            ))}
          </div>
          <span className="market-bottom-label">低投入 · 0</span>
        </div>
        <div className="market-legend">
          <span><i className="legend-dot legend-self" />你的行动</span>
          {locked && <span><i className="legend-dot" />竞拍</span>}
          {locked && <span><i className="legend-dot legend-disrupt" />扰乱</span>}
        </div>
        <div className="market-readout">
          <span>{locked ? '公开市场样本' : '你的市场等价出价'}</span>
          <strong>{locked ? `${publicMarketEntries.length} 份` : resolvedPreviews.length === 0 ? '—' : resolvedPreviews.map((preview) => `${preview.action.group} ${preview.amounts.marketEquivalent}`).join(' / ')}</strong>
        </div>
      </aside>

      <section className="game-stage" aria-label="房间行动区">
        <div className="room-intro">
          <div><p className="eyebrow">{roomKindNames[room.kind].toUpperCase()}</p><h2>选择这一房间的目标</h2></div>
          <p>{game.phase === 'room_result' ? '本房间已经完成结算' : locked ? '你的行动已锁定，AI 行动已经公开' : '提交前，其他玩家无法看到你的行动'}</p>
        </div>
        {humanEntryEvents.length > 0 && (
          <div className="room-entry-notice" aria-label="进入房间时发生的效果">
            <strong>进入房间</strong>
            {humanEntryEvents.map((event, index) => <span key={`${event.type}-${index}`}>{event.message}</span>)}
          </div>
        )}
        <div className="reward-grid">
          {room.rewards.map((reward) => {
            const definition = getItemDefinition(reward.itemId);
            const presentation = itemPresentations[reward.itemId];
            const groupSelected = selectedAction.kind !== 'withdraw' && selectedAction.groups.includes(reward.group);
            const bidMaximum = maximumFor(reward.group, 'bid');
            const disruptMaximum = maximumFor(reward.group, 'disrupt');
            return (
              <section key={reward.group} className={`reward-column reward-column-${reward.group.toLowerCase()}`}>
                <article className={`item-card ${groupSelected ? 'item-card-selected' : ''}`}>
                  <span className="item-emoji" aria-hidden="true">{reward.hidden ? '❓' : presentation.emoji}</span>
                  <h3>{reward.hidden ? '未知道具' : definition.name}</h3>
                  <p>{reward.hidden ? '该道具在本房间结算前对所有玩家与 AI 隐藏。' : presentation.description}</p>
                  <span className="item-meta">{reward.hidden ? '宝箱房隐藏奖励' : `${poolNames[definition.pool]}道具 · ${rarityNames[definition.rarity]}`}</span>
                </article>
                <fieldset className="action-pair" disabled={locked}>
                  <legend className="sr-only">奖励 {reward.group} 的行动</legend>
                  <ActionOption group={reward.group} kind="bid" amount={Math.min(amounts[reward.group].bid, bidMaximum)} maximum={bidMaximum} selected={selectedAction.kind === 'bid' && selectedAction.groups.includes(reward.group)} multiple={canDoubleBid} onSelect={() => selectAction('bid', reward.group)} onAmountChange={(amount) => setAmount(reward.group, 'bid', amount)} />
                  <ActionOption group={reward.group} kind="disrupt" amount={Math.min(amounts[reward.group].disrupt, disruptMaximum)} maximum={disruptMaximum} selected={selectedAction.kind === 'disrupt' && selectedAction.groups.includes(reward.group)} multiple={canDoubleDisrupt} onSelect={() => selectAction('disrupt', reward.group)} onAmountChange={(amount) => setAmount(reward.group, 'disrupt', amount)} />
                </fieldset>
              </section>
            );
          })}
        </div>
        <footer className="action-footer">
          <div className="action-summary"><span>当前选择</span><strong>{actionDescription}</strong>{turnErrors[0] && <small className="action-error">{turnErrors[0]}</small>}</div>
          <Button type="button" size="lg" className={`confirm-button confirm-button-${selectedAction.kind}`} disabled={locked || turnErrors.length > 0} onClick={() => onSubmit(turn)}>{confirmLabel}</Button>
          <Button type="button" variant="secondary" className="observe-button" disabled={locked} onClick={() => setSelectedAction({ kind: 'withdraw', groups: [] })}>静观其变</Button>
        </footer>
      </section>
    </main>
  );
}

interface ActionOptionProps {
  group: RewardGroup;
  kind: ActiveActionKind;
  amount: number;
  maximum: number;
  selected: boolean;
  multiple: boolean;
  onSelect: () => void;
  onAmountChange: (amount: number) => void;
}

function ActionOption({ group, kind, amount, maximum, selected, multiple, onSelect, onAmountChange }: ActionOptionProps) {
  const id = `${kind}-${group}`;
  const isDisruption = kind === 'disrupt';
  const changeAmount = (nextAmount: number) => onAmountChange(Math.min(maximum, Math.max(1, nextAmount)));
  return (
    <div className={`action-option ${isDisruption ? 'action-option-disrupt' : ''} ${selected ? 'action-option-selected' : ''}`}>
      <label className="action-option-label" htmlFor={id} aria-label={`${isDisruption ? '扰乱' : '竞拍'}奖励 ${group}`}>
        <input id={id} type={multiple ? 'checkbox' : 'radio'} name={multiple ? undefined : 'room-action'} checked={selected} onChange={onSelect} />
        <span><strong>{isDisruption ? '扰乱市场' : '出价竞拍'}</strong><small>{isDisruption ? '2.5× 市场影响，以得分为目的' : '争夺最高价与合作区奖励'}</small></span>
      </label>
      <div className="action-control-row">
        <div className="slider-block">
          <input type="range" min="1" max={maximum} value={amount} aria-label={`${isDisruption ? '扰乱' : '竞拍'}奖励 ${group} 的出价`} onFocus={() => !selected && onSelect()} onPointerDown={() => !selected && onSelect()} onChange={(event) => changeAmount(Number(event.target.value))} />
          <div className="range-limits"><span>1</span><span>{maximum} 上限</span></div>
        </div>
        <div className="number-stepper">
          <button type="button" onClick={() => changeAmount(amount - 1)} disabled={amount <= 1} aria-label="出价减一">−1</button>
          <input type="number" min="1" max={maximum} value={amount} onFocus={() => !selected && onSelect()} onChange={(event) => changeAmount(Number(event.target.value))} aria-label={`${isDisruption ? '扰乱' : '竞拍'}奖励 ${group} 的数值`} />
          <button type="button" onClick={() => changeAmount(amount + 1)} disabled={amount >= maximum} aria-label="出价加一">+1</button>
        </div>
      </div>
    </div>
  );
}
