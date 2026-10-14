import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SurvivalReplayViewer } from '@/components/game/survival-replay-viewer';
import { SurvivalReplayOverview } from '@/components/game/survival-replay-overview';
import { playLongRun } from './survival-long-run';
import {
  serializeSurvivalCheckpoint,
  parseSurvivalCheckpoint,
  serializeSurvivalReplay,
  parseSurvivalReplay,
  saveSurvivalProgress,
} from './survival-persistence';
import { createSurvivalReplay } from './survival-record';
import {
  serializeSurvivalBackup,
  parseSurvivalBackup,
} from './survival-backup';
import { createPlayerProfile } from './player-profile';
import { survivalDraft } from './survival-client';
import {
  survivalReplayDisplayLog,
  survivalReplayTimeline,
  survivalReplayOverview,
} from './survival-replay-display';
const stats = (values: number[]) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    n: values.length,
    medianMs: sorted[Math.floor(sorted.length / 2)]!,
    p95Ms:
      sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!,
    maximumMs: sorted.at(-1)!,
  };
};
function measure(action: () => unknown, n = 7) {
  action();
  const times = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    action();
    times.push(performance.now() - t);
  }
  return stats(times);
}
const bytes = (source: string) => Buffer.byteLength(source, 'utf8');
it.skipIf(process.env.SURVIVAL_LONG_RUN_STUDY !== '1')(
  'measures genuine seven-layer survival persistence and replay workloads',
  () => {
    const tag = process.env.SURVIVAL_LONG_RUN_TAG ?? 'baseline';
    if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Invalid report tag');
    const dir = resolve('work', `survival-long-run-${tag}`);
    mkdirSync(dir, { recursive: true });
    const fixtures = [];
    for (const characterId of ['isaac', 'jacob_esau'] as const) {
      let chosen: ReturnType<typeof playLongRun> | undefined;
      for (let seed = 1; seed <= 120; seed++) {
        const game = playLongRun(seed, characterId);
        if (game.game.roomRecords.length === 35) {
          chosen = game;
          break;
        }
      }
      if (!chosen)
        throw new Error('No genuine official seven-floor fixture found');
      fixtures.push(chosen);
    }
    fixtures.push(playLongRun(42, 'jacob_esau', 'hard', 'pace', true));
    const results = fixtures.map((run) => {
      const { game } = run,
        log = createSurvivalReplay(game),
        checkpoint = serializeSurvivalCheckpoint(game),
        replay = serializeSurvivalReplay(log),
        backup = serializeSurvivalBackup(game, null, createPlayerProfile());
      expect(game.roomRecords).toHaveLength(35);
      expect(parseSurvivalCheckpoint(checkpoint).game).toEqual(game);
      expect(parseSurvivalReplay(replay).replay).toEqual(log);
      expect(parseSurvivalBackup(backup).checkpoint.game).toEqual(game);
      writeFileSync(
        resolve(
          dir,
          `${run.characterId}-${run.structural ? 'structural' : 'official'}-checkpoint.json`,
        ),
        checkpoint,
      );
      writeFileSync(
        resolve(
          dir,
          `${run.characterId}-${run.structural ? 'structural' : 'official'}-replay.json`,
        ),
        replay,
      );
      const values = new Map<string, string>(),
        storage = {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => {
            values.set(key, value);
          },
          removeItem: (key: string) => {
            values.delete(key);
          },
        };
      const draftState = [...run.states]
          .reverse()
          .find(
            (s) =>
              s.phase === 'room_action' && s.activePlayerIds.includes('human'),
          )!,
        draft = survivalDraft(draftState)!;
      const stageSamples = run.states
        .filter(
          (s) =>
            s.phase === 'room_result' &&
            [5, 15, 25, 35].includes(s.roomRecords.length),
        )
        .map((s) => ({
          rooms: s.roomRecords.length,
          checkpointBytes: bytes(serializeSurvivalCheckpoint(s)),
          serialize: measure(() => serializeSurvivalCheckpoint(s)),
          restore: measure(
            () => parseSurvivalCheckpoint(serializeSurvivalCheckpoint(s)),
            3,
          ),
        }));
      const edits = Array.from({ length: 50 }, (_, i) => ({
        ...draft,
        amounts: {
          ...draft.amounts,
          A: {
            ...draft.amounts.A,
            bid: Math.min(draftState.players[0]!.money, 1 + i) || 1,
          },
        },
      }));
      const noop = () => {};
      return {
        seed: run.seed,
        characterId: run.characterId,
        difficulty: run.difficulty,
        policy: run.policy,
        structural: run.structural,
        cutLines: game.cutLines,
        rooms: 35,
        commands: game.commandLog.length,
        participants: game.roomRecords.reduce(
          (n, r) => n + r.activePlayerIds.length,
          0,
        ),
        activeDraftAtRooms: draftState.roomRecords.length,
        bytes: {
          checkpoint: bytes(checkpoint),
          replay: bytes(replay),
          backup: bytes(backup),
        },
        timings: {
          serializeCheckpoint: measure(() => serializeSurvivalCheckpoint(game)),
          restoreCheckpoint: measure(() => parseSurvivalCheckpoint(checkpoint)),
          createReplay: measure(() => createSurvivalReplay(game)),
          serializeReplay: measure(() => serializeSurvivalReplay(log)),
          readReplay: measure(() => parseSurvivalReplay(replay)),
          serializeBackup: measure(() =>
            serializeSurvivalBackup(game, null, createPlayerProfile()),
          ),
          restoreBackup: measure(() => parseSurvivalBackup(backup)),
          saveCompleted: measure(() => saveSurvivalProgress(storage, game)),
          draftBurst50: measure(() => {
            for (const edit of edits)
              saveSurvivalProgress(storage, draftState, edit);
          }, 3),
          timeline: measure(() => survivalReplayTimeline(log)),
          allPlayerOverviews: measure(() => {
            for (const id of Object.keys(log.playerNames))
              survivalReplayOverview(log, id);
          }),
          display: measure(() => survivalReplayDisplayLog(log)),
          renderRoomSSR: measure(
            () =>
              renderToStaticMarkup(
                createElement(SurvivalReplayViewer, { log }),
              ),
            3,
          ),
          renderOverviewSSR: measure(
            () =>
              renderToStaticMarkup(
                createElement(SurvivalReplayOverview, {
                  log,
                  playerId: 'human',
                  index: 34,
                  decimals: 2,
                  onRoom: noop,
                  onPlayer: noop,
                  onReference: noop,
                }),
              ),
            3,
          ),
          submitAiRooms: stats(
            run.steps
              .filter((s) => s.action.type === 'submit_ai_room')
              .map((s) => s.ms),
          ),
        },
        stageSamples,
        specials: {
          doubleTurns: game.roomRecords
            .flatMap((r) => r.turns)
            .filter((t) => t.actions.length === 2).length,
          refunds: game.roomRecords
            .flatMap((r) => r.events)
            .filter((e) => e.type === 'refund').length,
          heartRetroactivity: game.roomRecords
            .flatMap((r) => Object.values(r.roomScoreSummaries))
            .filter((s) => s.retroactiveScore > 0).length,
        },
      };
    });
    writeFileSync(
      resolve(dir, 'report.json'),
      JSON.stringify(
        {
          kind: 'survival-long-run-measurement-1',
          tag,
          createdAt: new Date().toISOString(),
          runtime: process.version,
          measurement:
            'Node timings; in-memory storage excludes real browser disk and React SSR excludes layout/paint. No performance thresholds in CI.',
          results,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify(results, null, 2));
  },
  240000,
);
