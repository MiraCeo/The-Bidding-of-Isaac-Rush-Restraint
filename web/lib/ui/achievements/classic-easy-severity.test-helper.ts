/** Easy-only severity experiment, no production imports or writes. */
import { defaultRules } from '../../game/config';
import { easySeverityPlan as plan } from '../../../scripts/classic-easy-severity-plan.mjs';
import { applyFeasibleMistake } from './classic-feasible-mistake.test-helper';
import {
  applyQuoteMistake,
  runMistakeMatch,
  type MistakeArm,
  type MistakeEvent,
} from './classic-mistake.test-helper';
import type { CharacterId } from '../../game/item-types';
import type { StudyPolicy } from './difficulty-study.test-helper';

export function easySeveritySeed(block: number) {
  if (!Number.isSafeInteger(block) || block < 0 || block >= plan.blocks)
    throw Error('Invalid severity seed block');
  return (0x08010000 + Math.imul(plan.seedStart + block + 1, 104729)) >>> 0;
}
export function runEasySeverityMatch(
  block: number,
  role: CharacterId,
  policy: StudyPolicy,
  arm: MistakeArm,
  witness?: (event: MistakeEvent) => void,
) {
  const feasible = plan.feasibleArms.includes(arm.id);
  const humanLiquidity = {
    rooms: 0,
    zeroEntryRooms: 0,
    earlyZeroAfterRooms: 0,
    bossEntries: 0,
    zeroBossEntries: 0,
    bossCashRatio: 0,
  };
  const row = runMistakeMatch(
    block,
    role,
    policy,
    arm,
    (e) =>
      witness?.(
        feasible
          ? e
          : ({
              ...e,
              requestedKind: e.triggered ? 'quote' : null,
              kind: e.applied ? 'quote' : null,
              fallback: false,
              selection: 'quote-only',
            } as MistakeEvent),
      ),
    easySeveritySeed(block),
    feasible ? applyFeasibleMistake : applyQuoteMistake,
    (record) => {
      const before = record.playersBefore.find((p) => p.id === 'human')!;
      const after = record.players.find((p) => p.id === 'human')!;
      humanLiquidity.rooms++;
      humanLiquidity.zeroEntryRooms += Number(before.money === 0);
      humanLiquidity.earlyZeroAfterRooms += Number(
        record.room.roomIndex < 4 && after.money === 0,
      );
      if (record.room.kind === 'boss') {
        humanLiquidity.bossEntries++;
        humanLiquidity.zeroBossEntries += Number(before.money === 0);
        humanLiquidity.bossCashRatio +=
          before.money /
          defaultRules.floorStartingMoney[record.room.floorIndex]!;
      }
    },
  );
  if (humanLiquidity.rooms !== 15 || humanLiquidity.bossEntries !== 3)
    throw Error('Incomplete human liquidity observation');
  return { ...row, kind: plan.rowKind, humanLiquidity };
}
