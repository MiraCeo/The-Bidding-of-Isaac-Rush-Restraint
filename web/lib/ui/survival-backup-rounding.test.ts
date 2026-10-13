import { describe, it, expect } from 'vitest';
import { playLongRun } from './survival-long-run';
import {
  serializeSurvivalBackup,
  parseSurvivalBackup,
} from './survival-backup';
import {
  parseSurvivalReplay,
  type SurvivalReplayDocument,
} from './survival-persistence';
import { createPlayerProfile } from './player-profile';
import { withChecksum } from './file-json';
const game = playLongRun(3).game;
const source = serializeSurvivalBackup(game, null, createPlayerProfile());
interface BackupFixture {
  replay: SurvivalReplayDocument & { checksum: string };
  checksum: string;
  [key: string]: unknown;
}
function edited(change: (doc: BackupFixture) => void) {
  const doc = JSON.parse(source) as BackupFixture;
  change(doc);
  const { checksum: _replayChecksum, ...replay } = doc.replay;
  doc.replay = withChecksum(replay);
  const { checksum: _backupChecksum, ...backup } = doc;
  return JSON.stringify(withChecksum(backup));
}
function knife(doc: BackupFixture) {
  const trigger =
    doc.replay.replay.rooms[1]!.scoreBreakdowns['ai-11']!.triggers[0]!;
  expect(trigger.itemId).toBe('moms_knife');
  return trigger;
}
describe('cross-runtime survival backup explanation rounding', () => {
  it('accepts only last-bit Math.exp knife amount differences and keeps the input untouched', () => {
    for (const sign of [-1, 1]) {
      const changed = edited((doc) => {
        const trigger = knife(doc);
        trigger.amount =
          trigger.amount! + sign * trigger.amount! * Number.EPSILON * 4;
      });
      const before = changed;
      expect(parseSurvivalBackup(changed).checkpoint.game).toEqual(game);
      expect(changed).toBe(before);
    }
  });
  it('rejects a larger explanation difference even when inner factual checks and both checksums pass', () => {
    const changed = edited((doc) => {
      knife(doc).amount! += 1e-9;
    });
    expect(() =>
      parseSurvivalReplay(JSON.stringify(JSON.parse(changed).replay)),
    ).not.toThrow();
    expect(() => parseSurvivalBackup(changed)).toThrow();
  });
  it('does not apply the allowance to a changed item identity, ordering or authoritative room score', () => {
    for (const change of [
      (doc: BackupFixture) => {
        knife(doc).itemId = 'score_charm';
      },
      (doc: BackupFixture) => {
        doc.replay.replay.rooms[6]!.scoreBreakdowns['ai-9']!.triggers.reverse();
      },
      (doc: BackupFixture) => {
        doc.replay.replay.rooms[1]!.scoreBreakdowns['ai-11']!.score += 0.0001;
      },
    ]) {
      const changed = edited(change);
      expect(changed).not.toBe(source);
      expect(() => parseSurvivalBackup(changed)).toThrow();
    }
  });
});
