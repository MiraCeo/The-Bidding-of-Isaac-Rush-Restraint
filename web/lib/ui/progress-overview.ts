import type { CharacterId } from '../game/item-types';
import { classicDifficultyLabel } from '../game/classic-difficulty';
import { survivalDifficultyLabel } from '../game/survival-difficulty';
import type { GameSession } from './game-session';
import type { SurvivalClientSession } from './survival-client';
import type { PlayerProfile } from './player-profile';
import { historyCounters, readCompletionRegistry } from './completion-registry';

export type OverviewMode = 'classic' | 'survival';
export interface OverviewMatch {
  mode: OverviewMode;
  characterId: CharacterId | null;
  state: 'empty' | 'active' | 'complete' | 'ai-running';
  status: string;
  difficulty: string;
  location: string;
  detail: string;
  progress: { value: number; max: number; label: string } | null;
  metrics: Array<{
    label: string;
    value: number | null;
    kind: 'rank' | 'score' | 'count';
  }>;
  action: string;
}

/** Presentation only: never advances a match, writes a profile or ranks history anew. */
export function overviewMatches(
  classic: GameSession,
  survival: SurvivalClientSession | null,
): OverviewMatch[] {
  const c = classic.game,
    s = survival?.game;
  const completedRooms = classic.replay?.rooms.length ?? 0;
  const ownClassic =
    c.phase === 'character_selection'
      ? null
      : c.players.find((p) => p.id === c.humanPlayerId);
  const entry =
    c.phase === 'game_result'
      ? c.finalRanking.find((e) => e.playerId === c.humanPlayerId)
      : undefined;
  const classicModel: OverviewMatch =
    c.phase === 'character_selection'
      ? {
          mode: 'classic',
          characterId: null,
          state: 'empty',
          status: '尚未开始对局',
          difficulty: '开局前选择难度',
          location: '三层 · 十五个房间',
          detail: '选择角色、逐房竞价，完成你的道具构筑。',
          progress: null,
          metrics: [],
          action: '进入经典模式',
        }
      : {
          mode: 'classic',
          characterId: c.selectedCharacter,
          state: c.phase === 'game_result' ? 'complete' : 'active',
          status: c.phase === 'game_result' ? '已结束' : '进行中',
          difficulty: classicDifficultyLabel(c.classicAi?.difficulty, c.classicAi?.policy),
          location: `第 ${c.floorIndex + 1} 层 · 房间 ${c.roomIndex + 1}/5`,
          detail:
            c.phase === 'game_result'
              ? '十五个房间已完成，查看你的最终结果。'
              : '保留当前位置与报价草稿，随时回来继续。',
          progress: {
            value: completedRooms,
            max: 15,
            label: `已结算 ${completedRooms}/15 房`,
          },
          metrics:
            c.phase === 'game_result'
              ? [
                  {
                    label: '最终名次',
                    value: entry
                      ? c.finalRanking.findIndex(
                          (e) => e.playerId === c.humanPlayerId,
                        ) + 1
                      : null,
                    kind: 'rank',
                  },
                  {
                    label: '最终积分',
                    value: entry?.finalScore ?? null,
                    kind: 'score',
                  },
                ]
              : [
                  { label: '已结算房间', value: completedRooms, kind: 'count' },
                  {
                    label: '持有道具',
                    value: ownClassic?.items.length ?? null,
                    kind: 'count',
                  },
                ],
          action: c.phase === 'game_result' ? '查看经典结果' : '继续经典对局',
        };
  if (!s)
    return [
      classicModel,
      {
        mode: 'survival',
        characterId: null,
        state: 'empty',
        status: '尚未开始对局',
        difficulty: '开局前选择难度',
        location: '每层五房 · 逐层淘汰',
        detail: '跨过层末斩杀线，争取存活到最后。',
        progress: null,
        metrics: [],
        action: '进入生存模式',
      },
    ];
  const frozen = s.eliminated[s.humanPlayerId],
    done = s.phase === 'competition_complete';
  const aiRunning = !done && !s.activePlayerIds.includes(s.humanPlayerId);
  const ownSurvival = s.finalRanking.find(
    (e) => e.playerId === s.humanPlayerId,
  );
  const personalFloor = frozen?.floorIndex ?? s.floorIndex;
  const settledInFloor = s.currentFloorRoomScores[s.humanPlayerId]?.length ?? 0;
  return [
    classicModel,
    {
      mode: 'survival',
      characterId: s.selectedCharacter,
      state: done ? 'complete' : aiRunning ? 'ai-running' : 'active',
      status: done ? '已结束' : aiRunning ? 'AI续赛中' : '进行中',
      difficulty: survivalDifficultyLabel(s.aiDifficulty),
      location: frozen
        ? `你在第 ${personalFloor + 1} 层淘汰`
        : `第 ${s.floorIndex + 1} 层 · 房间 ${s.roomIndex + 1}/5`,
      detail: frozen
        ? done
          ? '个人结果已冻结，后续AI续赛不会改写。'
          : `个人结果已冻结，AI正在完成第 ${s.floorIndex + 1} 层。`
        : done
          ? '存活至终局，最终结果已保留。'
          : `当前 ${s.activePlayerIds.length} 人存活 · 层末统一判定。`,
      progress:
        done || frozen
          ? null
          : {
              value: settledInFloor,
              max: s.rules.roomsPerFloor,
              label: `本层已结算 ${settledInFloor}/${s.rules.roomsPerFloor} 房`,
            },
      metrics: done
        ? [
            {
              label: '最终名次',
              value: ownSurvival?.rank ?? null,
              kind: 'rank',
            },
            {
              label: '累计积分',
              value: ownSurvival?.finalScore ?? null,
              kind: 'score',
            },
          ]
        : frozen
          ? [
              { label: '个人淘汰层', value: personalFloor + 1, kind: 'count' },
              {
                label: '个人冻结累计分',
                value: frozen.cumulativeScore,
                kind: 'score',
              },
            ]
          : [
              {
                label: '本局已结算房间',
                value: s.roomRecords.length,
                kind: 'count',
              },
              {
                label: '持有道具',
                value:
                  s.players.find((p) => p.id === s.humanPlayerId)?.items
                    .length ?? null,
                kind: 'count',
              },
            ],
      action: done ? '查看生存结果' : '继续生存对局',
    },
  ];
}

