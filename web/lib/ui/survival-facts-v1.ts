/** Frozen contract of survival-facts-1. Future mechanics need a new encoding/decoder, not edits here. */
export const survivalFactsV1Mechanics = Object.freeze({
  bossRewards: 'standard',
  excludedItems: Object.freeze(['dark_princes_crown']),
  eliminationTiePolicy: 'seeded_cutoff',
  allBelowPolicy: 'eliminate_all_no_champion',
  rankingPolicy: 'survivors_then_elimination_floor_then_score',
  scorePolicy: 'room_scores_plus_cash_without_repeated_inheritance',
});
