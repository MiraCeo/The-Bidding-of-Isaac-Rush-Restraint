import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { easySeverityPlan as plan } from './classic-easy-severity-plan.mjs';
import { analyzeMistakeRows } from './analyze-classic-mistake-study.mjs';
import { summarizeDecisionWitnesses } from './analyze-classic-decision-mistakes.mjs';
import { auditFeasibleEvents } from './analyze-classic-feasible-mistakes.mjs';

const mean = (xs) => xs.reduce((n, x) => n + x, 0) / xs.length;
const sum = (rows, key) => rows.reduce((n, r) => n + r.humanLiquidity[key], 0);
export function analyzeEasySeverityRows(rows, studyPlan = plan) {
  for (const r of rows) {
    const h = r.humanLiquidity;
    if (
      !h ||
      h.rooms !== 15 ||
      h.bossEntries !== 3 ||
      Object.values(h).some((n) => !Number.isFinite(n) || n < 0) ||
      h.zeroEntryRooms > 15 ||
      h.earlyZeroAfterRooms > 12 ||
      h.zeroBossEntries > 3
    )
      throw Error('Invalid human liquidity observation');
  }
  const base = analyzeMistakeRows(rows, studyPlan);
  const augment = (group, matches) => ({
    ...group,
    bottom5: mean(matches.map((r) => Number(r.rank >= 16))),
    humanZeroEntryRate: sum(matches, 'zeroEntryRooms') / sum(matches, 'rooms'),
    humanEarlyZeroAfterRate:
      sum(matches, 'earlyZeroAfterRooms') / (matches.length * 12),
    humanMatchesWithEarlyZero: mean(
      matches.map((r) => Number(r.humanLiquidity.earlyZeroAfterRooms > 0)),
    ),
    humanZeroBossRate:
      sum(matches, 'zeroBossEntries') / sum(matches, 'bossEntries'),
    humanBossCashRatio:
      sum(matches, 'bossCashRatio') / sum(matches, 'bossEntries'),
  });
  return {
    ...base,
    kind: 'isolated-easy-medium-share-analysis',
    groups: base.groups.map((g) =>
      augment(
        g,
        rows.filter((r) => r.arm === g.arm && r.policy === g.policy),
      ),
    ),
    pooled: base.pooled.map((g) =>
      augment(
        g,
        rows.filter((r) => r.arm === g.arm),
      ),
    ),
    byRole: base.byRole.map((g) =>
      augment(
        g,
        rows.filter((r) => r.arm === g.arm && r.role === g.role),
      ),
    ),
    referencePairs: analyzeMistakeRows(rows, {
      ...studyPlan,
      primaryPairs: studyPlan.secondaryPairs,
    }).primary,
  };
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const directory = resolve(process.argv[2]);
  const run = JSON.parse(readFileSync(resolve(directory, 'run.json'), 'utf8'));
  const complete = JSON.parse(
    readFileSync(resolve(directory, 'complete.json'), 'utf8'),
  );
  if (
    run.kind !== 'v080-classic-easy-medium-share-40' ||
    JSON.stringify(run.plan) !== JSON.stringify(plan) ||
    complete.matches !== 4500
  )
    throw Error('Invalid severity run');
  const input = readFileSync(resolve(directory, 'rows.jsonl'), 'utf8');
  const findings = analyzeEasySeverityRows(
    input.trim().split(/\r?\n/).map(JSON.parse),
  );
  const witnessData = readFileSync(
    resolve(directory, 'mistakes.jsonl'),
    'utf8',
  );
  const events = witnessData.trim()
    ? witnessData.trim().split(/\r?\n/).map(JSON.parse)
    : [];
  const content = summarizeDecisionWitnesses(events, plan, plan.structuredArms);
  const availability = auditFeasibleEvents(events, plan, plan.feasibleArms);
  const severity = plan.arms.map((a) => {
    const selected = events.filter((e) => e.arm === a.id);
    return {
      arm: a.id,
      triggered: selected.length,
      requestedMedium: selected.filter((e) => e.requestedSeverity === 'medium')
        .length,
      appliedMedium: selected.filter(
        (e) => e.applied && e.severity === 'medium',
      ).length,
      appliedMild: selected.filter((e) => e.applied && e.severity === 'mild')
        .length,
    };
  });
  for (const c of content) {
    const g = findings.pooled.find((g) => g.arm === c.arm),
      s = severity.find((s) => s.arm === c.arm);
    if (
      c.triggered !== g.triggers ||
      c.applied !== g.applied ||
      c.applied !== s.appliedMedium + s.appliedMild
    )
      throw Error('Severity witnesses do not reconcile');
  }
  writeFileSync(
    resolve(directory, 'findings.json'),
    JSON.stringify(
      {
        ...findings,
        content,
        availability,
        severity,
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
      earlyZero: g.humanEarlyZeroAfterRate.toFixed(3),
      applied: g.appliedRate.toFixed(4),
    })),
  );
  console.table(
    findings.primary.map((p) => ({
      pair: `${p.low}-${p.high}`,
      delta: p.rankDifference.mean.toFixed(3),
      ci95: `[${p.rankDifference.lower.toFixed(3)}, ${p.rankDifference.upper.toFixed(3)}]`,
    })),
  );
  console.table(
    severity.map((s) => ({
      arm: s.arm,
      triggered: s.triggered,
      requestedMedium: s.requestedMedium,
      requestedShare: s.triggered
        ? (s.requestedMedium / s.triggered).toFixed(4)
        : '-',
      appliedMedium: s.appliedMedium,
      appliedMild: s.appliedMild,
    })),
  );
}
