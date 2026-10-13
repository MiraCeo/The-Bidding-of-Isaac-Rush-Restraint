import { ItemIcon } from './item-icon';
import { displayItemText } from '@/lib/ui/item-labels';
import { useState, useEffect, type ReactNode } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Coins,
  Gauge,
  Menu,
  Scale,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { RoomUtilities } from './room-utilities';
import { MatchRestartControl } from './match-restart-control';
import { GameNavigation } from './game-navigation';
import { ItemBadges } from './item-badges';
import { BuildStatus, QuotePreview } from './player-build';
import { createRoomDraft, type RoomDraft } from '@/lib/ui/game-session';
import {
  changeQuoteAmount,
  quoteMaximum,
  quoteAvailableMaximum,
  selectQuoteTarget,
  switchQuoteKind,
} from '@/lib/ui/room-action-draft';
import { useUtilityPages } from './use-utility-pages';
import type { PreferenceSaveStatus } from './game-settings';
import type { GamePreferences } from '@/lib/ui/game-preferences';
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

interface RoomPrototypeProps {
  rules?: import('@/lib/game/types').RulesConfig;
  extraStatus?: ReactNode;
  renderUtilities?: (
    panel: import('./room-utilities').RoomUtilityPanel | null,
    turn: PlayerTurn,
    onReturn: () => void,
  ) => ReactNode;
  draft?: RoomDraft;
  onDraftChange?: (update: (current: RoomDraft) => RoomDraft) => void;
  game: ActiveClientGameState;
  onSubmit: (turn: PlayerTurn) => void;
  preferences: GamePreferences;
  preferenceSaveStatus: PreferenceSaveStatus;
  onPreferencesChange: (preferences: GamePreferences) => void;
}

const roomKindNames = {
  normal: '普通房',
  treasure: '宝箱房',
  shop: '商店',
  hidden: '隐藏房',
  boss: 'BOSS 房',
} as const;
function actionLabel(action: PlayerAction): string {
  if (action.type === 'withdraw') return '静观其变';
  return `${action.type === 'bid' ? '竞拍' : '扰乱'} ${action.group} · ${action.amount}`;
}

