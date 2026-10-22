import type { AiDoctrine } from '../game/ai-decision';
import type { AiPersonality } from '../game/ai-personality';

/** Ephemeral reference navigation only; never part of a save or replay. */
export type AiGuideTarget =
  | { kind: 'personality'; id: AiPersonality }
  | { kind: 'doctrine'; id: AiDoctrine };
