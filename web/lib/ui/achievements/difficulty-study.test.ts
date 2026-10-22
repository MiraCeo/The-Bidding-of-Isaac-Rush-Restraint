import { it, expect } from 'vitest';
import {
  playAchievementStudy,
  summarizeStudyRows,
  type StudyMatch,
} from './difficulty-study.test-helper';
import {
  summarizeStudyCampaigns,
  summarizeStudyOverlaps,
} from './difficulty-study-stats.test-helper';

function fixture(
  root: string,
  metrics: Partial<StudyMatch['metrics']> = {},
  achieved: StudyMatch['achieved'] = [],
): StudyMatch {
  return {
    mode: 'classic',
    difficulty: 'classic',
    role: 'isaac',
    policy: 'pace',
    seed: 1,
    humanRooms: 15,
    totalRooms: 15,
    terminal: true,
    champion: false,
    survived: true,
    achieved,
    metrics: { highest: 0, interest: 0, savings: 0, stolen: 0, ...metrics },
    actions: { bid: 15, disrupt: 0, withdraw: 0, dual: 0 },
    opportunities: {
      interestRooms: 0,
      bagRooms: 0,
      saleRooms: 0,
      dualBidRooms: 0,
      dualDisruptRooms: 0,
      transcendenceRooms: 0,
      fullBidActions: 0,
    },
    events: [],
    root,
    traceFingerprint: '',
  };
}

it('keeps default official classic game and deterministic study witnesses', () => {
  const a = playAchievementStudy(0x56101eef, 'isaac', 'pace');
  expect(playAchievementStudy(0x56101eef, 'isaac', 'pace')).toEqual(a);
  expect(a.humanRooms).toBe(15);
  expect(a.totalRooms).toBe(15);
  expect(a.achieved).toContain('E06');
  expect(a.achieved).not.toContain('F07');
  for (const metric of ['highest', 'interest', 'savings', 'stolen'] as const)
    expect(a.events.reduce((s, e) => s + e.metrics[metric], 0)).toBe(
      a.metrics[metric],
    );
}, 30000);

it('runs double-action exploration and official survival through terminal', () => {
  const a = playAchievementStudy(
    0x56101eef,
    'jacob_esau',
    'explore',
    'standard',
  );
  expect(a.terminal).toBe(true);
  expect(a.totalRooms).toBeGreaterThanOrEqual(a.humanRooms);
  expect(a.totalRooms % 5).toBe(0);
  expect(a.achieved).toContain('F07');
  expect(a.achieved).not.toContain('E06');
  expect(a.actions.dual).toBeGreaterThan(0);
}, 30000);

it('uses null for out-of-scope rates, also in role summaries', () => {
  const [s] = summarizeStudyRows([fixture('a', {}, ['E06'])]);
  expect(s!.achievements.F07).toMatchObject({ n: 0, rate: null });
  expect(s!.byRole.isaac.achievements.F07).toMatchObject({ n: 0, rate: null });
  expect(s!.byRole.lost.achievements.E06).toMatchObject({ n: 0, rate: null });
  expect(s!.achievements.E06.rate).toBe(1);
  expect(s!.achievements.B08.hi95).toBeGreaterThan(0);
});

it('checks the public-information policy against official highest-difficulty settlement', () => {
  const a = playAchievementStudy(0x56101eef, 'isaac', 'public-ai', 'highest');
  expect(a.terminal).toBe(true);
  expect(a.totalRooms).toBeLessThanOrEqual(35);
  expect(a.achieved.includes('F06')).toBe(a.champion);
  expect(a.achieved.includes('F02')).toBe(a.survived);
  for (const metric of ['highest', 'interest', 'savings', 'stolen'] as const)
    expect(a.events.reduce((sum, e) => sum + e.metrics[metric], 0)).toBe(
      a.metrics[metric],
    );
}, 30000);

it('counts disjoint observed campaigns, threshold equality and censored misses', () => {
  const rows = Array.from({ length: 41 }, (_, i) =>
    fixture(String(i), { highest: i < 20 ? 2 : 3, interest: 1 }),
  );
  const [s] = summarizeStudyCampaigns(rows);
  expect(s).toMatchObject({ campaigns: 2, excludedTail: 1 });
  expect(s!.goals.B08).toMatchObject({
    firstHit: [null, 17],
    hits: 1,
    censored: 1,
    medianAmongHits: 17,
  });
  expect(s!.goals.D08).toMatchObject({
    firstHit: [null, null],
    medianAmongHits: null,
  });
  expect(s!.goals.E10!.firstHit).toEqual([20, 20]);
  expect(s!.goals.B02!.firstHit).toEqual([5, 4]);
});

it('rejects repeated authority roots and invalid campaign windows', () => {
  expect(() => summarizeStudyCampaigns([fixture('a'), fixture('a')])).toThrow(
    'Repeated official match root',
  );
  expect(() => summarizeStudyCampaigns([], 0)).toThrow(
    'Invalid campaign window',
  );
});

it('reports observed co-occurrence without claiming two rules are equivalent', () => {
  const s = summarizeStudyOverlaps([
    fixture('a', {}, ['D06', 'D09']),
    fixture('b', {}, ['D06']),
    fixture('c'),
  ]);
  expect(s.find((x) => x.a === 'D09')).toMatchObject({
    n: 3,
    aHits: 1,
    bHits: 2,
    both: 1,
    aOnly: 0,
    bOnly: 1,
    shareOfBase: 0.5,
  });
  expect(s.find((x) => x.a === 'F10')).toMatchObject({
    n: 0,
    jaccard: null,
    shareOfBase: null,
  });
});
