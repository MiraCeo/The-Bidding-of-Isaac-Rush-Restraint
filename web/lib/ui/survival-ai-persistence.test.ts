import { describe, expect, it, vi } from 'vitest';
import { startSurvivalClient } from './survival-client';
import {
  createSurvivalReplay,
  survivalCompatibility,
  survivalMatchId,
} from './survival-record';
import {
  parseSurvivalCheckpoint,
  serializeSurvivalCheckpoint,
  serializeSurvivalReplay,
  parseSurvivalReplay,
  loadSurvivalCheckpoint,
  survivalSaveKey,
} from './survival-persistence';
import { withChecksum } from './file-json';
import {
  startSurvivalGame,
  createSurvivalResearchReducer,
} from '../game/survival-session';
import { decideAiTurn } from '../game/ai-decision';
import * as ai from '../game/ai-decision';
import * as survivalAi from '../game/survival-ai';

function oldTranscript() {
  let game = startSurvivalGame({
    characterId: 'lost',
    seed: 42,
    cutLines: Array(7).fill(250),
    buildId: '0.3.0-client1-frozen',
  });
  game = createSurvivalResearchReducer(decideAiTurn)(game, {
    type: 'submit_player_turn',
    turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
  });
  const log = createSurvivalReplay(game);
  log.ruleFacts.engineVersion = 'survival-client-1';
  log.compatibility = survivalCompatibility(log.ruleFacts);
  log.id = survivalMatchId(log.seed, log.characterId, log.compatibility);
  const raw = JSON.parse(serializeSurvivalCheckpoint(game));
  delete raw.checksum;
  raw.ruleFacts = log.ruleFacts;
  raw.compatibility = log.compatibility;
  return { log, checkpoint: JSON.stringify(withChecksum(raw)) };
}
describe('survival AI2 engine boundary and retained historical facts', () => {
  it('writes the selected seven-step curve and AI2 identity without upgrading classic format', () => {
    const session = startSurvivalClient('isaac', 42);
    const doc = parseSurvivalCheckpoint(
      serializeSurvivalCheckpoint(session.game, session.draft),
    );
    expect(doc.game.cutLines).toEqual([200, 325, 500, 750, 1050, 1500, 2500]);
    expect(doc.compatibility).toMatch(/^survival-client-4-/);
    expect(doc.version).toBe(5);
  });
  it('reads client1 factual replay without invoking either AI policy', () => {
    const old = oldTranscript();
    const source = serializeSurvivalReplay(old.log, '0.3.0-legacy');
    const a = vi.spyOn(ai, 'decideAiTurn'),
      b = vi.spyOn(survivalAi, 'decideSurvivalAiTurn');
    try {
      const doc = parseSurvivalReplay(source);
      expect(doc.replay).toEqual(old.log);
      expect(doc.replay.compatibility).toMatch(/^survival-client-1-/);
      expect(a).not.toHaveBeenCalled();
      expect(b).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
  it('rejects old continuation before AI runs and preserves original automatic data', () => {
    const old = oldTranscript();
    const storage = {
      getItem: (key: string) =>
        key === survivalSaveKey ? old.checkpoint : null,
    };
    const a = vi.spyOn(ai, 'decideAiTurn'),
      b = vi.spyOn(survivalAi, 'decideSurvivalAiTurn');
    try {
      expect(() => parseSurvivalCheckpoint(old.checkpoint)).toThrow(
        '版本不兼容',
      );
      const loaded = loadSurvivalCheckpoint(storage);
      expect(loaded.document).toBeNull();
      expect(loaded.message).toContain('原数据保留');
      expect(storage.getItem(survivalSaveKey)).toBe(old.checkpoint);
      expect(a).not.toHaveBeenCalled();
      expect(b).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
