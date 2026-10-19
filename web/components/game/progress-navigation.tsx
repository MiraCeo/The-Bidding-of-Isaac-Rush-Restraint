import { createContext, useContext } from 'react';
import type { RoomUtilityPanel } from './room-utilities';
import type { AiGuideTarget } from '@/lib/ui/ai-guide-target';

/** Shared UI navigation only. Authoritative match state stays in its existing owner. */
export const ProgressNavigationContext = createContext<{
  openProgress: () => void;
  replayReturnToProgress: boolean;
  pendingPage: RoomUtilityPanel | null | undefined;
  consumePage: () => void;
  aiGuideTarget?: AiGuideTarget;
  openAiGuide?: (target: AiGuideTarget) => void;
  consumeAiGuideTarget?: () => void;
} | null>(null);
export const useProgressNavigation = () =>
  useContext(ProgressNavigationContext);
