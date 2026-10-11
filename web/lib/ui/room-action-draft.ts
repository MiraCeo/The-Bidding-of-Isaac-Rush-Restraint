import {
  defaultRules,
  hasItem,
  type RewardGroup,
  type RuntimePlayerState,
} from '../game';
import type { RoomDraft } from './game-session';

export type QuoteKind = 'bid' | 'disrupt';

function canDouble(player: RuntimePlayerState, kind: QuoteKind) {
  return hasItem(
    player,
    kind === 'bid' ? 'more_options' : 'more_options_question',
  );
}

/** Change only the selection, never the four remembered amounts or the live game. */
export function switchQuoteKind(
  draft: RoomDraft,
  kind: QuoteKind,
  player: RuntimePlayerState,
) {
  const groups =
    draft.selectedAction.kind === 'withdraw'
      ? ['A' as const]
      : draft.selectedAction.groups;
  let notice = '';
  let nextGroups = [...groups];
  if (groups.length === 2 && !canDouble(player, kind)) {
    nextGroups = [groups[0]!];
    notice = `当前仅支持单${kind === 'bid' ? '竞拍' : '扰乱'}，已保留目标 ${groups[0]}；各模式报价仍保留。`;
  } else if (
    groups.length === 2 &&
    kind === 'bid' &&
    draft.amounts.A.bid + draft.amounts.B.bid > Math.floor(player.money * 0.5)
  ) {
    nextGroups = [groups[0]!];
    notice = `原双竞拍报价超过 ${Math.floor(player.money * 0.5)} 的名义总额上限，已保留目标 ${groups[0]}；调整报价后可重新选择双目标。`;
  }
  return {
    draft: { ...draft, selectedAction: { kind, groups: nextGroups } },
    notice,
  };
}

export function quoteMaximum(
  draft: RoomDraft,
  group: RewardGroup,
  kind: QuoteKind,
  player: RuntimePlayerState,
) {
  const general =
    kind === 'bid'
      ? player.money
      : Math.floor(player.money * defaultRules.disruptionMaxMoneyRatio);
  if (
    kind === 'bid' &&
    draft.selectedAction.kind === 'bid' &&
    draft.selectedAction.groups.length === 2 &&
    draft.selectedAction.groups.includes(group)
  ) {
    const other = group === 'A' ? 'B' : 'A';
    return Math.max(
      1,
      Math.floor(player.money * 0.5) - draft.amounts[other].bid,
    );
  }
  return Math.max(1, general);
}

export function selectQuoteTarget(
  draft: RoomDraft,
  kind: QuoteKind,
  group: RewardGroup,
  player: RuntimePlayerState,
): RoomDraft {
  const selected = draft.selectedAction;
  if (selected.kind !== kind || !canDouble(player, kind))
    return { ...draft, selectedAction: { kind, groups: [group] } };
  if (selected.groups.includes(group)) {
    return selected.groups.length === 2
      ? {
          ...draft,
          selectedAction: {
            kind,
            groups: selected.groups.filter((value) => value !== group),
          },
        }
      : draft;
  }
  let amounts = draft.amounts;
  if (kind === 'bid') {
    const remaining =
      Math.floor(player.money * 0.5) - amounts[selected.groups[0]!].bid;
    if (remaining < 1)
      return { ...draft, selectedAction: { kind, groups: [group] } };
    amounts = {
      ...amounts,
      [group]: {
        ...amounts[group],
        bid: Math.min(amounts[group].bid, remaining),
      },
    };
  }
  return {
    ...draft,
    amounts,
    selectedAction: { kind, groups: [...selected.groups, group] },
  };
}

/** Selection and clamping happen in one update so an edit cannot create an invalid double draft. */
export function changeQuoteAmount(
  draft: RoomDraft,
  group: RewardGroup,
  kind: QuoteKind,
  amount: number,
  player: RuntimePlayerState,
): RoomDraft {
  if (!Number.isFinite(amount)) return draft;
  const selected =
    draft.selectedAction.kind === kind &&
    draft.selectedAction.groups.includes(group)
      ? draft
      : selectQuoteTarget(draft, kind, group, player);
  const value = Math.min(
    quoteMaximum(selected, group, kind, player),
    Math.max(1, Math.round(amount)),
  );
  return {
    ...selected,
    amounts: {
      ...selected.amounts,
      [group]: { ...selected.amounts[group], [kind]: value },
    },
  };
}