export function RoomPrototype({
  rules = defaultRules,
  extraStatus,
  renderUtilities,
  draft,
  onDraftChange,
  game,
  onSubmit,
  preferences,
  preferenceSaveStatus,
  onPreferencesChange,
}: RoomPrototypeProps) {
  const floorMoney = rules.floorStartingMoney[game.floorIndex]!;
  const [rankingOpen, setRankingOpen] = useState(
    preferences.rankingInitiallyOpen,
  );
  const [marketOpen, setMarketOpen] = useState(preferences.marketInitiallyOpen);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setRankingOpen(preferences.rankingInitiallyOpen);
    });
    return () => {
      cancelled = true;
    };
  }, [preferences.rankingInitiallyOpen]);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setMarketOpen(preferences.marketInitiallyOpen);
    });
    return () => {
      cancelled = true;
    };
  }, [preferences.marketInitiallyOpen]);
  const { utilityPanel, changeUtilityPanel } = useUtilityPages();
  const [localDraft, setLocalDraft] = useState(() =>
    createRoomDraft({ ...game, phase: 'room_action' }, rules)!,
  );
  const currentDraft = draft ?? localDraft;
  const { selectedAction, amounts } = currentDraft;
  const changeDraft = onDraftChange ?? setLocalDraft;
  const [lastQuoteKind, setLastQuoteKind] = useState<ActiveActionKind>(
    currentDraft.selectedAction.kind === 'withdraw'
      ? 'bid'
      : currentDraft.selectedAction.kind,
  );
  const [modeNotice, setModeNotice] = useState('');
  const activeKind =
    selectedAction.kind === 'withdraw' ? lastQuoteKind : selectedAction.kind;

  const room = getCurrentRoom(game);
  const human = game.players.find((player) => player.id === game.humanPlayerId);
  if (!human) throw new Error('当前对局缺少真人玩家。');

  const locked = game.phase !== 'room_action';
  const canDoubleBid = hasItem(human, 'more_options');
  const canDoubleDisrupt = hasItem(human, 'more_options_question');
  const humanMoney = human.money;
  const hasQuoteFunds =
    activeKind === 'bid'
      ? humanMoney > 0
      : Math.floor(humanMoney * rules.disruptionMaxMoneyRatio) > 0;
  const humanEntryEvents = game.roomEntryEvents.filter(
    (event) => event.playerId === human.id || event.message.includes(human.id),
  );
  const ranking = [...game.players]
    .sort(
      (left, right) =>
        right.money - left.money || left.id.localeCompare(right.id),
    )
    .map((player) => ({
      ...player,
      name: player.isHuman
        ? '你'
        : (game.aiProfiles[player.id]?.name ?? player.id),
    }));

  const turn: PlayerTurn = {
    playerId: human.id,
    actions:
      selectedAction.kind === 'withdraw'
        ? [{ type: 'withdraw' }]
        : selectedAction.groups.map((group) => ({
            type: selectedAction.kind,
            group,
            amount: amounts[group][selectedAction.kind],
          })),
  };
  const turnErrors = validateTurn(human, turn, rules);
  const previewTurn =
    hasQuoteFunds || selectedAction.kind === 'withdraw'
      ? turn
      : { ...turn, actions: [] };
  const resolvedPreviews = previewTurn.actions
    .filter((action) => action.type !== 'withdraw')
    .map((action) => ({
      action,
      amounts: getRuntimeActionAmounts(human, action, rules),
    }));
  const totalActualCost = resolvedPreviews.reduce(
    (sum, preview) => sum + preview.amounts.actualCost,
    0,
  );
  const publicMarketEntries = (game.pendingRoomTurns ?? [previewTurn]).flatMap(
    (publicTurn) => {
      const player = game.players.find(
        (candidate) => candidate.id === publicTurn.playerId,
      );
      if (!player) return [];
      return publicTurn.actions.flatMap((action, actionIndex) =>
        action.type === 'withdraw'
          ? []
          : [
              {
                player,
                action,
                actionIndex,
                amounts: getRuntimeActionAmounts(player, action, rules),
              },
            ],
      );
    },
  );
  const maximumMarketValue = Math.max(
    floorMoney * 1.25,
    ...publicMarketEntries.map((entry) => entry.amounts.marketEquivalent ?? 0),
  );

  function canDouble(kind: ActiveActionKind): boolean {
    return kind === 'bid' ? canDoubleBid : canDoubleDisrupt;
  }

  function switchMode(kind: ActiveActionKind) {
    if (locked) return;
    setLastQuoteKind(kind);
    setModeNotice(switchQuoteKind(currentDraft, kind, human!).notice);
    changeDraft((current) => switchQuoteKind(current, kind, human!).draft);
  }

  function selectAction(kind: ActiveActionKind, group: RewardGroup) {
    if (locked) return;
    setLastQuoteKind(kind);
    setModeNotice('');
    changeDraft((current) => selectQuoteTarget(current, kind, group, human!));
  }

  function setAmount(
    group: RewardGroup,
    kind: ActiveActionKind,
    amount: number,
  ) {
    if (locked) return;
    setModeNotice('');
    setLastQuoteKind(kind);
    changeDraft((current) =>
      changeQuoteAmount(current, group, kind, amount, human!),
    );
  }

  const actionDescription =
    selectedAction.kind === 'withdraw'
      ? '静观其变，保存全部资金'
      : !hasQuoteFunds
        ? '无可用报价，请选择静观其变'
        : `${selectedAction.kind === 'bid' ? '竞拍' : '扰乱'} ${selectedAction.groups.join('、')} · 实际扣款 ${totalActualCost}`;
  const confirmLabel = locked
    ? '行动已锁定'
    : selectedAction.kind === 'bid'
      ? '出价竞拍'
      : selectedAction.kind === 'disrupt'
        ? '扰乱市场'
        : '静观其变';

  return (
    <main className={utilityPanel ? 'ranking-page' : 'game-page'}>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-block">
            <p className="eyebrow">THE BIDDING OF ISAAC</p>
            <h1>以撒的竞合：冲 · 慎</h1>
          </div>
          <GameNavigation
            page={utilityPanel}
            onPageChange={changeUtilityPanel}
          />
          <div className="round-status">
            <span className="status-chip">
              <Gauge aria-hidden="true" />第 {game.floorIndex + 1} 层 · 房间{' '}
              {game.roomIndex + 1}/5
            </span>
            <button
              type="button"
              className="status-chip build-entry"
              aria-label="查看角色构筑"
              aria-current={utilityPanel === 'build' ? 'page' : undefined}
              onClick={() => changeUtilityPanel('build')}
            >
              {characterNames[game.selectedCharacter]}{' '}
              <span aria-hidden="true">▾</span>
            </button>
            <span className="status-chip status-chip-money">
              <Coins aria-hidden="true" />
              <strong>{human.money}</strong>
            </span>
          </div>
        </div>
      </header>
      {extraStatus}

      <div
        className="room-game-content"
        hidden={utilityPanel !== null}
        inert={utilityPanel !== null}
      >
        <button
          type="button"
          className={`drawer-tab drawer-tab-left ${rankingOpen ? 'drawer-tab-expanded' : ''}`}
          onClick={() => setRankingOpen((open) => !open)}
          aria-controls="ranking-drawer"
          aria-expanded={rankingOpen}
        >
          <Menu aria-hidden="true" />
          <span>{rankingOpen ? '收起排行' : '排行'}</span>
          {rankingOpen ? (
            <ChevronLeft aria-hidden="true" />
          ) : (
            <ChevronRight aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className={`drawer-tab drawer-tab-right ${marketOpen ? 'drawer-tab-expanded' : ''}`}
          onClick={() => setMarketOpen((open) => !open)}
          aria-controls="market-drawer"
          aria-expanded={marketOpen}
        >
          {marketOpen ? (
            <ChevronRight aria-hidden="true" />
          ) : (
            <ChevronLeft aria-hidden="true" />
          )}
          <span>{marketOpen ? '收起市场' : '市场'}</span>
          <Scale aria-hidden="true" />
        </button>

        <aside
          id="ranking-drawer"
          className={`side-drawer ranking-drawer ${rankingOpen ? 'drawer-open' : ''}`}
          aria-hidden={!rankingOpen}
          inert={!rankingOpen}
        >
          <div className="drawer-heading">
            <div>
              <p className="eyebrow">PLAYER RANKING</p>
              <h2>资金排行</h2>
            </div>
          </div>
          <p className="drawer-description">按照当前剩余资金从高到低排列。</p>
          <ol className="ranking-list">
            {ranking.map((player, index) => (
              <li
                key={player.id}
                className={player.isHuman ? 'ranking-self' : ''}
              >
                <span className="ranking-position">{index + 1}</span>
                <span className="ranking-avatar" aria-hidden="true">
                  {player.name.slice(0, 1)}
                </span>
                <span className="ranking-name">
                  {player.name}
                  {player.isHuman && <small>当前玩家</small>}
                </span>
                <strong>
                  <Coins aria-hidden="true" />
                  {player.money}
                </strong>
              </li>
            ))}
          </ol>
        </aside>

        <aside
          id="market-drawer"
          className={`side-drawer market-drawer ${marketOpen ? 'drawer-open' : ''}`}
          aria-hidden={!marketOpen}
          inert={!marketOpen}
        >
          <div className="drawer-heading">
            <div>
              <p className="eyebrow">SHARED MARKET</p>
              <h2>全房间共同市场</h2>
            </div>
          </div>
          <p className="drawer-description">
            {locked
              ? '本房间全部行动已经公开；共同基准线将在结算时生成。'
              : '玩家提交后才会公开本房间的共同基准线与全部行动。'}
          </p>
          <div className="vertical-market-wrap">
            <span className="market-top-label">
              预览上限 · {maximumMarketValue}
            </span>
            <div
              className="vertical-market"
              aria-label={
                locked ? '本房间公开市场等价出价' : '当前行动的市场等价出价预览'
              }
            >
              {!locked && (
                <span className="market-pending">其他玩家尚未提交</span>
              )}
              {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
                <span
                  key={ratio}
                  className="market-tick"
                  style={{ bottom: `${ratio * 100}%` }}
                >
                  {Math.round(maximumMarketValue * ratio)}
                </span>
              ))}
              {publicMarketEntries.map((entry) => (
                <span
                  key={`${entry.player.id}-${entry.actionIndex}`}
                  className={`vertical-action-marker ${entry.action.type === 'disrupt' ? 'vertical-action-marker-disrupt' : ''} ${entry.player.isHuman ? 'vertical-self-marker' : ''}`}
                  style={{
                    bottom: `${((entry.amounts.marketEquivalent ?? 0) / maximumMarketValue) * 100}%`,
                    left: entry.player.isHuman
                      ? entry.action.group === 'A'
                        ? '42%'
                        : '58%'
                      : `${38 + ((Number(entry.player.id.replace('ai-', '')) * 17 + entry.actionIndex * 11) % 25)}%`,
                  }}
                  title={`${entry.player.isHuman ? '你' : (game.aiProfiles[entry.player.id]?.name ?? entry.player.id)}：${actionLabel(entry.action)}；市场等价 ${entry.amounts.marketEquivalent}`}
                >
                  {entry.player.isHuman && <b>你{entry.action.group}</b>}
                </span>
              ))}
            </div>
            <span className="market-bottom-label">低投入 · 0</span>
          </div>
          <div className="market-legend">
            <span>
              <i className="legend-dot legend-self" />
              你的行动
            </span>
            {locked && (
              <span>
                <i className="legend-dot" />
                竞拍
              </span>
            )}
            {locked && (
              <span>
                <i className="legend-dot legend-disrupt" />
                扰乱
              </span>
            )}
          </div>
          <div className="market-readout">
            <span>{locked ? '公开市场样本' : '你的市场等价出价'}</span>
            <strong>
              {locked
                ? `${publicMarketEntries.length} 份`
                : resolvedPreviews.length === 0
                  ? '—'
                  : resolvedPreviews
                      .map(
                        (preview) =>
                          `${preview.action.group} ${preview.amounts.marketEquivalent}`,
                      )
                      .join(' / ')}
            </strong>
          </div>
        </aside>

        <section className="game-stage" aria-label="房间行动区">
          <div className="room-intro">
            <div>
              <p className="eyebrow">
                {roomKindNames[room.kind].toUpperCase()}
              </p>
              <h2>选择这一房间的目标</h2>
            </div>
            <div className="room-intro-controls">
              <BuildStatus
                game={game}
                rules={rules}
                onOpen={() => changeUtilityPanel('build')}
              />
              {utilityPanel === null && <MatchRestartControl />}
            </div>
          </div>
          {humanEntryEvents.length > 0 && (
            <div
              className="room-entry-notice"
              aria-label="进入房间时发生的效果"
            >
              <strong>进入房间</strong>
              {humanEntryEvents.map((event, index) => (
                <span key={`${event.type}-${index}`}>
                  {displayItemText(event.message)}
                </span>
              ))}
            </div>
          )}
          <div className={`action-mode-bar action-mode-bar-${activeKind}`}>
            <fieldset className="action-mode-switch" aria-label="本房行动方式">
              <legend className="sr-only">本房行动方式</legend>
              {(['bid', 'disrupt'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={selectedAction.kind === kind}
                  disabled={locked}
                  onClick={() => switchMode(kind)}
                >
                  {kind === 'bid' ? '竞拍' : '扰乱'}
                </button>
              ))}
            </fieldset>
            <p id="action-mode-hint">
              {selectedAction.kind === 'withdraw'
                ? hasQuoteFunds
                  ? '已选择观望，确认后提交；点击模式或目标可恢复报价。'
                  : '已选择观望，确认后提交；当前无可用报价。'
                : !hasQuoteFunds
                  ? '当前资金不足以提交正整数报价；可选择静观其变。'
                  : activeKind === 'bid'
                    ? canDoubleBid
                      ? `可选 A＋B · 双竞拍名义总额 ≤ ${Math.floor(humanMoney * 0.5)}`
                      : '选择一个目标 · 争夺最高价与合作区奖励'
                    : `${canDoubleDisrupt ? '可选 A＋B' : '选择一个目标'} · 每笔上限 ${Math.floor(humanMoney * rules.disruptionMaxMoneyRatio)} · 市场影响 ×2.5`}
            </p>
          </div>
          <output className="action-mode-notice">{modeNotice}</output>
          <div className="reward-grid">
            {room.rewards.map((reward) => {
              const definition = getItemDefinition(reward.itemId);
              const presentation = itemPresentations[reward.itemId];
              const available = quoteAvailableMaximum(
                currentDraft,
                reward.group,
                activeKind,
                human,
              );
              const groupSelected =
                available > 0 &&
                selectedAction.kind !== 'withdraw' &&
                selectedAction.groups.includes(reward.group);
              const maximum = quoteMaximum(
                currentDraft,
                reward.group,
                activeKind,
                human,
              );
              return (
                <section
                  key={reward.group}
                  className={`reward-column reward-column-${reward.group.toLowerCase()}`}
                >
                  <article
                    className={`item-card ${groupSelected ? 'item-card-selected' : ''}`}
                  >
                    <button
                      type="button"
                      className="reward-target"
                      aria-label={`选择目标 ${reward.group}`}
                      aria-pressed={groupSelected}
                      disabled={locked || !hasQuoteFunds}
                      onClick={() => selectAction(activeKind, reward.group)}
                    >
                      目标 {reward.group}{' '}
                      <span>{groupSelected ? '已选' : '选择'}</span>
                    </button>
                    {reward.hidden ? (
                      <ItemIcon hidden size="room" className="room-item-icon" />
                    ) : (
                      <ItemIcon
                        itemId={reward.itemId}
                        size="room"
                        className="room-item-icon"
                      />
                    )}
                    <h3>{reward.hidden ? '未知道具' : definition.name}</h3>
                    <p>
                      {reward.hidden
                        ? '该道具在本房间结算前对所有玩家与 AI 隐藏。'
                        : presentation.description}
                    </p>
                    {reward.hidden ? (
                      <span className="item-meta">宝箱房隐藏奖励</span>
                    ) : (
                      <ItemBadges item={definition} compact />
                    )}
                  </article>
                  <fieldset
                    className="action-pair"
                    disabled={locked}
                    aria-describedby="action-mode-hint"
                  >
                    <legend className="sr-only">
                      奖励 {reward.group} 的行动
                    </legend>
                    <ActionOption
                      group={reward.group}
                      kind={activeKind}
                      amount={amounts[reward.group][activeKind]}
                      maximum={maximum}
                      available={available}
                      selected={groupSelected}
                      multiple={canDouble(activeKind)}
                      onSelect={() => selectAction(activeKind, reward.group)}
                      onAmountChange={(amount) =>
                        setAmount(reward.group, activeKind, amount)
                      }
                    />
                  </fieldset>
                  <QuotePreview
                    game={game}
                    turn={previewTurn}
                    group={reward.group}
                    compact
                  />
                </section>
              );
            })}
          </div>
          <p className="secret-action-note">
            仅预览你的报价，不预测秘密市场与最终积分。提交前，其他玩家无法看到你的行动。
          </p>
          <footer
            className="action-footer action-footer-sticky"
            aria-label="确认本房行动"
          >
            <div className="action-summary">
              <span>当前选择</span>
              <strong>{actionDescription}</strong>
              {turnErrors[0] && (
                <small className="action-error">{turnErrors[0]}</small>
              )}
            </div>
            <Button
              type="button"
              size="lg"
              className={`confirm-button confirm-button-${selectedAction.kind}`}
              disabled={locked || turnErrors.length > 0}
              onClick={() => onSubmit(turn)}
            >
              {confirmLabel}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="observe-button"
              disabled={locked}
              aria-pressed={selectedAction.kind === 'withdraw'}
              onClick={() => {
                setModeNotice('');
                changeDraft((current) => ({
                  ...current,
                  selectedAction: { kind: 'withdraw', groups: [] },
                }));
              }}
            >
              静观其变
            </Button>
          </footer>
        </section>
      </div>
      {renderUtilities ? (
        renderUtilities(utilityPanel, turn, () => changeUtilityPanel(null))
      ) : (
        <RoomUtilities
          panel={utilityPanel}
          game={game}
          turn={turn}
          preferences={preferences}
          saveStatus={preferenceSaveStatus}
          onPanelChange={changeUtilityPanel}
          onPreferencesChange={(next) => {
            if (next.rankingInitiallyOpen !== preferences.rankingInitiallyOpen)
              setRankingOpen(next.rankingInitiallyOpen);
            if (next.marketInitiallyOpen !== preferences.marketInitiallyOpen)
              setMarketOpen(next.marketInitiallyOpen);
            onPreferencesChange(next);
          }}
        />
      )}
    </main>
  );
}

