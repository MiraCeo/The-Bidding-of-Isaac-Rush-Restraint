import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mistakePlan as defaultPlan } from './classic-mistake-plan.mjs';

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sum = (rows, key) => rows.reduce((s, r) => s + r[key], 0);
export function mistakeBootstrap(
  xs,
  alpha = 0.05,
  repetitions = defaultPlan.bootstrapResamples,
) {
  if (!xs.length || xs.some((x) => !Number.isFinite(x)))
    throw Error('Invalid seed block values');
  let seed = 0x03201080;
  const draws = Array.from({ length: repetitions }, () => {
    let total = 0;
    for (let i = 0; i < xs.length; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      total += xs[Math.floor(((seed >>> 0) / 0x100000000) * xs.length)];
    }
    return total / xs.length;
  }).sort((a, b) => a - b);
  return {
    mean: mean(xs),
    lower: draws[Math.floor((draws.length * alpha) / 2)],
    upper: draws[Math.ceil(draws.length * (1 - alpha / 2)) - 1],
    blocks: xs.length,
    confidence: 1 - alpha,
  };
}
export function validateMistakeRows(rows, plan = defaultPlan) {
  const expected =
    plan.blocks * plan.roles.length * plan.policies.length * plan.arms.length;
  if (rows.length !== expected) throw Error('Incomplete mistake matrix');
  const byKey = new Map();
  for (const r of rows) {
    const arm = plan.arms.find((a) => a.id === r.arm);
    if (
      !arm ||
      r.kind !== (plan.rowKind ?? 'research-only-quote-lapse') ||
      !Number.isInteger(r.block) ||
      r.block < 0 ||
      r.block >= plan.blocks ||
      r.seed !==
        (0x08010000 + Math.imul(plan.seedStart + r.block + 1, 104729)) >>> 0 ||
      !plan.roles.includes(r.role) ||
      !plan.policies.includes(r.policy) ||
      r.rooms !== 15 ||
      !Number.isInteger(r.rank) ||
      r.rank < 1 ||
      r.rank > 20 ||
      !Number.isFinite(r.score) ||
      ![r.world, r.traceHash, r.terminalHash].every((s) =>
        /^[a-f0-9]{64}$/.test(s),
      ) ||
      !Array.isArray(r.floors) ||
      r.floors.length !== 3
    )
      throw Error('Invalid mistake row');
    for (const f of r.floors) {
      if (
        Object.values(f).some((x) => !Number.isFinite(x)) ||
        f.turns !== 95 ||
        f.positiveCash + f.zeroCash !== f.turns ||
        f.triggers !== f.applied + f.blocked ||
        f.applied !== f.mild + f.medium ||
        f.triggers > f.positiveCash ||
        (arm.rate === 0 && f.triggers !== 0) ||
        (arm.mediumShare === 0 && f.medium !== 0)
      )
        throw Error('Inconsistent mistake counters');
    }
    const key = `${r.block}:${r.role}:${r.policy}:${r.arm}`;
    if (byKey.has(key)) throw Error('Duplicate mistake condition');
    byKey.set(key, r);
  }
  for (let b = 0; b < plan.blocks; b++)
    for (const role of plan.roles)
      for (const policy of plan.policies) {
        const matches = plan.arms.map((a) =>
          byKey.get(`${b}:${role}:${policy}:${a.id}`),
        );
        if (
          matches.some((r) => !r) ||
          new Set(matches.map((r) => r.world)).size !== 1
        )
          throw Error('Unpaired mistake worlds');
      }
  return byKey;
}
function describe(rows) {
  const counters = rows.flatMap((r) => r.floors),
    positive = sum(counters, 'positiveCash'),
    applied = sum(counters, 'applied');
  const target = sum(counters, 'targetRatio') / sum(counters, 'targets');
  return {
    matches: rows.length,
    rank: mean(rows.map((r) => r.rank)),
    score: mean(rows.map((r) => r.score)),
    top5: mean(rows.map((r) => Number(r.rank <= 5))),
    first: mean(rows.map((r) => Number(r.rank === 1))),
    humanAwards: mean(rows.map((r) => sum(r.floors, 'humanAwards'))),
    humanEntitled: mean(rows.map((r) => sum(r.floors, 'humanEntitled'))),
    aiTurns: sum(counters, 'turns'),
    positiveCash: positive,
    triggers: sum(counters, 'triggers'),
    applied,
    triggerRate: sum(counters, 'triggers') / positive,
    appliedRate: applied / positive,
    mild: sum(counters, 'mild'),
    medium: sum(counters, 'medium'),
    blocked: sum(counters, 'blocked'),
    meanModelLossWhenApplied: applied
      ? sum(counters, 'modelLoss') / applied
      : null,
    meanCostChangeWhenApplied: applied
      ? sum(counters, 'costChange') / applied
      : null,
    withdrawRate: sum(counters, 'withdraw') / sum(counters, 'turns'),
    beforeBossCashRatio:
      sum(counters, 'beforeBossCash') / sum(counters, 'beforeBossTurns'),
    targetMeanPerFloorCash: target,
    targetSdPerFloorCash: Math.sqrt(
      Math.max(
        0,
        sum(counters, 'targetRatioSquared') / sum(counters, 'targets') -
          target ** 2,
      ),
    ),
  };
}
export function analyzeMistakeRows(rows, plan = defaultPlan) {
  const byKey = validateMistakeRows(rows, plan);
  function paired(low, high, policies, alpha) {
    const blocks = Array.from({ length: plan.blocks }, (_, block) => {
      const pairs = plan.roles.flatMap((role) =>
        policies.map((policy) => [
          byKey.get(`${block}:${role}:${policy}:${low}`),
          byKey.get(`${block}:${role}:${policy}:${high}`),
        ]),
      );
      return {
        rank: mean(pairs.map(([a, b]) => a.rank - b.rank)),
        score: mean(pairs.map(([a, b]) => a.score - b.score)),
        awards: mean(
          pairs.map(
            ([a, b]) =>
              sum(a.floors, 'humanAwards') - sum(b.floors, 'humanAwards'),
          ),
        ),
      };
    });
    return {
      low,
      high,
      policies,
      rankDifference: mistakeBootstrap(
        blocks.map((b) => b.rank),
        alpha,
        plan.bootstrapResamples,
      ),
      meanScoreDifference: mean(blocks.map((b) => b.score)),
      meanAwardsDifference: mean(blocks.map((b) => b.awards)),
    };
  }
  return {
    kind: 'isolated-classic-quote-mistakes-analysis',
    matches: rows.length,
    independentSeedBlocks: plan.blocks,
    aiPlayerTurns: rows.length * 285,
    primary: plan.primaryPairs.map(([a, b]) =>
      paired(
        a,
        b,
        plan.primaryPolicies,
        plan.familywiseAlpha / plan.primaryPairs.length,
      ),
    ),
    secondaryByPolicy: plan.policies.flatMap((p) =>
      plan.primaryPairs.map(([a, b]) => paired(a, b, [p], 0.05)),
    ),
    groups: plan.policies.flatMap((policy) =>
      plan.arms.map((arm) => ({
        policy,
        arm: arm.id,
        ...describe(
          rows.filter((r) => r.policy === policy && r.arm === arm.id),
        ),
      })),
    ),
    pooled: plan.arms.map((arm) => ({
      arm: arm.id,
      ...describe(rows.filter((r) => r.arm === arm.id)),
    })),
    byRole: plan.roles.flatMap((role) =>
      plan.arms.map((arm) => ({
        role,
        arm: arm.id,
        ...describe(rows.filter((r) => r.role === role && r.arm === arm.id)),
      })),
    ),
  };
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const plan = defaultPlan;
  const directory = resolve(process.argv[2]);
  const marker = JSON.parse(
    readFileSync(resolve(directory, 'run.json'), 'utf8'),
  );
  const completed = JSON.parse(
    readFileSync(resolve(directory, 'complete.json'), 'utf8'),
  );
  if (
    marker.kind !== 'v080-isolated-classic-quote-mistakes' ||
    JSON.stringify(marker.plan) !== JSON.stringify(plan) ||
    completed.matches !== 5400
  )
    throw Error('Invalid mistake run');
  const input = readFileSync(resolve(directory, 'rows.jsonl'), 'utf8');
  const findings = analyzeMistakeRows(
    input.trim().split(/\r?\n/).map(JSON.parse),
  );
  const witnesses = readFileSync(resolve(directory, 'mistakes.jsonl'), 'utf8');
  const events = witnesses.trim()
    ? witnesses.trim().split(/\r?\n/).map(JSON.parse)
    : [];
  for (const arm of plan.arms) {
    const all = events.filter((e) => e.arm === arm.id),
      pooled = findings.pooled.find((g) => g.arm === arm.id);
    if (
      all.length !== pooled.triggers ||
      all.filter((e) => e.applied).length !== pooled.applied
    )
      throw Error('Mistake witnesses do not reconcile');
  }
  writeFileSync(
    resolve(directory, 'findings.json'),
    JSON.stringify(
      {
        ...findings,
        inputSha256: createHash('sha256').update(input).digest('hex'),
        witnessSha256: createHash('sha256').update(witnesses).digest('hex'),
        source: marker.source,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  console.table(
    findings.groups.map((g) => ({
      script: g.policy,
      arm: g.arm,
      rank: g.rank.toFixed(3),
      score: g.score.toFixed(1),
      awards: g.humanAwards.toFixed(3),
      trigger: g.triggerRate.toFixed(4),
      applied: g.appliedRate.toFixed(4),
    })),
  );
  console.table(
    findings.primary.map((p) => ({
      pair: `${p.low}-${p.high}`,
      delta: p.rankDifference.mean.toFixed(3),
      ci: `[${p.rankDifference.lower.toFixed(3)}, ${p.rankDifference.upper.toFixed(3)}]`,
    })),
  );
}
