import {
  startClientGame,
  getCurrentRoom,
  type ClientRoomSettlementRecord,
} from '../game/client-session';
import { settleRuntimeRoom } from '../game/room-engine';
import { defaultRules } from '../game/config';
import { createSeededRandom } from '../game/random';
import type { PlayerTurn } from '../game/item-types';
/** Synthetic positional fixture; original metrics are produced by the real engine. */
export function publishedMarket(
  roomIndex = 0,
  floorIndex = 0,
  withdraw = false,
): ClientRoomSettlementRecord {
  const game = startClientGame('isaac', 42);
  const turns: PlayerTurn[] = game.players.map((p, i) => ({
    playerId: p.id,
    actions: [
      withdraw
        ? { type: 'withdraw' }
        : i === 0
          ? { type: 'bid', group: 'A', amount: 100 }
          : i === 1
            ? { type: 'disrupt', group: 'A', amount: 30 }
            : i < 8
              ? { type: 'bid', group: 'A', amount: 1 }
              : { type: 'bid', group: 'B', amount: 10 },
    ],
  }));
  const room = { ...getCurrentRoom(game), floorIndex, roomIndex };
  return {
    ...settleRuntimeRoom(
      room,
      game.players,
      turns,
      defaultRules,
      createSeededRandom(7),
    ),
    room,
    turns,
    playersBefore: game.players,
  };
}
