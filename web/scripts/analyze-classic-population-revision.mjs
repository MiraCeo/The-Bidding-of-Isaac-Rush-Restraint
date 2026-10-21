import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { populationRevisionPlan as plan } from './classic-population-revision-plan.mjs';
import {
  validatePopulationRows,
  analyzePopulationRows,
} from './analyze-classic-population-study.mjs';
import { summarizeDecisionWitnesses } from './analyze-classic-decision-mistakes.mjs';
import { auditFeasibleEvents } from './analyze-classic-feasible-mistakes.mjs';

const directory = resolve(process.argv[2]),
  run = JSON.parse(readFileSync(resolve(directory, 'run.json'), 'utf8'));
if (
  run.kind !== 'v080-classic-population-user-revision' ||
  JSON.stringify(run.plan) !== JSON.stringify(plan) ||
  JSON.parse(readFileSync(resolve(directory, 'complete.json'), 'utf8'))
    .matches !== 6300
)
  throw Error('Invalid revised population run');
const input = readFileSync(resolve(directory, 'rows.jsonl'), 'utf8'),
  rows = input.trim().split(/\r?\n/).map(JSON.parse);
const byKey = validatePopulationRows(rows, plan),
  findings = analyzePopulationRows(rows, plan);
const witnessData = readFileSync(resolve(directory, 'mistakes.jsonl'), 'utf8');
const events = witnessData.trim()
  ? witnessData.trim().split(/\r?\n/).map(JSON.parse)
  : [];
const content = summarizeDecisionWitnesses(events, plan, plan.structuredArms);
const availability = auditFeasibleEvents(events, plan, plan.feasibleArms);
for (const e of events) {
  const r = byKey.get(`${e.block}:${e.role}:${e.policy}:${e.arm}`);
  if (!r || e.grade !== r.assignment[e.playerId] || e.grade === 'high')
    throw Error('Revised population mistake grade mismatch');
}
for (const arm of plan.arms)
  for (const grade of plan.grades) {
    const selected = events.filter(
        (e) => e.arm === arm.id && e.grade === grade,
      ),
      g = findings.gradeResults.find(
        (g) => g.arm === arm.id && g.grade === grade,
      );
    if (
      selected.length !== g.triggered ||
      selected.filter((e) => e.applied).length !== g.applied
    )
      throw Error('Revised per-grade witness mismatch');
  }
writeFileSync(
  resolve(directory, 'findings.json'),
  JSON.stringify(
    {
      ...findings,
      kind: 'isolated-ai-population-revision-analysis',
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
    revision: `${p.low}-${p.high}`,
    delta: p.rankDifference.mean.toFixed(3),
    ci9833: `[${p.rankDifference.lower.toFixed(3)}, ${p.rankDifference.upper.toFixed(3)}]`,
  })),
);
