import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  allocateBalanceRun,
  assertBalanceRun,
  writeBalanceJson,
  balanceStudyPlan,
} from './balance-study-output.mjs';
const hash = (s) => createHash('sha256').update(s).digest('hex');
const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(',')}}`
      : JSON.stringify(v);
export function distribution(values) {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length)
    return { n: 0, mean: null, median: null, min: null, max: null };
  if (v.some((x) => !Number.isFinite(x)))
    throw Error('Nonfinite balance statistic');
  return {
    n: v.length,
    mean: v.reduce((a, b) => a + b, 0) / v.length,
    median:
      v.length % 2
        ? v[(v.length - 1) / 2]
        : (v[v.length / 2 - 1] + v[v.length / 2]) / 2,
    min: v[0],
    max: v.at(-1),
  };
}
export function hardGate(a, row) {
  if (a.scope !== 'shared' && a.scope !== row.scenario.mode) return false;
  if (a.id === 'E11' && row.role !== 'isaac') return false;
  if (['E12', 'E16'].includes(a.id) && row.role !== 'lost') return false;
  if (['E15', 'E19', 'E20'].includes(a.id) && row.role !== 'jacob_esau')
    return false;
  if (['F02', 'F10'].includes(a.id) && row.scenario.difficulty !== 'highest')
    return false;
  if (a.id === 'F16' && !['hard', 'highest'].includes(row.scenario.difficulty))
    return false;
  return true;
}
const rate = (hits, n) => ({ hits, n, rate: n ? hits / n : null });
function group(rows, key) {
  const map = new Map();
  for (const r of rows) {
    const k = key(r);
    const v = map.get(k) ?? [];
    v.push(r);
    map.set(k, v);
  }
  return map;
}
export function pairedEffects(rows) {
  const pairs = group(
      rows,
      (r) => `${r.scenario.mode}/${r.role}/${r.policy}/${r.seed}`,
    ),
    result = [];
  for (const [key, cells] of pairs) {
    if (
      cells.length !== 4 ||
      new Set(cells.map((r) => r.scenario.difficulty)).size !== 4
    )
      throw Error('Incomplete tier quartet ' + key);
    if (new Set(cells.map((r) => r.diagnostics.firstWorld)).size !== 1)
      throw Error('Different initial world ' + key);
    const highest = cells.find((r) => r.scenario.difficulty === 'highest');
    if (!highest) throw Error('Missing highest comparator');
    for (const r of cells)
      result.push({
        mode: r.scenario.mode,
        difficulty: r.scenario.difficulty,
        role: r.role,
        policy: r.policy,
        seed: r.seed,
        rankDelta: r.diagnostics.rank - highest.diagnostics.rank,
        scoreDelta: r.diagnostics.score - highest.diagnostics.score,
        survivedDelta:
          Number(r.match.survived) - Number(highest.match.survived),
        humanRoomsDelta: r.match.humanRooms - highest.match.humanRooms,
      });
  }
  return [...group(result, (r) => `${r.mode}/${r.difficulty}/${r.policy}`)].map(
    ([key, pairs]) => ({
      key,
      nPairedMatches: pairs.length,
      independentSeedBlocks: new Set(pairs.map((r) => r.seed)).size,
      rankDelta: distribution(pairs.map((r) => r.rankDelta)),
      scoreDelta: distribution(pairs.map((r) => r.scoreDelta)),
      humanRoomsDelta: distribution(pairs.map((r) => r.humanRoomsDelta)),
      survivedDelta: distribution(pairs.map((r) => r.survivedDelta)),
      rankBetter: pairs.filter((r) => r.rankDelta < 0).length,
      rankWorse: pairs.filter((r) => r.rankDelta > 0).length,
      rankTied: pairs.filter((r) => r.rankDelta === 0).length,
      byRole: [...group(pairs, (r) => r.role)].map(([role, r]) => ({
        role,
        rankDelta: distribution(r.map((v) => v.rankDelta)),
      })),
    }),
  );
}
function sumCounters(rows, kind) {
  const values = rows.map((r) => r.diagnostics[kind]);
  const sums = Object.fromEntries(
    Object.keys(values[0]).map((k) => [
      k,
      values.reduce((n, r) => n + r[k], 0),
    ]),
  );
  return {
    ...sums,
    withdrawalPerPlayerTurn: sums.playerTurns
      ? sums.withdraw / sums.playerTurns
      : null,
    disruptionPerAction: sums.actions ? sums.disrupt / sums.actions : null,
    doublePerPlayerTurn: sums.playerTurns
      ? sums.doubleTurns / sums.playerTurns
      : null,
    zeroCashPerPlayerTurn: sums.playerTurns
      ? sums.zeroMoneyTurns / sums.playerTurns
      : null,
    meanSpendFractionWhenPositive: sums.positiveMoneyTurns
      ? sums.spendRatioSum / sums.positiveMoneyTurns
      : null,
  };
}
export function summarizeBalance(rows, catalog) {
  return [
    ...group(
      rows,
      (r) => `${r.scenario.mode}/${r.scenario.difficulty}/${r.policy}`,
    ),
  ].map(([key, g]) => ({
    key,
    n: g.length,
    seedBlocks: new Set(g.map((r) => r.seed)).size,
    rank: distribution(g.map((r) => r.diagnostics.rank)),
    score: distribution(g.map((r) => r.diagnostics.score)),
    highestScoreClassicOrChampionSurvival: rate(
      g.filter((r) => r.match.champion).length,
      g.length,
    ),
    survived: rate(g.filter((r) => r.match.survived).length, g.length),
    humanRooms: distribution(g.map((r) => r.match.humanRooms)),
    duringHuman: sumCounters(g, 'duringHuman'),
    afterHuman: sumCounters(g, 'afterHuman'),
    opportunities: Object.fromEntries(
      Object.keys(g[0].exposure).map((k) => [
        k,
        g.reduce((n, r) => n + r.exposure[k], 0),
      ]),
    ),
    humanFloors: g.reduce((n, r) => n + r.diagnostics.humanFloors, 0),
    passedFloors: g.reduce((n, r) => n + r.diagnostics.passedFloors, 0),
    lowestFloors: g.reduce((n, r) => n + r.diagnostics.lowestFloors, 0),
    achievements: Object.fromEntries(
      catalog.map((a) => {
        const eligible = a.id === 'E08' ? [] : g.filter((r) => hardGate(a, r));
        return [
          a.id,
          {
            number: a.number,
            name: a.name,
            kind: a.kind,
            target: a.target,
            ...rate(
              eligible.filter((r) => r.achieved.includes(a.id)).length,
              eligible.length,
            ),
            scope:
              'hard mode/role/tier gates only, not an item-opportunity denominator; cross-role E08 has no single-match denominator',
          },
        ];
      }),
    ),
    byRole: [...group(g, (r) => r.role)].map(([role, r]) => ({
      role,
      n: r.length,
      rank: distribution(r.map((x) => x.diagnostics.rank)),
      survived: rate(r.filter((x) => x.match.survived).length, r.length),
      humanRooms: distribution(r.map((x) => x.match.humanRooms)),
    })),
    aiByRole: [
      ...group(
        g.flatMap((r) => r.diagnostics.aiFinal),
        (a) => a.role,
      ),
    ].map(([role, r]) => ({
      role,
      playerSlots: r.length,
      rank: distribution(r.map((a) => a.rank)),
      score: distribution(r.map((a) => a.score)),
      survived: rate(r.filter((a) => a.survived).length, r.length),
    })),
    aiByDoctrine: [
      ...group(
        g.flatMap((r) => r.diagnostics.aiFinal),
        (a) => a.doctrine,
      ),
    ].map(([doctrine, r]) => ({
      doctrine,
      playerSlots: r.length,
      rank: distribution(r.map((a) => a.rank)),
      survived: rate(r.filter((a) => a.survived).length, r.length),
    })),
  }));
}
export function summarizePaths(rows, catalog) {
  const paths = [...group(rows, (r) => r.cell)].map(([cell, g]) => {
    g.sort((a, b) => a.index - b.index);
    if (
      g.some((r, i) => r.index !== i + 1) ||
      new Set(g.map((r) => r.match.root)).size !== g.length
    )
      throw Error('Broken profile sequence');
    return { cell, rows: g, last: g.at(-1) };
  });
  return {
    paths: paths.map(({ cell, rows: g, last }) => ({
      cell,
      games: g.length,
      roleSequence: g.map((r) => r.role),
      humanRooms: g.reduce((n, r) => n + r.match.humanRooms, 0),
      earned: last.campaignAchieved.length,
      roleUnlocks: Object.fromEntries(
        ['isaac', 'lost', 'azazel', 'eden', 'jacob_esau'].map((role) => [
          role,
          role === 'isaac'
            ? 0
            : (g.find((r) => r.unlocks.includes(role))?.index ?? null),
        ]),
      ),
    })),
    achievements: catalog.map((a) => {
      const eligible = paths.filter((p) => p.rows.some((r) => hardGate(a, r)));
      const hit = eligible.filter((p) =>
        p.last.campaignAchieved.includes(a.id),
      );
      const first = hit.map(
        (p) => p.rows.find((r) => r.campaignAchieved.includes(a.id)).index,
      );
      return {
        ...a,
        eligiblePaths: eligible.length,
        hitPaths: hit.length,
        censoredPaths: eligible.length - hit.length,
        firstGameAmongHits: distribution(first),
        finalProgress: distribution(
          eligible.map((p) => p.last.campaignProgress[a.id] ?? 0),
        ),
        byScenarioPolicy: [
          ...group(
            eligible,
            (p) =>
              `${p.last.scenario.mode}/${p.last.scenario.difficulty}/${p.last.policy}`,
          ),
        ].map(([key, p]) => ({
          key,
          n: p.length,
          hits: p.filter((v) => v.last.campaignAchieved.includes(a.id)).length,
        })),
      };
    }),
  };
}
function loadRun(root, directory, expected) {
  const marker = assertBalanceRun(root, directory),
    read = (name) => JSON.parse(readFileSync(resolve(directory, name), 'utf8'));
  if (marker.purpose !== expected || read('status.json').status !== 'completed')
    throw Error('Incomplete/mismatched study');
  const summary = read('summary.json'),
    plan = balanceStudyPlan[expected];
  if (
    summary.ledgerSchema !== 8 ||
    summary.catalogVersion !== 7 ||
    summary.version !== '0.8.0' ||
    canonical(summary.source) !== canonical(marker.source)
  )
    throw Error('Wrong study source/schema');
  const rows = Array.from({ length: plan.batches }, (_, i) =>
    read(`rows-${i}.json`),
  ).flat();
  const identities = new Set(rows.map((r) => r.identity));
  if (
    identities.size !== rows.length ||
    rows.length !== summary.matches ||
    rows.length !==
      (expected === 'campaign' ? 360 : expected === 'main' ? 1200 : 120)
  )
    throw Error('Incomplete research matrix');
  const witnesses = readdirSync(directory).filter((p) =>
    /^witness-\d+-\d+\.json$/.test(p),
  );
  if (witnesses.length !== rows.length) throw Error('Witness count mismatch');
  for (const name of witnesses) {
    const w = read(name),
      row = rows.find((r) => r.identity === w.identity);
    if (
      !row ||
      hash(canonical(w.context)) !== row.match.traceFingerprint ||
      w.context.root !== row.match.root ||
      w.traceFingerprint !== row.match.traceFingerprint ||
      canonical(w.opportunities) !== canonical(row.exposure)
    )
      throw Error('Witness provenance failed');
    if (
      row.exposure.eternalMissingEvidenceRooms !== 0 ||
      !row.match.terminal ||
      row.diagnostics.duringHuman.invalidTurns ||
      row.diagnostics.afterHuman.invalidTurns
    )
      throw Error('Invalid observation');
    if (expected === 'campaign' && !row.availableRolesBefore.includes(row.role))
      throw Error('Campaign used locked role');
    if (
      row.scenario.mode === 'classic' &&
      (row.match.classicAi?.policy !== 'classic-tiered-1' ||
        row.match.classicAi.difficulty !== row.scenario.difficulty)
    )
      throw Error('Classic policy identity lost');
  }
  const profiles = read(`profiles-${plan.batches - 1}.json`);
  for (const [cell, profile] of Object.entries(profiles))
    if (hash(JSON.stringify(profile)) !== summary.profileHashes[cell])
      throw Error('Profile hash mismatch');
  return { directory, marker, summary, rows };
}
export function analyzeRuns(root, paths) {
  const runs = ['pilot', 'main', 'campaign'].map((purpose, i) =>
    loadRun(root, resolve(paths[i]), purpose),
  );
  if (
    runs.some(
      (r) => canonical(r.marker.source) !== canonical(runs[0].marker.source),
    )
  )
    throw Error('Mixed source fingerprints');
  const seeds = runs.map((r) => new Set(r.rows.map((v) => v.seedIndex)));
  for (let i = 0; i < seeds.length; i++)
    for (let j = i + 1; j < seeds.length; j++)
      if ([...seeds[i]].some((s) => seeds[j].has(s)))
        throw Error('Pilot/main/campaign seeds overlap');
  const catalog = runs[1].summary.catalog;
  const output = allocateBalanceRun(root, 'analysis');
  writeBalanceJson(root, output, 'findings.json', {
    source: runs[0].marker.source,
    producerRuns: runs.map((r) => ({
      directory: r.directory,
      matches: r.rows.length,
    })),
    verifiedContexts: runs.reduce((n, r) => n + r.rows.length, 0),
    scope:
      '10 independent paired main seed blocks; 18 adaptive profile paths. No human win-rate or causal role/personality claims. Pilot not pooled into main.',
    main: summarizeBalance(runs[1].rows, catalog),
    paired: pairedEffects(runs[1].rows),
    fixedRolePaths10: summarizePaths(runs[1].rows, catalog),
    campaigns20: summarizePaths(runs[2].rows, catalog),
  });
  writeBalanceJson(root, output, 'status.json', {
    status: 'completed',
    contextsVerified: 1680,
  });
  return output;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length !== 5)
    throw Error('Use pilot-dir main-dir campaign-dir');
  console.log(
    analyzeRuns(
      fileURLToPath(new URL('..', import.meta.url)),
      process.argv.slice(2),
    ),
  );
}
