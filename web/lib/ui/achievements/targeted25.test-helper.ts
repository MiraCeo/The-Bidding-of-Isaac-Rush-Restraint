import { achievementCatalog, type AchievementId } from './catalog';
import { achievementNumber } from './numbering';
import { availableStudyRoles } from './current-study.test-helper';
import type { PlayerProfile } from '../player-profile';
import type { CharacterId, ItemId } from '../../game/item-types';
import type { ClassicDifficulty } from '../../game/classic-difficulty';
import { createGameSession, reduceGameSession } from '../game-session';
import {
  startSurvivalClient,
  reduceSurvivalClient,
  survivalRoomRules,
} from '../survival-client';
import {
  beginClassicGrowth,
  beginSurvivalGrowth,
  type GrowthContext,
} from './lifecycle';
import { defaultRules } from '../../game/config';
import { canonicalJson } from '../../shared/json-facts';
import { sha256Hex } from '../../shared/sha256';
import { auditFloorCounts } from './audit117-edge.test-helper';
import { withAchievementVerificationScope } from './registry';
import {
  freshTargetState,
  targetPublicInput,
  chooseTargetTurn,
  observeTargetRoom,
  confirmTargetFloor,
  type TargetDecision,
} from './targeted25-controller.test-helper';
import type { ClientRoomSettlementRecord } from '../../game/client-session';

