import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  tempoPlan as plan,
  tempoSeed,
  assertTempoRun,
} from './achievement-tempo-plan.mjs';
const hash = (s) => createHash('sha256').update(s).digest('hex');
const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v)
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
          .map((k) => JSON.stringify(k) + ':' + canonical(v[k]))
          .join(',')}}`
      : JSON.stringify(v);
export function firstHit(values, threshold) {
  if (
    !Number.isSafeInteger(threshold) ||
    threshold < 1 ||
    values.some(
      (v, i) =>
        !Number.isSafeInteger(v) || v < 0 || (i > 0 && v < values[i - 1]),
    )
  )
    throw Error('Invalid cumulative tempo series');
  const i = values.findIndex((v) => v >= threshold);
  return i < 0 ? null : i + 1;
}
export function describe(values) {
  if (values.some((v) => !Number.isFinite(v)))
    throw Error('Invalid tempo statistic');
  const v = [...values].sort((a, b) => a - b),
    n = v.length;
  return {
    n,
    mean: n ? v.reduce((a, b) => a + b, 0) / n : null,
    median: n ? (n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2) : null,
    min: n ? v[0] : null,
    max: n ? v.at(-1) : null,
  };
}
export function thresholdReading(paths, metric, threshold) {
  const hits = paths.map((p) =>
      firstHit(
        p.map((r) => r.cumulative[metric]),
        threshold,
      ),
    ),
    observed = hits.filter((v) => v !== null);
  return {
    threshold,
    paths: paths.length,
    reached: observed.length,
    censored: paths.length - observed.length,
    reachedFraction: paths.length ? observed.length / paths.length : null,
    firstHitAmongReached: describe(observed),
  };
}
export function summarizeTempo(rows) {
  const pathMap = new Map();
  for (const r of rows) {
    const key = r.block + '/' + r.cell,
      p = pathMap.get(key) ?? [];
    p.push(r);
    pathMap.set(key, p);
  }
  const paths = [...pathMap.values()].map((p) =>
    p.sort((a, b) => a.index - b.index),
  );
  const group = (key) =>
    [...new Set(paths.map((p) => key(p[0])))].map((id) => {
      const selected = paths.filter((p) => key(p[0]) === id),
        flat = selected.flat();
      const opportunities = Object.fromEntries(
        Object.keys(flat[0].opportunities).map((k) => [
          k,
          flat.reduce((n, r) => n + r.opportunities[k], 0),
        ]),
      );
      return {
        id,
        paths: selected.length,
        independentBlocks: new Set(selected.map((p) => p[0].block)).size,
        steps: selected[0].length,
        opportunities,
        finalProgress: Object.fromEntries(
          ['allIn', 'boss'].map((metric) => [
            metric,
            describe(selected.map((p) => p.at(-1).cumulative[metric])),
          ]),
        ),
        readings: Object.fromEntries(
          ['allIn', 'boss'].map((metric) => [
            metric,
            plan.thresholds.map((t) => thresholdReading(selected, metric, t)),
          ]),
        ),
      };
    });
  const pairs = [];
  for (let block = 0; block < plan.blocks; block++)
    for (const policy of plan.policies) {
      const current = pathMap.get(block + '/population-standard/' + policy),
        old = pathMap.get(block + '/legacy-standard/' + policy);
      if (!current || !old) continue;
      pairs.push({
        block,
        policy,
        allInDelta:
          current.at(-1).cumulative.allIn - old.at(-1).cumulative.allIn,
        bossDelta: current.at(-1).cumulative.boss - old.at(-1).cumulative.boss,
        sameRoleMatches: current.filter((r, i) => r.role === old[i].role)
          .length,
      });
    }
  return {
    matches: rows.length,
    paths: paths.length,
    byScenario: group((r) => r.scenario.id),
    byCell: group((r) => r.cell),
    standardPaired: {
      paths: pairs.length,
      independentBlocks: new Set(pairs.map((p) => p.block)).size,
      allInFinalDelta: describe(pairs.map((p) => p.allInDelta)),
      bossFinalDelta: describe(pairs.map((p) => p.bossDelta)),
      pairs,
    },
    candidates: plan.candidates,
    scope: plan.scope,
    censoring:
      'First-hit median describes reached paths only. No extrapolation beyond 20 games. Controllers in the same seed block are paired, not independent humans.',
  };
}
export function analyzeTempoRun(root, directory) {
  const marker = assertTempoRun(root, directory),
    status = JSON.parse(
      readFileSync(resolve(directory, 'status.json'), 'utf8'),
    );
  if (status.status !== 'completed') throw Error('Incomplete tempo run');
  const blocks = marker.purpose === 'pilot' ? 1 : plan.blocks,
    steps = marker.purpose === 'pilot' ? 1 : plan.steps;
  const rows = [],
    identities = new Set();
  let contexts = 0,
    profilesChecked = 0,
    targets;
  for (let block = 0; block < blocks; block++) {
    const meta = JSON.parse(
      readFileSync(resolve(directory, `block-${block}.json`), 'utf8'),
    );
    const rawRows = readFileSync(
        resolve(directory, `rows-${block}.json`),
        'utf8',
      ),
      rawWitness = readFileSync(
        resolve(directory, `witness-${block}.jsonl`),
        'utf8',
      );
    if (
      meta.block !== block ||
      hash(rawRows) !== meta.rowsSha256 ||
      hash(rawWitness) !== meta.witnessSha256
    )
      throw Error('Tempo report hash mismatch');
    const batch = JSON.parse(rawRows),
      witnesses = rawWitness
        .trim()
        .split('\n')
        .map((s) => JSON.parse(s));
    if (
      batch.length !== steps * plan.scenarios.length * plan.policies.length ||
      witnesses.length !== batch.length ||
      meta.matches !== batch.length
    )
      throw Error('Incomplete tempo block');
    const ws = new Map(witnesses.map((w) => [w.identity, w]));
    if (ws.size !== batch.length) throw Error('Duplicate tempo witness');
    targets ??= meta.targets;
    if (canonical(targets) !== canonical(meta.targets))
      throw Error('Changing target definitions');
    const accum = new Map(),
      worlds = new Map();
    for (const row of batch) {
      const scenario = plan.scenarios.find((s) => s.id === row.scenario.id),
        w = ws.get(row.identity);
      if (
        !scenario ||
        canonical(scenario) !== canonical(row.scenario) ||
        !plan.policies.includes(row.policy) ||
        row.cell !== scenario.id + '/' + row.policy ||
        row.block !== block ||
        row.identity !== `${block}/${row.cell}/${row.index}` ||
        row.seed !== tempoSeed(block, row.index - 1, marker.purpose) ||
        identities.has(row.identity)
      )
        throw Error('Invalid tempo row identity');
      identities.add(row.identity);
      if (
        !row.availableRolesBefore.includes(row.role) ||
        row.role !==
          row.availableRolesBefore[
            (row.index - 1) % row.availableRolesBefore.length
          ]
      )
        throw Error('Locked/wrong research role');
      if (
        !w ||
        hash(canonical(w.context)) !== row.traceFingerprint ||
        w.traceFingerprint !== row.match.traceFingerprint ||
        row.traceFingerprint !== w.traceFingerprint ||
        w.context.units.at(-1)?.stage !== 'complete'
      )
        throw Error('Invalid authority context');
      if (
        scenario.mode === 'classic'
          ? row.match.classicAi?.policy !== scenario.aiPolicy ||
            row.match.classicAi.difficulty !== scenario.difficulty
          : row.match.mode !== 'survival' ||
            row.match.difficulty !== scenario.difficulty ||
            row.match.classicAi !== undefined
      )
        throw Error('Wrong recorded AI policy');
      if (
        new Set(w.evidence.map((e) => e.position)).size !== w.evidence.length ||
        w.evidence.length !== row.match.humanRooms
      )
        throw Error('Invalid human room witness');
      const allIn = w.evidence.filter((e) => e.allInAward).length,
        boss = w.evidence.filter((e) => e.bossAward).length;
      if (allIn !== row.counts.allIn || boss !== row.counts.boss)
        throw Error('Witness count mismatch');
      const prior = accum.get(row.cell) ?? { allIn: 0, boss: 0, index: 0 };
      if (
        row.index !== prior.index + 1 ||
        row.cumulative.allIn !== prior.allIn + allIn ||
        row.cumulative.boss !== prior.boss + boss
      )
        throw Error('Invalid cumulative progress');
      accum.set(row.cell, { ...row.cumulative, index: row.index });
      const worldKey = `${row.seed}/${scenario.mode}/${row.role}`;
      if (worlds.has(worldKey) && worlds.get(worldKey) !== row.firstWorld)
        throw Error('Unpaired initial world');
      worlds.set(worldKey, row.firstWorld);
      rows.push(row);
      contexts++;
    }
    const profiles = JSON.parse(
      readFileSync(resolve(directory, `profiles-${block}.json`), 'utf8'),
    );
    if (
      Object.keys(profiles).length !==
      plan.scenarios.length * plan.policies.length
    )
      throw Error('Missing final profile');
    for (const [cell, p] of Object.entries(profiles)) {
      if (hash(JSON.stringify(p)) !== meta.profileHashes[cell])
        throw Error('Profile hash mismatch');
      profilesChecked++;
      const path = batch.filter((r) => r.cell === cell);
      if (path.length !== steps) throw Error('Incomplete profile path');
      for (const [i, metric] of ['allIn', 'boss'].entries())
        for (const [tier, id] of targets[i].ids.entries()) {
          const observed =
            path.find((r) => r.achieved.includes(id))?.index ?? null;
          if (
            observed !==
            firstHit(
              path.map((r) => r.cumulative[metric]),
              targets[i].targets[tier],
            )
          )
            throw Error(
              'First-hit calculation diverged from production awards',
            );
        }
    }
  }
  if (rows.length !== status.matches)
    throw Error('Wrong completed match count');
  const summary = {
    kind: plan.kind,
    purpose: marker.purpose,
    plan,
    source: marker.source,
    checked: { contexts, profiles: profilesChecked },
    targets,
    ...summarizeTempo(rows),
  };
  writeFileSync(
    resolve(directory, 'analysis.json'),
    JSON.stringify(summary, null, 2) + '\n',
    { flag: 'wx' },
  );
  return summary;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL('..', import.meta.url)),
    directory = resolve(process.argv[2] ?? '');
  const summary = analyzeTempoRun(root, directory);
  console.log(
    JSON.stringify(
      {
        directory,
        matches: summary.matches,
        paths: summary.paths,
        checked: summary.checked,
      },
      null,
      2,
    ),
  );
}
