/** Fixed per-AI grade population, independent of roles/doctrines/personalities. */
import { createHash } from 'node:crypto';
import {
  populationPlan as defaultPlan,
  type PopulationArm,
  type AiGrade,
} from '../../../scripts/classic-population-plan.mjs';
import { defaultRules } from '../../game/config';
import { createSeededRandom } from '../../game/random';
import { mixClientSeed } from '../../game/client-runtime';
import { canonicalJson } from '../../shared/json-facts';
import type { CharacterId } from '../../game/item-types';
import { applyFeasibleMistake } from './classic-feasible-mistake.test-helper';
import {
  runMistakeMatch,
  type MistakeEvent,
} from './classic-mistake.test-helper';
import type { StudyPolicy } from './difficulty-study.test-helper';

export function populationSeed(block: number, plan = defaultPlan) {
  if (!Number.isSafeInteger(block) || block < 0 || block >= plan.blocks)
    throw Error('Invalid population seed block');
  return (0x08010000 + Math.imul(plan.seedStart + block + 1, 104729)) >>> 0;
}
export function assignPopulation(
  seed: number,
  arm: PopulationArm,
  plan = defaultPlan,
) {
  if (
    defaultRules.playerCount - 1 !== plan.aiCount ||
    arm.counts.length !== 3 ||
    arm.counts.some((n) => !Number.isInteger(n) || n < 0) ||
    arm.counts.reduce((a, b) => a + b, 0) !== plan.aiCount
  )
    throw Error('Invalid fixed AI counts');
  const order = Array.from({ length: plan.aiCount }, (_, i) => `ai-${i + 1}`);
  const random = createSeededRandom(mixClientSeed(seed, 0x18b4c913));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random.next() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const assignment: Record<string, AiGrade> = {};
  for (const [i, id] of order.entries())
    assignment[id] =
      i < arm.counts[0]!
        ? 'low'
        : i < arm.counts[0]! + arm.counts[1]!
          ? 'mid'
          : 'high';
  return { order, assignment };
}
function gradeCounters() {
  return {
    turns: 0,
    positiveCash: 0,
    triggered: 0,
    applied: 0,
    awardCopies: 0,
    entitledTurns: 0,
    rankSum: 0,
    scoreSum: 0,
  };
}
export function runPopulationMatch(
  block: number,
  role: CharacterId,
  policy: StudyPolicy,
  arm: PopulationArm,
  witness?: (event: MistakeEvent) => void,
  plan = defaultPlan,
) {
  const seed = populationSeed(block, plan),
    assigned = assignPopulation(seed, arm, plan);
  const byGrade = {
    low: gradeCounters(),
    mid: gradeCounters(),
    high: gradeCounters(),
  };
  const humanLiquidity = {
    rooms: 0,
    zeroEntryRooms: 0,
    earlyZeroAfterRooms: 0,
    bossEntries: 0,
    zeroBossEntries: 0,
    bossCashRatio: 0,
  };
  let aiResults: {
    playerId: string;
    grade: AiGrade;
    role: CharacterId | null;
    doctrine: string;
    personalities: string[];
    rank: number;
    score: number;
  }[] = [];
  const transform: typeof applyFeasibleMistake = (
    decision,
    player,
    floor,
    rules,
    options,
    gameSeed,
  ) => {
    const grade = assigned.assignment[player.id];
    if (!grade) throw Error('Unassigned AI player');
    // Dispatch uses this AI's fixed grade, not the arm's descriptive mean rate.
    const result = applyFeasibleMistake(
      decision,
      player,
      floor,
      rules,
      options,
      gameSeed,
      plan.levels[grade],
    );
    byGrade[grade].triggered += Number(result.event.triggered);
    byGrade[grade].applied += Number(result.event.applied);
    return { decision: result.decision, event: { ...result.event, grade } };
  };
  const row = runMistakeMatch(
    block,
    role,
    policy,
    arm,
    witness,
    seed,
    transform,
    (record) => {
      const before = record.playersBefore.find((p) => p.id === 'human')!,
        after = record.players.find((p) => p.id === 'human')!;
      humanLiquidity.rooms++;
      humanLiquidity.zeroEntryRooms += Number(before.money === 0);
      humanLiquidity.earlyZeroAfterRooms += Number(
        record.room.roomIndex < 4 && after.money === 0,
      );
      if (record.room.kind === 'boss') {
        humanLiquidity.bossEntries++;
        humanLiquidity.zeroBossEntries += Number(before.money === 0);
        humanLiquidity.bossCashRatio +=
          before.money /
          defaultRules.floorStartingMoney[record.room.floorIndex]!;
      }
      const awarded = new Map();
      for (const a of record.awards)
        awarded.set(a.playerId, (awarded.get(a.playerId) ?? 0) + a.copies);
      const entitled = new Set(record.entitlements.map((e) => e.playerId));
      for (const p of record.playersBefore.filter((p) => !p.isHuman)) {
        const g = byGrade[assigned.assignment[p.id]!]!;
        g.turns++;
        g.positiveCash += Number(p.money > 0);
        g.awardCopies += awarded.get(p.id) ?? 0;
        g.entitledTurns += Number(entitled.has(p.id));
      }
    },
    (game) => {
      aiResults = game.finalRanking.flatMap((entry, i) => {
        if (entry.playerId === 'human') return [];
        const p = game.players.find((p) => p.id === entry.playerId)!;
        const grade = assigned.assignment[p.id]!;
        byGrade[grade].rankSum += i + 1;
        byGrade[grade].scoreSum += entry.finalScore;
        return [
          {
            playerId: p.id,
            grade,
            role: p.characterId,
            doctrine: game.aiProfiles[p.id]!.doctrine,
            personalities: [...game.aiProfiles[p.id]!.personalities],
            rank: i + 1,
            score: entry.finalScore,
          },
        ];
      });
    },
  );
  if (
    aiResults.length !== plan.aiCount ||
    humanLiquidity.rooms !== 15 ||
    humanLiquidity.bossEntries !== 3
  )
    throw Error('Incomplete population diagnostics');
  for (const [i, grade] of plan.grades.entries())
    if (byGrade[grade].turns !== arm.counts[i]! * 15)
      throw Error('AI grade changed during match');
  const assignmentHash = createHash('sha256')
    .update(canonicalJson(assigned))
    .digest('hex');
  return {
    ...row,
    kind: plan.rowKind,
    humanLiquidity,
    assignmentOrder: assigned.order,
    assignment: assigned.assignment,
    assignmentHash,
    byGrade,
    aiResults,
  };
}