interface ActionOptionProps {
  group: RewardGroup;
  kind: ActiveActionKind;
  amount: number;
  maximum: number;
  available: number;
  selected: boolean;
  multiple: boolean;
  onSelect: () => void;
  onAmountChange: (amount: number) => void;
}

function ActionOption({
  group,
  kind,
  amount,
  maximum,
  available,
  selected,
  multiple,
  onSelect,
  onAmountChange,
}: ActionOptionProps) {
  const id = `${kind}-${group}`;
  const isDisruption = kind === 'disrupt';
  const changeAmount = (nextAmount: number) =>
    onAmountChange(Math.min(maximum, Math.max(1, nextAmount)));
  return (
    <div
      className={`action-option ${isDisruption ? 'action-option-disrupt' : ''} ${selected ? 'action-option-selected' : ''}`}
    >
      <label
        className="action-option-label"
        htmlFor={id}
        aria-label={`${isDisruption ? '扰乱' : '竞拍'}奖励 ${group}`}
      >
        <input
          id={id}
          type={multiple ? 'checkbox' : 'radio'}
          name={multiple ? undefined : 'room-action'}
          checked={selected}
          disabled={available < 1}
          onChange={onSelect}
        />
        <span>
          <strong>
            {group} · {isDisruption ? '扰乱报价' : '竞拍报价'}
          </strong>
          <small>
            {available < 1
              ? '资金不足，无法报价'
              : selected
                ? '已选择此目标'
                : multiple
                  ? '可追加此目标'
                  : '选择此目标'}
          </small>
        </span>
      </label>
      {available < 1 ? (
        <output className="action-quote-unavailable">
          <strong>无可用报价</strong>
          <span>可切换为静观其变，不产生零元报价。</span>
        </output>
      ) : (
        <div className="action-control-row">
          <div className="slider-block">
            <input
              type="range"
              min="1"
              max={maximum}
              value={amount}
              aria-label={`${isDisruption ? '扰乱' : '竞拍'}奖励 ${group} 的出价`}
              onFocus={() => !selected && onSelect()}
              onPointerDown={() => !selected && onSelect()}
              onChange={(event) => changeAmount(Number(event.target.value))}
            />
            <div className="range-limits">
              <span>1</span>
              <span>{maximum} 上限</span>
            </div>
          </div>
          <div className="number-stepper">
            <button
              type="button"
              onClick={() => changeAmount(amount - 1)}
              disabled={amount <= 1}
              aria-label="出价减一"
            >
              −1
            </button>
            <input
              type="number"
              min="1"
              max={maximum}
              value={amount}
              onFocus={() => !selected && onSelect()}
              onChange={(event) => changeAmount(Number(event.target.value))}
              aria-label={`${isDisruption ? '扰乱' : '竞拍'}奖励 ${group} 的数值`}
            />
            <button
              type="button"
              onClick={() => changeAmount(amount + 1)}
              disabled={amount >= maximum}
              aria-label="出价加一"
            >
              +1
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
