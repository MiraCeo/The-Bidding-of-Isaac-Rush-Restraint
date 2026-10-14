import { describe, expect, it } from 'vitest';
import { runSurvivalEliminationProbe } from './research/survival-elimination-probe';
import { survivalOfficialCutLines } from './survival-rules';
import {
  survivalDifficulties,
  survivalDifficultyLabel,
} from './survival-difficulty';
import { startSurvivalGame, survivalGameReducer } from './survival-session';
import type { CharacterId } from './item-types';
import frozenWorlds from './fixtures/survival-ai2-highest-worlds.json';
import client3Worlds from './fixtures/survival-client3-worlds.json';

describe('survival difficulty and frozen highest policy', () => {
  it.each(client3Worlds)(
    'retains frozen historical client3 $difficulty world $seed',
    (world) => {
      const game = runSurvivalEliminationProbe({
          seed: world.seed,
          characterId: world.characterId as CharacterId,
          policy: 'all_ai',
          cutLines: survivalOfficialCutLines,
          aiVersion: 'survival',
          aiDifficulty: world.difficulty as 'easy' | 'standard' | 'hard',
        }),
        probe = game.finalRanking.find((row) => row.playerId === 'human')!;
      expect({
        floors: game.floorRecords.length,
        survivors: game.activePlayerIds.length,
        wipeout: game.completionReason === 'all_eliminated',
        probeRank: probe.rank,
        probeSurvived: probe.status === 'survived',
      }).toEqual({
        floors: world.floors,
        survivors: world.survivors,
        wipeout: world.wipeout,
        probeRank: world.probeRank,
        probeSurvived: world.probeSurvived,
      });
    },
  );
  it('new client4 highest preserves every physical state and RNG outcome of the prior highest', () => {
    const options = {
      seed: 42,
      characterId: 'isaac' as const,
      aiDifficulty: 'highest' as const,
      cutLines: survivalOfficialCutLines,
    };
    let old = startSurvivalGame(options),
      current = startSurvivalGame({ ...options, aiPolicy: 'role-aware-1' });
    while (old.phase !== 'competition_complete') {
      const action =
        old.phase === 'room_action'
          ? old.activePlayerIds.includes('human')
            ? {
                type: 'submit_player_turn' as const,
                turn: {
                  playerId: 'human',
                  actions: [{ type: 'withdraw' as const }],
                },
              }
            : { type: 'submit_ai_room' as const }
          : {
              type:
                old.phase === 'room_result'
                  ? ('advance_room' as const)
                  : ('advance_floor' as const),
            };
      old = survivalGameReducer(old, action);
      current = survivalGameReducer(current, action);
      const { aiPolicy, ...physical } = current;
      expect(aiPolicy).toBe('role-aware-1');
      expect(physical).toEqual(old);
    }
  });
  it.each(frozenWorlds)('retains released AI2 world $seed', (world) => {
    const game = runSurvivalEliminationProbe({
      seed: world.seed,
      characterId: world.characterId as CharacterId,
      policy: 'all_ai',
      cutLines: survivalOfficialCutLines,
      aiVersion: 'survival',
      aiDifficulty: 'highest',
    });
    const probe = game.finalRanking.find((row) => row.playerId === 'human')!;
    expect({
      floors: game.floorRecords.length,
      survivors: game.activePlayerIds.length,
      allEliminated: game.completionReason === 'all_eliminated',
      probeSurvived: probe.status === 'survived',
      probeRank: probe.rank,
      probeEliminationFloor:
        probe.eliminationFloorIndex === null
          ? null
          : probe.eliminationFloorIndex + 1,
      championCharacter:
        game.players.find((p) => p.id === game.championId)?.characterId ?? null,
    }).toEqual({
      floors: world.floors,
      survivors: world.survivors,
      allEliminated: world.allEliminated,
      probeSurvived: world.probeSurvived,
      probeRank: world.probeRank,
      probeEliminationFloor: world.probeEliminationFloor,
      championCharacter: world.championCharacter,
    });
  });
  it('keeps every highest command result equal to historical AI2, excluding the new difficulty field', () => {
    const options = {
      seed: 42,
      characterId: 'isaac' as const,
      cutLines: survivalOfficialCutLines,
    };
    let historical = startSurvivalGame(options),
      highest = startSurvivalGame({ ...options, aiDifficulty: 'highest' });
    let commands = 0;
    while (historical.phase !== 'competition_complete') {
      const action =
        historical.phase === 'room_action'
          ? historical.activePlayerIds.includes('human')
            ? {
                type: 'submit_player_turn' as const,
                turn: {
                  playerId: 'human',
                  actions: [{ type: 'withdraw' as const }],
                },
              }
            : { type: 'submit_ai_room' as const }
          : {
              type:
                historical.phase === 'room_result'
                  ? ('advance_room' as const)
                  : ('advance_floor' as const),
            };
      historical = survivalGameReducer(historical, action);
      highest = survivalGameReducer(highest, action);
      const { aiDifficulty, ...actual } = highest;
      expect(aiDifficulty).toBe('highest');
      expect(actual).toEqual(historical);
      expect(++commands).toBeLessThan(78);
    }
  });
  it.each(survivalDifficulties)(
    'is deterministic and preserves formal rules: %s',
    (aiDifficulty) => {
      const options = {
        seed: 20261214,
        characterId: 'isaac' as const,
        policy: 'pace_bid' as const,
        cutLines: survivalOfficialCutLines,
        aiVersion: 'survival' as const,
        aiDifficulty,
      };
      const game = runSurvivalEliminationProbe(options);
      expect(runSurvivalEliminationProbe(options)).toEqual(game);
      expect(game.aiDifficulty).toBe(aiDifficulty);
      expect(game.cutLines).toEqual(survivalOfficialCutLines);
      expect(game.players.every((p) => p.money >= 0)).toBe(true);
      expect(game.finalRanking).toHaveLength(20);
      expect(game.activePlayerIds.length).toBeLessThanOrEqual(6);
    },
  );
  it('labels old unlayered replays without claiming highest AI2', () => {
    expect(survivalDifficultyLabel(undefined, 'survival-client-1')).toBe(
      '未分层（旧AI）',
    );
    expect(survivalDifficultyLabel(undefined, 'survival-client-2')).toBe(
      '最高',
    );
  });
});
