import { calculateSurvivalFloorScore } from '../game/survival-floor';
import {
  settleSurvivalEliminations,
  rankSurvivalFacts,
} from '../game/survival-results';
import {
  survivalPrototypeRules,
  survivalOfficialCutLines,
} from '../game/survival-rules';
import { createSeededRandom } from '../game/random';
export const survivalTutorialLessons = [
  {
    id: 'score',
    title: '生存分与累计分',
    task: '调整房间分、余额和上层S，区分本层S与本层新增积分。',
  },
  {
    id: 'elimination',
    title: '过线也会淘汰',
    task: '比较线下淘汰、末位补淘汰、同分抽签和团灭。',
  },
  {
    id: 'ranking',
    title: '总榜与三种排行',
    task: '先按存活、再按淘汰层、最后累计分排序，不是单纯比最高分。',
  },
  {
    id: 'roles',
    title: '角色与资金规划',
    task: '认识五角色构筑、实际费用与BOSS预留，不额外增加角色收入。',
  },
  {
    id: 'difficulty',
    title: '难度与信息边界',
    task: '难度只改变AI判断，不改变资金、斩杀线、奖励或淘汰公式。',
  },
  {
    id: 'continuation',
    title: '出局、续赛与保存',
    task: '真人出局冻结个人结果，AI继续实际比赛；区分续玩文件与只读回放。',
  },
] as const;
export function survivalTutorialScore(
  roomScore: number,
  money: number,
  previousS: number,
) {
  return calculateSurvivalFloorScore(
    {
      finalRoomScores: [0, 0, 0, 0, roomScore],
      remainingMoney: money,
      previousSurvivalScore: previousS,
    },
    survivalPrototypeRules,
  );
}
export type TutorialEliminationCase =
  | 'passed'
  | 'below'
  | 'tie'
  | 'wipeout'
  | 'six';
export function survivalTutorialElimination(scenario: TutorialEliminationCase) {
  const n = scenario === 'six' ? 8 : 20;
  const participants = Array.from({ length: n }, (_, i) => ({
    playerId: i ? 'ai-' + i : 'human',
    survivalScore:
      scenario === 'wipeout'
        ? 100 + i
        : scenario === 'tie'
          ? 300
          : scenario === 'below' && i < 5
            ? 100 + i * 10
            : 220 + i * 20,
  }));
  const resolution = settleSurvivalEliminations(
    participants,
    survivalOfficialCutLines[0]!,
    survivalPrototypeRules,
    createSeededRandom(20261013),
  );
  return { participants, resolution };
}
export function survivalTutorialRanking() {
  return rankSurvivalFacts(
    [
      {
        playerId: 'survivor',
        eliminationFloorIndex: null,
        finalScore: 600,
        tieBreaker: 0.1,
      },
      {
        playerId: 'late',
        eliminationFloorIndex: 4,
        finalScore: 700,
        tieBreaker: 0.2,
      },
      {
        playerId: 'early-rich',
        eliminationFloorIndex: 0,
        finalScore: 9000,
        tieBreaker: 0.3,
      },
      {
        playerId: 'late-rich',
        eliminationFloorIndex: 4,
        finalScore: 800,
        tieBreaker: 0.4,
      },
    ],
    4,
  );
}
