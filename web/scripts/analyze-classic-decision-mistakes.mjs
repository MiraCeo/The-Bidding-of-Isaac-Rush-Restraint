import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { decisionMistakePlan as plan } from './classic-decision-mistake-plan.mjs';
import { analyzeMistakeRows } from './analyze-classic-mistake-study.mjs';

export function summarizeDecisionWitnesses(
  events,
  studyPlan = plan,
  structuredArms = studyPlan.arms
    .filter((a) => a.id.startsWith('new'))
    .map((a) => a.id),
) {
  const unique = new Set();
  const summary = studyPlan.arms.map((arm) => ({
    arm: arm.id,
    triggered: 0,
    applied: 0,
    requested: { reward: 0, budget: 0, quote: 0 },
    executed: { reward: 0, budget: 0, quote: 0 },
    fallback: 0,
    fallbackApplied: 0,
    blocked: 0,
    budgetExtraCost: 0,
    rewardCostDelta: 0,
  }));
  for (const e of events) {
    const group = summary.find((g) => g.arm === e.arm);
    if (
      !group ||
      !e.triggered ||
      !Number.isInteger(e.block) ||
      e.block < 0 ||
      e.block >= studyPlan.blocks ||
      !studyPlan.roles.includes(e.role) ||
      !studyPlan.policies.includes(e.policy) ||
      !/^ai-\d+$/.test(e.playerId) ||
      !Number.isInteger(e.floor) ||
      e.floor < 0 ||
      e.floor > 2 ||
      !Number.isInteger(e.room) ||
      e.room < 0 ||
      e.room > 4 ||
      (!['reward', 'budget', 'quote'].includes(e.requestedKind) &&
        !(
          e.selection === 'feasible-first' &&
          e.requestedKind === null &&
          !e.applied &&
          Array.isArray(e.availableKinds) &&
          e.availableKinds.length === 0
        ))
    )
      throw Error('Invalid content witness');
    const key = `${e.block}:${e.role}:${e.policy}:${e.arm}:${e.playerId}:${e.floor}:${e.room}`;
    if (unique.has(key)) throw Error('Duplicate content witness');
    unique.add(key);
    if (
      !structuredArms.includes(e.arm) &&
      (e.requestedKind !== 'quote' || e.fallback)
    )
      throw Error('Control used new mistake content');
    group.triggered++;
    if (e.requestedKind !== null) group.requested[e.requestedKind]++;
    if (e.fallback) group.fallback++;
    if (!e.applied) {
      if (e.kind !== null) throw Error('Unapplied content marked as executed');
      group.blocked++;
      continue;
    }
    if (
      !['reward', 'budget', 'quote'].includes(e.kind) ||
      !['mild', 'medium'].includes(e.severity) ||
      !(e.modelLoss > 0) ||
      !Number.isFinite(e.modelLoss) ||
      !e.before ||
      !e.after ||
      !Number.isFinite(e.beforeCost) ||
      !Number.isFinite(e.afterCost)
    )
      throw Error('Invalid applied content');
    const cap =
      e.kind === 'reward'
        ? studyPlan.content.rewardLossCaps[e.severity]
        : e.kind === 'budget'
          ? studyPlan.content.budgetLossCaps[e.severity]
          : e.severity === 'mild'
            ? studyPlan.mildMaximumModelLoss
            : studyPlan.mediumMaximumModelLoss;
    if (e.modelLoss > cap) throw Error('Content model-loss cap exceeded');
    if (e.kind === 'reward') {
      if (
        e.beforeCost !== e.afterCost ||
        !(e.visibleValueGap >= studyPlan.content.minimumVisibleValueGap) ||
        e.before.actions.length !== e.after.actions.length
      )
        throw Error('Invalid reward reassignment');
      for (let i = 0; i < e.before.actions.length; i++) {
        const a = e.before.actions[i],
          b = e.after.actions[i];
        if (
          a.type === 'withdraw' ||
          a.type !== b.type ||
          a.amount !== b.amount ||
          a.group === b.group
        )
          throw Error('Reward lapse changed more than assignment');
      }
      group.rewardCostDelta += e.afterCost - e.beforeCost;
    }
    if (e.kind === 'budget') {
      if (
        e.room === 4 ||
        !(e.afterCost > e.beforeCost) ||
        !(e.reserveAfter >= 0)
      )
        throw Error('Invalid future-cash overcommitment');
      const beforeMoney = e.afterCost + e.reserveAfter;
      if (
        e.afterCost >
        beforeMoney * studyPlan.content.budgetMaximumCashRatio[e.severity]
      )
        throw Error('Content reserve cap exceeded');
      group.budgetExtraCost += e.afterCost - e.beforeCost;
    }
    group.applied++;
    group.executed[e.kind]++;
    if (e.fallback) group.fallbackApplied++;
  }
  return summary;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const directory = resolve(process.argv[2]);
  const run = JSON.parse(readFileSync(resolve(directory, 'run.json'), 'utf8'));
  const completed = JSON.parse(
    readFileSync(resolve(directory, 'complete.json'), 'utf8'),
  );
  if (
    run.kind !== 'v080-classic-decision-mistake-content' ||
    JSON.stringify(run.plan) !== JSON.stringify(plan) ||
    completed.matches !== 5400
  )
    throw Error('Invalid content run');
  const input = readFileSync(resolve(directory, 'rows.jsonl'), 'utf8');
  const findings = analyzeMistakeRows(
    input.trim().split(/\r?\n/).map(JSON.parse),
    plan,
  );
  const witnessData = readFileSync(
    resolve(directory, 'mistakes.jsonl'),
    'utf8',
  );
  const events = witnessData.trim()
    ? witnessData.trim().split(/\r?\n/).map(JSON.parse)
    : [];
  const content = summarizeDecisionWitnesses(events);
  for (const c of content) {
    const group = findings.pooled.find((g) => g.arm === c.arm);
    if (
      c.triggered !== group.triggers ||
      c.applied !== group.applied ||
      c.blocked !== group.blocked
    )
      throw Error('Content witness count mismatch');
  }
  writeFileSync(
    resolve(directory, 'findings.json'),
    JSON.stringify(
      {
        ...findings,
        kind: 'isolated-classic-decision-mistakes-analysis',
        content,
        plan,
        source: run.source,
        inputSha256: createHash('sha256').update(input).digest('hex'),
        witnessSha256: createHash('sha256').update(witnessData).digest('hex'),
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
      ci99: `[${p.rankDifference.lower.toFixed(3)}, ${p.rankDifference.upper.toFixed(3)}]`,
    })),
  );
  console.table(
    content.map((c) => ({
      arm: c.arm,
      reward: c.executed.reward,
      budget: c.executed.budget,
      quote: c.executed.quote,
      fallback: c.fallback,
      budgetExtra: c.budgetExtraCost,
    })),
  );
}
