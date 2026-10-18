import { MarketImpactPreview } from './market-impact-preview';
import { classicDifficultyLabel } from '@/lib/game/classic-difficulty';
import type { HistoricalMarket } from '@/lib/ui/market-history';
import {
  getQuoteCapacity,
  formatMarketAmount,
  capacityDescription,
} from '@/lib/ui/quote-capacity';
import { GameHeader } from './game-header';
import { ItemIcon } from './item-icon';
import { LocateSelfButton } from './ranking-self-summary';
import { displayItemText } from '@/lib/ui/item-labels';
import { useState, useEffect, useMemo, type ReactNode } from 'react';
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
  type PlayerTurn,
  type RewardGroup,
} from '@/lib/game';

type ActionKind = 'bid' | 'disrupt' | 'withdraw';
type ActiveActionKind = Exclude<ActionKind, 'withdraw'>;

interface RoomPrototypeProps {
  marketHistory?: readonly HistoricalMarket[];
  rules?: import('@/lib/game/types').RulesConfig;
  extraStatus?: ReactNode;
  headingActions?: ReactNode;
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

export function RoomPrototype({
  marketHistory,
  rules = defaultRules,
  extraStatus,
  headingActions,
  renderUtilities,
  draft,
  onDraftChange,
  game,
  onSubmit,
  preferences,
  preferenceSaveStatus,
  onPreferencesChange,
}: RoomPrototypeProps) {
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
  const ranking = useMemo(
    () =>
      [...game.players]
        .sort(
          (left, right) =>
            right.money - left.money || left.id.localeCompare(right.id),
        )
        .map((player) => ({
          ...player,
          name: player.isHuman
            ? '你'
            : (game.aiProfiles[player.id]?.name ?? player.id),
          capacity: getQuoteCapacity(player, rules),
        })),
    [game.players, game.aiProfiles, rules],
  );
  const ownCapacity = ranking.find((player) => player.isHuman)!.capacity;

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

  const panelControls = (
    <div className="room-panel-controls" aria-label="房间辅助面板">
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

      <span className="room-panel-summary">
        资金名次 {ranking.findIndex((player) => player.isHuman) + 1} /{' '}
        {ranking.length}
      </span>
    </div>
  );

  return (
    <main className={utilityPanel ? 'ranking-page' : 'game-page'}>
      <GameHeader
        showContext={utilityPanel !== 'settings' && utilityPanel !== 'rules'}
        navigation={
          <GameNavigation
            page={utilityPanel}
            onPageChange={changeUtilityPanel}
          />
        }
        context={
          <>
            <div className="round-status">
              {!extraStatus && (
                <span className="status-chip">
                  难度 {classicDifficultyLabel(game.classicAi?.difficulty)}
                </span>
              )}
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
            {utilityPanel === null && panelControls}
          </>
        }
      />
      {utilityPanel === null && extraStatus}

      <div
        className="room-game-content"
        data-ranking-open={rankingOpen}
        data-market-open={marketOpen}
        hidden={utilityPanel !== null}
        inert={utilityPanel !== null}
      >
        <aside
          id="ranking-drawer"
          className={`side-drawer ranking-drawer ${rankingOpen ? 'drawer-open' : ''}`}
          hidden={!rankingOpen}
          aria-hidden={!rankingOpen}
          inert={!rankingOpen}
          data-ranking-scope
        >
          <div className="drawer-heading">
            <div>
              <p className="eyebrow">PLAYER RANKING</p>
              <h2>资金排行</h2>
            </div>
            <LocateSelfButton />
          </div>
          <p className="drawer-description">
            按当前资金降序 · {ranking.length} 人
          </p>
          <details className="ranking-capacity-help">
            <summary>计算口径</summary>
            <p>
              下行竞／扰为单目标理论市场等价上限，并非本房报价。按当前资金、已持有道具和合法名义报价上限计算。完美视力修正竞拍市场等价；Steam折扣只减扣款，不扩大名义上限。双行动受各自总额限制，不把两项单目标上限相加；悬停数值可查看双行动能力。
            </p>
          </details>
          <p className="ranking-capacity-legend">
            上行资金 · 下行竞拍／扰乱能力上限
          </p>
          <ol className="ranking-list">
            {ranking.map((player, index) => (
              <li
                key={player.id}
                data-player-id={player.id}
                className={player.isHuman ? 'ranking-self' : ''}
                data-ranking-self={player.isHuman}
                tabIndex={player.isHuman ? -1 : undefined}
              >
                <span className="ranking-position">{index + 1}</span>
                <span className="ranking-avatar" aria-hidden="true">
                  {player.name.slice(0, 1)}
                </span>
                <span className="ranking-name" title={player.name}>
                  {player.name}
                  {player.isHuman && <small>本人</small>}
                </span>
                <div className="ranking-amounts">
                  <strong>
                    <Coins aria-hidden="true" />
                    {player.money}
                  </strong>
                  <small
                    className="ranking-capacity"
                    title={capacityDescription(player.capacity)}
                    aria-label={capacityDescription(player.capacity)}
                  >
                    <span>
                      竞{' '}
                      {formatMarketAmount(player.capacity.bid.marketEquivalent)}
                    </span>
                    <span>
                      扰{' '}
                      {formatMarketAmount(
                        player.capacity.disrupt.marketEquivalent,
                      )}
                    </span>
                  </small>
                </div>
              </li>
            ))}
          </ol>
        </aside>

        <aside
          id="market-drawer"
          className={`side-drawer market-drawer ${marketOpen ? 'drawer-open' : ''}`}
          hidden={!marketOpen}
          aria-hidden={!marketOpen}
          inert={!marketOpen}
        >
          <div className="drawer-heading">
            <div>
              <p className="eyebrow">MARKET REFERENCE</p>
              <h2>市场参考</h2>
            </div>
          </div>
          <MarketImpactPreview
            history={marketHistory}
            onViewReplay={() => changeUtilityPanel('replay')}
            player={human}
            turn={previewTurn}
            kind={activeKind}
            capacity={ownCapacity}
            rules={rules}
          />
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
              {headingActions}
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
                  data-selected={groupSelected}
                >
                  <article
                    className={`item-card ${groupSelected ? 'item-card-selected' : ''}`}
                  >
                    <label
                      className="reward-target"
                      htmlFor={activeKind + '-' + reward.group}
                    >
                      <input
                        id={activeKind + '-' + reward.group}
                        type={canDouble(activeKind) ? 'checkbox' : 'radio'}
                        name={canDouble(activeKind) ? undefined : 'room-action'}
                        checked={groupSelected}
                        disabled={locked || available < 1}
                        onChange={() => selectAction(activeKind, reward.group)}
                        aria-label={
                          (activeKind === 'disrupt' ? '扰乱' : '竞拍') +
                          '奖励 ' +
                          reward.group
                        }
                        aria-describedby="action-mode-hint"
                      />
                      <strong>目标 {reward.group}</strong>
                      <span>
                        {groupSelected
                          ? '已选'
                          : available < 1
                            ? '资金不足'
                            : canDouble(activeKind)
                              ? '可追加'
                              : '未选择'}
                      </span>
                    </label>
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
  onSelect,
  onAmountChange,
}: ActionOptionProps) {
  const isDisruption = kind === 'disrupt';
  const changeAmount = (nextAmount: number) =>
    onAmountChange(Math.min(maximum, Math.max(1, nextAmount)));
  return (
    <div
      className={`action-option ${isDisruption ? 'action-option-disrupt' : ''} ${selected ? 'action-option-selected' : ''}`}
    >
      <strong className="action-quote-label">
        {isDisruption ? '扰乱报价' : '竞拍报价'}
      </strong>
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
