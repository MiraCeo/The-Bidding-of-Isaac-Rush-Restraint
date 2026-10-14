/** Isolated real-elimination research: never imported by the client or written to live storage. */
import { decideAiTurn, type AiDecision } from '../ai-decision';
import { decideSurvivalAiTurn } from '../survival-ai';
import { createEmptyAiHistory } from '../ai-analysis';
import { createAiQuoteProfile } from '../ai-quote';
import { generateAiPersonalities } from '../ai-personality';
import { createSeededRandom } from '../random';
import { defaultRules } from '../config';
import {
  decideClientAiRoom,
  mixClientSeed,
  updateClientAiHistory,
  type AiClientProfile,
} from '../client-runtime';
import {
  startSurvivalGame,
  createSurvivalResearchReducer,
  type SurvivalGameState,
  type SurvivalGameAction,
} from '../survival-session';
import type { CharacterId, PlayerTurn } from '../item-types';
import type { ProbePolicy } from './survival-score-probe';
import type { SurvivalDifficulty } from '../survival-difficulty';

export const proposedSurvivalCutLines = Object.freeze([
  200, 250, 325, 425, 550, 700, 850,
]);
export interface EliminationProbeOptions {
  disableRoleAdaptation?: boolean;
  aiPolicy?: import('../survival-difficulty').SurvivalAiPolicy;
  aiDifficulty?: SurvivalDifficulty;
  aiVersion?: 'legacy' | 'survival';
  seed: number;
  characterId: CharacterId;
  policy: ProbePolicy;
  cutLines: readonly number[];
}
export interface EliminationObserver {
  onRoom?: (
    before: SurvivalGameState,
    after: SurvivalGameState,
    decisions: readonly AiDecision[],
  ) => void;
  onFloor?: (before: SurvivalGameState, after: SurvivalGameState) => void;
}

/** Formal reducer owns all economy, elimination, frozen players, finish conditions and ranking. */
export function runSurvivalEliminationProbe(
  options: EliminationProbeOptions,
  observer: EliminationObserver = {},
) {
  if (!['all_ai', 'pace_bid', 'withdraw'].includes(options.policy))
    throw new Error('Unknown elimination research policy.');
  let game = startSurvivalGame({
    ...options,
    buildId: 'research-real-elimination-1',
  });
  const random = createSeededRandom(mixClientSeed(options.seed, 0xc0ac29b7));
  let probeProfile: AiClientProfile = {
    playerId: 'human',
    name: '探针AI',
    doctrine: 'balanced',
    personalities: generateAiPersonalities(random, 2, 4),
    quoteProfile: createAiQuoteProfile(random),
    history: createEmptyAiHistory(),
  };
  let queued = new Map<string, AiDecision>();
  const survivalDecider: typeof decideAiTurn = (
    player,
    floorIndex,
    rules,
    random,
    decisionOptions,
  ) =>
    decideSurvivalAiTurn(player, floorIndex, rules, random, {
      ...decisionOptions,
      ...(options.disableRoleAdaptation
        ? { survivalDisableRoleAdaptation: true }
        : {}),
    });
  const reducer = createSurvivalResearchReducer((...args) => {
    if (options.policy !== 'all_ai')
      return (
        options.aiVersion === 'survival' ? survivalDecider : decideAiTurn
      )(...args);
    const decision = queued.get(args[0].id);
    if (!decision) throw new Error('Missing pre-submit AI decision.');
    return decision;
  });
  let commands = 0;
  while (game.phase !== 'competition_complete') {
    if (commands++ >= 77)
      throw new Error(
        'Real-elimination probe exceeded formal seven-floor command bound.',
      );
    const before = game;
    let action: SurvivalGameAction;
    let allAi: ReturnType<typeof decideClientAiRoom> | null = null;
    if (game.phase === 'room_action') {
      const humanActive = game.activePlayerIds.includes('human');
      let humanTurn: PlayerTurn | null = null;
      if (options.policy === 'all_ai') {
        const players = game.players
          .filter((player) => game.activePlayerIds.includes(player.id))
          .map((player) => ({ ...player, isHuman: false }));
        const rules = {
          ...defaultRules,
          playerCount: players.length,
          roomsPerFloor: Array(game.floorIndex + 1).fill(5),
          floorStartingMoney: Array(game.floorIndex + 1).fill(1000),
        };
        // Same shared streams as v29; add the independent balanced probe before the 19 AI.
        // Decisions see only public pre-submit context, never another current action or future rewards.
        allAi = decideClientAiRoom(
          {
            seed: game.seed,
            players,
            aiProfiles: { ...game.aiProfiles, human: probeProfile },
            room: game.rooms[game.floorIndex]![game.roomIndex]!,
            globalRoomIndex: game.floorIndex * 5 + game.roomIndex,
            remainingRooms: 5 - game.roomIndex,
            remainingGameRooms:
              Math.ceil((players.length - 6) / 2) * 5 - game.roomIndex,
            recentMarkets: game.recentMarkets,
            rules,
            ...(options.aiVersion === 'survival'
              ? {
                  survivalContext: {
                    cutLine: game.cutLines[game.floorIndex]!,
                    moneyExchangeRatio: game.rules.moneyExchangeRatio,
                    scoreInheritanceRatio: game.rules.scoreInheritanceRatio,
                    minimumEliminations: game.rules.minimumEliminations,
                    participants: players.map((player) => ({
                      playerId: player.id,
                      money: player.money,
                      roomScore: (
                        game.currentFloorRoomScores[player.id] ?? []
                      ).reduce((sum, value) => sum + value, 0),
                      previousSurvivalScore:
                        game.previousSurvivalScores[player.id] ?? 0,
                    })),
                  },
                  survivalDifficulty: game.aiDifficulty,
                  survivalAiPolicy: game.aiPolicy,
                }
              : {}),
          },
          options.aiVersion === 'survival' ? survivalDecider : decideAiTurn,
        );
        queued = new Map(
          allAi.decisions.map((decision) => [decision.turn.playerId, decision]),
        );
        humanTurn = queued.get('human')?.turn ?? null;
      } else if (humanActive) {
        const player = game.players[0]!,
          amount = Math.floor(player.money / (5 - game.roomIndex));
        humanTurn = {
          playerId: 'human',
          actions:
            options.policy === 'withdraw' || amount < 1
              ? [{ type: 'withdraw' }]
              : [
                  {
                    type: 'bid',
                    group: game.roomIndex % 2 ? 'B' : 'A',
                    amount,
                  },
                ],
        };
      }
      action = humanActive
        ? { type: 'submit_player_turn', turn: humanTurn! }
        : { type: 'submit_ai_room' };
    } else
      action = {
        type: game.phase === 'room_result' ? 'advance_room' : 'advance_floor',
      };
    game = reducer(game, action);
    if (game === before)
      throw new Error('Elimination probe unexpectedly stalled.');
    if (before.phase === 'room_action') {
      if (allAi && before.activePlayerIds.includes('human'))
        probeProfile = updateClientAiHistory(
          allAi.aiProfiles,
          allAi.decisions,
          game.roomSettlement!,
        ).human!;
      observer.onRoom?.(
        before,
        game,
        allAi?.decisions ?? game.revealedAiDecisions,
      );
    }
    if (before.phase === 'room_result' && game.phase === 'floor_result')
      observer.onFloor?.(before, game);
  }
  return game;
}
