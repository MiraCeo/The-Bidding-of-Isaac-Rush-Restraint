import { describe, expect, it } from 'vitest';
import {
  defaultRules,
  startClientGame,
  validateTurn,
  type ItemId,
  type PlayerTurn,
} from '../game';
import { grantItemInstance } from '../game/runtime';
import { createRoomDraft, type RoomDraft } from './game-session';
import {
  changeQuoteAmount,
  quoteMaximum,
  selectQuoteTarget,
  switchQuoteKind,
  type QuoteKind,
} from './room-action-draft';
import { parseGameSave, serializeGameSave } from './game-save';
import { createGameSession, reduceGameSession } from './game-session';

function fixture(items: ItemId[] = []) {
  const game = startClientGame('isaac', 42);
  const player = game.players.find((p) => p.isHuman)!;
  player.items = [];
  for (const [i, itemId] of items.entries())
    grantItemInstance(player, {
      itemId,
      instanceId: `draft-${i}`,
      acquiredOrder: i,
    });
  const draft = createRoomDraft(game)!;
  return { player, draft };
}
function turn(draft: RoomDraft): PlayerTurn {
  return {
    playerId: 'human',
    actions:
      draft.selectedAction.kind === 'withdraw'
        ? [{ type: 'withdraw' }]
        : draft.selectedAction.groups.map((group) => ({
            type: draft.selectedAction.kind as QuoteKind,
            group,
            amount:
              draft.amounts[group][draft.selectedAction.kind as QuoteKind],
          })),
  };
}

