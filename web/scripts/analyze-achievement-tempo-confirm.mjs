/** Read-only analysis of completed 30-game continuation, including recorded recovery. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { tempoPlan, assertTempoRun } from './achievement-tempo-plan.mjs';
import { summarizeTempo, firstHit } from './analyze-achievement-tempo.mjs';
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
const root = fileURLToPath(new URL('..', import.meta.url)),
  directory = resolve(process.argv[2] ?? '');
const marker = JSON.parse(readFileSync(resolve(directory, 'run.json'), 'utf8'));
const recovery = JSON.parse(
  readFileSync(resolve(directory, 'recovery.json'), 'utf8'),
);
if (
  marker.kind !== 'v081-tempo-confirm-30' ||
  hash(readFileSync(resolve(directory, 'run.json'), 'utf8')) !==
    recovery.originalMarkerSha256
)
  throw Error('Invalid confirmation/recovery marker');
const plan = marker.plan,
  parent = marker.parent.directory,
  source = recovery.source;
assertTempoRun(root, parent);
const analysisRaw = readFileSync(resolve(parent, 'analysis.json'), 'utf8'),
  analysis = JSON.parse(analysisRaw);
if (
  hash(analysisRaw) !== marker.parent.analysisSha256 ||
  JSON.parse(readFileSync(resolve(directory, 'status.json'), 'utf8')).status !==
    'completed'
)
  throw Error('Incomplete or changed parent');
for (const f of marker.source.files)
  if (hash(readFileSync(resolve(root, f.path))) !== f.sha256)
    throw Error('Changed original input: ' + f.path);
const rows = [];
let checkedContexts = 0,
  checkedProfiles = 0;
for (let block = 0; block < 6; block++) {
  const priorRows = JSON.parse(
    readFileSync(resolve(parent, `rows-${block}.json`), 'utf8'),
  ).filter((r) => plan.scenarios.includes(r.scenario.id));
  const meta = JSON.parse(
      readFileSync(resolve(directory, `block-${block}.json`), 'utf8'),
    ),
    rawRows = readFileSync(resolve(directory, `rows-${block}.json`), 'utf8'),
    rawWitness = readFileSync(
      resolve(directory, `witness-${block}.jsonl`),
      'utf8',
    );
  if (
    hash(rawRows) !== meta.rowsSha256 ||
    hash(rawWitness) !== meta.witnessSha256
  )
    throw Error('Invalid confirmation hashes');
  const batch = JSON.parse(rawRows),
    witnesses = rawWitness
      .trim()
      .split('\n')
      .map((s) => JSON.parse(s)),
    ws = new Map(witnesses.map((w) => [w.identity, w]));
  if (batch.length !== 90 || ws.size !== 90)
    throw Error('Incomplete continuation block');
  for (const row of batch) {
    const w = ws.get(row.identity),
      prefix = priorRows.filter((r) => r.cell === row.cell),
      preceding = batch.filter(
        (r) => r.cell === row.cell && r.index < row.index,
      );
    const prev = preceding.at(-1) ?? prefix.at(-1),
      seed =
        (0x08010000 +
          Math.imul(20001 + block * 10 + row.index - 21, 104729)) >>>
        0;
    if (
      row.index !== prev.index + 1 ||
      row.seed !== seed ||
      row.block !== block ||
      row.identity !== `${block}/${row.cell}/${row.index}` ||
      !plan.scenarios.includes(row.scenario.id)
    )
      throw Error('Wrong continuation identity/coordinate');
    if (
      !w ||
      hash(canonical(w.context)) !== row.traceFingerprint ||
      w.traceFingerprint !== row.traceFingerprint ||
      w.context.units.at(-1)?.stage !== 'complete'
    )
      throw Error('Invalid continuation authority');
    for (const [metric, flag] of [
      ['allIn', 'allInAward'],
      ['boss', 'bossAward'],
    ]) {
      const n = w.evidence.filter((e) => e[flag]).length;
      if (
        n !== row.counts[metric] ||
        row.cumulative[metric] !== prev.cumulative[metric] + n
      )
        throw Error('Wrong continuation count');
    }
    if (
      row.role !==
      row.availableRolesBefore[
        (row.index - 1) % row.availableRolesBefore.length
      ]
    )
      throw Error('Invalid continuation role');
    checkedContexts++;
  }
  const profiles = JSON.parse(
    readFileSync(resolve(directory, `profiles-${block}.json`), 'utf8'),
  );
  if (Object.keys(profiles).length !== 9)
    throw Error('Missing confirmation profile');
  for (const [cell, p] of Object.entries(profiles)) {
    if (hash(JSON.stringify(p)) !== meta.profileHashes[cell])
      throw Error('Wrong confirmation profile hash');
    checkedProfiles++;
    const path = [...priorRows, ...batch]
      .filter((r) => r.cell === cell)
      .sort((a, b) => a.index - b.index);
    if (path.length !== 30) throw Error('Incomplete 30-game path');
    for (const [i, metric] of ['allIn', 'boss'].entries())
      for (const [tier, id] of analysis.targets[i].ids.entries())
        if (
          (path.find((r) => r.achieved.includes(id))?.index ?? null) !==
          firstHit(
            path.map((r) => r.cumulative[metric]),
            analysis.targets[i].targets[tier],
          )
        )
          throw Error('Continuation awards differ from threshold reads');
  }
  rows.push(...priorRows, ...batch);
}
const goalReadings = [];
for (const scenario of plan.scenarios)
  for (const controller of [null, ...tempoPlan.policies]) {
    const selected = rows.filter(
      (r) =>
        r.scenario.id === scenario &&
        (controller === null || r.policy === controller),
    );
    const cells = [...new Set(selected.map((r) => r.block + '/' + r.cell))];
    const paths = cells.map((cell) =>
      selected
        .filter((r) => r.block + '/' + r.cell === cell)
        .sort((a, b) => a.index - b.index),
    );
    const readings = {};
    for (const metric of ['allIn', 'boss'])
      readings[metric] = tempoPlan.thresholds.map((threshold) => {
        const hits = paths
          .map((p) =>
            firstHit(
              p.map((r) => r.cumulative[metric]),
              threshold,
            ),
          )
          .filter((x) => x !== null)
          .sort((a, b) => a - b);
        const n = paths.length;
        return {
          threshold,
          paths: n,
          reached: hits.length,
          censored: n - hits.length,
          halfReachedBy:
            hits.length >= Math.ceil(n * 0.5)
              ? hits[Math.ceil(n * 0.5) - 1]
              : null,
          eightyPercentReachedBy:
            hits.length >= Math.ceil(n * 0.8)
              ? hits[Math.ceil(n * 0.8) - 1]
              : null,
        };
      });
    goalReadings.push({ scenario, controller, readings });
  }
const summary = {
  kind: 'v081-tempo-confirm-30',
  plan,
  parent,
  source,
  goalReadings,
  checked: { newContexts: checkedContexts, finalProfiles: checkedProfiles },
  ...summarizeTempo(rows),
  censoring:
    '30-game paths; first-hit median only among reached paths, no extrapolation beyond 30 games. Other baseline scenarios retain their 20-game window.',
};
writeFileSync(
  resolve(directory, 'analysis.json'),
  JSON.stringify(summary, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(
  JSON.stringify(
    {
      directory,
      newMatches: checkedContexts,
      totalPathMatches: rows.length,
      paths: summary.paths,
      profiles: checkedProfiles,
    },
    null,
    2,
  ),
);
