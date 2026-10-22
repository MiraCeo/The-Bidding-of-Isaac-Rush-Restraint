import { expect, it } from 'vitest';
import { mixed25Plan, mixed25Seed } from '../../../scripts/mixed25-plan.mjs';
import {
  assertMixed25Targets,
  mixed25Readout,
  mixed25Targets,
  mixed25Catalog,
  chooseMixed25,
  runMixed25Match,
} from './mixed25.test-helper';
import {
  achievementCatalog,
  characterAchievementRequirements,
} from './catalog';
import {
  freshStudyProfile,
  advanceStudyProfile,
} from './current-study.test-helper';
import { canonicalJson } from '../../shared/json-facts';
import { sha256Hex } from '../../shared/sha256';
it('maps exactly the proposed 28 public thresholds, preserving role prerequisites and stage order', () => {
  const before = JSON.stringify(achievementCatalog);
  assertMixed25Targets();
  expect(Object.keys(mixed25Targets)).toHaveLength(28);
  for (const ids of Object.values(characterAchievementRequirements))
    for (const id of ids) expect(mixed25Targets[id]).toBeUndefined();
  expect(JSON.stringify(achievementCatalog)).toBe(before);
  expect(
    mixed25Catalog().find((a) => a.number === 'E12')!.candidateTarget,
  ).toBe(10);
  expect(
    mixed25Catalog().find((a) => a.number === 'F13')!.candidateTarget,
  ).toBe(10);
  expect(
    mixed25Catalog().find((a) => a.number === 'D15')!.candidateTarget,
  ).toBe(10);
  expect(
    mixed25Catalog().find((a) => a.number === 'E24')!.candidateTarget,
  ).toBe(15);
});
it('does not award unchanged IDs from raw progress or write candidate badges into profiles', () => {
  const profile = freshStudyProfile(),
    before = JSON.stringify(profile);
  const r = mixed25Readout({ E10: 10, D09: 100 }, []);
  expect(r.candidate).toContain('E10');
  expect(r.candidate).not.toContain('D09');
  expect(JSON.stringify(profile)).toBe(before);
});
it('uses disjoint pilot seeds and exactly 540 planned matches', () => {
  expect(
    mixed25Plan.blocks * mixed25Plan.routes.length * mixed25Plan.games,
  ).toBe(540);
  const seeds = Array.from({ length: 6 }, (_, b) =>
    Array.from({ length: 30 }, (_, i) => mixed25Seed(b, i)),
  ).flat();
  expect(new Set(seeds).size).toBe(180);
  expect(seeds).not.toContain(mixed25Seed(0, 0, true));
  expect(() => mixed25Seed(6, 0)).toThrow();
  expect(() => mixed25Seed(0, 30)).toThrow();
});
it('uses one real profile across modes and produces deterministic legitimate authority without candidate writes', () => {
  const profile = freshStudyProfile(),
    choice = chooseMixed25('collector', 1, profile, [], {}, 0);
  expect(choice.role).toBe('isaac');
  expect(choice.mode).toBe('classic');
  const seed = mixed25Seed(0, 0, true),
    a = runMixed25Match(seed, choice),
    b = runMixed25Match(seed, choice);
  expect(a).toEqual(b);
  expect(a.traceFingerprint).toBe(sha256Hex(canonicalJson(a.context)));
  const advanced = advanceStudyProfile(profile, a.context, 1, true),
    earned = mixed25Readout(advanced.progress, advanced.achieved).candidate;
  const next = chooseMixed25(
    'collector',
    2,
    advanced.profile,
    earned,
    { isaac: 1 },
    0,
  );
  expect(next.mode).toBe('survival');
  expect(next.available).toContain(next.role);
  const survival = runMixed25Match(mixed25Seed(0, 1, true), next);
  expect(survival.context.mode).toBe('survival');
  expect(survival.context.units.at(-1)?.stage).toBe('complete');
}, 60000);
