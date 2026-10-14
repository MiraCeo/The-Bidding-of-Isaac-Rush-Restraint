import { describe, expect, it, vi } from 'vitest';
import { decideAiTurn } from './ai-decision';
import { defaultRules } from './config';
import { createClientResearchReducer, startClientGame } from './client-session';
import { createRuntimePlayer } from './runtime';
import { settleRuntimeRoom } from './room-engine';
import { generateFloor } from './rooms';
import { createSeededRandom } from './random';
import type { PlayerTurn, RuntimePlayerState } from './item-types';
import {
  startSurvivalPrototype,
  survivalGameReducer,
  createSurvivalResearchReducer,
  continueSurvivalAfterHumanElimination,
  survivalPublicStatus,
  type SurvivalGameState,
  type SurvivalPrototypeOptions,
} from './survival-session';
import { survivalPrototypeRules } from './survival-rules';

const options: SurvivalPrototypeOptions = {
  characterId: 'isaac',
  seed: 42,
  cutLines: Array<number>(7).fill(0),
  bossRewards: 'standard',
};
const withdraw: PlayerTurn = {
  playerId: 'human',
  actions: [{ type: 'withdraw' }],
};

function playFloor(
  state: SurvivalGameState,
  reducer = survivalGameReducer,
): SurvivalGameState {
  let current = state;
  for (let index = 0; index < 5; index += 1) {
    expect(current.phase).toBe('room_action');
    current = reducer(
      current,
      current.activePlayerIds.includes('human')
        ? { type: 'submit_player_turn', turn: withdraw }
        : { type: 'submit_ai_room' },
    );
    expect(current.phase).toBe('room_result');
    if (index < 4) current = reducer(current, { type: 'advance_room' });
  }
  return current;
}

