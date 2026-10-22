import { mistakePlan } from './classic-mistake-plan.mjs';
export const decisionMistakePlan: typeof mistakePlan & {
  readonly rowKind: string;
  readonly content: {
    readonly rewardShare: number;
    readonly budgetShare: number;
    readonly quoteShare: number;
    readonly minimumVisibleValueGap: number;
    readonly rewardLossCaps: { mild: number; medium: number };
    readonly budgetLossCaps: { mild: number; medium: number };
    readonly budgetFactors: {
      mild: readonly number[];
      medium: readonly number[];
    };
    readonly budgetMinimumExtraFloorRatio: { mild: number; medium: number };
    readonly budgetMaximumExtraFloorRatio: { mild: number; medium: number };
    readonly budgetMaximumCashRatio: { mild: number; medium: number };
  };
};
