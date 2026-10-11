import { defaultRules } from '../game/config';
import { createSeededRandom } from '../game/random';
import { createRuntimePlayer, grantItemInstance } from '../game/runtime';
import { getRuntimeActionAmounts, validateTurn } from '../game/turns';
import {
  settleRuntimeRoom,
  type RoomSettlementResult,
} from '../game/room-engine';
import {
  preparePlayersForRoom,
  type PreparedRoomPlayers,
} from '../game/room-economy';
import type {
  GeneratedRoom,
  ItemId,
  PlayerTurn,
  RuntimePlayerState,
} from '../game/item-types';
import type { RewardGroup } from '../game/types';

export const tutorialSeed = 20261011;
export const tutorialHumanId = 'tutorial-human';
export const tutorialLessons = [
  {
    id: 'bid',
    title: '第一次竞拍',
    task: '选择A或B，调整报价并提交。观察接近基准线与争夺高价的区别。',
    kind: 'bid',
    initial: 25,
  },
  {
    id: 'amounts',
    title: '四种报价数值',
    task: '本例持有Steam大促和完美视力。先用25报价，看看扣款、市场与计分为何不同。',
    kind: 'bid',
    initial: 25,
  },
  {
    id: 'disrupt',
    title: '扰乱与占位',
    task: '先用20扰乱，观察市场影响、得分和奖励轮空。扰乱不是“更强的竞拍”。',
    kind: 'disrupt',
    initial: 20,
  },
  {
    id: 'double',
    title: '双行动与构筑',
    task: '雅阁和以扫同时竞拍A、B。两笔名义报价合计不能超过当前资金的一半。',
    kind: 'bid',
    initial: 25,
  },
  {
    id: 'withdraw',
    title: '观望与换层',
    task: '本例进入第一层最后一房，资金仅剩20，屏障已经消耗。提交观望，再演示换层。',
    kind: 'withdraw',
    initial: 0,
  },
] as const;
export type TutorialPhase =
  | 'quote'
  | 'market'
  | 'rewards'
  | 'score'
  | 'floor'
  | 'complete';
export interface TutorialState {
  lessonIndex: number;
  phase: TutorialPhase;
  group: RewardGroup;
  amounts: Record<RewardGroup, number>;
  result: RoomSettlementResult | null;
  nextFloor: PreparedRoomPlayers | null;
  completed: number[];
}
export type TutorialAction =
  | { type: 'group'; group: RewardGroup }
  | { type: 'amount'; group: RewardGroup; amount: number }
  | { type: 'submit' }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'reset' }
  | { type: 'lesson'; index: number };

