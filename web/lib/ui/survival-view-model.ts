import { survivalRankingStatus } from '../game/survival-results';
import type { SurvivalReplayLog } from './survival-record';
import { canonicalJson } from '../shared/json-facts';

export function survivalFinalRankingRows(log: SurvivalReplayLog) {
  return (
    log.final?.ranking.map((entry) => ({
      ...entry,
      name: log.playerNames[entry.playerId]!,
      statusLabel: survivalRankingStatus(entry),
    })) ?? []
  );
}
export function survivalReplayFactIdentity(log: SurvivalReplayLog): string {
  const { startedBuild: _build, ...facts } = log;
  return canonicalJson({
    ...facts,
    rooms: facts.rooms.map(({ build: _build, ...room }) => room),
    floors: facts.floors.map(({ build: _build, ...floor }) => floor),
    final: facts.final
      ? (({ build: _build, ...final }) => final)(facts.final)
      : null,
  });
}
export function sameSurvivalReplayResults(
  a: SurvivalReplayLog,
  b: SurvivalReplayLog,
): boolean {
  return (
    a.id === b.id &&
    a.compatibility === b.compatibility &&
    survivalReplayFactIdentity(a) === survivalReplayFactIdentity(b)
  );
}
