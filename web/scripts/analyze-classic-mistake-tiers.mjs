import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { mistakeTierPlan as plan } from './classic-mistake-tier-plan.mjs';
import { analyzeMistakeRows } from './analyze-classic-mistake-study.mjs';

const directory = resolve(process.argv[2]);
const run = JSON.parse(readFileSync(resolve(directory, 'run.json'), 'utf8'));
const completed = JSON.parse(
  readFileSync(resolve(directory, 'complete.json'), 'utf8'),
);
if (
  run.kind !== 'v080-classic-mistake-tiers-25-15-5-0' ||
  JSON.stringify(run.plan) !== JSON.stringify(plan) ||
  completed.matches !== 3600
)
  throw Error('Invalid tier mistake run');
const data = readFileSync(resolve(directory, 'rows.jsonl'), 'utf8');
const findings = analyzeMistakeRows(
  data.trim().split(/\r?\n/).map(JSON.parse),
  plan,
);
const witnessData = readFileSync(resolve(directory, 'mistakes.jsonl'), 'utf8');
const events = witnessData.trim()
  ? witnessData.trim().split(/\r?\n/).map(JSON.parse)
  : [];
const unique = new Set();
for (const e of events) {
  const key = `${e.block}:${e.role}:${e.policy}:${e.arm}:${e.playerId}:${e.floor}:${e.room}`;
  if (unique.has(key) || !e.triggered)
    throw Error('Duplicate or untriggered mistake witness');
  unique.add(key);
  if (
    e.applied &&
    (!(e.modelLoss > 0) ||
      !e.before ||
      !e.after ||
      (e.severity !== 'mild' && e.severity !== 'medium') ||
      e.modelLoss >
        (e.severity === 'mild'
          ? plan.mildMaximumModelLoss
          : plan.mediumMaximumModelLoss))
  )
    throw Error('Invalid bounded-mistake witness');
}
for (const arm of plan.arms) {
  const selected = events.filter((e) => e.arm === arm.id),
    group = findings.pooled.find((g) => g.arm === arm.id);
  if (
    selected.length !== group.triggers ||
    selected.filter((e) => e.applied).length !== group.applied
  )
    throw Error('Tier witnesses do not reconcile');
}
writeFileSync(
  resolve(directory, 'findings.json'),
  JSON.stringify(
    {
      ...findings,
      study: run.kind,
      plan,
      inputSha256: createHash('sha256').update(data).digest('hex'),
      witnessSha256: createHash('sha256').update(witnessData).digest('hex'),
      source: run.source,
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
