import { describe, expect, it, vi } from 'vitest';
import * as ai from '../game/ai-decision';
import { createGameSession, reduceGameSession } from './game-session';
import { serializeGameCheckpoint, serializeGameBackup } from './game-save';
import { parseReplay, serializeReplay } from './game-replay';
import { createPlayerProfile } from './player-profile';
import { copySnapshot } from './replay-record';
import {
  completedReplaySession,
  parseDataFile,
  previewCompletedReplay,
  sameReplayResults,
  describeDataProgress,
} from './data-management';
function game(count = 1, seed = 42) {
  let s = reduceGameSession(createGameSession(seed), {
    type: 'start_game',
    characterId: 'lost',
  });
  for (let i = 0; i < count; i++) {
    s = reduceGameSession(s, {
      type: 'submit_player_turn',
      turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
    });
    s = reduceGameSession(s, { type: 'advance_room' });
  }
  return s;
}
describe('task-oriented data management', () => {
  it.each(['checkpoint', 'backup', 'replay'] as const)(
    'detects %s from the actual format, not file name',
    (kind) => {
      const s = game();
      const source =
        kind === 'checkpoint'
          ? serializeGameCheckpoint(s)
          : kind === 'backup'
            ? serializeGameBackup(s, createPlayerProfile())
            : serializeReplay(s.replay!, 'build');
      const parsed = parseDataFile('\uFEFF' + source, 'misleading.txt');
      expect(parsed.kind).toBe(kind);
      expect(parsed.filename).toBe('misleading.txt');
    },
  );
  it.each(['save', 'replay'] as const)(
    'rejects unsupported v1 %s files',
    (kind) => {
      expect(() =>
        parseDataFile(
          JSON.stringify({
            format: 'the-bidding-of-isaac-' + kind,
            version: 1,
          }),
          'old.json',
        ),
      ).toThrow('v2');
    },
  );
  it('rejects invalid, unknown and oversized data without guessing another type', () => {
    expect(() => parseDataFile('broken', 'x.json')).toThrow('JSON');
    expect(() => parseDataFile('{}', 'x.json')).toThrow('识别');
    expect(() =>
      parseDataFile(' '.repeat(8 * 1024 * 1024 + 1), 'x.json'),
    ).toThrow('8 MiB');
  });
  it('reads the local directory preview without AI decisions or changing input bytes', () => {
    const s = game(15);
    const source = serializeReplay(s.replay!, 'build');
    const decide = vi.spyOn(ai, 'decideAiTurn');
    expect(previewCompletedReplay(source).replay).toEqual(s.replay);
    expect(decide).not.toHaveBeenCalled();
    decide.mockRestore();
    expect(source).toBe(
      serializeReplay(
        s.replay!,
        'build',
        new Date(JSON.parse(source).exportedAt),
      ),
    );
  });
  it('does not list partial or incompatible archives as recently completed games', () => {
    expect(() =>
      previewCompletedReplay(serializeReplay(game(2).replay!, 'build')),
    ).toThrow('无效');
    const source = JSON.parse(serializeReplay(game(15).replay!, 'build'));
    source.replay.rulesVersion = 'other';
    expect(() => previewCompletedReplay(JSON.stringify(source))).toThrow(
      '不兼容',
    );
  });
  it('deduplicates equal outcomes even if compatible historical provenance differs', () => {
    const a = game(15).replay!,
      b = copySnapshot(a);
    b.startedBuild = 'other';
    b.rooms[0]!.source = 'checkpoint-reconstruction';
    b.rooms[0]!.build = 'other';
    b.final!.build = 'other';
    expect(sameReplayResults(a, b)).toBe(true);
    expect(b.rooms[0]!.source).toBe('checkpoint-reconstruction');
  });
  it('keeps same-seed branches distinct when any earlier action record differs', () => {
    const a = game(15).replay!,
      b = copySnapshot(a);
    b.rooms[0]!.settlement.turns[0]!.actions = [
      { type: 'bid', group: 'A', amount: 1 },
    ];
    expect(a.id).toBe(b.id);
    expect(sameReplayResults(a, b)).toBe(false);
  });
  it('restores a completed archive for backup without replacing a live session or losing provenance', () => {
    const s = game(15);
    s.replay!.startedBuild = 'original-build';
    const doc = parseReplay(serializeReplay(s.replay!, 'export-build'));
    const reconstructed = completedReplaySession(doc);
    expect(reconstructed.game).toEqual(s.game);
    expect(reconstructed.replay).toEqual(s.replay);
    expect(reconstructed.draft).toBeNull();
  });
  it('refuses to create a completed backup from partial results', () => {
    const doc = parseReplay(serializeReplay(game(3).replay!, 'build'));
    expect(() => completedReplaySession(doc)).toThrow('已完成');
  });
  it('describes progress without duplicating the character name or claiming continuation at the end', () => {
    expect(describeDataProgress(game(0))).toContain('行动待提交');
    expect(describeDataProgress(game(15))).toContain('对局已结束');
    expect(describeDataProgress(game(1))).not.toContain('游魂');
  });
});
