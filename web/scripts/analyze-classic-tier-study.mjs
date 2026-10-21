import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const tiers = ['easy', 'standard', 'hard', 'highest'];
const policies = ['pace', 'public-ai', 'explore'];
const roles = ['isaac', 'lost', 'azazel', 'eden', 'jacob_esau'];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sum = (rows, key) => rows.reduce((s, r) => s + r[key], 0);
export function blockBootstrap(xs, repetitions = 5000) {
  if (!xs.length || xs.some((x) => !Number.isFinite(x)))
    throw Error('Invalid bootstrap blocks');
  let seed = 0x08102026;
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
    lower: draws[Math.floor(repetitions * 0.025)],
    upper: draws[Math.floor(repetitions * 0.975)],
    blocks: xs.length,
  };
}
export function validateClassicRows(rows) {
  if (rows.length !== 3600)
    throw Error('Expected 3600 complete classic matches');
  const byKey = new Map();
  for (const r of rows) {
    if (
      !Number.isSafeInteger(r.block) ||
      r.block < 0 ||
      r.block >= 60 ||
      r.seed !== (0x08010000 + Math.imul(2001 + r.block, 104729)) >>> 0 ||
      !roles.includes(r.role) ||
      !policies.includes(r.policy) ||
      !tiers.includes(r.difficulty) ||
      r.rooms !== 15 ||
      !Number.isSafeInteger(r.rank) ||
      r.rank < 1 ||
      r.rank > 20 ||
      !Number.isFinite(r.score) ||
      ![r.initialWorld, r.traceHash, r.terminalHash].every((s) =>
        /^[a-f0-9]{64}$/.test(s),
      ) ||
      !Array.isArray(r.floors) ||
      r.floors.length !== 3 ||
      r.floors.some(
        (f) =>
          f.turns !== 95 ||
          Object.values(f).some((n) => !Number.isFinite(n) || n < 0),
      )
    )
      throw Error('Invalid classic row');
    const key = `${r.block}:${r.role}:${r.policy}:${r.difficulty}`;
    if (byKey.has(key)) throw Error('Duplicate classic condition');
    byKey.set(key, r);
  }
  for (let block = 0; block < 60; block++)
    for (const role of roles)
      for (const policy of policies) {
        const matches = tiers.map((t) =>
          byKey.get(`${block}:${role}:${policy}:${t}`),
        );
        if (
          matches.some((r) => !r) ||
          new Set(matches.map((r) => r.initialWorld)).size !== 1
        )
          throw Error('Unpaired classic worlds');
      }
  return byKey;
}
function behavior(rows, floor) {
  const counters = rows.flatMap((r) =>
    floor === undefined ? r.floors : [r.floors[floor]],
  );
  const ratio = (n, d) => sum(counters, n) / sum(counters, d);
  const targetMean = ratio('targetRatio', 'targets');
  return {
    turns: sum(counters, 'turns'),
    withdraw: ratio('withdraw', 'turns'),
    disruption: ratio('disrupt', 'actions'),
    zeroCash: ratio('zeroCashTurns', 'turns'),
    doubles: ratio('doubles', 'turns'),
    cashSpentFraction: ratio('cashSpentFraction', 'positiveCashTurns'),
    entitlementRate: ratio('entitledTurns', 'turns'),
    awardCopiesPerTurn: ratio('awardCopies', 'turns'),
    beforeBossCashRatio: ratio('beforeBossCashRatio', 'beforeBossTurns'),
    quoteClampRate: ratio('clampedQuotes', 'quotes'),
    targetErrorPerFloorCash: ratio('targetAbsoluteError', 'quotes'),
    highestErrorPerFloorCash: ratio('highestAbsoluteError', 'quotes'),
    targetPerFloorCash: targetMean,
    targetStandardDeviationPerFloorCash: Math.sqrt(
      Math.max(0, ratio('targetRatioSquared', 'targets') - targetMean ** 2),
    ),
  };
}
export function analyzeClassicRows(rows) {
  const byKey = validateClassicRows(rows);
  const groups = policies.flatMap((policy) =>
    tiers.map((difficulty) => {
      const matches = rows.filter(
        (r) => r.policy === policy && r.difficulty === difficulty,
      );
      return {
        policy,
        difficulty,
        matches: matches.length,
        rank: mean(matches.map((r) => r.rank)),
        score: mean(matches.map((r) => r.score)),
        top5: mean(matches.map((r) => Number(r.rank <= 5))),
        first: mean(matches.map((r) => Number(r.rank === 1))),
        humanAwardCopies: mean(matches.map((r) => r.human.awardCopies)),
        humanEntitledRooms: mean(matches.map((r) => r.human.entitledTurns)),
        behavior: behavior(matches),
        floors: [0, 1, 2].map((f) => behavior(matches, f)),
      };
    }),
  );
  const adjacent = policies.flatMap((policy) =>
    tiers.slice(0, -1).map((lower, index) => {
      const higher = tiers[index + 1];
      const deltas = Array.from({ length: 60 }, (_, block) => {
        const pairs = roles.map((role) => [
          byKey.get(`${block}:${role}:${policy}:${lower}`),
          byKey.get(`${block}:${role}:${policy}:${higher}`),
        ]);
        return {
          rank: mean(pairs.map(([a, b]) => a.rank - b.rank)),
          score: mean(pairs.map(([a, b]) => a.score - b.score)),
          humanAwards: mean(
            pairs.map(([a, b]) => a.human.awardCopies - b.human.awardCopies),
          ),
        };
      });
      return {
        policy,
        lower,
        higher,
        rankDifference: blockBootstrap(deltas.map((d) => d.rank)),
        scoreDifference: blockBootstrap(deltas.map((d) => d.score)),
        humanAwardsDifference: blockBootstrap(deltas.map((d) => d.humanAwards)),
      };
    }),
  );
  const roleGroups = roles.flatMap((role) =>
    policies.flatMap((policy) =>
      tiers.map((difficulty) => {
        const matches = rows.filter(
          (r) =>
            r.role === role &&
            r.policy === policy &&
            r.difficulty === difficulty,
        );
        return {
          role,
          policy,
          difficulty,
          matches: matches.length,
          rank: mean(matches.map((r) => r.rank)),
          score: mean(matches.map((r) => r.score)),
        };
      }),
    ),
  );
  return {
    kind: 'v080-classic-tier-diagnosis-analysis',
    matches: rows.length,
    independentSeedBlocks: 60,
    aiPlayerTurns: rows.length * 285,
    intervalMethod:
      '5000 deterministic percentile bootstrap resamples of 60 paired seed-block means; exploratory, no multiple-comparison correction',
    groups,
    adjacent,
    roleGroups,
  };
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const directory = resolve(process.argv[2]);
  const marker = JSON.parse(
    readFileSync(resolve(directory, 'run.json'), 'utf8'),
  );
  const complete = JSON.parse(
    readFileSync(resolve(directory, 'complete.json'), 'utf8'),
  );
  if (
    marker.kind !== 'v080-classic-tier-diagnosis' ||
    marker.blocks !== 60 ||
    complete.matches !== 3600
  )
    throw Error('Incomplete or wrong study');
  const content = readFileSync(resolve(directory, 'rows.jsonl'), 'utf8');
  const rows = content
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  const findings = {
    ...analyzeClassicRows(rows),
    source: marker.source,
    rowsSha256: createHash('sha256').update(content).digest('hex'),
  };
  writeFileSync(
    resolve(directory, 'findings.json'),
    JSON.stringify(findings, null, 2) + '\n',
    { flag: 'wx' },
  );
  console.table(
    findings.groups.map(
      ({ policy, difficulty, rank, score, top5, behavior: b }) => ({
        policy,
        difficulty,
        rank: rank.toFixed(3),
        score: score.toFixed(2),
        top5: top5.toFixed(3),
        withdraw: b.withdraw.toFixed(4),
        bossCash: b.beforeBossCashRatio.toFixed(4),
        targetError: b.targetErrorPerFloorCash.toFixed(4),
        targetSD: b.targetStandardDeviationPerFloorCash.toFixed(4),
      }),
    ),
  );
  console.table(
    findings.adjacent.map(({ policy, lower, higher, rankDifference: d }) => ({
      policy,
      pair: `${lower}-${higher}`,
      delta: d.mean.toFixed(3),
      ci: `[${d.lower.toFixed(3)},${d.upper.toFixed(3)}]`,
    })),
  );
}
