export const mistakePlan: {
  readonly rowKind?: string;
  readonly blocks: number;
  readonly roles: readonly ['isaac', 'lost', 'azazel', 'eden', 'jacob_esau'];
  readonly policies: readonly ['pace', 'public-ai', 'explore'];
  readonly seedStart: number;
  readonly arms: readonly {
    id: string;
    base: 'original' | 'easy' | 'standard' | 'hard' | 'highest';
    rate: number;
    mediumShare: number;
  }[];
  readonly mildFactors: readonly number[];
  readonly mediumFactors: readonly number[];
  readonly mildMaximumModelLoss: number;
  readonly mediumMaximumModelLoss: number;
  readonly primaryPolicies: readonly string[];
  readonly primaryPairs: readonly (readonly [string, string])[];
  readonly bootstrapResamples: number;
  readonly familywiseAlpha: number;
};
