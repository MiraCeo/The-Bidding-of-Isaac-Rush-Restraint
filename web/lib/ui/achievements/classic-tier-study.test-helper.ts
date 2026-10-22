/** Classic-only diagnostic runner. No growth/profile/save/replay is emitted. */
import { createHash } from 'node:crypto';
import { defaultRules } from '../../game/config';
import {
  classicAiPolicy,
  type ClassicDifficulty,
} from '../../game/classic-difficulty';
import {
  startClientGame,
  clientGameReducer,
  type ActiveClientGameState,
  type ClientRoomSettlementRecord,
} from '../../game/client-session';
import { createClientMarketSnapshot } from '../../game/client-runtime';
import { validateTurn } from '../../game/turns';
import type { CharacterId } from '../../game/item-types';
import { canonicalJson } from '../../shared/json-facts';
import {
  createStudyController,
  type StudyPolicy,
} from './difficulty-study.test-helper';

const hash = (value: unknown) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
export function classicTierTrace() {
  const trace = createHash('sha256');
  return {
    update: (r: ClientRoomSettlementRecord) =>
      trace.update(
        canonicalJson({
          room: r.room,
          actions: r.resolvedActions,
          scores: r.roomScoreSummaries,
          baseline: r.baseline,
          entitlements: r.entitlements,
          awards: r.awards,
          events: r.events,
          players: r.players,
        }),
      ),
    digest: () => trace.digest('hex'),
  };
}
export function classicTierSeed(block: number) {
  if (!Number.isSafeInteger(block) || block < 0 || block >= 60)
    throw Error('Unknown tier seed block');
  // balanceSeed indices 2000..2059: disjoint from the first study's 0/100..109/1000..1059.
  return (0x08010000 + Math.imul(2001 + block, 104729)) >>> 0;
}
function aiCounters() {
  return {
    turns: 0,
    actions: 0,
    bid: 0,
    disrupt: 0,
    withdraw: 0,
    doubles: 0,
    positiveCashTurns: 0,
    zeroCashTurns: 0,
    cashSpentFraction: 0,
    entitledTurns: 0,
    awardCopies: 0,
    beforeBossCashRatio: 0,
    beforeBossTurns: 0,
    quotes: 0,
    clampedQuotes: 0,
    targetAbsoluteError: 0,
    highestAbsoluteError: 0,
    targets: 0,
    targetRatio: 0,
    targetRatioSquared: 0,
  };
}
export type ClassicTierCounters = ReturnType<typeof aiCounters>;
export function classicTierTerminalHash(game: ActiveClientGameState) {
  return hash({
    players: game.players,
    finalRanking: game.finalRanking,
    aiProfiles: game.aiProfiles,
  });
}
export function runClassicTierMatch(
  block: number,
  role: CharacterId,
  policy: StudyPolicy,
  difficulty: ClassicDifficulty,
  terminalObserver?: (game: ActiveClientGameState) => void,
) {
  const seed = classicTierSeed(block);
  let game = startClientGame(role, seed, {
    policy: classicAiPolicy,
    difficulty,
  });
  const initialWorld = hash({
    players: game.players,
    rooms: game.rooms,
    aiProfiles: game.aiProfiles,
  });
  const controller = createStudyController(seed, policy),
    trace = classicTierTrace();
  const floors = [aiCounters(), aiCounters(), aiCounters()];
  const human = {
    awardCopies: 0,
    entitledTurns: 0,
    actualCost: 0,
    bid: 0,
    disrupt: 0,
    withdraw: 0,
  };
  let rooms = 0;
  for (let command = 0; game.phase !== 'game_result'; command++) {
    if (command >= 32) throw Error('Classic tier command bound exceeded');
    if (game.phase === 'room_action') {
      const turn = controller.decide(game, defaultRules);
      const next = clientGameReducer(game, {
        type: 'submit_player_turn',
        turn,
      });
      if (next.phase !== 'room_result' || !next.roomSettlement)
        throw Error('Missing tier settlement');
      game = next;
      const r = next.roomSettlement!,
        stats = floors[game.floorIndex]!;
      const floorMoney = defaultRules.floorStartingMoney[game.floorIndex]!;
      const market = createClientMarketSnapshot(
        r,
        floorMoney,
        r.playersBefore.length,
      );
      if (market) {
        stats.targets++;
        stats.targetRatio += market.targetRatio;
        stats.targetRatioSquared += market.targetRatio ** 2;
      }
      for (const submitted of r.turns) {
        const player = r.playersBefore.find(
          (p) => p.id === submitted.playerId,
        )!;
        if (!player || validateTurn(player, submitted, defaultRules).length)
          throw Error('Illegal tier-study turn');
        const cost = r.resolvedActions
          .filter((a) => a.playerId === player.id)
          .reduce((sum, a) => sum + a.actualCost, 0);
        if (cost < 0 || cost > player.money)
          throw Error('Tier-study actual cash violation');
        const entitled = Number(
          r.entitlements.some((e) => e.playerId === player.id),
        );
        const awards = r.awards
          .filter((a) => a.playerId === player.id)
          .reduce((sum, a) => sum + a.copies, 0);
        if (player.isHuman) {
          human.actualCost += cost;
          human.entitledTurns += entitled;
          human.awardCopies += awards;
          for (const a of submitted.actions) human[a.type]++;
          continue;
        }
        stats.turns++;
        stats.actions += submitted.actions.length;
        stats.doubles += Number(submitted.actions.length === 2);
        stats.entitledTurns += entitled;
        stats.awardCopies += awards;
        if (player.money > 0) {
          stats.positiveCashTurns++;
          stats.cashSpentFraction += cost / player.money;
        } else stats.zeroCashTurns++;
        if (r.room.kind === 'boss') {
          stats.beforeBossTurns++;
          stats.beforeBossCashRatio += player.money / floorMoney;
        }
        for (const a of submitted.actions) stats[a.type]++;
        const quote = game.revealedAiDecisions.find(
          (d) => d.turn.playerId === player.id,
        )?.quoteAnalysis;
        if (quote && market) {
          stats.quotes++;
          stats.clampedQuotes += Number(quote.wasClamped);
          stats.targetAbsoluteError += Math.abs(
            quote.prediction.predictedTarget / floorMoney - market.targetRatio,
          );
          stats.highestAbsoluteError += Math.abs(
            quote.prediction.predictedHighestMarketEquivalent / floorMoney -
              market.highestMarketEquivalentRatio!,
          );
        }
      }
      controller.update(r);
      trace.update(r);
      rooms++;
    } else {
      const next = clientGameReducer(game, { type: 'advance_room' });
      if (next.phase === 'character_selection')
        throw Error('Unexpected selection');
      game = next;
    }
  }
  if (rooms !== 15) throw Error('Incomplete classic tier match');
  terminalObserver?.(game);
  const rank = game.finalRanking.findIndex((r) => r.playerId === 'human') + 1;
  return {
    block,
    seed,
    role,
    policy,
    difficulty,
    initialWorld,
    rooms,
    traceHash: trace.digest(),
    terminalHash: classicTierTerminalHash(game),
    rank,
    score: game.finalRanking[rank - 1]!.finalScore,
    human,
    floors,
  };
}
