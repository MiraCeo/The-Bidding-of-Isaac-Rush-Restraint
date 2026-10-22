import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  assertTargeted25,
  targeted25Plan as plan,
  targeted25BaselineHashes,
} from './targeted25-plan.mjs';
const hash = (s) => createHash('sha256').update(s).digest('hex');
const canonical = (v) =>
  Array.isArray(v)
    ? '[' + v.map(canonical).join(',') + ']'
    : v && typeof v === 'object'
      ? '{' +
        Object.keys(v)
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
          .map((k) => JSON.stringify(k) + ':' + canonical(v[k]))
          .join(',') +
        '}'
      : JSON.stringify(v);
export function targeted25Distribution(values) {
  if (values.some((x) => !Number.isFinite(x)))
    throw Error('Invalid distribution');
  const v = [...values].sort((a, b) => a - b),
    n = v.length;
  return {
    n,
    min: n ? v[0] : null,
    max: n ? v.at(-1) : null,
    mean: n ? v.reduce((a, b) => a + b, 0) / n : null,
    median: n ? (n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2) : null,
  };
}
export function summarizeTargeted25(rows, catalog) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.block + '/' + r.route,
      path = groups.get(key) ?? [];
    path.push(r);
    groups.set(key, path);
  }
  const paths = [...groups.values()].map((p) =>
    p.sort((a, b) => a.index - b.index),
  );
  const snapshots = plan.checkpoints.map((index) => {
    const selected = paths
      .map((p) => p.find((r) => r.index === index))
      .filter(Boolean);
    return {
      index,
      paths: selected.length,
      currentCount: targeted25Distribution(
        selected.map((r) => r.actualEarned.length),
      ),
      candidateCount: targeted25Distribution(
        selected.map((r) => r.candidateEarned.length),
      ),
      badgeGain: targeted25Distribution(
        selected.map((r) => r.candidateEarned.length - r.actualEarned.length),
      ),
      currentComplete: selected.filter((r) => r.actualEarned.length === 117)
        .length,
      candidateComplete: selected.filter(
        (r) => r.candidateEarned.length === 117,
      ).length,
      byRoute: plan.routes.map((route) => {
        const s = selected.filter((r) => r.route === route);
        return {
          route,
          paths: s.length,
          candidateCount: targeted25Distribution(
            s.map((r) => r.candidateEarned.length),
          ),
          complete: s.filter((r) => r.candidateEarned.length === 117).length,
        };
      }),
    };
  });
  const bottlenecks = plan.checkpoints.map((index) => {
    const selected = paths
      .map((p) => p.find((r) => r.index === index))
      .filter(Boolean);
    return {
      index,
      paths: selected.length,
      items: catalog
        .map((a) => {
          const missing = selected.filter(
            (r) => !r.candidateEarned.includes(a.id),
          );
          return {
            id: a.id,
            number: a.number,
            name: a.name,
            scope: a.scope,
            kind: a.kind,
            currentTarget: a.target,
            candidateTarget: a.candidateTarget,
            missing: missing.length,
            paths: selected.length,
            progress: targeted25Distribution(
              missing.map((r) => r.progress[a.id] ?? 0),
            ),
            routes: plan.routes.map((route) => ({
              route,
              missing: missing.filter((r) => r.route === route).length,
              paths: selected.filter((r) => r.route === route).length,
            })),
          };
        })
        .filter((a) => a.missing)
        .sort(
          (a, b) => b.missing - a.missing || a.number.localeCompare(b.number),
        ),
    };
  });
  return {
    matches: rows.length,
    paths: paths.length,
    checkpoints: snapshots,
    bottlenecks,
    endpoints: paths.map((p) => ({
      block: p[0].block,
      route: p[0].route,
      firstCandidateComplete:
        p.find((r) => r.candidateEarned.length === 117)?.index ?? null,
      lastIndex: p.at(-1).index,
      actualCount: p.at(-1).actualEarned.length,
      candidateCount: p.at(-1).candidateEarned.length,
      missing: p.at(-1).candidateMissing,
      classicGames: p.filter((r) => r.choice.mode === 'classic').length,
      survivalGames: p.filter((r) => r.choice.mode === 'survival').length,
      usedRoles: [...new Set(p.map((r) => r.choice.role))],
      difficultyGames: Object.fromEntries(
        ['easy', 'standard', 'hard', 'highest'].map((d) => [
          d,
          p.filter((r) => r.choice.difficulty === d).length,
        ]),
      ),
    })),
    scope:
      'Original/candidate thresholds on the SAME physically played adaptive route, not two separately optimal collection routes. Candidate readout never persisted as production achievements. Not human telemetry or migration acceptance.',
  };
}
export function analyzeTargeted25(root, directory) {
  const marker = assertTargeted25(root, directory),
    status = JSON.parse(
      readFileSync(resolve(directory, 'status.json'), 'utf8'),
    );
  if (status.status !== 'completed') throw Error('Incomplete targeted25 run');
  if (
    canonical(marker.baselineHashes) !==
    canonical(targeted25BaselineHashes(root))
  )
    throw Error('Archived baseline changed');
  const blocks = marker.purpose === 'pilot' ? 1 : 6,
    games = marker.purpose === 'pilot' ? 4 : 30,
    all = [];
  let catalog;
  for (let block = 0; block < blocks; block++) {
    const meta = JSON.parse(
      readFileSync(resolve(directory, `block-${block}.json`), 'utf8'),
    );
    const raw = readFileSync(resolve(directory, `rows-${block}.json`), 'utf8'),
      wraw = readFileSync(resolve(directory, `witness-${block}.jsonl`), 'utf8');
    if (hash(raw) !== meta.rowsSha256 || hash(wraw) !== meta.witnessSha256)
      throw Error('Targeted25 output hash mismatch');
    const rows = JSON.parse(raw),
      witnesses = wraw
        .trim()
        .split('\n')
        .map((s) => JSON.parse(s)),
      wm = new Map(witnesses.map((w) => [w.identity, w]));
    if (
      rows.length !== games ||
      wm.size !== rows.length ||
      meta.matches !== rows.length
    )
      throw Error('Incomplete targeted25 block');
    catalog ??= meta.catalog;
    if (canonical(catalog) !== canonical(meta.catalog))
      throw Error('Changing targeted25 catalog');
    const ps = JSON.parse(
      readFileSync(resolve(directory, `profiles-${block}.json`), 'utf8'),
    );
    for (const [route, p] of Object.entries(ps))
      if (hash(JSON.stringify(p)) !== meta.profileHashes[route])
        throw Error('Invalid production profile hash');
    for (const route of plan.routes) {
      const path = rows.filter((r) => r.route === route);
      if (path.length !== games) throw Error('Missing targeted25 route');
      if (new Set(path.map((r) => r.root)).size !== games)
        throw Error('Repeated game identity within one profile');
      for (const [i, r] of path.entries()) {
        if (
          r.index !== i + 1 ||
          r.block !== block ||
          r.identity !== `${block}/${route}/${r.index}` ||
          !r.availableBefore.includes(r.choice.role)
        )
          throw Error('Invalid targeted25 row');
        const w = wm.get(r.identity);
        if (
          !w ||
          hash(canonical(w.context)) !== r.traceFingerprint ||
          w.context.mode !== r.choice.mode ||
          w.context.root !== r.root ||
          w.context.units.at(-1)?.stage !== 'complete'
        )
          throw Error('Invalid targeted25 authority');
        const actual = new Set(r.actualEarned),
          candidate = catalog
            .filter(
              (a) =>
                actual.has(a.id) ||
                (a.candidateTarget !== a.target &&
                  (r.progress[a.id] ?? 0) >= a.candidateTarget),
            )
            .map((a) => a.id);
        if (
          canonical(candidate) !== canonical(r.candidateEarned) ||
          new Set(r.candidateEarned).size !== r.candidateEarned.length ||
          r.candidateMissing.length + r.candidateEarned.length !== 117
        )
          throw Error('Invalid candidate readout');
        if (
          i > 0 &&
          path[i - 1].candidateEarned.some((id) => !candidate.includes(id))
        )
          throw Error('Candidate progress went backwards');
      }
      if (
        games >= 20 &&
        path.slice(0, 20).filter((r) => r.choice.mode === 'classic').length !==
          10
      )
        throw Error('Changed first20 budget');
      if (path.some((r) => r.actualEarned.length === 117 && r.index < 35))
        throw Error('Impossible current full completion');
    }
    all.push(...rows);
  }
  if (all.length !== status.matches) throw Error('Wrong completed match count');
  const result = {
    kind: plan.kind,
    purpose: marker.purpose,
    plan,
    source: marker.source,
    catalog,
    ...summarizeTargeted25(all, catalog),
    targetedDiagnostics: targetDiagnostics(all),
    pairedBaseline:
      marker.purpose === 'main'
        ? pairedTargetSummary(all, root, catalog)
        : null,
  };
  writeFileSync(
    resolve(directory, 'analysis.json'),
    JSON.stringify(result, null, 2) + '\n',
    { flag: 'wx' },
  );
  return result;
}
export function targetDiagnostics(rows) {
  const attempts = rows.flatMap((r) => r.attempts);
  const goals = [...new Set(attempts.map((a) => a.goal))]
    .sort((a, b) => a.localeCompare(b))
    .map((goal) => {
      const a = attempts.filter((a) => a.goal === goal);
      return {
        goal,
        rooms: a.length,
        actualCost: a.reduce((n, a) => n + a.actualCost, 0),
        extraCostVsScoreBase: a.reduce(
          (n, a) => n + a.actualCost - a.baseCost,
          0,
        ),
        predictedScoreDeltaVsBase: a.reduce(
          (n, a) => n + a.predictedScore - a.basePredictedScore,
          0,
        ),
        actualRoomScore: targeted25Distribution(
          a.map((a) => a.result.actualScore),
        ),
        actualEvents: {
          doubleQualified: a.filter((a) => a.result.doubleQualified).length,
          optionsDestroyed: a.filter((a) => a.result.success.includes('B07'))
            .length,
          doubleVacancy: a.filter((a) => a.result.success.includes('C15'))
            .length,
          redeemed: a.filter((a) => a.result.redeemed).length,
          qualifiedCapital: a.filter((a) => a.result.success.includes('D12'))
            .length,
          watchedVacancy: a.filter((a) => a.result.watchedVacancy).length,
          targetActuallyDelivered: a.filter(
            (a) =>
              a.visibleTarget &&
              a.result.awards.some(
                (v) => v.itemId === a.visibleTarget && v.copies > 0,
              ),
          ).length,
        },
      };
    });
  const eligibility = Object.fromEntries(
    [
      'capital',
      'doubleBid',
      'doubleDisrupt',
      'redemption',
      'combo',
      'lostMantle',
    ].map((key) => [
      key,
      {
        rooms: attempts.filter((a) => a.eligible[key]).length,
        games: rows.filter((r) => r.attempts.some((a) => a.eligible[key]))
          .length,
      },
    ]),
  );
  return {
    humanRooms: attempts.length,
    goals,
    eligibility,
    championGames: rows.filter((r) => r.champion).length,
    actualLowestGames: rows.filter((r) =>
      r.floorConfirmations.some((f) => f.confirmed),
    ).length,
    lowestThenChampion: rows.filter(
      (r) => r.champion && r.floorConfirmations.some((f) => f.confirmed),
    ).length,
    scoreAfterConfirmedRooms: attempts.filter(
      (a) => a.lowestConfirmedBefore && a.goal !== 'edge',
    ).length,
    invalidEdgeAfterConfirmedRooms: attempts.filter(
      (a) => a.lowestConfirmedBefore && a.goal === 'edge',
    ).length,
    scoreCostNote:
      'Predicted deltas use the same current public state vs this new controller score-only choice; not actual counterfactual score, rival-turn oracle or full-game causal ablation. Event counts overlap, do not sum.',
  };
}
export function pairedTargetSummary(rows, root, catalog) {
  const directory = resolve(root, 'work/0.8/mixed25', plan.baseline),
    baseline = [];
  for (let b = 0; b < 6; b++) {
    const done = JSON.parse(
      readFileSync(resolve(directory, `done-${b}.json`), 'utf8'),
    );
    for (const [name, sha] of Object.entries(done.outputs))
      if (hash(readFileSync(resolve(directory, name))) !== sha)
        throw Error('Invalid baseline output');
    baseline.push(
      ...JSON.parse(readFileSync(resolve(directory, `rows-${b}.json`), 'utf8')),
    );
  }
  for (const r of rows)
    for (const route of ['collector', 'public']) {
      const old = baseline.find(
        (a) => a.block === r.block && a.index === r.index && a.route === route,
      );
      if (!old || old.seed !== r.seed) throw Error('Unpaired target seed');
    }
  return {
    baseline: plan.baseline,
    note: '6 paired initial seed sequences; later actions, roles, difficulty and trajectories may diverge. Historical outputs reused, not 360 extra games.',
    checkpoints: plan.checkpoints.map((index) => ({
      index,
      comparators: ['collector', 'public'].map((route) => {
        const selected = rows.filter((r) => r.index === index),
          pairs = selected.map((r) => ({
            new: r,
            old: baseline.find(
              (a) =>
                a.block === r.block && a.index === index && a.route === route,
            ),
          }));
        return {
          route,
          paths: pairs.length,
          currentCount: targeted25Distribution(
            pairs.map((p) => p.old.actualEarned.length),
          ),
          candidateCount: targeted25Distribution(
            pairs.map((p) => p.old.candidateEarned.length),
          ),
          newCandidateDelta: targeted25Distribution(
            pairs.map(
              (p) =>
                p.new.candidateEarned.length - p.old.candidateEarned.length,
            ),
          ),
          improved: pairs.filter(
            (p) => p.new.candidateEarned.length > p.old.candidateEarned.length,
          ).length,
          unchanged: pairs.filter(
            (p) =>
              p.new.candidateEarned.length === p.old.candidateEarned.length,
          ).length,
          worsened: pairs.filter(
            (p) => p.new.candidateEarned.length < p.old.candidateEarned.length,
          ).length,
          full: pairs.filter((p) => p.old.candidateEarned.length === 117)
            .length,
          all117: catalog.map((a) => ({
            number: a.number,
            name: a.name,
            oldMissing: pairs.filter(
              (p) => !p.old.candidateEarned.includes(a.id),
            ).length,
            newMissing: pairs.filter(
              (p) => !p.new.candidateEarned.includes(a.id),
            ).length,
            gained: pairs.filter(
              (p) =>
                p.new.candidateEarned.includes(a.id) &&
                !p.old.candidateEarned.includes(a.id),
            ).length,
            lost: pairs.filter(
              (p) =>
                !p.new.candidateEarned.includes(a.id) &&
                p.old.candidateEarned.includes(a.id),
            ).length,
          })),
        };
      }),
    })),
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL('..', import.meta.url)),
    directory = resolve(process.argv[2] ?? ''),
    result = analyzeTargeted25(root, directory);
  console.log(
    JSON.stringify(
      {
        directory,
        matches: result.matches,
        paths: result.paths,
        checkpoints: result.checkpoints,
      },
      null,
      2,
    ),
  );
}