export function createTutorialState(
  lessonIndex = 0,
  completed: number[] = [],
): TutorialState {
  const lesson = tutorialLessons[lessonIndex];
  if (!lesson) throw new Error('教学课程不存在。');
  return {
    lessonIndex,
    phase: 'quote',
    group: 'A',
    amounts: { A: lesson.initial, B: lesson.initial },
    result: null,
    nextFloor: null,
    completed,
  };
}
/** Fixed fixtures and a private random stream; never creates or reads a live game. */
export function createTutorialScene(lessonIndex: number) {
  const lesson = tutorialLessons[lessonIndex];
  if (!lesson) throw new Error('教学课程不存在。');
  const human = createRuntimePlayer({
    id: tutorialHumanId,
    isHuman: true,
    money: lesson.id === 'double' ? 120 : lesson.id === 'withdraw' ? 20 : 100,
    score: lesson.id === 'withdraw' ? 123.456 : 0,
  });
  const items: ItemId[] =
    lesson.id === 'amounts'
      ? ['steam_sale', 'twenty_twenty']
      : lesson.id === 'double'
        ? ['more_options', 'more_options_question']
        : lesson.id === 'withdraw'
          ? ['holy_mantle', 'wooden_cross']
          : [];
  items.forEach((itemId, i) =>
    grantItemInstance(human, {
      instanceId: `tutorial-${lessonIndex}-${i}`,
      itemId,
      acquiredOrder: i + 1,
    }),
  );
  if (lesson.id === 'double') human.characterId = 'jacob_esau';
  if (lesson.id === 'withdraw') {
    human.temporaryShields = 0;
    human.persistentShields = 0;
  }
  const opponents = Array.from(
    { length: defaultRules.playerCount - 1 },
    (_, i) =>
      createRuntimePlayer({
        id: `tutorial-${i + 1}`,
        isHuman: false,
        money: 100,
        score: 0,
      }),
  );
  const opponentTurns: PlayerTurn[] = opponents.map((p, i) => ({
    playerId: p.id,
    actions: [
      { type: 'bid', group: i % 2 === 0 ? 'A' : 'B', amount: 10 + (i % 8) * 4 },
    ],
  }));
  const room: GeneratedRoom = {
    floorIndex: 0,
    roomIndex: lesson.id === 'withdraw' ? 4 : 0,
    kind: lesson.id === 'withdraw' ? 'boss' : 'normal',
    rewards: [
      {
        group: 'A',
        itemId: lesson.id === 'withdraw' ? 'pentagram' : 'score_charm',
        hidden: false,
      },
      {
        group: 'B',
        itemId: lesson.id === 'withdraw' ? 'moms_heart' : 'interest',
        hidden: false,
      },
    ],
  };
  return { human, players: [human, ...opponents], opponentTurns, room };
}
export function tutorialTurn(state: TutorialState): PlayerTurn {
  const lesson = tutorialLessons[state.lessonIndex]!;
  if (lesson.kind === 'withdraw')
    return { playerId: tutorialHumanId, actions: [{ type: 'withdraw' }] };
  const groups: RewardGroup[] =
    lesson.id === 'double' ? ['A', 'B'] : [state.group];
  return {
    playerId: tutorialHumanId,
    actions: groups.map((group) => ({
      type: lesson.kind,
      group,
      amount: state.amounts[group],
    })),
  };
}
export function tutorialPreviews(state: TutorialState) {
  const { human } = createTutorialScene(state.lessonIndex);
  return tutorialTurn(state).actions.map((action) => ({
    action,
    ...getRuntimeActionAmounts(human, action, defaultRules),
  }));
}
export function tutorialErrors(state: TutorialState): string[] {
  return validateTurn(
    createTutorialScene(state.lessonIndex).human,
    tutorialTurn(state),
    defaultRules,
  );
}
export function tutorialPlayerName(id: string): string {
  return id === tutorialHumanId
    ? '你（教学玩家）'
    : `预设玩家${id.slice('tutorial-'.length)}`;
}
export function tutorialReducer(
  state: TutorialState,
  action: TutorialAction,
): TutorialState {
  const lesson = tutorialLessons[state.lessonIndex]!;
  if (action.type === 'lesson')
    return Number.isInteger(action.index) && tutorialLessons[action.index]
      ? createTutorialState(action.index, state.completed)
      : state;
  if (action.type === 'reset')
    return createTutorialState(state.lessonIndex, state.completed);
  if (action.type === 'group')
    return state.phase === 'quote' &&
      lesson.kind !== 'withdraw' &&
      lesson.id !== 'double'
      ? { ...state, group: action.group }
      : state;
  if (action.type === 'amount') {
    if (
      state.phase !== 'quote' ||
      lesson.kind === 'withdraw' ||
      !Number.isFinite(action.amount)
    )
      return state;
    const { human } = createTutorialScene(state.lessonIndex);
    const maximum =
      lesson.kind === 'disrupt'
        ? Math.floor(human.money * defaultRules.disruptionMaxMoneyRatio)
        : human.money;
    return {
      ...state,
      amounts: {
        ...state.amounts,
        [action.group]: Math.max(
          1,
          Math.min(maximum, Math.round(action.amount)),
        ),
      },
    };
  }
  if (
    action.type === 'submit' &&
    state.phase === 'quote' &&
    tutorialErrors(state).length === 0
  ) {
    const scene = createTutorialScene(state.lessonIndex);
    const result = settleRuntimeRoom(
      scene.room,
      scene.players,
      [tutorialTurn(state), ...scene.opponentTurns],
      defaultRules,
      createSeededRandom(tutorialSeed + state.lessonIndex),
    );
    return { ...state, phase: 'market', result };
  }
  if (action.type === 'back') {
    const previous: Partial<Record<TutorialPhase, TutorialPhase>> = {
      rewards: 'market',
      score: 'rewards',
      floor: 'score',
    };
    return previous[state.phase]
      ? { ...state, phase: previous[state.phase]! }
      : state;
  }
  if (action.type === 'next') {
    if (state.phase === 'market') return { ...state, phase: 'rewards' };
    if (state.phase === 'rewards') return { ...state, phase: 'score' };
    if (state.phase === 'score' && lesson.id === 'withdraw' && state.result) {
      return {
        ...state,
        phase: 'floor',
        nextFloor: preparePlayersForRoom(
          state.result.players,
          1,
          0,
          defaultRules,
          createSeededRandom(tutorialSeed + 100),
        ),
      };
    }
    if (state.phase === 'score' || state.phase === 'floor') {
      const completed = Array.from(
        new Set([...state.completed, state.lessonIndex]),
      );
      return state.lessonIndex < tutorialLessons.length - 1
        ? createTutorialState(state.lessonIndex + 1, completed)
        : { ...state, phase: 'complete', completed };
    }
  }
  return state;
}
export function tutorialHumanAfter(
  state: TutorialState,
): RuntimePlayerState | undefined {
  return state.result?.players.find((p) => p.id === tutorialHumanId);
}
