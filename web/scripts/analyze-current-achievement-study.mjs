import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  allocateStudyRun,
  assertStudyRun,
  writeStudyJson,
} from './current-study-output.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(',')}}`
      : JSON.stringify(v);
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
export function observedFirstHits(cells, id) {
  const eligible = cells.filter((c) => c.achievements[id]?.applicable);
  const hits = eligible
    .flatMap((c) =>
      c.achievements[id].firstCampaignGame === null
        ? []
        : [c.achievements[id].firstCampaignGame],
    )
    .sort((a, b) => a - b);
  return {
    paths: eligible.length,
    hits: hits.length,
    censored: eligible.length - hits.length,
    firstHitGames: hits,
    medianAmongHits: hits.length
      ? hits[Math.floor((hits.length - 1) / 2)]
      : null,
    hitBy: Object.fromEntries(
      [5, 10, 20].map((n) => [n, hits.filter((v) => v <= n).length]),
    ),
    finalProgress: eligible.map((c) => c.achievements[id].finalProgress),
  };
}
export function loadCurrentStudy(root, directory, purpose) {
  const marker = assertStudyRun(root, directory);
  assert.equal(marker.purpose, purpose);
  assert.equal(marker.source.dirty, false);
  assert.equal(json(resolve(directory, 'status.json')).status, 'completed');
  const summary = json(resolve(directory, 'summary.json'));
  assert.deepEqual(summary.source, marker.source);
  assert.equal(summary.catalog.length, 117);
  assert(
    [
      [7, 6],
      [8, 7],
    ].some(
      ([schema, catalog]) =>
        summary.ledgerSchema === schema && summary.catalogVersion === catalog,
    ),
  );
  const rowFiles = readdirSync(directory)
    .filter((f) => /^rows-\d+\.json$/.test(f))
    .sort();
  const rows = rowFiles.flatMap((f) => json(resolve(directory, f)));
  assert.equal(rows.length, summary.matches);
  assert.equal(new Set(rows.map((r) => r.identity)).size, rows.length);
  const witnessFiles = readdirSync(directory).filter((f) =>
    /^witness-\d+-\d+\.json$/.test(f),
  );
  const witnesses = new Map();
  for (const file of witnessFiles) {
    const witness = json(resolve(directory, file));
    assert(!witnesses.has(witness.identity));
    witnesses.set(witness.identity, witness);
  }
  assert.equal(witnesses.size, rows.length);
  for (const row of rows) {
    const witness = witnesses.get(row.identity);
    assert(witness);
    assert.equal(sha(canonical(witness.context)), row.match.traceFingerprint);
    assert.equal(witness.seed, row.match.seed);
    assert.equal(witness.context.root, row.match.root);
    assert.deepEqual(witness.opportunities, row.exposure);
  }
  const profiles = json(
    resolve(directory, `profiles-${rowFiles.length - 1}.json`),
  );
  for (const [cell, p] of Object.entries(profiles)) {
    assert.equal(sha(JSON.stringify(p)), summary.finalProfiles[cell].sha256);
    const wire = p.progression.modules.achievementRegistryV1;
    assert.equal(wire.version, summary.ledgerSchema);
    assert.equal(wire.catalogVersion, summary.catalogVersion);
  }
  return { directory, summary, rows };
}
export function analyzeStudies(root, pilotDir, mainDir, campaignDir) {
  const pilot = loadCurrentStudy(root, pilotDir, 'pilot'),
    main = loadCurrentStudy(root, mainDir, 'main'),
    campaign = loadCurrentStudy(root, campaignDir, 'campaign');
  assert.equal(pilot.rows.length, 150);
  assert.equal(main.rows.length, 1500);
  assert.equal(campaign.rows.length, 600);
  assert.deepEqual(pilot.summary.source, main.summary.source);
  assert.deepEqual(campaign.summary.source, main.summary.source);
  const seedSets = [pilot, main, campaign].map(
    (s) => new Set(s.rows.map((r) => r.seedIndex)),
  );
  for (let i = 0; i < 3; i++)
    for (let j = i + 1; j < 3; j++)
      for (const n of seedSets[i]) assert(!seedSets[j].has(n));
  const { catalog, series } = main.summary;
  const badges = catalog.map((a) => {
    const applicable = main.rows.filter(
      (r) => a.scope === 'shared' || r.match.mode === a.scope,
    );
    return {
      ...a,
      singleMatch: {
        hits: applicable.filter((r) => r.achieved.includes(a.id)).length,
        n: applicable.length,
      },
      fixedRolePaths: observedFirstHits(main.summary.cells, a.id),
      adaptiveNewProfiles: observedFirstHits(campaign.summary.cells, a.id),
    };
  });
  const opportunityKeys = {
    'S-TAIL-DESTROYED': 'tailEligibleRooms',
    'S-TAIL-DUPLICATED': 'tailEligibleRooms',
    'S-ETERNAL-CLEARS': 'eternalPositiveRooms',
    'S-OPTIONS-AWARDS': 'optionsOfferedRooms',
    'S-BOSS-AWARDS': 'bossRooms',
  };
  const exposures = Object.entries(opportunityKeys).map(([id, key]) => ({
    id,
    denominator: key,
    byCell: main.summary.cells.map((c) => ({
      cell: c.cell,
      opportunities: c.exposure[key],
      triggers: c.causes[id],
      heldTail: c.exposure.tailHeldRooms,
      eligibleTailGroups: c.exposure.tailEligibleGroups,
      acquiredTailCopies: c.exposure.tailAcquiredCopies,
      missingEternalEvidence: c.exposure.eternalMissingEvidenceRooms,
    })),
    totalOpportunities: main.summary.cells.reduce(
      (n, c) => n + c.exposure[key],
      0,
    ),
    totalTriggers: main.summary.cells.reduce((n, c) => n + c.causes[id], 0),
  }));
  const representatives = catalog.filter(
    (a) =>
      !series.some((s) => s.ids.includes(a.id)) ||
      series.some((s) => s.ids[0] === a.id),
  );
  const overlaps = [];
  for (let i = 0; i < representatives.length; i++)
    for (const b of representatives.slice(i + 1)) {
      const a = representatives[i],
        rows = main.rows.filter(
          (r) =>
            (a.scope === 'shared' || r.match.mode === a.scope) &&
            (b.scope === 'shared' || r.match.mode === b.scope),
        );
      const aHits = rows.filter((r) => r.achieved.includes(a.id)).length,
        bHits = rows.filter((r) => r.achieved.includes(b.id)).length;
      const both = rows.filter(
        (r) => r.achieved.includes(a.id) && r.achieved.includes(b.id),
      ).length;
      if (both)
        overlaps.push({
          a: a.number,
          aName: a.name,
          b: b.number,
          bName: b.name,
          n: rows.length,
          aHits,
          bHits,
          both,
          jaccard: both / (aHits + bHits - both),
          shareOfSmaller: both / Math.min(aHits, bHits),
        });
    }
  overlaps.sort((a, b) => b.jaccard - a.jaccard || b.both - a.both);
  const directory = allocateStudyRun(root, 'analysis');
  writeStudyJson(root, directory, 'findings.json', {
    scope:
      'descriptive scripted-model evidence and observed campaign paths; not human telemetry, balance changes or browser acceptance',
    measuredSource: main.summary.source,
    inputs: [pilotDir, mainDir, campaignDir],
    matches: { pilot: 150, main: 1500, newProfileCampaigns: 600 },
    independentSeedIndices: seedSets.map((s) => s.size),
    cells: {
      main: main.summary.cells.length,
      adaptiveCampaigns: campaign.summary.cells.length,
    },
    badges,
    series,
    exposures,
    overlaps,
    newProfilePaths: campaign.summary.cells.map((c) => ({
      cell: c.cell,
      roles: c.roles,
      unlocks: c.unlocks,
      completeSeries: c.completeSeries,
    })),
    caveats: [
      'Main cells each have 20 scripted seeds; pooled matches reuse paired seeds across roles/difficulties/policies.',
      'Fixed-role campaigns have one observed 20-match path per condition, not independent-player timing samples.',
      'Adaptive new-profile campaigns have five independent seed blocks per policy/mode, select only actually unlocked roles, and are descriptive small samples.',
      'Zero hits are not impossibility; non-applicable modes are excluded, not failures. Opportunity rooms are correlated and reported without binomial confidence intervals.',
      'Campaign timing reports censored paths separately and never substitutes zero for an unobserved first hit.',
    ],
  });
  writeStudyJson(root, directory, 'status.json', {
    status: 'completed',
    witnessesVerified: 2250,
    profileHashesVerified: [pilot, main, campaign].reduce(
      (n, s) => n + Object.keys(s.summary.finalProfiles).length,
      0,
    ),
  });
  return directory;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length !== 5)
    throw Error('Provide pilot, main, campaign directories');
  console.log(
    analyzeStudies(
      fileURLToPath(new URL('..', import.meta.url)),
      ...process.argv.slice(2),
    ),
  );
}
