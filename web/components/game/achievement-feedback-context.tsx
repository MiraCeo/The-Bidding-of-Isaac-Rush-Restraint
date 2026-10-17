import { createContext, type ReactNode } from 'react';

/** Display slot only. Saved batches remain owned by each mode's persistence. */
export const AchievementFeedbackContext = createContext<ReactNode>(null);
