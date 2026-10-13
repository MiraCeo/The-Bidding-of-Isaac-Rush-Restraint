import {
  useEffect,
  useState,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { Button } from '@/components/ui/button';
import { CharacterSelection } from './character-selection';
import { RoomPrototype } from './room-prototype';
import { RoomResult } from './room-result';
import { RoomRanking } from './room-ranking';
import { SurvivalScoreBoard } from './survival-score-board';
import { currentSurvivalBoard } from '@/lib/ui/survival-board';
import type { ClientRankingView } from '@/lib/game/client-session';
import { GameNavigation } from './game-navigation';
import { GameSettings, type PreferenceSaveStatus } from './game-settings';
import { GameTutorial } from './game-tutorial';
import type { RoomUtilityPanel } from './room-utilities';
import { ItemArtProvider, ItemIcon } from './item-icon';
import {
  SurvivalFloorFacts,
  SurvivalTotalBoard,
  SurvivalReplayViewer,
} from './survival-replay-viewer';
import { SurvivalDataManagement } from './survival-data-management';
import {
  reduceSurvivalClient,
  survivalRoomView,
  survivalRoomRules,
  type SurvivalClientSession,
} from '@/lib/ui/survival-client';
import type { CharacterId, PlayerTurn } from '@/lib/game/item-types';
import type { SurvivalGameAction } from '@/lib/game/survival-session';
import { createSurvivalReplay } from '@/lib/ui/survival-record';
import {
  persistSurvivalCheckpoint,
  type SurvivalReplayDocument,
} from '@/lib/ui/survival-persistence';
import {
  getPreferenceStorage,
  type GamePreferences,
} from '@/lib/ui/game-preferences';
import { getBuildSummary } from '@/lib/ui/player-build';
import { survivalItemCatalog } from '@/lib/game/survival-content';
import { survivalOfficialCutLines } from '@/lib/game/survival-rules';
import {
  survivalDifficultyLabel,
  type SurvivalDifficulty,
} from '@/lib/game/survival-difficulty';
import { itemPresentations } from '@/lib/game/item-presentation';
import { loadPlayerProfile } from '@/lib/ui/game-save';
import { playerProfileKey } from '@/lib/ui/player-profile';
import {
  survivalCompletionKey,
  recordSurvivalCompletedMatch,
} from '@/lib/ui/survival-profile';
import type { ModeDataCandidate } from '@/lib/ui/mode-data';

export interface SurvivalGameAppProps {
  selectedDifficulty: SurvivalDifficulty;
  onDifficultyChange: (difficulty: SurvivalDifficulty) => void;
  inactive: boolean;
  session: SurvivalClientSession | null;
  setSession: Dispatch<SetStateAction<SurvivalClientSession | null>>;
  onStart: (character: CharacterId) => void;
  onReturnMenu: () => void;
  onNew: () => void;
  preferences: GamePreferences;
  status: PreferenceSaveStatus;
  onPreferencesChange: (next: GamePreferences) => void;
  imported: SurvivalReplayDocument | null;
  onReplay: (doc: SurvivalReplayDocument | null) => void;
  onImport: (candidate: ModeDataCandidate, profile: boolean) => void;
  restoreMessage?: string;
}
export function SurvivalGameApp(props: SurvivalGameAppProps) {
  const { session, preferences, setSession } = props;
  const game = session?.game;
  const [panel, setPanel] = useState<RoomUtilityPanel | null>(null);
  const [rankingView, setRankingView] = useState<
    'survival' | ClientRankingView
  >('survival');
  const [message, setMessage] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [restart, setRestart] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const dispatch = (action: SurvivalGameAction) => {
    try {
      if (!session) return;
      const next = reduceSurvivalClient(session, action);
      setSession((current) => (current === session ? next : current));
      if (action.type === 'advance_room' || action.type === 'advance_floor') {
        setPanel(null);
        setRankingView('survival');
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '结算未完成，当前对局已保留。',
      );
    }
  };
  useEffect(() => {
    let cancelled = false;
    if (props.imported)
      queueMicrotask(() => {
        if (!cancelled) setPanel('replay');
      });
    return () => {
      cancelled = true;
    };
  }, [props.imported]);
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const saved = persistSurvivalCheckpoint(
      getPreferenceStorage(),
      session.game,
      session.draft,
    );
    queueMicrotask(() => {
      if (!cancelled)
        setSaveStatus(
          saved
            ? '生存检查点已保存'
            : '存储不可用，当前仅在本页运行，请导出存档。',
        );
    });
    return () => {
      cancelled = true;
    };
  }, [session]);
  useEffect(() => {
    if (
      !session ||
      session.game.activePlayerIds.includes('human') ||
      session.game.phase === 'competition_complete' ||
      message
    )
      return;
    const token = window.setTimeout(() => {
      try {
        const phase = session.game.phase;
        const next = reduceSurvivalClient(session, {
          type:
            phase === 'room_action'
              ? 'submit_ai_room'
              : phase === 'room_result'
                ? 'advance_room'
                : 'advance_floor',
        });
        setSession((current) => (current === session ? next : current));
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : 'AI续跑暂停，原对局已保留。',
        );
      }
    }, 25);
    return () => window.clearTimeout(token);
  }, [session, setSession, message]);
  useEffect(() => {
    if (!game || game.phase !== 'competition_complete') return;
    let cancelled = false;
    const log = createSurvivalReplay(game);
    void survivalCompletionKey(log)
      .then((key) => {
        if (cancelled) return;
        const storage = getPreferenceStorage();
        const loaded = loadPlayerProfile(storage);
        if (loaded.message) throw new Error(loaded.message);
        const next = recordSurvivalCompletedMatch(loaded.profile, log, key);
        if (next === loaded.profile) return;
        if (!storage) throw new Error('玩家进度存储不可用。');
        storage.setItem(playerProfileKey, JSON.stringify(next));
        setProfileMessage('生存结果已登记，重复载入不会重复计局。');
      })
      .catch((error) => {
        if (!cancelled)
          setProfileMessage(
            error instanceof Error ? error.message : '玩家进度未写入。',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [game]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && panel) {
        event.preventDefault();
        setPanel(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [panel]);
  const log = game ? createSurvivalReplay(game) : null;
  const decimals = preferences.scoreDecimals;
  const name = (id: string) =>
    id === 'human' ? '你' : (game?.aiProfiles[id]?.name ?? id);
  function utilities(
    selected: RoomUtilityPanel | null,
    _turn?: PlayerTurn,
    onReturn?: () => void,
  ): ReactNode {
    if (!selected) return null;
    const close = () => {
      onReturn?.();
      setPanel(null);
    };
    if (selected === 'settings')
      return (
        <GameSettings
          preferences={preferences}
          saveStatus={props.status}
          onChange={props.onPreferencesChange}
          beforeGame={!game}
          onReturnGame={close}
          customData={
            <SurvivalDataManagement
              session={session}
              imported={props.imported}
              onImport={props.onImport}
              onReplay={props.onReplay}
            />
          }
        />
      );
    let content: ReactNode;
    if (selected === 'tutorial') content = <GameTutorial />;
    else if (selected === 'replay')
      content = (
        <>
          <div className="data-actions">
            {log && (
              <Button variant="secondary" onClick={() => props.onReplay(null)}>
                本局记录
              </Button>
            )}
          </div>
          {(props.imported?.replay ?? log) ? (
            <SurvivalReplayViewer
              key={props.imported ? props.imported.exportedAt : 'current'}
              log={(props.imported?.replay ?? log)!}
              decimals={decimals}
            />
          ) : (
            <p>暂无回放。从设置读取生存 v4 文件，或完成一个房间。</p>
          )}
        </>
      );
    else if (selected === 'build' && game) {
      const summary = getBuildSummary(
        survivalRoomView(game, true),
        survivalRoomRules(game),
      );
      content = (
        <>
          <h2>构筑与当前状态</h2>
          <p>
            临时屏障 {summary.temporaryShields} · 持久屏障{' '}
            {summary.persistentShields} · 道具 {summary.itemCount}
          </p>
          {summary.effects
            .filter((effect) => effect.label !== '终局王冠倍率')
            .map((effect) => (
              <p key={effect.label}>
                <b>
                  {effect.label} {effect.value}
                </b>{' '}
                · {effect.note}
              </p>
            ))}
          <div className="survival-items">
            {summary.inventory.map(({ item, count }) => (
              <article key={item.id}>
                <ItemIcon itemId={item.id} />
                <b>
                  {item.name} ×{count}
                </b>
                <p>{itemPresentations[item.id].description}</p>
              </article>
            ))}
          </div>
        </>
      );
    } else if (selected === 'ranking' && game) {
      const available = game.roomSettlement !== null;
      const view = available ? rankingView : 'survival';
      content = (
        <>
          <div
            className="ranking-view-tabs survival-ranking-tabs"
            role="tablist"
            aria-label="生存排行类型"
          >
            {(['score', 'contest', 'survival'] as const).map((tab) => (
              <button
                key={tab}
                role="tab"
                type="button"
                aria-selected={view === tab}
                disabled={tab !== 'survival' && !available}
                className={view === tab ? 'ranking-view-tab-active' : ''}
                onClick={() => setRankingView(tab)}
              >
                {tab === 'score'
                  ? '积分排行'
                  : tab === 'contest'
                    ? '争夺榜'
                    : '生存榜'}
              </button>
            ))}
          </div>
          {view === 'survival' ? (
            <SurvivalScoreBoard
              model={currentSurvivalBoard(game)}
              decimals={decimals}
            />
          ) : (
            <RoomRanking
              embedded
              hideViewTabs
              hideFooter
              finalRoom={false}
              game={{ ...survivalRoomView(game), roomRankingView: view }}
              onSwitch={setRankingView}
              onAdvance={() => dispatch({ type: 'advance_room' })}
              scoreDecimals={decimals}
              scoreDescription="已结算房间积分排行，展示本房行动、得分与道具；总分不含层末余额兑换和继承，分层累计请查看生存榜。"
            />
          )}
          {game.phase === 'room_result' &&
            game.activePlayerIds.includes('human') && (
              <footer className="result-actions ranking-actions survival-ranking-actions">
                <p>查看榜单不会重复结算或提交行动。</p>
                <Button
                  size="lg"
                  onClick={() => dispatch({ type: 'advance_room' })}
                >
                  {game.roomIndex === 4 ? '查看层末结算' : '进入下一房间'}
                </Button>
              </footer>
            )}
        </>
      );
    } else if (selected === 'rules')
      content = (
        <>
          <h2>生存模式规则</h2>
          <p>
            20人开局，每层5房，第5房为BOSS。每层基础资金重置为1000，再应用角色与道具效果。正式斩杀线为
            {survivalOfficialCutLines.join('／')}。
          </p>
          <p>
            层末：S = R ＋ 0.1 × 剩余资金 ＋ 0.2 × 上层S。累计积分只加 R
            与资金兑换；继承分不重复计入，也不再次乘道具倍率。
          </p>
          <p>
            线下全部淘汰。若不足两人，再从达标者末位补足；末位同分按种子抽签。剩余人数≤6时结算；全部线下则团灭，无冠军。
          </p>
          <p>
            总榜：存活者在前；淘汰者按淘汰层数降序，再按累计积分降序。同层同分抽签，保留事实记录。
          </p>
          <p>
            玩家提前淘汰后冻结，AI自动完成剩余比赛。每层BOSS使用普通奖励池，保留心脏对BOSS分数的追溯机制，不使用经典第三层双心脏规则。
          </p>
          <p>
            生存模式暂不提供黑王子之冠，伊甸开局也不抽取。积分存储保留4位，显示偏好不改变淘汰判定。
          </p>
          <p>
            生存AI分简单、标准、困难、最高四档；默认标准。最高保留0.3.1原设置，其他档逐级减弱判断和报价精度，基本资金规划与合法性不变。开局后难度锁定，存档和回放保留本局难度。
          </p>
          <details>
            <summary>生存道具池 · 25件</summary>
            <div className="survival-items">
              {survivalItemCatalog.map((item) => (
                <article key={item.id}>
                  <ItemIcon itemId={item.id} />
                  <b>{item.name}</b>
                  <p>{itemPresentations[item.id].description}</p>
                </article>
              ))}
            </div>
          </details>
        </>
      );
    else content = <p>开始生存对局后可查看此页。</p>;
    return (
      <section
        id="room-utilities-title"
        tabIndex={-1}
        className="ranking-stage game-tools-stage survival-utility"
      >
        <Button variant="secondary" onClick={close}>
          返回游戏
        </Button>
        {content}
      </section>
    );
  }
  const human = game?.players.find((p) => p.id === 'human');
  const lastHumanScore = game?.floorRecords.at(-1)?.scores.human;
  const completedLayer =
    game?.phase === 'floor_result' || game?.phase === 'competition_complete';
  const strip = game && (
    <section className="survival-status" aria-label="生存进度">
      <b>
        生存 · 第 {game.floorIndex + 1} 层 · {game.activePlayerIds.length} 人
      </b>
      <span>难度 {survivalDifficultyLabel(game.aiDifficulty)}</span>
      <span>斩杀线 {game.cutLines[game.floorIndex]}</span>
      <span>资金 {human?.money}</span>
      <span>
        {game.humanEliminatedAt !== null ? '淘汰层房间分' : '本层房间分'}{' '}
        {(game.humanEliminatedAt !== null
          ? game.eliminated.human!.score.roomScore
          : (game.currentFloorRoomScores.human ?? []).reduce(
              (sum, value) => sum + value,
              0,
            )
        ).toFixed(decimals)}
      </span>
      <span>
        {completedLayer ? '结算继承' : '上层继承'}{' '}
        {(game.humanEliminatedAt !== null
          ? game.eliminated.human!.score.inheritedScore
          : completedLayer
            ? (lastHumanScore?.inheritedScore ?? 0)
            : (game.previousSurvivalScores.human ?? 0) * 0.2
        ).toFixed(decimals)}
      </span>
      <span>
        {game.humanEliminatedAt !== null ? '淘汰层兑换' : '当前余额可兑'}{' '}
        {((human?.money ?? 0) * 0.1).toFixed(decimals)}
        {game.humanEliminatedAt === null && !completedLayer
          ? '（层末为准）'
          : ''}
      </span>
      <Button variant="secondary" onClick={props.onReturnMenu}>
        返回主菜单
      </Button>
      {game.phase === 'room_action' && session?.draft && (
        <Button variant="secondary" onClick={() => setRestart(true)}>
          重新选角
        </Button>
      )}
    </section>
  );
  let page: ReactNode;
  if (!session)
    page = (
      <CharacterSelection
        aiDifficulty={props.selectedDifficulty}
        onDifficultyChange={props.onDifficultyChange}
        mode="survival"
        onStart={props.onStart}
        onReturnMenu={props.onReturnMenu}
        preferences={preferences}
        preferenceSaveStatus={props.status}
        onPreferencesChange={props.onPreferencesChange}
        renderUtilities={(selected, onReturn) =>
          utilities(selected, undefined, onReturn)
        }
      />
    );
  else if (game!.phase === 'room_action' && session.draft)
    page = (
      <RoomPrototype
        key={`${game!.seed}:${game!.floorIndex}:${game!.roomIndex}`}
        game={survivalRoomView(game!)}
        rules={survivalRoomRules(game!)}
        draft={session.draft}
        onDraftChange={(update) =>
          setSession((current) =>
            current?.draft
              ? { ...current, draft: update(current.draft) }
              : current,
          )
        }
        onSubmit={(turn) => dispatch({ type: 'submit_player_turn', turn })}
        preferences={preferences}
        preferenceSaveStatus={props.status}
        onPreferencesChange={props.onPreferencesChange}
        extraStatus={strip}
        renderUtilities={utilities}
      />
    );
  else {
    let body: ReactNode;
    if (game!.phase === 'competition_complete')
      body = (
        <>
          <p className="eyebrow">SURVIVAL COMPLETE</p>
          <h2>
            {game!.championId
              ? `${name(game!.championId)}获得生存榜首`
              : '团灭 · 无冠军'}
          </h2>
          <p>
            你的名次：第{' '}
            {
              game!.finalRanking.find((entry) => entry.playerId === 'human')!
                .rank
            }{' '}
            名 ·{' '}
            {game!.humanEliminatedAt === null
              ? '存活'
              : `第 ${game!.humanEliminatedAt + 1} 层淘汰`}
          </p>
          <SurvivalTotalBoard log={log!} decimals={decimals} />
          <p>{profileMessage}</p>
          <Button onClick={props.onNew}>再来一局生存</Button>
        </>
      );
    else if (game!.humanEliminatedAt !== null)
      body = (
        <div aria-live="polite">
          <h2>你已在第 {game!.humanEliminatedAt + 1} 层淘汰</h2>
          <p>个人结果已冻结，AI正在自动完成整局。</p>
          <p>
            目前：第 {game!.floorIndex + 1} 层 · 房间 {game!.roomIndex + 1}/5 ·
            已结算 {game!.roomRecords.length} 房
          </p>
        </div>
      );
    else if (game!.phase === 'floor_result')
      body = (
        <>
          <p className="eyebrow">FLOOR SETTLEMENT</p>
          <h2>层末生存结算</h2>
          <SurvivalFloorFacts
            log={log!}
            index={game!.floorRecords.length - 1}
            decimals={decimals}
          />
          <Button onClick={() => dispatch({ type: 'advance_floor' })}>
            {game!.floorRecords.at(-1)!.plan.shouldFinish
              ? '查看生存总榜'
              : '进入下一层'}
          </Button>
        </>
      );
    else
      body = (
        <RoomResult
          embedded
          game={survivalRoomView(game!)}
          rules={survivalRoomRules(game!)}
          finalRoom={false}
          advanceLabel={game!.roomIndex === 4 ? '查看层末结算' : '进入下一房间'}
          onAdvance={() => dispatch({ type: 'advance_room' })}
          onShowRanking={(view) => {
            setRankingView(view);
            setPanel('ranking');
          }}
          scoreDecimals={decimals}
        />
      );
    page = (
      <main className="ranking-page">
        <header className="topbar">
          <div className="topbar-inner">
            <div className="brand-block">
              <p className="eyebrow">SURVIVAL</p>
              <h1>以撒的竞合 · 生存</h1>
            </div>
            <GameNavigation
              page={panel}
              onPageChange={(next) => {
                if (next === 'ranking') setRankingView('survival');
                setPanel(next);
              }}
            />
          </div>
        </header>
        {strip}
        <div className="survival-tools">
          <Button variant="secondary" onClick={() => setPanel('build')}>
            构筑与当前状态
          </Button>
          <Button variant="secondary" onClick={() => setPanel('replay')}>
            生存回放
          </Button>
          {game!.phase !== 'competition_complete' && (
            <Button variant="secondary" onClick={() => setRestart(true)}>
              重新选角
            </Button>
          )}
        </div>
        <section
          className="ranking-stage survival-stage"
          hidden={panel !== null}
          inert={panel !== null}
        >
          {body}
        </section>
        {utilities(panel)}
      </main>
    );
  }
  if (props.imported && panel === 'replay')
    page = (
      <main className="ranking-page">
        <header className="topbar">
          <div className="topbar-inner">
            <h1>生存只读回放</h1>
            <Button
              variant="secondary"
              onClick={() => {
                setPanel(null);
                props.onReplay(null);
              }}
            >
              返回生存对局
            </Button>
            <Button variant="secondary" onClick={props.onReturnMenu}>
              返回主菜单
            </Button>
          </div>
        </header>
        {utilities('replay')}
      </main>
    );
  if (props.inactive) return null;
  return (
    <ItemArtProvider>
      <div
        className="game-client"
        data-reduce-motion={preferences.reduceMotion}
      >
        {page}
        <output className="survival-save-message">
          {message || props.restoreMessage || saveStatus}
        </output>
        {message && game?.humanEliminatedAt !== null && (
          <Button onClick={() => setMessage('')}>重试AI续跑</Button>
        )}
        {restart && (
          <dialog
            open
            aria-modal="true"
            aria-label="重新开始生存对局"
            className="survival-confirm"
          >
            <h2>放弃当前生存对局并重新选角？</h2>
            <p>不会删除经典存档、玩家进度与已导出的文件。</p>
            <Button
              onClick={() => {
                setRestart(false);
                setPanel(null);
                props.onNew();
              }}
            >
              确认重新选角
            </Button>
            <Button variant="secondary" onClick={() => setRestart(false)}>
              取消
            </Button>
          </dialog>
        )}
      </div>
    </ItemArtProvider>
  );
}
