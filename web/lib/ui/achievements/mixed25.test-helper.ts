/** Counterfactual thresholds are readouts only; profiles and unlocks use production. */
import { mixed25Plan } from '../../../scripts/mixed25-plan.mjs';
import {
  achievementCatalog,
  achievementCharacters,
  characterAchievementRequirements,
  type AchievementId,
} from './catalog';
import { achievementSeries } from './series';
import { achievementIdForNumber, achievementNumber } from './numbering';
import { createStudyController } from './difficulty-study.test-helper';
import {
  createEdgeController,
  auditFloorCounts,
} from './audit117-edge.test-helper';
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
import { validateTurn } from '../../game/turns';
import type { CharacterId, ItemId } from '../../game/item-types';
import type { ClassicDifficulty } from '../../game/classic-difficulty';
import type { ClientRoomSettlementRecord } from '../../game/client-session';
import type { PlayerProfile } from '../player-profile';
import { availableStudyRoles } from './current-study.test-helper';
import { canonicalJson } from '../../shared/json-facts';
import { sha256Hex } from '../../shared/sha256';

export type Mixed25Route = (typeof mixed25Plan.routes)[number];
export type Mixed25Style =
  | 'public-ai'
  | 'pace'
  | 'explore'
  | 'edge-public-1'
  | 'edge-opening-1';
