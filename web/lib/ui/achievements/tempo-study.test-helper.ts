/** Read-only research adapter. Production never imports it. */
import { canonicalJson } from '../../shared/json-facts';
import { sha256Hex } from '../../shared/sha256';
import { validateTurn } from '../../game/turns';
import type {
  ActiveClientGameState,
  ClientRoomSettlementRecord,
} from '../../game/client-session';
import type { SurvivalGameState } from '../../game/survival-session';
import type { RulesConfig } from '../../game/types';
import type { CharacterId } from '../../game/item-types';
import type { PlayerProfile } from '../player-profile';
import type { TempoScenario } from '../../../scripts/achievement-tempo-plan.mjs';
import {
  runCurrentStudyMatch,
  availableStudyRoles,
  advanceStudyProfile,
} from './current-study.test-helper';
import type { StudyPolicy } from './difficulty-study.test-helper';
import { decodeAchievementEvent } from './event-codec';
import { extractAllInCapital } from './revision066-facts';
import { withAchievementVerificationScope } from './registry';

function observeTempoMatch(
  seed: number,
  role: CharacterId,
  policy: StudyPolicy,
  scenario: TempoScenario,
) {
  const evidence: {
    position: number;
    cash: number;
    allInAttempt: boolean;
    allInAward: boolean;
    allInCapital: readonly [number, number];
    bossRoom: boolean;
    bossQualified: boolean;
    bossAward: boolean;
  }[] = [];
  let firstPlayers: unknown,
    terminal: ActiveClientGameState | SurvivalGameState | undefined;
  const observe = (r: ClientRoomSettlementRecord, rules: RulesConfig) => {
    const human = r.playersBefore.find((p) => p.id === 'human')!;
    if (firstPlayers === undefined)
      firstPlayers = structuredClone(r.playersBefore);
    for (const turn of r.turns) {
      const player = r.playersBefore.find((p) => p.id === turn.playerId)!;
      if (validateTurn(player, turn, rules).length)
        throw Error('Illegal tempo action');
      const cost = r.resolvedActions
        .filter((a) => a.playerId === player.id)
        .reduce((n, a) => n + a.actualCost, 0);
      if (cost < 0 || cost > player.money)
        throw Error('Tempo actual cost outside cash');
    }
    const fullBids = r.resolvedActions.filter(
      (a) =>
        a.playerId === 'human' &&
        a.action.type === 'bid' &&
        human.money > 0 &&
        a.action.amount === human.money,
    );
    const awards = r.awards.filter((a) => a.playerId === 'human');
    const capital = extractAllInCapital(r);
    if (!capital) throw Error('Missing all-in capital evidence');
    evidence.push({
      position: r.room.floorIndex * 5 + r.room.roomIndex,
      cash: human.money,
      allInCapital: capital,
      allInAttempt: fullBids.length > 0,
      allInAward: fullBids.some((a) => {
        const action = a.action;
        return (
          action.type !== 'withdraw' &&
          awards.some((w) => w.group === action.group)
        );
      }),
      bossRoom: r.room.kind === 'boss',
      bossQualified:
        r.room.kind === 'boss' &&
        r.entitlements.some((e) => e.playerId === 'human'),
      bossAward: r.room.kind === 'boss' && awards.length > 0,
    });
  };
  const result = runCurrentStudyMatch(
    seed,
    role,
    policy,
    scenario.mode === 'classic' ? 'classic' : scenario.difficulty,
    {
      ...(scenario.mode === 'classic'
        ? {
            classicAi: {
              policy:
                scenario.aiPolicy === 'classic-population-1'
                  ? ('classic-population-1' as const)
                  : ('classic-tiered-1' as const),
              difficulty: scenario.difficulty,
            },
          }
        : {}),
      room: observe,
      terminal: (g) => {
        terminal = g;
      },
    },
  );
  if (
    !terminal ||
    firstPlayers === undefined ||
    evidence.length !== result.match.humanRooms
  )
    throw Error('Incomplete tempo match');
  const game: ActiveClientGameState | SurvivalGameState = terminal;
  if (
    scenario.mode === 'classic'
      ? !('classicAi' in game) ||
        game.classicAi?.policy !== scenario.aiPolicy ||
        game.classicAi.difficulty !== scenario.difficulty
      : !('aiPolicy' in game) ||
        game.aiPolicy !== scenario.aiPolicy ||
        game.aiDifficulty !== scenario.difficulty
  )
    throw Error('Wrong tempo strategy identity');
  let allIn = 0,
    boss = 0;
  for (const unit of result.context.units) {
    const event = decodeAchievementEvent(unit);
    if (event.stage !== 'room') continue;
    const e = evidence.find((r) => r.position === unit.position);
    if (
      !e ||
      !!(event.facts.milestoneFlags! & 16) !== e.allInAward ||
      event.facts.bossAwarded !== e.bossAward ||
      canonicalJson(event.facts.allInCapital) !== canonicalJson(e.allInCapital)
    )
      throw Error('Tempo witness differs from authority event');
    allIn += Number(!!(event.facts.milestoneFlags! & 16));
    boss += Number(event.facts.bossAwarded);
  }
  if (allIn !== result.progress.D09 || boss !== result.progress.E03)
    throw Error('Tempo counts differ from production progress');
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
  return { ...result, evidence, firstWorld, counts: { allIn, boss } };
}
/** Same bounded, content-keyed verification scope used by the old balance runner. */
export function runTempoMatch(...args: Parameters<typeof observeTempoMatch>) {
  return withAchievementVerificationScope(() => observeTempoMatch(...args));
}
export function advanceTempoStep(
  profile: PlayerProfile,
  seed: number,
  index: number,
  policy: StudyPolicy,
  scenario: TempoScenario,
) {
  const available = availableStudyRoles(profile),
    role = available[(index - 1) % available.length]!;
  const result = runTempoMatch(seed, role, policy, scenario);
  const before = JSON.stringify(profile),
    advanced = advanceStudyProfile(
      profile,
      result.context,
      index,
      index === 1 || index === 20,
    );
  if (JSON.stringify(profile) !== before)
    throw Error('Tempo mutated input profile');
  return { role, available, result, advanced };
}
