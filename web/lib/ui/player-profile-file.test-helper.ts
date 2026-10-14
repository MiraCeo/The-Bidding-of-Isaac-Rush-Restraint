import { createPlayerProfile, type PlayerProfile } from './player-profile';
export function profileFileFixture(): PlayerProfile {
  const profile = createPlayerProfile(new Date('2026-10-14T00:00:00.000Z'));
  profile.updatedAt = '2026-10-14T01:00:00.000Z';
  profile.history = [
    {
      key: 'classic-one',
      replayId: 'classic-one',
      characterId: 'isaac',
      completedAt: profile.updatedAt,
      finalScore: 123.4567,
      rank: 1,
    },
    {
      key: 'survival-one',
      replayId: 'survival-one',
      mode: 'survival',
      aiDifficulty: 'highest',
      characterId: 'lost',
      completedAt: profile.updatedAt,
      finalScore: 90.2,
      rank: 20,
      status: 'eliminated',
      eliminationFloorIndex: 0,
    },
    {
      key: 'survival-two',
      replayId: 'survival-two',
      mode: 'survival',
      aiDifficulty: 'standard',
      characterId: 'jacob_esau',
      completedAt: profile.updatedAt,
      finalScore: 5432.1234,
      rank: 2,
      status: 'survived',
      eliminationFloorIndex: null,
    },
  ];
  profile.progression.statistics = { existingCounter: 3 };
  profile.progression.modules = {
    extension: {
      note: '已有扩展字段只保留，不新增玩法',
      values: [1, null, true, '测试'],
    },
  };
  return profile;
}