export interface Mixed25Choice {
  mode: 'classic' | 'survival';
  difficulty: ClassicDifficulty;
  role: CharacterId;
  style: Mixed25Style;
  reason: string;
  available: CharacterId[];
}
export const mixed25Targets = Object.fromEntries(
  Object.entries(mixed25Plan.targets).map(([number, target]) => {
    const id = achievementIdForNumber(number);
    if (!id) throw Error('Unknown candidate number');
    return [id, target];
  }),
) as Partial<Record<AchievementId, number>>;
export function assertMixed25Targets() {
  if (achievementCatalog.length !== 117) throw Error('Wrong candidate catalog');
  for (const a of achievementCatalog) {
    const target = mixed25Targets[a.id];
    if (
      target !== undefined &&
      (!Number.isSafeInteger(target) ||
        target < 1 ||
        target > a.target ||
        a.kind !== 'cumulative')
    )
      throw Error('Invalid candidate override');
  }
  for (const series of achievementSeries) {
    const values = series.ids.map(
      (id) =>
        mixed25Targets[id] ??
        achievementCatalog.find((a) => a.id === id)!.target,
    );
    if (values.some((v, i) => i > 0 && v <= values[i - 1]!))
      throw Error('Non-increasing candidate stages');
  }
  for (const ids of Object.values(characterAchievementRequirements))
    for (const id of ids)
      if (
        mixed25Targets[id] !== undefined &&
        mixed25Targets[id] !==
          achievementCatalog.find((a) => a.id === id)!.target
      )
        throw Error('Candidate alters role prerequisite');
}
export function mixed25Readout(
  progress: Partial<Record<AchievementId, number>>,
  actuallyEarned: readonly string[],
) {
  const actual = new Set(actuallyEarned),
    candidate = achievementCatalog
      .filter(
        (a) =>
          actual.has(a.id) ||
          (mixed25Targets[a.id] !== undefined &&
            (progress[a.id] ?? 0) >= mixed25Targets[a.id]!),
      )
      .map((a) => a.id);
  return {
    candidate,
    missing: achievementCatalog
      .filter((a) => !candidate.includes(a.id))
      .map((a) => a.id),
  };
}
export function chooseMixed25(
  route: Mixed25Route,
  index: number,
  profile: PlayerProfile,
  earned: readonly AchievementId[],
  roleUses: Partial<Record<CharacterId, number>>,
  survivalPlayed: number,
): Mixed25Choice {
  const available = availableStudyRoles(profile),
    has = (number: string) => earned.includes(achievementIdForNumber(number)!);
  const shadowRoles = achievementCharacters.filter((role) =>
    characterAchievementRequirements[role].every((id) => earned.includes(id)),
  );
  if (canonicalJson(available) !== canonicalJson(shadowRoles))
    throw Error('Shadow unlocks diverged from production');
  let mode: 'classic' | 'survival' = index % 2 === 1 ? 'classic' : 'survival',
    reason = index <= 20 ? 'fixed-10-plus-10' : 'missing-mode-goals';
  if (index > 20) {
    const c = achievementCatalog.filter(
      (a) => a.scope === 'classic' && !earned.includes(a.id),
    ).length;
    const s = achievementCatalog.filter(
      (a) => a.scope === 'survival' && !earned.includes(a.id),
    ).length;
    mode =
      c * 3 + (has('E13') ? 0 : 3) >= s * 2 + (has('F14') ? 0 : 6)
        ? 'classic'
        : 'survival';
  }
  let role = available[(index - 1) % available.length]!;
  if (route === 'collector') {
    const unused = available.find((r) => !roleUses[r]);
    if (unused) {
      role = unused;
      reason += ':unused-role';
    } else if (mode === 'classic' && !has('E13')) role = 'isaac';
    else if (
      mode === 'classic' &&
      available.includes('lost') &&
      (!has('E14') || !has('E18'))
    )
      role = 'lost';
    else if (
      mode === 'survival' &&
      survivalPlayed >= 4 &&
      !has('F14') &&
      available.includes('jacob_esau')
    )
      role = 'jacob_esau';
    else if (!has('E17') && available.includes('jacob_esau'))
      role = 'jacob_esau';
    else if (available.includes('eden')) role = 'eden';
  }
  let difficulty: ClassicDifficulty =
    mode === 'classic'
      ? route === 'mixed'
        ? 'highest'
        : 'standard'
      : survivalPlayed < 2
        ? 'standard'
        : survivalPlayed < 4
          ? 'hard'
          : 'highest';
  if (
    mode === 'classic' &&
    route === 'collector' &&
    (!has('E09') || (!has('E13') && role === 'isaac'))
  )
    difficulty = 'easy';
  let style: Mixed25Style =
    route === 'mixed' ? (index % 3 === 0 ? 'explore' : 'pace') : 'public-ai';
  if (route === 'collector') {
    if (
      mode === 'survival' &&
      (!has('F05') || !has('F15')) &&
      survivalPlayed % 3 === 2
    ) {
      style = has('F05') ? 'edge-opening-1' : 'edge-public-1';
      difficulty = 'standard';
      reason += ':lowest-survivor';
    } else if (
      mode === 'classic' &&
      index > 6 &&
      index % 3 === 0 &&
      has('E13')
    ) {
      style = 'explore';
      reason += ':disruption-opportunity';
    }
    if (index > 20 && has('F14') && !has('F15') && mode === 'survival') {
      style = 'edge-opening-1';
      difficulty = 'standard';
      reason += ':lowest-then-champion';
    }
  }
  return { mode, difficulty, role, style, reason, available };
}
export function runMixed25Match(seed: number, choice: Mixed25Choice) {
  const policy =
    choice.style === 'pace' || choice.style === 'explore'
      ? choice.style
      : 'public-ai';
  const ctrl = createStudyController(seed, policy),
    edge = createEdgeController(seed),
    held = new Set<ItemId>(),
    offered = new Set<ItemId>();
  let humanRooms = 0,
    aiOnlyRooms = 0;
  const observe = (r: ClientRoomSettlementRecord) => {
    const human = r.playersBefore.find((p) => p.id === 'human')!;
    for (const item of human.items) held.add(item.itemId);
    // Post-settlement observer only. Decision controllers see masked hidden rewards.
    for (const reward of r.room.rewards) offered.add(reward.itemId);
    humanRooms++;
  };
  let context: GrowthContext;
  if (choice.mode === 'classic') {
    if (choice.style.startsWith('edge'))
      throw Error('Survival edge style in classic');
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
        throw Error('Invalid classic mixed25 state');
      if (s.game.phase === 'room_action') {
        const turn = ctrl.decide(s.game, defaultRules),
          human = s.game.players.find((p) => p.id === 'human')!;
        if (validateTurn(human, turn, defaultRules).length)
          throw Error('Illegal mixed25 classic action');
        s = reduceGameSession(s, { type: 'submit_player_turn', turn });
        if (s.game.phase === 'character_selection' || !s.game.roomSettlement)
          throw Error('Missing classic mixed25 result');
        observe(s.game.roomSettlement);
        ctrl.update(s.game.roomSettlement);
      } else s = reduceGameSession(s, { type: 'advance_room' });
      if (s.growthIssue) throw Error(s.growthIssue);
    }
    context = s.growth!;
  } else {
    let s = beginSurvivalGrowth(
        startSurvivalClient(choice.role, seed, choice.difficulty),
      ),
      commands = 0;
    while (s.game.phase !== 'competition_complete') {
      if (++commands > 80) throw Error('Survival mixed25 command bound');
      const g = s.game;
      if (g.phase === 'room_action') {
        if (g.activePlayerIds.includes('human')) {
          const rules = survivalRoomRules(g),
            useEdge =
              choice.style === 'edge-public-1' ||
              (choice.style === 'edge-opening-1' && g.floorIndex === 0);
          const turn = useEdge ? edge.decide(g, rules) : ctrl.decide(g, rules),
            human = g.players.find((p) => p.id === 'human')!;
          if (validateTurn(human, turn, rules).length)
            throw Error('Illegal mixed25 survival action');
          s = reduceSurvivalClient(s, { type: 'submit_player_turn', turn });
          if (!s.game.roomSettlement)
            throw Error('Missing survival mixed25 result');
          observe(s.game.roomSettlement);
          if (useEdge) edge.update(s.game.roomSettlement);
          else ctrl.update(s.game.roomSettlement);
        } else {
          s = reduceSurvivalClient(s, { type: 'submit_ai_room' });
          aiOnlyRooms++;
        }
      } else
        s = reduceSurvivalClient(s, {
          type: g.phase === 'room_result' ? 'advance_room' : 'advance_floor',
        });
      if (s.growthIssue) throw Error(s.growthIssue);
    }
    context = s.growth!;
  }
  if (context.units.at(-1)?.stage !== 'complete')
    throw Error('Incomplete mixed25 authority');
  return {
    context,
    traceFingerprint: sha256Hex(canonicalJson(context)),
    humanRooms,
    aiOnlyRooms,
    floors: auditFloorCounts(context.units),
    held: [...held].sort((a, b) => a.localeCompare(b)),
    offered: [...offered].sort((a, b) => a.localeCompare(b)),
  };
}
export function mixed25Catalog() {
  return achievementCatalog.map((a) => ({
    ...a,
    number: achievementNumber(a.id),
    candidateTarget: mixed25Targets[a.id] ?? a.target,
  }));
}
