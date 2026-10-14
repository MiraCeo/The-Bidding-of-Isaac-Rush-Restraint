/** Synthetic played games, not renamed clones. Fixed metadata for comparable native studies. */
import { createGameSession, reduceGameSession } from '../game-session';
import { playLongRun } from '../survival-long-run';
import { createSurvivalReplay } from '../survival-record';
import {
  prepareLibraryReplay,
  replaySource,
  type PreparedReplay,
  type LibraryReplay,
} from '../replay-library';
import {
  classicLibraryProof,
  type ClassicLibraryProof,
} from '../classic-library-equivalence';
import { librarySha256 } from '../replay-library';
import type { CharacterId } from '../../game/item-types';
import type { SurvivalDifficulty } from '../../game/survival-difficulty';

export interface LargeLibraryCorpus {
  kind: 'large-library-study-corpus-1';
  prepared: PreparedReplay[];
  anchor: { key: string; raw: string; rooms: 35 };
  markerProof: ClassicLibraryProof;
}
export async function generateLargeLibraryCorpus(
  count = 100,
): Promise<LargeLibraryCorpus> {
  if (!Number.isInteger(count) || count < 2 || count > 100 || count % 2)
    throw Error('研究库数量必须为2～100的偶数。');
  const roles: CharacterId[] = [
      'isaac',
      'lost',
      'azazel',
      'eden',
      'jacob_esau',
    ],
    difficulties: SurvivalDifficulty[] = [
      'highest',
      'standard',
      'hard',
      'easy',
    ],
    prepared: PreparedReplay[] = [];
  let anchor: LargeLibraryCorpus['anchor'] | undefined,
    markerProof: ClassicLibraryProof | undefined;
  for (let i = 0; i < count; i++) {
    const index = Math.floor(i / 2),
      role = roles[index % roles.length]!;
    let doc: LibraryReplay;
    if (i % 2 === 0) {
      let session = reduceGameSession(createGameSession(42 + index), {
        type: 'start_game',
        characterId: role,
      });
      for (let room = 0; room < 15; room++) {
        session = reduceGameSession(session, {
          type: 'submit_player_turn',
          turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
        });
        session = reduceGameSession(session, { type: 'advance_room' });
      }
      doc = {
        format: 'the-bidding-of-isaac-replay',
        version: 5,
        kind: 'replay',
        mode: 'classic',
        replay: session.replay!,
        exportedAt: new Date(Date.UTC(2026, 9, 14, 8, 0, i)).toISOString(),
        exportedBuild: 'large-library-fixture-v1',
      };
      if (!markerProof)
        markerProof = await classicLibraryProof(doc.replay, librarySha256);
    } else {
      const game = playLongRun(
        index === 0 ? 3 : 20262000 + index,
        role,
        difficulties[index % difficulties.length]!,
      ).game;
      doc = {
        format: 'the-bidding-of-isaac-replay',
        version: 5,
        kind: 'replay',
        mode: 'survival',
        replay: createSurvivalReplay(game),
        exportedAt: new Date(Date.UTC(2026, 9, 14, 8, 0, i)).toISOString(),
        exportedBuild: 'large-library-fixture-v1',
      };
    }
    const raw = replaySource(doc),
      entry = await prepareLibraryReplay(raw);
    entry.entry.savedAt = doc.exportedAt;
    prepared.push(entry);
    if (i === 1) {
      if (doc.mode !== 'survival' || doc.replay.rooms.length !== 35)
        throw Error('35房锚点不再相同，停止研究。');
      anchor = { key: entry.entry.key, raw, rooms: 35 };
    }
  }
  if (
    new Set(prepared.map((p) => p.entry.key)).size !== count ||
    !anchor ||
    !markerProof
  )
    throw Error('研究库身份／锚点无效。');
  return {
    kind: 'large-library-study-corpus-1',
    prepared,
    anchor,
    markerProof,
  };
}
