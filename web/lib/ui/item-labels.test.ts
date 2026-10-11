import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getItemDefinition } from '../game/item-catalog';
import { itemPresentations } from '../game/item-presentation';
import { displayItemText } from './item-labels';
import { saveCompatibility } from './game-version';
import {
  createGameSession,
  reduceGameSession,
  type GameSession,
} from './game-session';
import { parseGameSave, serializeGameSave } from './game-save';
import { parseReplay, serializeReplay } from './game-replay';
import { replayRoomLocator } from './replay-record';
import { RoomResult } from '@/components/game/room-result';

function finishedGame(): GameSession {
  let session = reduceGameSession(createGameSession(42), {
    type: 'start_game',
    characterId: 'isaac',
  });
  for (let i = 0; i < 15; i++) {
    if (session.game.phase === 'character_selection') throw new Error();
    const money = session.game.players.find((p) => p.isHuman)!.money;
    session = reduceGameSession(session, {
      type: 'submit_player_turn',
      turn: {
        playerId: 'human',
        actions:
          i === 14 && money > 0
            ? [{ type: 'bid', group: 'A', amount: money }]
            : [{ type: 'withdraw' }],
      },
    });
    session = reduceGameSession(session, { type: 'advance_room' });
  }
  return session;
}
describe('cosmetic item rename without a v1 protocol change', () => {
  it('changes both visible catalog names, keeping original IDs, categories, stacking and descriptions', () => {
    expect(getItemDefinition('moms_heart')).toMatchObject({
      id: 'moms_heart',
      name: '以撒的心脏',
      pool: 'boss',
      rarity: 'rare',
      effectStacks: true,
    });
    expect(getItemDefinition('short_brimstone')).toMatchObject({
      id: 'short_brimstone',
      name: '硫磺火宝宝',
      pool: 'boss',
      rarity: 'normal',
      effectStacks: false,
    });
    expect(itemPresentations.moms_heart.description).toContain('200%');
    expect(itemPresentations.short_brimstone.description).toContain(
      '85%～120%',
    );
  });
  it('retains the exact compatibility fingerprint audited before this rename', () => {
    expect(saveCompatibility).toBe('20-personality-client-1-818e3e55');
  });
  it('resolves former labels for rendering without editing stored event strings', () => {
    const raw = '2 份妈妈的心脏追溯增加 100 分。短程硫磺火生效。';
    expect(displayItemText(raw)).toBe(
      '2 份以撒的心脏追溯增加 100 分。硫磺火宝宝生效。',
    );
    expect(raw).toContain('妈妈的心脏');
    expect(displayItemText('福袋返还 75 资金。')).toBe('福袋返还 75 资金。');
  });
  it('reads the unchanged v1 snapshots, raw heart traces and old replay locators across the complete game', () => {
    const session = finishedGame();
    const log = session.replay!;
    const rawHearts = log.rooms
      .flatMap((r) => r.settlement.events)
      .filter((e) => e.itemId === 'moms_heart' && e.type === 'score');
    expect(rawHearts.length).toBeGreaterThan(0);
    expect(rawHearts.every((e) => e.message.includes('妈妈的心脏'))).toBe(true);
    log.startedBuild = '0.2.2-6149ab3f422e';
    log.rooms.forEach((r) => {
      r.build = '0.2.2-6149ab3f422e';
    });
    const last = log.rooms[14]!;
    const locator = replayRoomLocator(log, last);
    const restored = parseGameSave(serializeGameSave(session)).session;
    expect(JSON.parse(JSON.stringify(restored))).toEqual(
      JSON.parse(JSON.stringify(session)),
    );
    const archive = parseReplay(serializeReplay(log, '0.2.2-6149ab3f422e'));
    expect(archive.replay).toEqual(log);
    expect(replayRoomLocator(archive.replay, archive.replay.rooms[14]!)).toBe(
      locator,
    );
  });
  it('shows the new heart name in actual room results, not the v1 wire wording', () => {
    const session = finishedGame();
    if (session.game.phase === 'character_selection') throw new Error();
    const html = renderToStaticMarkup(
      createElement(RoomResult, {
        game: { ...session.game, phase: 'room_result' },
        onAdvance: () => {},
        onShowRanking: () => {},
      }),
    );
    expect(html).toContain('以撒的心脏');
    expect(html).not.toContain('妈妈的心脏');
  });
});