export function overviewProfile(profile: PlayerProfile, message: string) {
  if (message)
    return {
      error: message,
      total: null,
      classic: null,
      survival: null,
      champions: null,
      historyCount: null,
      recent: [],
      scope: '资料暂不可核验',
      note: '原档案保留，未知资料不按零记录展示。',
    };
  try {
    const registry = readCompletionRegistry(profile);
    const groups = registry?.groups ?? historyCounters(profile);
    const count = (mode: OverviewMode) =>
      Object.entries(groups)
        .filter(([key]) => key.startsWith(mode + '/'))
        .reduce((sum, [, c]) => sum + c.completed, 0);
    const classic = count('classic'),
      survival = count('survival');
    return {
      error: '',
      total: classic + survival,
      classic,
      survival,
      champions: Object.values(groups).reduce((sum, c) => sum + c.champions, 0),
      historyCount: profile.history.length,
      recent: [...profile.history]
        .reverse()
        .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
        .slice(0, 3),
      scope: registry ? '统一登记累计' : '已保留历史',
      note: registry
        ? `自${new Date(registry.startedAt).toLocaleDateString('zh-CN')}启用登记；启用前的${registry.baselineHistoryCount}条历史不自动补入累计。`
        : '仅统计档案中保留的历史，不代表终身累计。',
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : '档案摘要暂不可核验。',
      total: null,
      classic: null,
      survival: null,
      champions: null,
      historyCount: null,
      recent: [],
      scope: '资料暂不可核验',
      note: '原档案保留，未知资料不按零记录展示。',
    };
  }
}
