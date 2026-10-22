import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { feasibleMistakePlan as plan } from './classic-feasible-mistake-plan.mjs';
import { analyzeMistakeRows } from './analyze-classic-mistake-study.mjs';
import { summarizeDecisionWitnesses } from './analyze-classic-decision-mistakes.mjs';

export function auditFeasibleEvents(
  events,
  studyPlan = plan,
  feasibleArms = studyPlan.arms
    .filter((a) => a.id.startsWith('eligible'))
    .map((a) => a.id),
) {
  const stats = studyPlan.arms.map((a) => ({
    arm: a.id,
    withOptions: 0,
    withoutOptions: 0,
    available: { reward: 0, budget: 0, quote: 0 },
    masks: {},
  }));
  for (const e of events) {
    const stat = stats.find((s) => s.arm === e.arm);
    if (!stat) throw Error('Unknown selection arm');
    if (!feasibleArms.includes(e.arm)) {
      if (
        e.selection !==
        (e.arm.startsWith('prior') ? 'type-first' : 'quote-only')
      )
        throw Error('Control selection order changed');
      continue;
    }
    if (
      e.selection !== 'feasible-first' ||
      e.fallback ||
      !Array.isArray(e.availableKinds) ||
      !e.candidateCounts
    )
      throw Error('Invalid selection metadata');
    const kinds = ['reward', 'budget', 'quote'];
    const expected = kinds.filter((k) => e.candidateCounts[k] > 0);
    if (
      kinds.some(
        (k) =>
          !Number.isInteger(e.candidateCounts[k]) || e.candidateCounts[k] < 0,
      ) ||
      e.candidateCounts.quote > 1 ||
      JSON.stringify(expected) !== JSON.stringify(e.availableKinds)
    )
      throw Error('Invalid feasible pools');
    for (const k of expected) stat.available[k]++;
    const mask = expected.join('+') || 'none';
    stat.masks[mask] = (stat.masks[mask] ?? 0) + 1;
    if (expected.length) {
      stat.withOptions++;
      if (
        !e.applied ||
        !expected.includes(e.kind) ||
        e.requestedKind !== e.kind
      )
        throw Error('Did not execute a feasible type');
    } else {
      stat.withoutOptions++;
      if (e.applied || e.kind !== null || e.requestedKind !== null)
        throw Error('Forced a nonexistent mistake');
    }
  }
  return stats;
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
    run.kind !== 'v080-classic-feasible-first-selection' ||
    JSON.stringify(run.plan) !== JSON.stringify(plan) ||
    completed.matches !== 5400
  )
    throw Error('Invalid selection run');
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
  const content = summarizeDecisionWitnesses(events, plan, plan.structuredArms);
  const availability = auditFeasibleEvents(events);
  for (const c of content) {
    const group = findings.pooled.find((g) => g.arm === c.arm);
    if (
      c.triggered !== group.triggers ||
      c.applied !== group.applied ||
      c.blocked !== group.blocked
    )
      throw Error('Selection witnesses do not reconcile');
  }
  writeFileSync(
    resolve(directory, 'findings.json'),
    JSON.stringify(
      {
        ...findings,
        kind: 'isolated-feasible-first-selection-analysis',
        content,
        availability,
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
      blocked: c.blocked,
    })),
  );
}
