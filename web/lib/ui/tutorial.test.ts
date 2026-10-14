import { describe, expect, it, vi } from 'vitest';
import {
  createTutorialScene,
  createTutorialState,
  tutorialReducer,
  tutorialLessons,
  tutorialErrors,
  tutorialPreviews,
  tutorialTurn,
  tutorialHumanId,
  tutorialHumanAfter,
  tutorialSeed,
} from './tutorial';
import { defaultRules } from '../game/config';
import { settleRuntimeRoom } from '../game/room-engine';
import { createSeededRandom } from '../game/random';
import { validateTurn } from '../game/turns';
import * as ai from '../game/ai-decision';

describe('independent fixed-sample tutorial', () => {
  it.each(tutorialLessons.map((_, i) => i))(
    'uses 20 legal participants and the real engine in lesson %s',
    (index) => {
      const state = createTutorialState(index),
        scene = createTutorialScene(index);
      expect(scene.players).toHaveLength(20);
      expect(scene.opponentTurns).toHaveLength(19);
      expect(tutorialErrors(state)).toEqual([]);
      for (const turn of scene.opponentTurns)
        expect(
          validateTurn(
            scene.players.find((p) => p.id === turn.playerId)!,
            turn,
            defaultRules,
          ),
        ).toEqual([]);
      const direct = settleRuntimeRoom(
        scene.room,
        scene.players,
        [tutorialTurn(state), ...scene.opponentTurns],
        defaultRules,
        createSeededRandom(tutorialSeed + index),
      );
      const before = JSON.stringify(scene);
      expect(tutorialReducer(state, { type: 'submit' }).result).toEqual(direct);
      expect(JSON.stringify(scene)).toBe(before);
    },
  );
  it('starts with no results and generates no formal AI decisions', () => {
    const decide = vi.spyOn(ai, 'decideAiTurn');
    const state = createTutorialState();
    expect(state.phase).toBe('quote');
    expect(state.result).toBeNull();
    const settled = tutorialReducer(state, { type: 'submit' });
    expect(settled.phase).toBe('market');
    expect(decide).not.toHaveBeenCalled();
    decide.mockRestore();
  });
  it('shows the actual discounted, market and scoring amounts without inventing points', () => {
    const [preview] = tutorialPreviews(createTutorialState(1));
    expect(preview).toMatchObject({
      actualCost: 18,
      marketEquivalent: 31.25,
      scoringEquivalent: 25,
    });
    expect(preview).not.toHaveProperty('score');
  });
  it('allows both bid targets and clamps only to legal nominal limits', () => {
    let state = tutorialReducer(createTutorialState(), {
      type: 'group',
      group: 'B',
    });
    state = tutorialReducer(state, {
      type: 'amount',
      group: 'B',
      amount: 1000,
    });
    expect(tutorialTurn(state).actions).toEqual([
      { type: 'bid', group: 'B', amount: 100 },
    ]);
    state = tutorialReducer(state, { type: 'amount', group: 'B', amount: -3 });
    expect(state.amounts.B).toBe(1);
    expect(
      tutorialReducer(state, { type: 'amount', group: 'B', amount: NaN }),
    ).toBe(state);
    expect(tutorialReducer(state, { type: 'lesson', index: 6 })).toBe(state);
  });
  it('uses the shared 50% disruption cap and records scoring without awarding vacant rewards', () => {
    const initial = createTutorialState(2);
    expect(tutorialPreviews(initial)[0]).toMatchObject({
      actualCost: 20,
      marketEquivalent: 50,
      scoringEquivalent: 25,
    });
    expect(
      tutorialReducer(initial, { type: 'amount', group: 'A', amount: 99 })
        .amounts.A,
    ).toBe(50);
    const result = tutorialReducer(initial, { type: 'submit' }).result!;
    expect(
      result.highPricePlacements.some((p) => p.playerId === tutorialHumanId),
    ).toBe(true);
    expect(result.awards.filter((a) => a.playerId === tutorialHumanId)).toEqual(
      [],
    );
    expect(
      result.roomScoreSummaries[tutorialHumanId]!.finalScore,
    ).toBeGreaterThan(0);
  });
  it('rejects over-budget double bids and shows two market samples and the real reward destruction', () => {
    let state = createTutorialState(3);
    state = tutorialReducer(state, { type: 'amount', group: 'A', amount: 40 });
    state = tutorialReducer(state, { type: 'amount', group: 'B', amount: 30 });
    expect(tutorialErrors(state)[0]).toContain('50%');
    expect(tutorialReducer(state, { type: 'submit' })).toBe(state);
    const settled = tutorialReducer(createTutorialState(3), { type: 'submit' });
    expect(settled.result!.baseline!.participantCount).toBe(21);
    expect(settled.result!.scoreBreakdowns[tutorialHumanId]!.multiplier).toBe(
      1,
    );
    expect(
      settled.result!.events.filter(
        (e) => e.playerId === tutorialHumanId && e.type === 'destroy',
      ),
    ).toHaveLength(1);
  });
  it('locks submitted amounts and makes repeat submits and stage backtracking deterministic', () => {
    const first = tutorialReducer(createTutorialState(), { type: 'submit' });
    expect(tutorialReducer(first, { type: 'submit' })).toBe(first);
    expect(
      tutorialReducer(first, { type: 'amount', group: 'A', amount: 99 }),
    ).toBe(first);
    expect(tutorialReducer(first, { type: 'back' })).toBe(first);
    const second = tutorialReducer(first, { type: 'next' });
    expect(second.phase).toBe('rewards');
    expect(tutorialReducer(second, { type: 'back' })).toEqual(first);
    expect(
      tutorialReducer(tutorialReducer(first, { type: 'reset' }), {
        type: 'submit',
      }).result,
    ).toEqual(first.result);
  });
  it('preserves score and inventory on withdrawal and demonstrates actual floor reset and shield semantics', () => {
    let state = tutorialReducer(createTutorialState(4), { type: 'submit' });
    const after = tutorialHumanAfter(state)!;
    expect(after.money).toBe(20);
    expect(after.score).toBe(123.456);
    expect(after.items).toHaveLength(2);
    expect(state.result!.roomScoreSummaries[tutorialHumanId]!.finalScore).toBe(
      0,
    );
    for (let i = 0; i < 3; i++)
      state = tutorialReducer(state, { type: 'next' });
    expect(state.phase).toBe('floor');
    const next = state.nextFloor!.players.find(
      (p) => p.id === tutorialHumanId,
    )!;
    expect(next).toMatchObject({
      money: 500,
      score: 123.456,
      temporaryShields: 1,
      persistentShields: 0,
    });
    expect(next.items).toEqual(after.items);
  });
  it('completes all five lessons in order without transferring earnings between fixtures', () => {
    let state = createTutorialState();
    for (let index = 0; index < 5; index++) {
      expect(state.lessonIndex).toBe(index);
      expect(state.result).toBeNull();
      state = tutorialReducer(state, { type: 'submit' });
      for (let i = 0; i < (index === 4 ? 4 : 3); i++)
        state = tutorialReducer(state, { type: 'next' });
    }
    expect(state.phase).toBe('complete');
    expect(state.completed).toEqual([0, 1, 2, 3, 4]);
    expect(createTutorialScene(1).human.items.map((v) => v.itemId)).toEqual([
      'steam_sale',
      'twenty_twenty',
    ]);
  });
  it('does not claim every lesson was completed after jumping directly to the last one', () => {
    let state = tutorialReducer(createTutorialState(4), { type: 'submit' });
    for (let i = 0; i < 4; i++)
      state = tutorialReducer(state, { type: 'next' });
    expect(state.completed).toEqual([4]);
    expect(() => createTutorialState(99)).toThrow();
  });
});
