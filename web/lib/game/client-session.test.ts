import { describe, expect, it } from 'vitest';

import { personalitiesConflict } from './ai-personality';
import { defaultRules } from './config';
import {
  clientGameReducer,
  createCharacterSelectionState,
  getCurrentRoom,
  startClientGame,
  type ClientGameState,
} from './client-session';
import { validateTurn } from './turns';

describe('client game session', () => {
  it('starts at character selection without creating a room early', () => {
    expect(createCharacterSelectionState(42)).toEqual({
      phase: 'character_selection',
      seed: 42,
    });
  });

  it('creates a complete deterministic game after choosing a character', () => {
    const first = startClientGame('isaac', 20260908);
    const second = startClientGame('isaac', 20260908);

    expect(first).toEqual(second);
    expect(first.phase).toBe('room_action');
    expect(first.players).toHaveLength(20);
    expect(first.rooms).toHaveLength(3);
    expect(first.rooms.every((floor) => floor.length === 5)).toBe(true);
    expect(getCurrentRoom(first)).toEqual(first.rooms[0]![0]);

    const human = first.players.find((player) => player.id === 'human');
    expect(human?.characterId).toBe('isaac');
    expect(human?.money).toBe(110);
    expect(human?.items.map((item) => item.itemId)).toEqual(['d6']);
  });

  it('creates nineteen AI with the 9/5/5 doctrines and active personality pool', () => {
    const state = startClientGame('lost', 12345);
    const profiles = Object.values(state.aiProfiles);

    expect(profiles).toHaveLength(19);
    expect(profiles.filter((profile) => profile.doctrine === 'balanced')).toHaveLength(9);
    expect(profiles.filter((profile) => profile.doctrine === 'cooperative')).toHaveLength(5);
    expect(profiles.filter((profile) => profile.doctrine === 'chaotic')).toHaveLength(5);
    for (const profile of profiles) {
      expect(profile.personalities.length).toBeGreaterThanOrEqual(2);
      expect(profile.personalities.length).toBeLessThanOrEqual(4);
      expect(profile.personalities).not.toContain('all_in');
      expect(personalitiesConflict(profile.personalities)).toBe(false);
    }
  });

  it('transitions from character selection only once', () => {
    const selection = createCharacterSelectionState(7);
    const active = clientGameReducer(selection, { type: 'start_game', characterId: 'azazel' });
    expect(active.phase).toBe('room_action');
    expect(clientGameReducer(active, { type: 'start_game', characterId: 'lost' })).toBe(active);
  });

  it('accepts one legal human turn and locks the room for AI reveal', () => {
    const active = startClientGame('isaac', 7);
    const turn = {
      playerId: 'human',
      actions: [{ type: 'bid' as const, group: 'A' as const, amount: 25 }],
    };
    const submitted = clientGameReducer(active, { type: 'submit_player_turn', turn });
    expect(submitted.phase).toBe('ai_reveal');
    if (submitted.phase === 'character_selection') throw new Error('Expected an active game.');
    expect(submitted.submittedPlayerTurn).toEqual(turn);
    expect(submitted.revealedAiDecisions).toHaveLength(19);
    expect(submitted.pendingRoomTurns).toHaveLength(20);
    expect(submitted.pendingRoomTurns?.[0]).toEqual(turn);
    for (const decision of submitted.revealedAiDecisions) {
      const player = submitted.players.find((candidate) => candidate.id === decision.turn.playerId);
      expect(player).toBeDefined();
      expect(validateTurn(player!, decision.turn, defaultRules)).toEqual([]);
    }
    expect(clientGameReducer(submitted, { type: 'submit_player_turn', turn })).toBe(submitted);
  });

  it('keeps AI decisions independent from the human secret action', () => {
    const first = startClientGame('isaac', 8128);
    const second = startClientGame('isaac', 8128);
    const bidA = clientGameReducer(first, {
      type: 'submit_player_turn',
      turn: { playerId: 'human', actions: [{ type: 'bid', group: 'A', amount: 20 }] },
    });
    const disruptB = clientGameReducer(second, {
      type: 'submit_player_turn',
      turn: { playerId: 'human', actions: [{ type: 'disrupt', group: 'B', amount: 20 }] },
    });
    if (bidA.phase === 'character_selection' || disruptB.phase === 'character_selection') {
      throw new Error('Expected active games.');
    }
    expect(bidA.revealedAiDecisions).toEqual(disruptB.revealedAiDecisions);
    expect(bidA.pendingRoomTurns?.slice(1)).toEqual(disruptB.pendingRoomTurns?.slice(1));
  });

  it('rejects an illegal human turn without changing phase', () => {
    const active = startClientGame('isaac', 7);
    const submitted = clientGameReducer(active, {
      type: 'submit_player_turn',
      turn: {
        playerId: 'human',
        actions: [{ type: 'disrupt', group: 'B', amount: 56 }],
      },
    });
    expect(submitted).toBe(active);
  });

  it('settles the revealed room once and stores a structured result', () => {
    const active = startClientGame('isaac', 314159);
    const revealed = clientGameReducer(active, {
      type: 'submit_player_turn',
      turn: { playerId: 'human', actions: [{ type: 'bid', group: 'A', amount: 25 }] },
    });
    if (revealed.phase !== 'ai_reveal') throw new Error('Expected AI reveal.');

    const settled = clientGameReducer(revealed, { type: 'settle_room' });
    expect(settled.phase).toBe('room_result');
    if (settled.phase === 'character_selection') throw new Error('Expected an active game.');
    expect(settled.roomSettlement).not.toBeNull();
    expect(settled.roomSettlement?.players).toEqual(settled.players);
    expect(settled.roomSettlement?.turns).toHaveLength(20);
    expect(settled.roomSettlement?.playersBefore.find((player) => player.id === 'human')?.money).toBe(110);
    expect(settled.roomSettlement?.room).toEqual(getCurrentRoom(settled));
    expect(settled.roomSettlement?.resolvedActions.length).toBeGreaterThanOrEqual(20);
    expect(settled.roomSettlement?.baseline?.participantCount).toBeGreaterThan(0);
    expect(settled.recentMarkets).toHaveLength(1);
    expect(settled.players).not.toEqual(active.players);
    expect(active.players.find((player) => player.id === 'human')?.money).toBe(110);
    expect(settled.players.every((player) => Number.isInteger(player.money))).toBe(true);
    expect(clientGameReducer(settled, { type: 'settle_room' })).toBe(settled);
  });

  it('replays the same settlement deterministically from the same room state', () => {
    const createRevealed = () => clientGameReducer(startClientGame('eden', 271828), {
      type: 'submit_player_turn',
      turn: { playerId: 'human', actions: [{ type: 'bid', group: 'B', amount: 20 }] },
    });
    const first = createRevealed();
    const second = createRevealed();
    if (first.phase !== 'ai_reveal' || second.phase !== 'ai_reveal') {
      throw new Error('Expected AI reveal states.');
    }
    expect(clientGameReducer(first, { type: 'settle_room' }))
      .toEqual(clientGameReducer(second, { type: 'settle_room' }));
  });

  it('plays all fifteen rooms through to a complete final ranking', () => {
    let state: ClientGameState = startClientGame('lost', 20260909);
    for (let roomNumber = 0; roomNumber < 15; roomNumber += 1) {
      expect(state.phase).toBe('room_action');
      if (state.phase === 'character_selection') throw new Error('Expected an active game.');
      expect(state.floorIndex).toBe(Math.floor(roomNumber / 5));
      expect(state.roomIndex).toBe(roomNumber % 5);

      state = clientGameReducer(state, {
        type: 'submit_player_turn',
        turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
      });
      expect(state.phase).toBe('ai_reveal');
      state = clientGameReducer(state, { type: 'settle_room' });
      expect(state.phase).toBe('room_result');
      state = clientGameReducer(state, { type: 'advance_room' });
    }

    expect(state.phase).toBe('game_result');
    if (state.phase !== 'game_result') throw new Error('Expected the final result.');
    expect(state.finalRanking).toHaveLength(20);
    expect(new Set(state.finalRanking.map((entry) => entry.playerId)).size).toBe(20);
    expect(state.finalRanking.map((entry) => entry.finalScore)).toEqual(
      [...state.finalRanking].map((entry) => entry.finalScore).sort((left, right) => right - left),
    );
    expect(Object.values(state.aiProfiles).every((profile) => profile.history.rounds === 15)).toBe(true);
    const restarted = clientGameReducer(state, { type: 'restart_game', seed: 99 });
    expect(restarted).toEqual({ phase: 'character_selection', seed: 99 });
  });

  it('reproduces the same complete game from a fixed seed', () => {
    const playGame = (): ClientGameState => {
      let state: ClientGameState = startClientGame('azazel', 424242);
      for (let roomNumber = 0; roomNumber < 15; roomNumber += 1) {
        if (state.phase !== 'room_action') throw new Error('Expected room action.');
        state = clientGameReducer(state, {
          type: 'submit_player_turn',
          turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
        });
        state = clientGameReducer(state, { type: 'settle_room' });
        state = clientGameReducer(state, { type: 'advance_room' });
      }
      return state;
    };
    expect(playGame()).toEqual(playGame());
  });
});