export interface TargetChoice {
  mode: 'classic' | 'survival';
  difficulty: ClassicDifficulty;
  role: CharacterId;
  available: CharacterId[];
  seekLowest: boolean;
  reason: string;
}
/** Decisions refer to public numbers; the shadow readout never unlocks roles. */
export function chooseTarget25(
  index: number,
  profile: PlayerProfile,
  earned: readonly AchievementId[],
  roleUses: Partial<Record<CharacterId, number>>,
  survivalPlayed: number,
): TargetChoice {
  const available = availableStudyRoles(profile),
    has = (n: string) => earned.some((id) => achievementNumber(id) === n);
  let mode: TargetChoice['mode'] = index % 2 ? 'classic' : 'survival';
  if (index > 20) {
    const c = achievementCatalog.filter(
        (a) => a.scope === 'classic' && !earned.includes(a.id),
      ).length,
      s = achievementCatalog.filter(
        (a) => a.scope === 'survival' && !earned.includes(a.id),
      ).length;
    // Alternate flex opportunities rather than starve one mode indefinitely.
    mode =
      index % 2
        ? c || !has('E13')
          ? 'classic'
          : 'survival'
        : s || !has('F15')
          ? 'survival'
          : 'classic';
  }
  let role: CharacterId = 'isaac',
    difficulty: ClassicDifficulty = 'easy',
    reason = 'isaac-champion';
  const unused = available.find((r) => !roleUses[r]);
  if (mode === 'classic') {
    if (!has('E13')) role = 'isaac';
    else if (unused) {
      role = unused;
      reason = 'unused-role';
    } else if (
      available.includes('lost') &&
      (!has('E18') || !has('E20') || !has('E14'))
    ) {
      role = 'lost';
      reason = 'lost-item-events';
    } else if (
      available.includes('jacob_esau') &&
      (!has('B07') || !has('C15') || !has('E17'))
    ) {
      role = 'jacob_esau';
      reason = 'dual-actions';
    } else {
      role = available.includes('eden') ? 'eden' : 'isaac';
      reason = 'visible-combos';
    }
  } else {
    const seekLowest = !has('F15') && survivalPlayed % 2 === 1;
    difficulty = seekLowest
      ? 'standard'
      : survivalPlayed < 2
        ? 'standard'
        : 'highest';
    role = available.includes('jacob_esau') ? 'jacob_esau' : 'isaac';
    reason = seekLowest ? 'confirmed-lowest-then-score' : 'highest-champion';
    if (unused && !seekLowest) {
      role = unused;
      reason += ':unused-role';
    }
  }
  return {
    mode,
    difficulty,
    role,
    available,
    seekLowest: mode === 'survival' && !has('F15') && survivalPlayed % 2 === 1,
    reason,
  };
}
export function runTarget25Match(
  seed: number,
  choice: TargetChoice,
  missing: readonly string[],
) {
  return withAchievementVerificationScope(() => {
    let state = freshTargetState(),
      humanRooms = 0,
      aiOnlyRooms = 0;
    const held = new Set<ItemId>(),
      offered = new Set<ItemId>(),
      attempts: Array<
        TargetDecision & {
          floor: number;
          room: number;
          moneyBefore: number;
          result: ReturnType<typeof observeTargetRoom>['actual'];
        }
      > = [],
      floorConfirmations: Array<{
        floor: number;
        confirmed: boolean;
        before: boolean;
      }> = [];
    const observe = (
      r: ClientRoomSettlementRecord,
      decision: TargetDecision,
    ) => {
      const h = r.playersBefore.find((p) => p.id === 'human')!;
      h.items.forEach((i) => held.add(i.itemId));
      r.room.rewards.forEach((i) => offered.add(i.itemId));
      const observed = observeTargetRoom(state, r);
      state = observed.state;
      attempts.push({
        ...decision,
        floor: r.room.floorIndex,
        room: r.room.roomIndex,
        moneyBefore: h.money,
        result: observed.actual,
      });
      humanRooms++;
    };
    let context: GrowthContext, champion: boolean;
    if (choice.mode === 'classic') {
      let s = beginClassicGrowth(
          reduceGameSession(createGameSession(seed), {
            type: 'start_game',
            characterId: choice.role,
            classicAi: {
              policy: 'classic-population-1',
              difficulty: choice.difficulty,
            },
          }),
        ),
        commands = 0;
      while (s.game.phase !== 'game_result') {
        if (++commands > 32 || s.game.phase === 'character_selection')
          throw Error('Target classic bound');
        if (s.game.phase === 'room_action') {
          const d = chooseTargetTurn(
            targetPublicInput(s.game),
            defaultRules,
            missing,
            state,
            false,
          );
          s = reduceGameSession(s, {
            type: 'submit_player_turn',
            turn: d.turn,
          });
          if (s.game.phase === 'character_selection' || !s.game.roomSettlement)
            throw Error('No classic target settlement');
          observe(s.game.roomSettlement, d);
        } else s = reduceGameSession(s, { type: 'advance_room' });
        if (s.growthIssue) throw Error(s.growthIssue);
      }
      const ranking = s.game.finalRanking;
      champion = ranking.some(
        (p) =>
          p.playerId === 'human' && p.finalScore === ranking[0]!.finalScore,
      );
      context = s.growth!;
    } else {
      let s = beginSurvivalGrowth(
          startSurvivalClient(choice.role, seed, choice.difficulty),
        ),
        commands = 0,
        checkedFloors = 0;
      while (s.game.phase !== 'competition_complete') {
        if (++commands > 80) throw Error('Target survival bound');
        const g = s.game;
        if (g.phase === 'room_action') {
          if (g.activePlayerIds.includes('human')) {
            const d = chooseTargetTurn(
              targetPublicInput(g),
              survivalRoomRules(g),
              missing,
              state,
              choice.seekLowest,
            );
            s = reduceSurvivalClient(s, {
              type: 'submit_player_turn',
              turn: d.turn,
            });
            if (!s.game.roomSettlement)
              throw Error('No survival target settlement');
            observe(s.game.roomSettlement, d);
          } else {
            s = reduceSurvivalClient(s, { type: 'submit_ai_room' });
            aiOnlyRooms++;
          }
        } else
          s = reduceSurvivalClient(s, {
            type: g.phase === 'room_result' ? 'advance_room' : 'advance_floor',
          });
        if (s.growthIssue) throw Error(s.growthIssue);
        for (const f of s.game.floorRecords.slice(checkedFloors)) {
          const before = state.lowestConfirmed;
          state = confirmTargetFloor(state, f);
          floorConfirmations.push({
            floor: f.floorIndex,
            confirmed: state.lowestConfirmed,
            before,
          });
          checkedFloors++;
        }
      }
      champion = s.game.championId === 'human';
      context = s.growth!;
    }
    if (context.units.at(-1)?.stage !== 'complete')
      throw Error('Incomplete target authority');
    return {
      context,
      traceFingerprint: sha256Hex(canonicalJson(context)),
      champion,
      humanRooms,
      aiOnlyRooms,
      floors: auditFloorCounts(context.units),
      held: [...held].sort(),
      offered: [...offered].sort(),
      attempts,
      floorConfirmations,
    };
  });
}
