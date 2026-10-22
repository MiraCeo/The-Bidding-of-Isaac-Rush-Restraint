/** Research adapter only. No production imports this module. */
import { classicAiPolicy } from '../../game/classic-difficulty';
import type { ClassicDifficulty } from '../../game/classic-difficulty';
import type { CharacterId } from '../../game/item-types';
import type {
  ActiveClientGameState,
  ClientRoomSettlementRecord,
} from '../../game/client-session';
import type { SurvivalGameState } from '../../game/survival-session';
import type { RulesConfig } from '../../game/types';
import { validateTurn } from '../../game/turns';
import { canonicalJson } from '../../shared/json-facts';
import { sha256Hex } from '../../shared/sha256';
import { decodeAchievementEvent } from './event-codec';
import { runCurrentStudyMatch } from './current-study.test-helper';
import { withAchievementVerificationScope } from './registry';
import type { StudyPolicy } from './difficulty-study.test-helper';

export type BalanceScenario = {
  mode: 'classic' | 'survival';
  difficulty: ClassicDifficulty;
};
export const balanceScenarios: readonly BalanceScenario[] = [
  'classic',
  'survival',
].flatMap((mode) =>
  ['easy', 'standard', 'hard', 'highest'].map(
    (difficulty) => ({ mode, difficulty }) as BalanceScenario,
  ),
);
export function balanceSeed(index: number) {
  if (!Number.isSafeInteger(index) || index < 0 || index > 10000)
    throw Error('Invalid balance study seed index');
  // Separate from the legacy 0x65100000 study, with unsigned 32-bit arithmetic.
  return (0x08010000 + Math.imul(index + 1, 104729)) >>> 0;
}
function counters() {
  return {
    playerTurns: 0,
    actions: 0,
    bid: 0,
    disrupt: 0,
    withdraw: 0,
    doubleTurns: 0,
    zeroMoneyTurns: 0,
    actualCost: 0,
    spendRatioSum: 0,
    positiveMoneyTurns: 0,
    awards: 0,
    invalidTurns: 0,
  };
}
export type AiStudyCounters = ReturnType<typeof counters>;
export function runBalanceMatch(
  seed: number,
  role: CharacterId,
  policy: StudyPolicy,
  scenario: BalanceScenario,
) {
  const duringHuman = counters(),
    afterHuman = counters();
  let firstPlayers: unknown;
  let terminal: ActiveClientGameState | SurvivalGameState | undefined;
  const observe = (
    record: ClientRoomSettlementRecord,
    rules: RulesConfig,
    humanPresent: boolean,
  ) => {
    if (humanPresent && firstPlayers === undefined)
      firstPlayers = structuredClone(record.playersBefore);
    const stats = humanPresent ? duringHuman : afterHuman;
    for (const turn of record.turns) {
      const player = record.playersBefore.find((p) => p.id === turn.playerId);
      if (!player) throw Error('Missing research turn player');
      const errors = validateTurn(player, turn, rules);
      if (errors.length)
        throw Error(`Illegal research action: ${errors.join('; ')}`);
      if (player.isHuman) continue;
      stats.playerTurns++;
      stats.actions += turn.actions.length;
      stats.doubleTurns += Number(turn.actions.length === 2);
      stats.zeroMoneyTurns += Number(player.money === 0);
      for (const action of turn.actions) stats[action.type]++;
      const cost = record.resolvedActions
        .filter((a) => a.playerId === player.id)
        .reduce((sum, a) => sum + a.actualCost, 0);
      if (cost < 0 || cost > player.money)
        throw Error('AI cost outside actual cash budget');
      stats.actualCost += cost;
      if (player.money > 0) {
        stats.positiveMoneyTurns++;
        stats.spendRatioSum += cost / player.money;
      }
      stats.awards += record.awards
        .filter((a) => a.playerId === player.id)
        .reduce((sum, a) => sum + a.copies, 0);
    }
  };
  const result = withAchievementVerificationScope(() =>
    runCurrentStudyMatch(
      seed,
      role,
      policy,
      scenario.mode === 'classic' ? 'classic' : scenario.difficulty,
      {
        ...(scenario.mode === 'classic'
          ? {
              classicAi: {
                policy: classicAiPolicy,
                difficulty: scenario.difficulty,
              },
            }
          : {}),
        room: (r, rules) => observe(r, rules, true),
        aiOnlyRoom: (r, rules) => observe(r, rules, false),
        terminal: (g) => {
          terminal = g;
        },
      },
    ),
  );
  if (!terminal || firstPlayers === undefined)
    throw Error('Missing research terminal/initial world');
  const game: ActiveClientGameState | SurvivalGameState = terminal;
  if (scenario.mode === 'classic') {
    if (
      !('classicAi' in game) ||
      game.classicAi?.difficulty !== scenario.difficulty
    )
      throw Error('Classic study silently used legacy/default difficulty');
  } else if (
    !('aiDifficulty' in game) ||
    game.aiDifficulty !== scenario.difficulty ||
    game.aiPolicy !== 'role-aware-1'
  )
    throw Error('Survival study did not use the current named policy');
  const firstWorld = sha256Hex(
    canonicalJson({
      players: firstPlayers,
      firstFloor: game.rooms[0],
      ai: Object.values(game.aiProfiles).map(
        ({ playerId, doctrine, personalities, quoteProfile }) => ({
          playerId,
          doctrine,
          personalities,
          quoteProfile,
        }),
      ),
    }),
  );
  const humanIndex = game.finalRanking.findIndex((r) => r.playerId === 'human');
  if (humanIndex < 0) throw Error('Missing formal human ranking');
  let humanFloors = 0,
    passedFloors = 0,
    lowestFloors = 0;
  for (const unit of result.context.units) {
    const event = decodeAchievementEvent(unit);
    if (event.stage === 'floor') {
      humanFloors += Number(event.facts.humanParticipated);
      passedFloors += Number(event.facts.humanSurvived);
      lowestFloors += Number(event.facts.lowestSurvivor);
    }
  }
  const diagnostics = {
    firstWorld,
    policyIdentity:
      scenario.mode === 'classic' ? classicAiPolicy : 'role-aware-1',
    rank: humanIndex + 1,
    score: game.finalRanking[humanIndex]!.finalScore,
    eliminationFloor:
      'humanEliminatedAt' in game && game.humanEliminatedAt !== null
        ? game.humanEliminatedAt + 1
        : null,
    humanFloors,
    passedFloors,
    lowestFloors,
    duringHuman,
    afterHuman,
    aiFinal: game.finalRanking
      .filter((r) => r.playerId !== 'human')
      .map((r) => {
        const p = game.players.find((p) => p.id === r.playerId)!;
        if (!p.characterId) throw Error('AI role missing from formal roster');
        const profile = game.aiProfiles[p.id]!;
        return {
          id: p.id,
          role: p.characterId,
          doctrine: profile.doctrine,
          personalities: profile.personalities,
          rank:
            game.finalRanking.findIndex((v) => v.playerId === r.playerId) + 1,
          score: r.finalScore,
          survived: 'status' in r ? r.status === 'survived' : true,
          eliminationFloor:
            'eliminationFloorIndex' in r &&
            typeof r.eliminationFloorIndex === 'number'
              ? r.eliminationFloorIndex + 1
              : null,
        };
      }),
  };
  return { ...result, scenario, diagnostics };
}