/** Explicit room-result fixture: isolate layer orchestration from heuristic AI performance. */
function uniqueFloorResult(
  state: SurvivalGameState,
  humanLowest = true,
): SurvivalGameState {
  const result = playFloor(state);
  return {
    ...result,
    players: result.players.map((player) =>
      result.activePlayerIds.includes(player.id)
        ? { ...player, money: 0 }
        : player,
    ),
    currentFloorRoomScores: Object.fromEntries(
      result.activePlayerIds.map((id, index) => [
        id,
        [0, 0, 0, 0, id === 'human' ? (humanLowest ? 1 : 1000) : 100 + index],
      ]),
    ),
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe('isolated survival session prototype', () => {
  it('starts with one generated floor, twenty survivors and role-adjusted 1000 public money', () => {
    const state = startSurvivalPrototype(options);
    expect(state.mode).toBe('survival');
    expect(state.phase).toBe('room_action');
    expect(state.players).toHaveLength(20);
    expect(state.activePlayerIds).toHaveLength(20);
    expect(state.rooms).toHaveLength(1);
    expect(state.rooms[0]).toHaveLength(5);
    expect(state.rooms[0]![4]!.kind).toBe('boss');
    expect(state.players[0]!.money).toBe(1100);
    expect(state.previousSurvivalScores.human).toBe(0);
    expect(state.floorRecords).toEqual([]);
    expect(Object.isFrozen(state.rules)).toBe(true);
    expect(Object.isFrozen(state.cutLines)).toBe(true);
  });

  it('retains the classic participant initialization without changing classic funds or rules', () => {
    const before = JSON.stringify(defaultRules);
    const classic = startClientGame('isaac', 42);
    const survival = startSurvivalPrototype(options);
    expect(survival.aiProfiles).toEqual(classic.aiProfiles);
    expect(
      survival.players.map((player) => [player.id, player.characterId]),
    ).toEqual(classic.players.map((player) => [player.id, player.characterId]));
    survival.players.forEach((player, index) => {
      if (player.characterId !== 'eden')
        expect(player.items).toEqual(classic.players[index]!.items);
      expect(
        player.items.some((item) => item.itemId === 'dark_princes_crown'),
      ).toBe(false);
    });
    expect(classic.players[0]!.money).toBe(110);
    expect(JSON.stringify(defaultRules)).toBe(before);
  });

  it('requires explicit cut lines and uses the confirmed standard BOSS policy', () => {
    for (const changes of [
      { cutLines: [] },
      { cutLines: [100] },
      { cutLines: Array(7).fill(-1) },
      { cutLines: Array(7).fill(Infinity) },
      { cutLines: Array(7).fill(100.00001) },
      { seed: -1 },
      { seed: 0x100000000 },
      { seed: 1.5 },
      { seed: NaN },
      { bossRewards: 'classic_final_hearts' },
      { bossRewards: 'unknown' },
      { rules: { ...survivalPrototypeRules, initialPlayerCount: 19 } },
      { rules: { ...survivalPrototypeRules, roomsPerFloor: 6 } },
      {
        rules: { ...survivalPrototypeRules, finalSurvivorCount: 20 },
        cutLines: [],
      },
    ]) {
      expect(() =>
        startSurvivalPrototype({
          ...options,
          ...changes,
        } as SurvivalPrototypeOptions),
      ).toThrow(RangeError);
    }
  });

  it('copies the experiment schedule rather than retaining caller-owned mutable configuration', () => {
    const cutLines = Array<number>(7).fill(100);
    const rules = { ...survivalPrototypeRules };
    const state = startSurvivalPrototype({ ...options, cutLines, rules });
    cutLines[0] = 999;
    rules.floorStartingMoney = 5;
    expect(state.cutLines[0]).toBe(100);
    expect(state.rules.floorStartingMoney).toBe(1000);
  });

  it('rejects illegal, duplicate and wrong-phase commands without adding facts or consuming AI decisions', () => {
    const decide = vi.fn(decideAiTurn);
    const reducer = createSurvivalResearchReducer(decide);
    const state = startSurvivalPrototype(options);
    expect(reducer(state, { type: 'submit_ai_room' })).toBe(state);
    expect(reducer(state, { type: 'advance_room' })).toBe(state);
    expect(reducer(state, { type: 'advance_floor' })).toBe(state);
    expect(
      reducer(state, {
        type: 'submit_player_turn',
        turn: {
          playerId: 'human',
          actions: [{ type: 'bid', group: 'A', amount: 1101 }],
        },
      }),
    ).toBe(state);
    expect(decide).not.toHaveBeenCalled();
    const result = reducer(state, {
      type: 'submit_player_turn',
      turn: withdraw,
    });
    expect(decide).toHaveBeenCalledTimes(19);
    expect(result.roomRecords).toHaveLength(1);
    expect(result.currentFloorRoomScores.human).toHaveLength(1);
    expect(
      reducer(result, { type: 'submit_player_turn', turn: withdraw }),
    ).toBe(result);
    expect(reducer(result, { type: 'submit_ai_room' })).toBe(result);
    expect(decide).toHaveBeenCalledTimes(19);
  });

  it('generates AI from public pre-submit state, independently of the human secret bid', () => {
    const state = startSurvivalPrototype(options);
    const bid = survivalGameReducer(state, {
      type: 'submit_player_turn',
      turn: {
        playerId: 'human',
        actions: [{ type: 'bid', group: 'A', amount: 200 }],
      },
    });
    const disrupt = survivalGameReducer(state, {
      type: 'submit_player_turn',
      turn: {
        playerId: 'human',
        actions: [{ type: 'disrupt', group: 'B', amount: 200 }],
      },
    });
    expect(bid.revealedAiDecisions).toEqual(disrupt.revealedAiDecisions);
  });

  it('does not leak a hidden treasure reward ID into AI decisions', () => {
    let state = startSurvivalPrototype(options);
    state = survivalGameReducer(state, {
      type: 'submit_player_turn',
      turn: withdraw,
    });
    state = survivalGameReducer(state, { type: 'advance_room' });
    const rooms = JSON.parse(
      JSON.stringify(state.rooms),
    ) as SurvivalGameState['rooms'];
    rooms[0]![1]!.rewards[1].itemId =
      rooms[0]![1]!.rewards[1].itemId === 'interest'
        ? 'sacred_heart'
        : 'interest';
    const first = survivalGameReducer(state, {
      type: 'submit_player_turn',
      turn: withdraw,
    });
    const second = survivalGameReducer(
      { ...state, rooms },
      { type: 'submit_player_turn', turn: withdraw },
    );
    expect(first.revealedAiDecisions).toEqual(second.revealedAiDecisions);
  });

  it('takes the five authoritative final room scores and actual balance only after the BOSS settles', () => {
    const boss = playFloor(startSurvivalPrototype(options));
    expect(boss.floorRecords).toHaveLength(0);
    const money = boss.players[0]!.money;
    const finalRoomScores = boss.roomRecords.map(
      (record) => record.roomScoreSummaries.human!.finalScore,
    );
    const layer = survivalGameReducer(boss, { type: 'advance_room' });
    expect(layer.phase).toBe('floor_result');
    expect(layer.floorRecords).toHaveLength(1);
    expect(layer.floorRecords[0]!.scores.human).toMatchObject({
      roomScore: finalRoomScores.reduce((sum, value) => sum + value, 0),
      remainingMoney: money,
      exchangedScore: money * 0.1,
      inheritedScore: 0,
    });
    expect(layer.players[0]!.money).toBe(money);
    expect(survivalGameReducer(layer, { type: 'advance_room' })).toBe(layer);
  });

  it('retains original entry economy, participant and AI strategy facts for future replay encoding', () => {
    const state = startSurvivalPrototype({
      ...options,
      characterId: 'jacob_esau',
    });
    const result = survivalGameReducer(state, {
      type: 'submit_player_turn',
      turn: withdraw,
    });
    const record = result.roomRecords[0]!;
    expect(record.entryEvents).toEqual(state.roomEntryEvents);
    expect(record.entryEvents).not.toBe(state.roomEntryEvents);
    expect(record.activePlayerIds).toEqual(state.activePlayerIds);
    expect(record.aiChoices).toEqual(
      result.revealedAiDecisions.map((decision) => ({
        playerId: decision.turn.playerId,
        strategy: decision.strategy,
      })),
    );
    expect(record.aiChoices).toHaveLength(19);
  });

  it('commits a resolved floor once and generates the next layer lazily', () => {
    const boss = uniqueFloorResult(startSurvivalPrototype(options), false);
    const layer = survivalGameReducer(boss, { type: 'advance_room' });
    expect(layer.phase).toBe('floor_result');
    expect(layer.activePlayerIds).toHaveLength(18);
    expect(layer.floorRecords[0]!.plan.status).toBe('resolved');
    expect(layer.rooms).toHaveLength(1);
    const next = survivalGameReducer(layer, { type: 'advance_floor' });
    expect(next.phase).toBe('room_action');
    expect(next.floorIndex).toBe(1);
    expect(next.roomIndex).toBe(0);
    expect(next.rooms).toHaveLength(2);
    expect(next.currentFloorRoomScores.human).toEqual([]);
    expect(next.previousSurvivalScores.human).toBe(1000);
    expect(next.players[0]!.money).toBeGreaterThanOrEqual(1100);
    expect(next.floorRecords).toHaveLength(1);
    expect(survivalGameReducer(next, { type: 'advance_floor' })).toBe(next);
  });

  it('keeps all identities while freezing eliminated players and their AI histories', () => {
    const boss = uniqueFloorResult(startSurvivalPrototype(options));
    const layer = survivalGameReducer(boss, { type: 'advance_room' });
    expect(layer.humanEliminatedAt).toBe(0);
    expect(layer.activePlayerIds).not.toContain('human');
    expect(layer.players).toHaveLength(20);
    expect(layer.eliminated.human!.score.survivalScore).toBe(1);
    const frozenHuman = layer.players[0]!;
    const eliminatedAi = Object.keys(layer.eliminated).find(
      (id) => id !== 'human',
    )!;
    const frozenAi = layer.players.find(
      (player) => player.id === eliminatedAi,
    )!;
    const frozenProfile = layer.aiProfiles[eliminatedAi]!;
    const next = survivalGameReducer(layer, { type: 'advance_floor' });
    expect(next.players[0]).toBe(frozenHuman);
    expect(next.players.find((player) => player.id === eliminatedAi)).toBe(
      frozenAi,
    );
    expect(
      survivalGameReducer(next, { type: 'submit_player_turn', turn: withdraw }),
    ).toBe(next);
    const result = survivalGameReducer(next, { type: 'submit_ai_room' });
    expect(result.players[0]).toBe(frozenHuman);
    expect(result.aiProfiles[eliminatedAi]).toBe(frozenProfile);
    expect(result.roomSettlement!.turns).toHaveLength(18);
    expect(result.roomSettlement!.players).toHaveLength(18);
    expect(result.revealedAiDecisions).toHaveLength(18);
    expect(
      result.roomSettlement!.events.every(
        (event) => !['human', eliminatedAi].includes(event.playerId),
      ),
    ).toBe(true);
  });

  it('excludes a frozen economic build from interest, theft targets, shields and market samples', () => {
    const layer = survivalGameReducer(
      uniqueFloorResult(startSurvivalPrototype(options)),
      { type: 'advance_room' },
    );
    const human = layer.players[0]!;
    const modified: SurvivalGameState = {
      ...layer,
      players: layer.players.map((player) =>
        player.id === 'human'
          ? {
              ...human,
              money: 1_000_000,
              items: [
                {
                  instanceId: 'frozen-interest',
                  itemId: 'interest',
                  acquiredOrder: 800,
                },
                {
                  instanceId: 'frozen-bag',
                  itemId: 'money_bag',
                  acquiredOrder: 801,
                },
                {
                  instanceId: 'frozen-shield',
                  itemId: 'holy_mantle',
                  acquiredOrder: 802,
                },
              ],
              temporaryShields: 7,
            }
          : layer.activePlayerIds.includes(player.id)
            ? {
                ...player,
                items: [
                  ...player.items,
                  {
                    instanceId: `${player.id}-bag`,
                    itemId: 'money_bag',
                    acquiredOrder: 100,
                  },
                ],
              }
            : player,
      ),
    };
    const before = modified.players[0]!;
    const next = survivalGameReducer(modified, { type: 'advance_floor' });
    expect(next.players[0]).toBe(before);
    expect(
      next.roomEntryEvents.every(
        (event) =>
          event.playerId !== 'human' && !event.message.includes(' human '),
      ),
    ).toBe(true);
    const result = survivalGameReducer(next, { type: 'submit_ai_room' });
    expect(result.players[0]).toBe(before);
    expect(
      result.roomSettlement!.resolvedActions.every(
        (action) => action.playerId !== 'human',
      ),
    ).toBe(true);
    expect(
      result.roomSettlement!.awards.every(
        (award) => award.playerId !== 'human',
      ),
    ).toBe(true);
    const newItems = result
      .roomSettlement!.players.flatMap((player) => player.items)
      .filter((item) => item.instanceId.startsWith('1:0:'));
    expect(newItems.length).toBeGreaterThan(0);
    expect(newItems.every((item) => item.acquiredOrder > 802)).toBe(true);
  });

  it('normalizes public market participation against current survivors rather than the original twenty', () => {
    const layer = survivalGameReducer(
      uniqueFloorResult(startSurvivalPrototype(options)),
      { type: 'advance_room' },
    );
    const next = survivalGameReducer(layer, { type: 'advance_floor' });
    const result = survivalGameReducer(next, { type: 'submit_ai_room' });
    const participants = result.roomSettlement!.baseline!.participantCount;
    expect(result.recentMarkets.at(-1)!.participationRate).toBe(
      participants / 18,
    );
  });

  it('resolves a tied layer with recorded seeded draws and does not apply the elimination twice', () => {
    const boss = uniqueFloorResult(startSurvivalPrototype(options));
    const tied: SurvivalGameState = {
      ...boss,
      currentFloorRoomScores: Object.fromEntries(
        boss.activePlayerIds.map((id) => [id, [0, 0, 0, 0, 100]]),
      ),
    };
    const layer = survivalGameReducer(tied, { type: 'advance_room' });
    expect(layer.floorRecords[0]!.plan.status).toBe('resolved');
    expect(layer.floorRecords[0]!.resolution.reason).toBe('random_tie');
    expect(layer.floorRecords[0]!.resolution.tieBreaks).toHaveLength(20);
    expect(layer.activePlayerIds).toHaveLength(18);
    expect(Object.keys(layer.eliminated)).toHaveLength(2);
    expect(survivalGameReducer(layer, { type: 'advance_room' })).toBe(layer);
    expect(survivalGameReducer(tied, { type: 'advance_room' })).toEqual(layer);
  });

  it('records total elimination and a complete leaderboard without a champion', () => {
    const boss = playFloor(
      startSurvivalPrototype({
        ...options,
        cutLines: Array(7).fill(1_000_000),
      }),
    );
    const layer = survivalGameReducer(boss, { type: 'advance_room' });
    expect(layer.phase).toBe('floor_result');
    expect(layer.floorRecords[0]!.resolution.reason).toBe('all_below');
    expect(layer.activePlayerIds).toHaveLength(0);
    expect(layer.completionReason).toBeNull();
    const final = survivalGameReducer(layer, { type: 'advance_floor' });
    expect(final.phase).toBe('competition_complete');
    expect(final.completionReason).toBe('all_eliminated');
    expect(final.finalRanking).toHaveLength(20);
    expect(final.championId).toBeNull();
    expect(final.finalRanking.every((entry) => !entry.isChampion)).toBe(true);
  });

  it('finishes at six survivors without an eighth floor and freezes previously eliminated accounts', () => {
    let state = startSurvivalPrototype(options);
    const lostSnapshots = new Map<string, RuntimePlayerState>();
    for (let floor = 0; floor < 7; floor += 1) {
      state = uniqueFloorResult(state, false);
      state = survivalGameReducer(state, { type: 'advance_room' });
      expect(state.activePlayerIds).toHaveLength(18 - floor * 2);
      for (const [id, player] of lostSnapshots)
        expect(state.players.find((candidate) => candidate.id === id)).toBe(
          player,
        );
      for (const id of Object.keys(state.eliminated))
        lostSnapshots.set(
          id,
          state.players.find((player) => player.id === id)!,
        );
      state = survivalGameReducer(state, { type: 'advance_floor' });
    }
    expect(state.phase).toBe('competition_complete');
    expect(state.completionReason).toBe('survivor_threshold');
    expect(state.rooms).toHaveLength(7);
    expect(state.roomRecords).toHaveLength(35);
    expect(state.floorRecords).toHaveLength(7);
    expect(survivalGameReducer(state, { type: 'advance_floor' })).toBe(state);
    expect(
      survivalGameReducer(state, {
        type: 'submit_player_turn',
        turn: withdraw,
      }),
    ).toBe(state);
    expect(state.finalRanking).toHaveLength(20);
    expect(
      state.finalRanking
        .slice(0, 6)
        .every((entry) => entry.status === 'survived'),
    ).toBe(true);
  });

  it('finishes with actual survivors when a layer eliminates past the six-person threshold', () => {
    const boss = uniqueFloorResult(
      startSurvivalPrototype({ ...options, cutLines: Array(7).fill(116) }),
    );
    const layer = survivalGameReducer(boss, { type: 'advance_room' });
    expect(layer.activePlayerIds).toHaveLength(4);
    const final = survivalGameReducer(layer, { type: 'advance_floor' });
    expect(final.phase).toBe('competition_complete');
    expect(final.rooms).toHaveLength(1);
  });

  it('automatically completes a real AI continuation after early human elimination, without fake human turns', () => {
    let state = startSurvivalPrototype(options);
    const humanMoney = state.players[0]!.money;
    const rewards = state.rooms[0]![0]!.rewards;
    const group =
      rewards[0].itemId === 'grab_bag' || rewards[0].itemId === 'guppys_collar'
        ? 'B'
        : 'A';
    state = survivalGameReducer(state, {
      type: 'submit_player_turn',
      turn: {
        playerId: 'human',
        actions: [{ type: 'bid', group, amount: humanMoney }],
      },
    });
    state = survivalGameReducer(state, { type: 'advance_room' });
    for (let room = 1; room < 5; room += 1) {
      state = survivalGameReducer(state, {
        type: 'submit_player_turn',
        turn: withdraw,
      });
      state = survivalGameReducer(state, { type: 'advance_room' });
    }
    expect(state.phase).toBe('floor_result');
    expect(state.activePlayerIds).not.toContain('human');
    const personal = JSON.parse(JSON.stringify(state.players[0]));
    const final = continueSurvivalAfterHumanElimination(state);
    expect(final.phase).toBe('competition_complete');
    expect(final.activePlayerIds).toHaveLength(6);
    expect(final.players[0]).toEqual(personal);
    expect(
      final.roomRecords
        .slice(5)
        .every((record) =>
          record.turns.every((turn) => turn.playerId !== 'human'),
        ),
    ).toBe(true);
    expect(continueSurvivalAfterHumanElimination(final)).toBe(final);
  });

  it('does not auto-play an active human and completes a later total elimination without granting a champion', () => {
    const initial = startSurvivalPrototype({
      ...options,
      cutLines: [0, ...Array(6).fill(1_000_000)],
    });
    expect(continueSurvivalAfterHumanElimination(initial)).toBe(initial);
    const layer = survivalGameReducer(uniqueFloorResult(initial), {
      type: 'advance_room',
    });
    const stopped = continueSurvivalAfterHumanElimination(layer);
    expect(stopped.phase).toBe('competition_complete');
    expect(stopped.floorIndex).toBe(1);
    expect(stopped.floorRecords.at(-1)!.resolution.reason).toBe('all_below');
    expect(stopped.activePlayerIds).toHaveLength(0);
    expect(stopped.championId).toBeNull();
    expect(continueSurvivalAfterHumanElimination(stopped)).toBe(stopped);
  });

  it('detects a non-progressing custom reducer rather than looping forever or inventing a forced winner', () => {
    const layer = survivalGameReducer(
      uniqueFloorResult(startSurvivalPrototype(options)),
      { type: 'advance_room' },
    );
    expect(() =>
      continueSurvivalAfterHumanElimination(layer, (state) => ({ ...state })),
    ).toThrow('exceeded the derived rule bound');
    expect(layer.completionReason).toBeNull();
  });

  it('projects public values without exposing hidden rewards, AI profiles, turns or future schedules', () => {
    const initial = startSurvivalPrototype(options);
    const before = JSON.stringify(initial);
    const view = survivalPublicStatus(initial);
    expect(view).toMatchObject({
      mode: 'survival',
      floor: 1,
      room: 1,
      activePlayerCount: 20,
      human: {
        status: 'active',
        money: 1100,
        floorRoomScore: 0,
        projectedExchangeScore: 110,
        inheritedScore: 0,
      },
    });
    expect(Object.keys(view).sort()).toEqual([
      'activePlayerCount',
      'completionReason',
      'cutLine',
      'floor',
      'human',
      'mode',
      'phase',
      'room',
    ]);
    expect(JSON.stringify(initial)).toBe(before);
    const layer = survivalGameReducer(uniqueFloorResult(initial), {
      type: 'advance_room',
    });
    const next = survivalGameReducer(layer, { type: 'advance_floor' });
    expect(survivalPublicStatus(next).human).toMatchObject({
      status: 'eliminated',
      floor: 1,
      score: { survivalScore: 1 },
    });
  });

  it('shows the committed inherited component at layer end rather than inheriting the just-written score twice', () => {
    let state = survivalGameReducer(
      uniqueFloorResult(startSurvivalPrototype(options), false),
      { type: 'advance_room' },
    );
    expect(survivalPublicStatus(state).human).toMatchObject({
      inheritedScore: 0,
    });
    state = survivalGameReducer(state, { type: 'advance_floor' });
    expect(survivalPublicStatus(state).human).toMatchObject({
      inheritedScore: 200,
    });
    state = survivalGameReducer(uniqueFloorResult(state, false), {
      type: 'advance_room',
    });
    expect(survivalPublicStatus(state).human).toMatchObject({
      inheritedScore: 200,
    });
  });

  it('operates on deeply frozen inputs without mutating prior room or layer facts', () => {
    const initial = deepFreeze(startSurvivalPrototype(options));
    const result = survivalGameReducer(initial, {
      type: 'submit_player_turn',
      turn: withdraw,
    });
    expect(result.roomRecords).toHaveLength(1);
    expect(initial.roomRecords).toHaveLength(0);
    expect(initial.currentFloorRoomScores.human).toEqual([]);
    const boss = deepFreeze(
      uniqueFloorResult(startSurvivalPrototype(options), false),
    );
    const layer = survivalGameReducer(boss, { type: 'advance_room' });
    expect(boss.floorRecords).toHaveLength(0);
    expect(layer.floorRecords).toHaveLength(1);
    expect(layer.players).toBe(boss.players);
  });

  it('reproduces naturally generated room actions and facts with a fixed seed', () => {
    expect(playFloor(startSurvivalPrototype(options))).toEqual(
      playFloor(startSurvivalPrototype(options)),
    );
  });

  it.each([42, 87, 128, 424242, 20261013])(
    'runs a natural multi-layer smoke match within the rule bound: seed %s',
    (seed) => {
      let state = startSurvivalPrototype({ ...options, seed });
      const frozen = new Map<string, string>();
      let commands = 0;
      while (state.phase !== 'competition_complete') {
        expect(commands++).toBeLessThan(100);
        if (state.phase === 'room_action') {
          if (state.activePlayerIds.includes('human')) {
            const human = state.players[0]!;
            const amount = Math.floor(human.money / (5 - state.roomIndex));
            state = survivalGameReducer(state, {
              type: 'submit_player_turn',
              turn: {
                playerId: 'human',
                actions:
                  amount > 0
                    ? [
                        {
                          type: 'bid',
                          group: state.roomIndex % 2 ? 'B' : 'A',
                          amount,
                        },
                      ]
                    : [{ type: 'withdraw' }],
              },
            });
          } else state = survivalGameReducer(state, { type: 'submit_ai_room' });
        } else
          state = survivalGameReducer(
            state,
            state.phase === 'room_result'
              ? { type: 'advance_room' }
              : { type: 'advance_floor' },
          );
        for (const [id, snapshot] of frozen) {
          expect(
            JSON.stringify(state.players.find((player) => player.id === id)),
          ).toBe(snapshot);
        }
        for (const id of Object.keys(state.eliminated)) {
          frozen.set(
            id,
            JSON.stringify(state.players.find((player) => player.id === id)),
          );
        }
      }
      expect(state.rooms.length).toBeLessThanOrEqual(7);
      expect(state.roomRecords.length).toBeLessThanOrEqual(35);
      expect(state.players).toHaveLength(20);
      for (const [index, record] of state.floorRecords.entries()) {
        if (record.plan.status === 'resolved') {
          expect(record.plan.eliminations.length).toBeGreaterThanOrEqual(2);
          expect(record.plan.survivorIds.length).toBeLessThanOrEqual(
            18 - index * 2,
          );
        }
      }
      expect(state.phase).toBe('competition_complete');
      expect(state.activePlayerIds.length).toBeLessThanOrEqual(6);
      for (const player of state.players) {
        const roomScore = state.roomRecords.reduce(
          (sum, record) =>
            sum + (record.roomScoreSummaries[player.id]?.finalScore ?? 0),
          0,
        );
        expect(player.score).toBeCloseTo(roomScore, 4);
        expect(Number.isSafeInteger(player.money)).toBe(true);
        expect(player.money).toBeGreaterThanOrEqual(0);
      }
    },
  );
});

describe('shared room mode seams', () => {
  it('preserves classic third-floor hearts but only applies a survival reward experiment explicitly', () => {
    const classic = generateFloor(2, createSeededRandom(7));
    const standard = generateFloor(
      2,
      createSeededRandom(7),
      undefined,
      'standard',
    );
    expect(classic[4]!.rewards.map((reward) => reward.itemId)).toEqual([
      'moms_heart',
      'moms_heart',
    ]);
    expect(standard[4]!.rewards[0].itemId).not.toBe(
      standard[4]!.rewards[1].itemId,
    );
    expect(standard[4]!.kind).toBe('boss');
    expect(
      generateFloor(6, createSeededRandom(7), undefined, 'standard'),
    ).toHaveLength(5);
  });

  it('does not move classic acquisition numbering, but permits a global order floor for active-only settlement', () => {
    const player = createRuntimePlayer({
      id: 'human',
      money: 100,
      score: 0,
      isHuman: true,
    });
    const room = generateFloor(0, createSeededRandom(42))[0]!;
    const turn: PlayerTurn = {
      playerId: 'human',
      actions: [{ type: 'bid', group: 'A', amount: 30 }],
    };
    const ordinary = settleRuntimeRoom(
      room,
      [player],
      [turn],
      defaultRules,
      createSeededRandom(42),
    );
    const global = settleRuntimeRoom(
      room,
      [player],
      [turn],
      defaultRules,
      createSeededRandom(42),
      { minimumAcquisitionOrder: 900 },
    );
    expect(ordinary.players[0]!.items[0]!.acquiredOrder).toBe(1);
    expect(global.players[0]!.items[0]!.acquiredOrder).toBe(900);
    expect(global.players[0]!.score).toBe(ordinary.players[0]!.score);
  });

  it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid acquisition context %s',
    (minimumAcquisitionOrder) => {
      expect(() =>
        settleRuntimeRoom(
          generateFloor(0, createSeededRandom(42))[0]!,
          [],
          [],
          defaultRules,
          createSeededRandom(42),
          { minimumAcquisitionOrder },
        ),
      ).toThrow(RangeError);
    },
  );

  it('retains the research-only classic AI injection seam', () => {
    const original = startClientGame('isaac', 42);
    const custom = createClientResearchReducer(decideAiTurn);
    expect(
      custom(original, { type: 'submit_player_turn', turn: withdraw }).phase,
    ).toBe('room_result');
  });
});
