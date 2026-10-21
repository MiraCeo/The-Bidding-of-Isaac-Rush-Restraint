import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { populationPlan as defaultPlan } from './classic-population-plan.mjs';
import { validateMistakeRows } from './analyze-classic-mistake-study.mjs';
import { analyzeEasySeverityRows } from './analyze-classic-easy-severity.mjs';
import { summarizeDecisionWitnesses } from './analyze-classic-decision-mistakes.mjs';
import { auditFeasibleEvents } from './analyze-classic-feasible-mistakes.mjs';

export function validatePopulationRows(rows, plan = defaultPlan) {
  const byKey = validateMistakeRows(rows, plan),
    orderByBlock = new Map();
  const expectedIds = Array.from(
    { length: 19 },
    (_, i) => `ai-${i + 1}`,
  ).sort();
  for (const r of rows) {
    const arm = plan.arms.find((a) => a.id === r.arm);
    if (
      !Array.isArray(r.assignmentOrder) ||
      JSON.stringify(
        [...r.assignmentOrder].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      ) !== JSON.stringify(expectedIds) ||
      !r.assignment ||
      JSON.stringify(Object.keys(r.assignment).sort()) !==
        JSON.stringify(expectedIds)
    )
      throw Error('Invalid AI assignment');
    const order = JSON.stringify(r.assignmentOrder);
    if (orderByBlock.has(r.block) && orderByBlock.get(r.block) !== order)
      throw Error('Grade allocation depends on role, script or difficulty');
    orderByBlock.set(r.block, order);
    const canonical = JSON.stringify({
      assignment: Object.fromEntries(
        Object.keys(r.assignment)
          .sort()
          .map((k) => [k, r.assignment[k]]),
      ),
      order: r.assignmentOrder,
    });
    if (
      createHash('sha256').update(canonical).digest('hex') !== r.assignmentHash
    )
      throw Error('Assignment fingerprint mismatch');
    for (const [i, id] of r.assignmentOrder.entries()) {
      const expected =
        i < arm.counts[0]
          ? 'low'
          : i < arm.counts[0] + arm.counts[1]
            ? 'mid'
            : 'high';
      if (r.assignment[id] !== expected)
        throw Error('Population quota mismatch');
    }
    if (
      !Array.isArray(r.aiResults) ||
      r.aiResults.length !== 19 ||
      new Set(r.aiResults.map((a) => a.playerId)).size !== 19 ||
      new Set(r.aiResults.map((a) => a.rank)).size !== 19
    )
      throw Error('Invalid AI final results');
    for (const a of r.aiResults)
      if (
        a.grade !== r.assignment[a.playerId] ||
        !plan.roles.includes(a.role) ||
        !['balanced', 'cooperative', 'chaotic'].includes(a.doctrine) ||
        !Number.isInteger(a.rank) ||
        a.rank < 1 ||
        a.rank > 20 ||
        a.rank === r.rank ||
        !Number.isFinite(a.score)
      )
        throw Error('Invalid graded AI result');
    for (const [i, grade] of plan.grades.entries()) {
      const g = r.byGrade?.[grade],
        results = r.aiResults.filter((a) => a.grade === grade);
      if (
        !g ||
        Object.values(g).some((n) => !Number.isFinite(n) || n < 0) ||
        g.turns !== arm.counts[i] * 15 ||
        g.positiveCash > g.turns ||
        g.triggered > g.positiveCash ||
        g.applied > g.triggered ||
        results.length !== arm.counts[i] ||
        g.rankSum !== results.reduce((n, a) => n + a.rank, 0) ||
        g.scoreSum !== results.reduce((n, a) => n + a.score, 0)
      )
        throw Error('AI grade diagnostics inconsistent');
      if (grade === 'high' && (g.triggered || g.applied))
        throw Error('High-grade AI was altered');
    }
    for (const [gradeKey, floorKey] of [
      ['turns', 'turns'],
      ['positiveCash', 'positiveCash'],
      ['triggered', 'triggers'],
      ['applied', 'applied'],
      ['awardCopies', 'aiAwards'],
    ])
      if (
        Object.values(r.byGrade).reduce((n, g) => n + g[gradeKey], 0) !==
        r.floors.reduce((n, f) => n + f[floorKey], 0)
      )
        throw Error('Population totals do not reconcile');
  }
  for (let b = 0; b < plan.blocks; b++)
    for (const role of plan.roles)
      for (const policy of plan.policies) {
        const mixed = plan.arms
          .slice(0, 4)
          .map((a) => byKey.get(`${b}:${role}:${policy}:${a.id}`));
        for (const id of expectedIds)
          for (let i = 1; i < mixed.length; i++)
            if (
              plan.grades.indexOf(mixed[i].assignment[id]) <
              plan.grades.indexOf(mixed[i - 1].assignment[id])
            )
              throw Error('A harder setting demoted an AI');
      }
  return byKey;
}
export function analyzePopulationRows(rows, plan = defaultPlan) {
  validatePopulationRows(rows, plan);
  const result = analyzeEasySeverityRows(rows, plan);
  const gradeResults = plan.arms.flatMap((arm) =>
    plan.grades.map((grade, i) => {
      const matches = rows.filter((r) => r.arm === arm.id),
        count = matches.length * arm.counts[i];
      const totals = matches.reduce((t, r) => {
        for (const [k, n] of Object.entries(r.byGrade[grade]))
          t[k] = (t[k] ?? 0) + n;
        return t;
      }, {});
      return {
        arm: arm.id,
        grade,
        playerMatches: count,
        ...totals,
        meanFinalRank: count ? totals.rankSum / count : null,
        meanFinalScore: count ? totals.scoreSum / count : null,
        triggerRate: totals.positiveCash
          ? totals.triggered / totals.positiveCash
          : null,
        appliedRate: totals.positiveCash
          ? totals.applied / totals.positiveCash
          : null,
      };
    }),
  );
  return {
    ...result,
    kind: 'isolated-ai-population-mixture-analysis',
    gradeResults,
  };
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const plan = defaultPlan;
  const directory = resolve(process.argv[2]),
    run = JSON.parse(readFileSync(resolve(directory, 'run.json'), 'utf8'));
  if (
    run.kind !== 'v080-classic-fixed-grade-population' ||
    JSON.stringify(run.plan) !== JSON.stringify(plan) ||
    JSON.parse(readFileSync(resolve(directory, 'complete.json'), 'utf8'))
      .matches !== 6300
  )
    throw Error('Invalid population run');
  const input = readFileSync(resolve(directory, 'rows.jsonl'), 'utf8'),
    rows = input.trim().split(/\r?\n/).map(JSON.parse);
  const byKey = validatePopulationRows(rows),
    findings = analyzePopulationRows(rows);
  const witnessData = readFileSync(
    resolve(directory, 'mistakes.jsonl'),
    'utf8',
  );
  const events = witnessData.trim()
    ? witnessData.trim().split(/\r?\n/).map(JSON.parse)
    : [];
  const content = summarizeDecisionWitnesses(events, plan, plan.structuredArms);
  const availability = auditFeasibleEvents(events, plan, plan.feasibleArms);
  for (const e of events) {
    const r = byKey.get(`${e.block}:${e.role}:${e.policy}:${e.arm}`);
    if (!r || e.grade !== r.assignment[e.playerId] || e.grade === 'high')
      throw Error('Mistake assigned to wrong AI grade');
  }
  for (const arm of plan.arms)
    for (const grade of plan.grades) {
      const witnesses = events.filter(
          (e) => e.arm === arm.id && e.grade === grade,
        ),
        g = findings.gradeResults.find(
          (g) => g.arm === arm.id && g.grade === grade,
        );
      if (
        witnesses.length !== g.triggered ||
        witnesses.filter((e) => e.applied).length !== g.applied
      )
        throw Error('Per-grade witness mismatch');
    }
  writeFileSync(
    resolve(directory, 'findings.json'),
    JSON.stringify(
      {
        ...findings,
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
      top5: g.top5.toFixed(3),
      bottom5: g.bottom5.toFixed(3),
      applied: g.appliedRate.toFixed(4),
    })),
  );
  console.table(
    findings.primary.map((p) => ({
      pair: `${p.low}-${p.high}`,
      delta: p.rankDifference.mean.toFixed(3),
      ci9833: `[${p.rankDifference.lower.toFixed(3)}, ${p.rankDifference.upper.toFixed(3)}]`,
    })),
  );
  console.table(
    findings.referencePairs.map((p) => ({
      reference: `${p.low}-${p.high}`,
      delta: p.rankDifference.mean.toFixed(3),
      ci9833: `[${p.rankDifference.lower.toFixed(3)}, ${p.rankDifference.upper.toFixed(3)}]`,
    })),
  );
}
