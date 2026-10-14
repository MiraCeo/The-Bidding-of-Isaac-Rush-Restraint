import { describe, expect, it } from 'vitest';
import {
  startSurvivalClient,
  reduceSurvivalClient,
  survivalRoomRules,
} from './survival-client';
import {
  continueSurvivalAfterHumanElimination,
  withSurvivalBuild,
} from '../game/survival-session';
import {
  serializeSurvivalBackup,
  parseSurvivalBackup,
} from './survival-backup';
import { createPlayerProfile, readPlayerProfile } from './player-profile';
import { createSurvivalReplay } from './survival-record';
import {
  recordSurvivalCompletedMatch,
  survivalCompletionKey,
} from './survival-profile';
import { parseModeDataFile } from './mode-data';
import { withChecksum } from './file-json';
import {
  completionRegistryModule,
  readCompletionRegistry,
  sumCounters,
} from './completion-registry';

function finished() {
  let session = startSurvivalClient('isaac', 42);
  for (let i = 0; i < 5; i++) {
    session = reduceSurvivalClient(session, {
      type: 'submit_player_turn',
      turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
    });
    session = reduceSurvivalClient(session, { type: 'advance_room' });
  }
  return continueSurvivalAfterHumanElimination(session.game);
}
describe('public survival data and progress isolation', () => {
  it('uses explicit entry rules without changing the classic defaults', () => {
    const session = startSurvivalClient('isaac', 42);
    expect(survivalRoomRules(session.game).floorStartingMoney).toEqual([1000]);
    expect(session.game.cutLines).toEqual([
      200, 325, 500, 750, 1050, 1500, 2500,
    ]);
  });
  it('round trips the backup checkpoint, independent replay and optional profile', () => {
    const session = startSurvivalClient('lost', 99);
    const profile = createPlayerProfile();
    profile.progression.statistics.example = 4;
    const source = serializeSurvivalBackup(
      session.game,
      session.draft,
      profile,
    );
    const doc = parseSurvivalBackup(source);
    expect(doc.checkpoint.game).toEqual(session.game);
    expect(doc.checkpoint.draft).toEqual(session.draft);
    expect(doc.profile).toEqual(profile);
    expect(parseModeDataFile(source, 'backup.json').kind).toBe(
      'survival-backup',
    );
  });
  it('rejects backup replay mismatch even with a recomputed outer checksum', () => {
    const session = startSurvivalClient('isaac', 42);
    const raw = JSON.parse(
      serializeSurvivalBackup(
        session.game,
        session.draft,
        createPlayerProfile(),
      ),
    );
    raw.replay = JSON.parse(
      serializeSurvivalBackup(
        startSurvivalClient('lost', 99).game,
        null,
        createPlayerProfile(),
      ),
    ).replay;
    expect(() =>
      parseSurvivalBackup(JSON.stringify(withChecksum(raw))),
    ).toThrow();
  });
  it('uses final factual ordinal rank and excludes inherited points from progress score', async () => {
    const log = createSurvivalReplay(finished());
    const key = await survivalCompletionKey(log);
    const profile = createPlayerProfile();
    const next = recordSurvivalCompletedMatch(profile, log, key);
    const human = log.final!.ranking.find((row) => row.playerId === 'human')!;
    expect(next.history[0]).toMatchObject({
      mode: 'survival',
      rank: human.rank,
      finalScore: human.finalScore,
      status: 'eliminated',
      eliminationFloorIndex: 0,
    });
    expect(readPlayerProfile(next)).toEqual(next);
    const { [completionRegistryModule]: _registry, ...modules } =
      next.progression.modules;
    expect({ ...next.progression, modules }).toEqual(profile.progression);
    expect(
      sumCounters(Object.values(readCompletionRegistry(next)!.groups))
        .completed,
    ).toBe(1);
  });
  it('deduplicates actual completion independently of the current build label', async () => {
    const game = finished();
    const log = createSurvivalReplay(game);
    const profile = createPlayerProfile();
    const key = await survivalCompletionKey(log);
    const next = recordSurvivalCompletedMatch(profile, log, key);
    const same = createSurvivalReplay(
      withSurvivalBuild(game, 'new-ui-only-build'),
    );
    expect(await survivalCompletionKey(same)).toBe(key);
    expect(recordSurvivalCompletedMatch(next, same, key)).toBe(next);
  });
  it('does not count partial facts as completed matches', () => {
    const profile = createPlayerProfile();
    expect(
      recordSurvivalCompletedMatch(
        profile,
        createSurvivalReplay(startSurvivalClient('lost', 99).game),
        'partial',
      ),
    ).toBe(profile);
  });
  it('rejects contradictory survival history status', () => {
    const profile = createPlayerProfile();
    profile.history.push({
      key: 'test',
      replayId: 'x',
      characterId: 'isaac',
      completedAt: new Date().toISOString(),
      finalScore: 1,
      rank: 1,
      mode: 'survival',
      status: 'survived',
      eliminationFloorIndex: 0,
    });
    expect(() => readPlayerProfile(profile)).toThrow();
  });
});
