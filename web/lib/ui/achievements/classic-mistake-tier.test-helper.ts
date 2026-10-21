/** Second isolated trial. Original quote-lapse implementation and strength unchanged. */
import { mistakeTierPlan } from '../../../scripts/classic-mistake-tier-plan.mjs';
import type { CharacterId } from '../../game/item-types';
import type { StudyPolicy } from './difficulty-study.test-helper';
import {
  runMistakeMatch,
  type MistakeArm,
  type MistakeEvent,
} from './classic-mistake.test-helper';

export function mistakeTierSeed(block: number) {
  if (
    !Number.isSafeInteger(block) ||
    block < 0 ||
    block >= mistakeTierPlan.blocks
  )
    throw Error('Invalid tier mistake seed block');
  return (
    (0x08010000 + Math.imul(mistakeTierPlan.seedStart + block + 1, 104729)) >>>
    0
  );
}
export function runMistakeTierMatch(
  block: number,
  role: CharacterId,
  policy: StudyPolicy,
  arm: MistakeArm,
  witness?: (event: MistakeEvent) => void,
) {
  return runMistakeMatch(
    block,
    role,
    policy,
    arm,
    witness,
    mistakeTierSeed(block),
  );
}
