import type {
  ActiveClientGameState,
  ClientRoomSettlementRecord,
} from '../../game/client-session';
import type { SurvivalGameState } from '../../game/survival-session';
import { readRoomNearMissEvidence } from '../../game/room-near-miss-evidence';

/** Observational DTO only. Not a receipt, a migration or permission to grant.
 * Integrating callers must establish fresh authority and version boundaries. */
export interface Revision057RoomFacts {
  cooperativeAwardOpportunities: number;
  missedCooperationActions: number;
  missedHighPriceActions: number;
  lastHighPriceAwardOpportunities: number;
  alternativeAwardOpportunities: number;
  onePathEntirelyVacant: boolean;
  bothPathsEntirelyVacant: boolean;
  lostHolyMantleAward: boolean;
}
export function extractRevision057RoomFacts(
  record: ClientRoomSettlementRecord,
): Revision057RoomFacts | null {
  const human = record.playersBefore.find((p) => p.id === 'human' && p.isHuman);
  if (!human) return null;
  const evidence = readRoomNearMissEvidence(record.scoreBreakdowns);
  if (!evidence)
    throw Error('新成就缺少权威按组落选证据，不按最终库存猜测次数。');
  const actions = record.resolvedActions.filter((a) => a.playerId === human.id);
  const bids = actions.filter((a) => a.action.type === 'bid');
  const awards = record.awards.filter(
    (a) => a.playerId === human.id && a.copies > 0,
  );
  const delivered = (group: string) => awards.some((a) => a.group === group);
  const source = (group: string, kind: string) =>
    record.entitlements.some(
      (e) =>
        e.playerId === human.id &&
        e.group === group &&
        e.sources.includes(kind),
    );
  const count = (groups: Iterable<string>) => new Set(groups).size;
  const bidGroups = new Set(
    bids.map((a) => (a.action.type === 'bid' ? a.action.group : '')),
  );
  const high = (group: string) =>
    record.highPricePlacements.filter((p) => p.group === group);
  const vacancies = (group: 'A' | 'B', type: 'highest' | 'cooperation') => {
    const slots = (
      type === 'highest'
        ? record.highPricePlacements
        : record.cooperationPlacements
    ).filter((p) => p.group === group);
    return (
      slots.length > 0 &&
      slots.every(
        (p) =>
          p.actionType === 'disrupt' &&
          !record.transcendenceRedemptions.some(
            (r) =>
              r.group === group &&
              r.playerId === p.playerId &&
              r.slotType === type,
          ),
      )
    );
  };
  const paths = (['A', 'B'] as const).map((group) => ({
    highest: vacancies(group, 'highest'),
    cooperation: vacancies(group, 'cooperation'),
  }));
  const noQualification = (group: string) =>
    !record.entitlements.some(
      (e) => e.playerId === human.id && e.group === group,
    ) && !delivered(group);
  return {
    cooperativeAwardOpportunities: count(
      awards.filter((a) => source(a.group, 'cooperation')).map((a) => a.group),
    ),
    missedCooperationActions: count(
      evidence
        .filter(
          (e) =>
            e.cooperationLost &&
            bidGroups.has(e.group) &&
            noQualification(e.group),
        )
        .map((e) => e.group),
    ),
    missedHighPriceActions: count(
      evidence
        .filter(
          (e) =>
            e.nextHighPrice &&
            bidGroups.has(e.group) &&
            noQualification(e.group),
        )
        .map((e) => e.group),
    ),
    lastHighPriceAwardOpportunities: count(
      bids
        .filter(
          (a) =>
            a.action.type === 'bid' &&
            high(a.action.group).at(-1)?.playerId === human.id &&
            source(a.action.group, 'highest') &&
            delivered(a.action.group),
        )
        .map((a) => (a.action.type === 'bid' ? a.action.group : '')),
    ),
    alternativeAwardOpportunities: count(
      bids
        .filter((a) => {
          if (a.action.type !== 'bid') return false;
          const group = a.action.group;
          return (
            !high(group).some(
              (p) => p.playerId === human.id && p.actionType === 'bid',
            ) &&
            !source(group, 'highest') &&
            source(group, 'cooperation') &&
            delivered(group) &&
            record.resolvedActions.some(
              (other) =>
                other.playerId !== human.id &&
                other.action.type !== 'withdraw' &&
                other.action.group === group &&
                (other.marketEquivalent ?? 0) > (a.marketEquivalent ?? 0),
            )
          );
        })
        .map((a) => (a.action.type === 'bid' ? a.action.group : '')),
    ),
    onePathEntirelyVacant: paths.some((p) => p.highest || p.cooperation),
    bothPathsEntirelyVacant: paths.some((p) => p.highest && p.cooperation),
    lostHolyMantleAward:
      human.characterId === 'lost' &&
      awards.some((a) => a.itemId === 'holy_mantle'),
  };
}

export interface Revision057CompletionFacts {
  mode: 'classic' | 'survival';
  characterId: ActiveClientGameState['selectedCharacter'];
  finalRank: number;
  champion: boolean;
}
/** Read the existing final order, never sort again or reinterpret a layer score.
 * Classic uses its authoritative ranking-array position (including tie draws);
 * survival uses the existing formal rank, with its own survivor/floor ordering. */
export function extractRevision057CompletionFacts(
  game: ActiveClientGameState | SurvivalGameState,
): Revision057CompletionFacts | null {
  if ('activePlayerIds' in game) {
    if (game.phase !== 'competition_complete') return null;
    const human = game.finalRanking.find((r) => r.playerId === 'human');
    if (
      !human ||
      !Number.isSafeInteger(human.rank) ||
      human.rank < 1 ||
      human.rank > game.finalRanking.length
    )
      throw Error('生存正式终局缺少有效真人排名。');
    return {
      mode: 'survival',
      characterId: game.selectedCharacter,
      finalRank: human.rank,
      champion: game.championId === 'human',
    };
  }
  if (game.phase !== 'game_result') return null;
  const index = game.finalRanking.findIndex(
    (r) => r.playerId === game.humanPlayerId,
  );
  if (index < 0) throw Error('经典正式终局缺少真人排名。');
  return {
    mode: 'classic',
    characterId: game.selectedCharacter,
    finalRank: index + 1,
    champion: !game.finalRanking.some(
      (r) => r.finalScore > game.finalRanking[index]!.finalScore,
    ),
  };
}
