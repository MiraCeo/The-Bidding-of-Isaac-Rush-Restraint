import { expect, it } from 'vitest';
import {
  runCurrentStudyMatch,
  pairedStudySeed,
  freshStudyProfile,
  advanceStudyProfile,
  availableStudyRoles,
  summarizeCurrentRows,
  studyRate,
  type CurrentStudyRow,
} from './current-study.test-helper';
import { playAchievementStudy } from './difficulty-study.test-helper';
import {
  readAchievementRegistry,
  projectAchievementRegistry,
} from './registry';
import { revision065NewSeries } from './revision065-catalog';
it.each(['pace', 'public-ai', 'explore'] as const)(
  'keeps %s official actions, RNG, hidden-information policy and terminal fingerprints unchanged under observation',
  (policy) => {
    const seed = pairedStudySeed(0);
    const old = playAchievementStudy(seed, 'isaac', policy);
    const observed = runCurrentStudyMatch(seed, 'isaac', policy, 'classic');
    expect(observed.match).toEqual(old);
    expect(observed.context.units.at(-1)!.stage).toBe('complete');
    expect(observed.exposure.humanRooms).toBe(15);
    expect(Object.keys(observed.progress)).toHaveLength(117);
    for (const s of revision065NewSeries)
      expect(observed.causes[s.id]).toBe(observed.progress[s.anchor]);
  },
  30000,
);
it('captures exact positive-score evidence and excludes AI-only rooms in official survival', () => {
  const result = runCurrentStudyMatch(
    pairedStudySeed(1),
    'lost',
    'explore',
    'highest',
  );
  expect(result.exposure.humanRooms).toBe(result.match.humanRooms);
  expect(result.match.totalRooms).toBeGreaterThanOrEqual(
    result.match.humanRooms,
  );
  expect(result.exposure.eternalMissingEvidenceRooms).toBe(0);
  expect(result.exposure.eternalHeldRooms).toBeGreaterThan(0);
  expect(result.exposure.eternalPositiveRooms).toBeGreaterThanOrEqual(
    result.causes['S-ETERNAL-CLEARS']!,
  );
}, 30000);
it('uses actual continuous schema7 profiles, not summed single-match awards or independent role accounts', () => {
  let profile = freshStudyProfile();
  expect(availableStudyRoles(profile)).toEqual(['isaac']);
  const rows: CurrentStudyRow[] = [];
  for (let i = 0; i < 2; i++) {
    const result = runCurrentStudyMatch(
      pairedStudySeed(i),
      'isaac',
      'pace',
      'classic',
    );
    const raw = JSON.stringify(profile),
      advanced = advanceStudyProfile(profile, result.context, i + 1, true);
    expect(JSON.stringify(profile)).toBe(raw);
    profile = advanced.profile;
    rows.push({
      identity: 'cell/' + i,
      cell: 'cell',
      index: i + 1,
      seedIndex: i,
      role: 'isaac',
      match: result.match,
      exposure: result.exposure,
      causes: result.causes,
      progress: result.progress,
      achieved: result.match.achieved,
      campaignProgress: advanced.progress,
      campaignAchieved: advanced.achieved,
      unlocks: advanced.unlocks,
    });
  }
  const view = projectAchievementRegistry(profile)!;
  expect(view.progress.E09).toBe(2);
  expect(readAchievementRegistry(profile)!.stages).toBeDefined();
  const [summary] = summarizeCurrentRows(rows);
  expect(summary!.n).toBe(2);
  expect(Object.keys(summary!.achievements)).toHaveLength(117);
  expect(summary!.achievements.E06!.firstCampaignGame).toBe(1);
  expect(summary!.achievements.E10!.censored).toBe(true);
  expect(summary!.achievements.E10!.firstCampaignGame).toBeNull();
  expect(summary!.achievements.E10!.progressAt20).toBeNull();
  expect(summary!.achievements.F07!.singleGame.rate).toBeNull();
  expect(summary!.unlocks.isaac).toBe(0);
  expect(() => summarizeCurrentRows([rows[0]!, rows[0]!])).toThrow();
  expect(() => summarizeCurrentRows([{ ...rows[0]!, index: 2 }])).toThrow();
  const adaptive = summarizeCurrentRows(rows, false)[0]!;
  expect(adaptive.achievements.E06!.singleGame.lo95).toBeNull();
}, 30000);
it('keeps zero-hit uncertainty, missing exposure and disjoint seed definitions explicit', () => {
  expect(studyRate(0, 0)).toMatchObject({ rate: null, hi95: null });
  expect(studyRate(0, 20).hi95).toBeGreaterThan(0);
  expect(studyRate(20, 20).lo95).toBeLessThan(1);
  expect(() => studyRate(2, 1)).toThrow();
  const pilot = [0, 1].map(pairedStudySeed),
    main = Array.from({ length: 20 }, (_, i) => pairedStudySeed(i + 2));
  expect(new Set([...pilot, ...main]).size).toBe(22);
  expect(() => pairedStudySeed(-1)).toThrow();
});