describe('compact action drafts without rule or save format changes', () => {
  it('remembers all four amounts while switching modes and preserves the selected single target', () => {
    const { player, draft } = fixture();
    draft.selectedAction = { kind: 'bid', groups: ['B'] };
    draft.amounts = { A: { bid: 31, disrupt: 7 }, B: { bid: 39, disrupt: 13 } };
    const before = structuredClone(draft);
    const other = switchQuoteKind(draft, 'disrupt', player);
    expect(other.draft.selectedAction).toEqual({
      kind: 'disrupt',
      groups: ['B'],
    });
    expect(other.notice).toBe('');
    expect(switchQuoteKind(other.draft, 'bid', player).draft).toEqual(before);
    expect(draft).toEqual(before);
  });
  it.each([
    [[], 'bid', false],
    [[], 'disrupt', false],
    [['more_options'], 'bid', true],
    [['more_options'], 'disrupt', false],
    [['more_options_question'], 'bid', false],
    [['more_options_question'], 'disrupt', true],
    [['more_options', 'more_options_question'], 'bid', true],
    [['more_options', 'more_options_question'], 'disrupt', true],
  ] as [ItemId[], QuoteKind, boolean][])(
    'checks destination double permission for %s / %s',
    (items, kind, allowed) => {
      const { player, draft } = fixture(items);
      draft.selectedAction = {
        kind: kind === 'bid' ? 'disrupt' : 'bid',
        groups: ['B', 'A'],
      };
      const result = switchQuoteKind(draft, kind, player);
      expect(result.draft.selectedAction.groups).toEqual(
        allowed ? ['B', 'A'] : ['B'],
      );
      expect(Boolean(result.notice)).toBe(!allowed);
      expect(result.draft.amounts).toEqual(draft.amounts);
      expect(validateTurn(player, turn(result.draft), defaultRules)).toEqual(
        [],
      );
    },
  );
  it('retains remembered bids but falls back explicitly if returning double bids exceed half the money', () => {
    const { player, draft } = fixture([
      'more_options',
      'more_options_question',
    ]);
    draft.selectedAction = { kind: 'disrupt', groups: ['B', 'A'] };
    draft.amounts.A.bid = 80;
    draft.amounts.B.bid = 70;
    const result = switchQuoteKind(draft, 'bid', player);
    expect(result.notice).toContain('超过 55');
    expect(result.draft.selectedAction.groups).toEqual(['B']);
    expect(result.draft.amounts).toEqual(draft.amounts);
    expect(validateTurn(player, turn(result.draft), defaultRules)).toEqual([]);
  });
  it('edits an unselected second target atomically and caps the actual draft, not just the display', () => {
    const { player, draft } = fixture(['more_options']);
    draft.amounts.A.bid = 40;
    const changed = changeQuoteAmount(draft, 'B', 'bid', 100, player);
    expect(changed.selectedAction.groups).toEqual(['A', 'B']);
    expect(changed.amounts.B.bid).toBe(15);
    expect(quoteMaximum(changed, 'A', 'bid', player)).toBe(40);
    expect(validateTurn(player, turn(changed), defaultRules)).toEqual([]);
    expect(draft.amounts.B.bid).toBe(25);
  });
  it('selects only the edited target if the current single bid consumes the entire double budget', () => {
    const { player, draft } = fixture(['more_options']);
    draft.amounts.A.bid = 80;
    const changed = changeQuoteAmount(draft, 'B', 'bid', 90, player);
    expect(changed.selectedAction.groups).toEqual(['B']);
    expect(changed.amounts.A.bid).toBe(80);
    expect(changed.amounts.B.bid).toBe(90);
    expect(validateTurn(player, turn(changed), defaultRules)).toEqual([]);
  });
  it('bounds integer inputs, keeps disruption half caps, and ignores non-finite input', () => {
    const { player, draft } = fixture(['more_options_question']);
    expect(
      changeQuoteAmount(draft, 'A', 'bid', 10.6, player).amounts.A.bid,
    ).toBe(11);
    expect(
      changeQuoteAmount(draft, 'A', 'bid', -20, player).amounts.A.bid,
    ).toBe(1);
    expect(changeQuoteAmount(draft, 'A', 'bid', NaN, player)).toBe(draft);
    let next = changeQuoteAmount(draft, 'A', 'disrupt', 999, player);
    next = changeQuoteAmount(next, 'B', 'disrupt', 999, player);
    expect(next.amounts.A.disrupt).toBe(55);
    expect(next.amounts.B.disrupt).toBe(55);
    expect(validateTurn(player, turn(next), defaultRules)).toEqual([]);
  });
  it('keeps at least one target and removes a checked target only when another remains', () => {
    const { player, draft } = fixture(['more_options']);
    expect(selectQuoteTarget(draft, 'bid', 'A', player)).toBe(draft);
    const both = selectQuoteTarget(draft, 'bid', 'B', player);
    expect(
      selectQuoteTarget(both, 'bid', 'A', player).selectedAction.groups,
    ).toEqual(['B']);
  });
  it('can leave observation without submitting or modifying remembered amounts', () => {
    const { player, draft } = fixture();
    draft.selectedAction = { kind: 'withdraw', groups: [] };
    expect(switchQuoteKind(draft, 'disrupt', player).draft).toEqual({
      ...draft,
      selectedAction: { kind: 'disrupt', groups: ['A'] },
    });
    expect(draft.selectedAction.kind).toBe('withdraw');
  });
  it('round-trips switched double drafts through the unchanged v1 save parser', () => {
    const session = reduceGameSession(createGameSession(42), {
      type: 'start_game',
      characterId: 'jacob_esau',
    });
    if (session.game.phase === 'character_selection')
      throw new Error('Not started');
    const player = session.game.players.find((p) => p.isHuman)!;
    let draft = changeQuoteAmount(session.draft!, 'A', 'bid', 100, player);
    draft = switchQuoteKind(draft, 'disrupt', player).draft;
    draft = selectQuoteTarget(draft, 'disrupt', 'B', player);
    draft = switchQuoteKind(draft, 'bid', player).draft;
    session.draft = draft;
    expect(draft.selectedAction.groups).toEqual(['A']);
    expect(parseGameSave(serializeGameSave(session)).session).toEqual(session);
  });
});
