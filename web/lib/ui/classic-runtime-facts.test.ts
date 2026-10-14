import { beforeAll, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {
  adjacentKnifeExplanation,
  preserveKnifeExplanationTails,
  restoreClassicRoomLocator,
} from './classic-runtime-facts';
import { classicCompletionFixture } from './completion-registry.test-helper';
import {
  createGameSession,
  reduceGameSession,
  type GameSession,
} from './game-session';
import {
  parseGameSave,
  serializeGameBackup,
  serializeGameCheckpoint,
} from './game-save';
import { parseReplay, serializeReplay, verifyReplayLog } from './game-replay';
import { createPlayerProfile, recordCompletedMatch } from './player-profile';
import {
  replayRoomLocator,
  canonicalJson,
  type ReplayRoomRecord,
} from './replay-record';
import { withChecksum } from './file-json';
import { classicCompletionKey } from './completion-identity';
import { newLibraryDocument, replayLibraryKey } from './replay-library';
import { packDataFile, unpackDataFile } from './compressed-file';
import * as sessionEngine from './game-session';
const now = new Date('2026-10-14T06:00:00Z');
let full: GameSession;
beforeAll(() => {
  full = classicCompletionFixture();
});
const view = new DataView(new ArrayBuffer(8));
function neighbor(n: number, offset = 1) {
  view.setFloat64(0, n);
  view.setBigUint64(0, view.getBigUint64(0) + BigInt(offset));
  return view.getFloat64(0);
}
function trigger(r: ReplayRoomRecord) {
  return Object.values(r.settlement.scoreBreakdowns)
    .flatMap((b) => b.triggers)
    .find((t) => t.itemId === 'moms_knife' && t.kind === 'additive_score')!;
}
function variant(session: GameSession, offset = 1) {
  const s = structuredClone(session);
  for (const i of [11, 13])
    if (s.replay!.rooms[i]) {
      const r = s.replay!.rooms[i]!,
        t = trigger(r);
      expect(t).toBeDefined();
      t.amount = neighbor(t.amount!, i === 11 ? offset : -offset);
      r.locator = replayRoomLocator(s.replay!, { ...r, locator: undefined });
    }
  if (s.game.phase !== 'character_selection' && s.game.roomSettlement) {
    const last = s.replay!.rooms.at(-1)!;
    // The persisted current settlement is a separate snapshot from the replay.
    s.game.roomSettlement.scoreBreakdowns = structuredClone(
      last.settlement.scoreBreakdowns,
    );
  }
  return s;
}
function atRoom12() {
  let s = reduceGameSession(createGameSession(42), {
    type: 'start_game',
    characterId: 'isaac',
  });
  for (let i = 0; i < 12; i++) {
    s = reduceGameSession(s, {
      type: 'submit_player_turn',
      turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
    });
    if (i < 11) s = reduceGameSession(s, { type: 'advance_room' });
  }
  return s;
}
it('restricts the two observed exp tails to two positive float64 neighbors, not a decimal tolerance', () => {
  expect(adjacentKnifeExplanation(33.684001962443375, 33.68400196244338)).toBe(
    true,
  );
  expect(adjacentKnifeExplanation(16.560544112099052, 16.56054411209905)).toBe(
    true,
  );
  expect(adjacentKnifeExplanation(50, neighbor(50, 2))).toBe(true);
  for (const n of [neighbor(50, 3), 50.000000001, NaN, Infinity, 0, -50])
    expect(adjacentKnifeExplanation(50, n)).toBe(false);
});
it('keeps exact same-runtime checkpoints unchanged with their historical metadata', () => {
  const source = serializeGameCheckpoint(full, now),
    parsed = parseGameSave(source);
  expect(serializeGameCheckpoint(parsed.session, now)).toBe(source);
});
it('recovers both observed legacy room fingerprints and preserves original explanation amounts and locators', () => {
  const changed = variant(full),
    source = serializeGameCheckpoint(changed, now),
    parsed = parseGameSave(source);
  expect(serializeGameCheckpoint(parsed.session, now)).toBe(source);
  expect(parsed.session.replay!.rooms.map((r) => r.locator)).toEqual(
    changed.replay!.rooms.map((r) => r.locator),
  );
  expect(parsed.session.game).toEqual(changed.game);
  expect(classicCompletionKey(parsed.session.replay!)).toBe(
    classicCompletionKey(full.replay!),
  );
});
it('checks and retains a current room_result explanation without modifying scores or continuation', () => {
  const changed = variant(atRoom12()),
    parsed = parseGameSave(serializeGameCheckpoint(changed, now));
  expect(parsed.session.game).toEqual(changed.game);
  let resumed = parsed.session;
  for (let i = 12; i < 15; i++) {
    resumed = reduceGameSession(resumed, { type: 'advance_room' });
    resumed = reduceGameSession(resumed, {
      type: 'submit_player_turn',
      turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
    });
  }
  resumed = reduceGameSession(resumed, { type: 'advance_room' });
  expect(resumed.game).toEqual(full.game);
  expect(classicCompletionKey(resumed.replay!)).toBe(
    classicCompletionKey(full.replay!),
  );
  expect(resumed.replay!.rooms[11]!.locator).toBe(
    changed.replay!.rooms[11]!.locator,
  );
});
it('restores full backup facts verbatim including the profile, raw library key and original provenance', async () => {
  const changed = variant(full),
    p = recordCompletedMatch(
      createPlayerProfile(now),
      changed.replay!,
      'legacy',
      now,
    );
  const source = serializeGameBackup(changed, p, now),
    parsed = parseGameSave(source);
  expect(parsed.session).toEqual(changed);
  expect(parsed.profile).toEqual(p);
  expect(serializeGameBackup(parsed.session, parsed.profile!, now)).toBe(
    source,
  );
  expect(
    await replayLibraryKey(
      newLibraryDocument({ mode: 'classic', replay: parsed.session.replay! }),
    ),
  ).toBe(
    await replayLibraryKey(
      newLibraryDocument({ mode: 'classic', replay: changed.replay! }),
    ),
  );
});
it('uses detached explanation copies and rejects an incoming missing, relabeled or moved trigger', () => {
  const r = full.replay!.rooms[11]!,
    source = canonicalJson(r),
    incoming = structuredClone(r.settlement);
  trigger({ ...r, settlement: incoming }).amount = neighbor(trigger(r).amount!);
  const aligned = preserveKnifeExplanationTails(r.settlement, incoming);
  expect(aligned).toEqual(incoming);
  expect(canonicalJson(r)).toBe(source);
  trigger({ ...r, settlement: incoming }).kind = 'other';
  expect(() => preserveKnifeExplanationTails(r.settlement, incoming)).toThrow();
  expect(() => preserveKnifeExplanationTails(r.settlement, {})).toThrow();
});
it('rejects explanation differences outside the small ULP neighborhood in checkpoints and backups', () => {
  const changed = variant(full, 3);
  expect(() => parseGameSave(serializeGameCheckpoint(changed, now))).toThrow();
  expect(() =>
    parseGameSave(serializeGameBackup(changed, createPlayerProfile(now), now)),
  ).toThrow();
});
it.each(['money', 'score', 'action', 'ai', 'ranking', 'otherTrigger'] as const)(
  'continues rejecting %s changes despite a re-signed outer file and legitimate tail differences',
  (field) => {
    const changed = variant(full),
      doc = JSON.parse(
        serializeGameBackup(changed, createPlayerProfile(now), now),
      );
    if (field === 'money') doc.checkpoint.game.players[0].money++;
    if (field === 'score')
      doc.checkpoint.game.players[0].score = neighbor(
        doc.checkpoint.game.players[0].score || 1,
      );
    if (field === 'action')
      doc.checkpoint.turns[0].actions = [
        { type: 'bid', group: 'A', amount: 1 },
      ];
    if (field === 'ai') doc.checkpoint.game.aiProfiles['ai-1'].name = 'changed';
    if (field === 'ranking') doc.checkpoint.game.finalRanking.reverse();
    if (field === 'otherTrigger') {
      const log = structuredClone(changed.replay!);
      log.rooms[11]!.settlement.scoreBreakdowns['ai-9']!.multiplier = neighbor(
        log.rooms[11]!.settlement.scoreBreakdowns['ai-9']!.multiplier,
      );
      expect(() => verifyReplayLog(log)).toThrow();
      return;
    }
    expect(() => parseGameSave(JSON.stringify(withChecksum(doc)))).toThrow();
  },
);
it('rejects a valid-looking but wrong history fingerprint, including changed source identity', () => {
  const s = variant(full),
    doc = JSON.parse(serializeGameCheckpoint(s, now));
  for (const locator of [
    s.replay!.rooms[11]!.locator!.replace(/#[a-f0-9]{8}$/, '#c01dbabe'),
    s.replay!.rooms[11]!.locator!.replace('F3-R2', 'F3-R3'),
  ]) {
    const copy = structuredClone(doc);
    copy.checkpoint.metadata.rooms[11].locator = locator;
    expect(() => parseGameSave(JSON.stringify(withChecksum(copy)))).toThrow();
  }
});
it('handles multiple simultaneous nearby trigger changes with a unique exact fingerprint', () => {
  const log = structuredClone(full.replay!),
    r = structuredClone(log.rooms[11]!);
  const base = trigger(r).amount!;
  r.settlement.scoreBreakdowns['ai-1']!.triggers.push({
    itemId: 'moms_knife',
    kind: 'additive_score',
    amount: base / 2,
  });
  r.settlement.scoreBreakdowns['ai-2']!.triggers.push({
    itemId: 'moms_knife',
    kind: 'additive_score',
    amount: base / 3,
  });
  r.locator = undefined;
  const different = structuredClone(r);
  for (const b of Object.values(different.settlement.scoreBreakdowns))
    for (const t of b.triggers)
      if (t.itemId === 'moms_knife' && t.amount !== undefined)
        t.amount = neighbor(t.amount, 2);
  const locator = replayRoomLocator(log, different),
    restored = restoreClassicRoomLocator(log, r, locator);
  expect({ ...restored, locator: undefined }).toEqual(different);
});
it('bounds oversized legacy searches and never changes the input or accepts an unchecked locator', () => {
  const log = structuredClone(full.replay!),
    r = structuredClone(log.rooms[11]!);
  for (let i = 0; i < 24; i++)
    r.settlement.scoreBreakdowns['ai-1']!.triggers.push({
      itemId: 'moms_knife',
      kind: 'additive_score',
      amount: 1 + i / 4,
    });
  r.locator = undefined;
  const before = canonicalJson(r);
  expect(() =>
    restoreClassicRoomLocator(log, r, `${log.id}/${r.location}#ffffffff`),
  ).toThrow('上限');
  expect(canonicalJson(r)).toBe(before);
});
it('reads shifted-tail replay files without running the engine or changing recorded values', () => {
  const log = variant(full).replay!,
    source = serializeReplay(log, 'runtime-p0', now);
  const create = vi.spyOn(sessionEngine, 'createGameSession'),
    reduce = vi.spyOn(sessionEngine, 'reduceGameSession');
  try {
    expect(parseReplay(source).replay).toEqual(log);
    expect(create).not.toHaveBeenCalled();
    expect(reduce).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
  }
});
it('preserves raw, compressed and restored final/ongoing checkpoint and backup evidence', async () => {
  const root = resolve('work/classic-runtime-p0');
  await mkdir(root, { recursive: true });
  const report = [];
  for (const [stage, session] of Object.entries({
    complete: full,
    room12: atRoom12(),
  }))
    for (const [origin, s] of Object.entries({
      node: session,
      shifted: variant(session),
    }))
      for (const kind of ['checkpoint', 'backup'] as const) {
        const p = createPlayerProfile(now),
          original =
            kind === 'checkpoint'
              ? serializeGameCheckpoint(s, now)
              : serializeGameBackup(s, p, now),
          packed = await packDataFile(original),
          decoded = (await unpackDataFile(packed.source)).source;
        expect(decoded).toBe(original);
        const parsed = parseGameSave(decoded),
          restored =
            kind === 'checkpoint'
              ? serializeGameCheckpoint(parsed.session, now)
              : serializeGameBackup(parsed.session, parsed.profile!, now);
        expect(restored).toBe(original);
        const name = `${stage}-${origin}-${kind}`;
        for (const [suffix, source] of Object.entries({
          original,
          compressed: packed.source,
          restored,
        }))
          await writeFile(resolve(root, `${name}.${suffix}.json`), source);
        report.push({
          name,
          bytes: packed.originalBytes,
          fileBytes: packed.fileBytes,
          originalSha256: createHash('sha256').update(original).digest('hex'),
          restoredSha256: createHash('sha256').update(restored).digest('hex'),
          sourceExact: true,
          historyLocatorExact: true,
        });
      }
  await writeFile(
    resolve(root, 'report.json'),
    JSON.stringify(
      {
        scope:
          'Node regression with synthetic nearby explanations; actual old Node/Chrome failure retained separately',
        cases: report,
      },
      null,
      2,
    ),
  );
});
