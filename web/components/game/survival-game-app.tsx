import { GameRules } from './game-rules';
import { AchievementFeedbackContext } from './achievement-feedback-context';
import { AchievementNotice } from './achievement-notice';
import { UtilityPageHeading } from './utility-page-heading';
import { ArrowLeft } from 'lucide-react';
import { GameHeader } from './game-header';
import {
  useEffect,
  useMemo,
  useRef,
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
import { SurvivalActionStatus } from './survival-action-status';
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
import { useUtilityPages } from './use-utility-pages';
import { useLivePersistence, currentGrowthEpoch } from './use-live-persistence';
import { mergeSavedGrowth } from '@/lib/ui/achievements/client-persistence';
import {
  beginSurvivalGrowth,
  bindGrowthEpoch,
  survivalGrowthOrder,
} from '@/lib/ui/achievements/lifecycle';
import {
  reduceSurvivalClient,
  survivalRoomView,
  survivalRoomRules,
  type SurvivalClientSession,
} from '@/lib/ui/survival-client';
import type { CharacterId, PlayerTurn } from '@/lib/game/item-types';
import type { SurvivalGameAction } from '@/lib/game/survival-session';
import { createSurvivalReplay } from '@/lib/ui/survival-record';
import { type SurvivalReplayDocument } from '@/lib/ui/survival-persistence';
import { type GamePreferences } from '@/lib/ui/game-preferences';
import { getBuildSummary } from '@/lib/ui/player-build';
import { survivalItemCatalog } from '@/lib/game/survival-content';
import { survivalOfficialCutLines } from '@/lib/game/survival-rules';
import {
  survivalDifficultyLabel,
  type SurvivalDifficulty,
} from '@/lib/game/survival-difficulty';
import { itemPresentations } from '@/lib/game/item-presentation';
import type { ModeDataCandidate } from '@/lib/ui/mode-data';

export interface SurvivalGameAppProps {
  persistenceRevision?: number;
  persistenceSource?: { source: string | null };
  onSaveStatusChange?: (message: string) => void;
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
  onReturnImported?: () => void;
  importedReturnLabel?: string;
  onImport: (
    candidate: ModeDataCandidate,
    profile: boolean,
    expectedProfileSource?: string | null,
    signal?: AbortSignal,
  ) => void | Promise<void>;
  restoreMessage?: string;
}
export function SurvivalGameApp(props: SurvivalGameAppProps) {
  const [selectedCharacter, setSelectedCharacter] =
    useState<CharacterId | null>(null);
  const { session, preferences, setSession, onSaveStatusChange } = props;
  const game = session?.game;
  const observedIncomplete = useRef(
    game !== undefined && game.phase !== 'competition_complete',
  );
  const log = useMemo(() => (game ? createSurvivalReplay(game) : null), [game]);
  const liveSave = useLivePersistence({
    mode: 'survival',
    session,
    initialSource: props.persistenceSource,
    revision: props.persistenceRevision ?? 0,
    origin: () => (observedIncomplete.current ? 'live' : 'restored'),
    survivalLog: log,
    onAcknowledged: (snapshot, context) =>
      setSession((current) => {
        if (!current?.growth || !snapshot.growth) return current;
        const growth = mergeSavedGrowth(
          current.growth,
          snapshot.growth,
          context,
        );
        return growth === current.growth ? current : { ...current, growth };
      }),
  });
  const { utilityPanel: panel, changeUtilityPanel: setPanel } = useUtilityPages(
    !props.inactive,
  );
  const [rankingView, setRankingView] = useState<
    'survival' | ClientRankingView
  >('survival');
  const [message, setMessage] = useState('');
  const saveStatus =
    liveSave.message ||
    (liveSave.saved ? '生存进度已自动保存。' : '生存进度待保存。');
  const [restart, setRestart] = useState(false);
  const profileMessage =
    liveSave.saved && !liveSave.message
      ? '生存结果已登记，重复载入不会重复计局。'
      : '';
  const [teachingOpen, setTeachingOpen] = useState(false);
  const dispatch = (action: SurvivalGameAction) => {
    try {
      if (!session) return;
      let source = session.growth
        ? session
        : beginSurvivalGrowth(session, survivalGrowthOrder(session.game));
      const epoch = currentGrowthEpoch();
      if (source.growth && epoch !== undefined)
        source = { ...source, growth: bindGrowthEpoch(source.growth, epoch) };
      const next = reduceSurvivalClient(source, action);
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
  }, [props.imported, setPanel]);
  useEffect(() => {
    onSaveStatusChange?.(saveStatus);
  }, [saveStatus, onSaveStatusChange]);
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
        let source = session.growth
          ? session
          : beginSurvivalGrowth(session, survivalGrowthOrder(session.game));
        const epoch = currentGrowthEpoch();
        if (source.growth && epoch !== undefined)
          source = { ...source, growth: bindGrowthEpoch(source.growth, epoch) };
        const next = reduceSurvivalClient(source, {
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
    if (!game) return;
    if (game.phase !== 'competition_complete')
      observedIncomplete.current = true;
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
  }, [panel, setPanel]);
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
        />
      );
    const roomRanking =
      selected === 'ranking' &&
      game?.roomSettlement &&
      rankingView !== 'survival'
        ? rankingView
        : null;
    let content: ReactNode;
    if (selected === 'tutorial')
      content = <GameTutorial mode="survival" scoreDecimals={decimals} />;
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
            <p>暂无回放。从进度读取当前v5文件，或完成一个房间。</p>
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
              hideHeading
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
        <GameRules
          mode="survival"
          catalog={survivalItemCatalog}
          gameplay={
            <>
              <Button
                variant="secondary"
                onClick={() => setTeachingOpen((open) => !open)}
              >
                {teachingOpen ? '收起生存教学' : '打开生存教学'}
              </Button>
              {teachingOpen && (
                <GameTutorial mode="survival" scoreDecimals={decimals} />
              )}
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
            </>
          }
        />
      );
    else content = <p>开始生存对局后可查看此页。</p>;
    const utilityHeading = (
      <UtilityPageHeading
        inlineDescription={selected === 'rules'}
        titleId="room-utilities-title"
        title={
          selected === 'ranking'
            ? roomRanking === 'score'
              ? '当前积分排行'
              : roomRanking === 'contest'
                ? '本房争夺榜'
                : '生存排行'
            : selected === 'rules'
              ? '生存模式规则'
              : selected === 'build'
                ? '构筑与当前状态'
                : selected === 'replay'
                  ? '生存回放'
                  : '生存教学'
        }
        eyebrow={
          selected === 'ranking'
            ? 'PLAYER RANKING'
            : selected === 'rules'
              ? 'GAME RULES'
              : selected === 'build'
                ? 'YOUR BUILD'
                : selected === 'replay'
                  ? 'MATCH REPLAY'
                  : 'LEARN BY PLAYING'
        }
        description={
          selected === 'ranking'
            ? roomRanking === 'score'
              ? '已结算房间积分排行，展示本房行动、得分与道具；总分不含层末余额兑换和继承，分层累计请查看生存榜。'
              : roomRanking === 'contest'
                ? '按照市场等价出价排列，扰乱者同样参与名额争夺。'
                : '已结算房间与层末成绩 · 查看不重复结算'
            : selected === 'rules'
              ? '现行生存机制与道具说明'
              : undefined
        }
      >
        <Button variant="secondary" onClick={close}>
          <ArrowLeft aria-hidden="true" />
          返回游戏
        </Button>
      </UtilityPageHeading>
    );
    return (
      <section
        id="room-utilities"
        aria-labelledby="room-utilities-title"
        className="ranking-stage game-tools-stage survival-utility"
      >
        {selected === 'rules' ? (
          content
        ) : (
          <>
            {utilityHeading}
            <div className="utility-page-content">{content}</div>
          </>
        )}
      </section>
    );
  }
  const human = game?.players.find((p) => p.id === 'human');
  const lastHumanScore = game?.floorRecords.at(-1)?.scores.human;
  const completedLayer =
    game?.phase === 'floor_result' || game?.phase === 'competition_complete';
  const strip =
    game &&
    (game.phase === 'room_action' && session?.draft ? (
      <SurvivalActionStatus
        activePlayers={game.activePlayerIds.length}
        cutLine={game.cutLines[game.floorIndex]!}
        roomScore={(game.currentFloorRoomScores.human ?? []).reduce(
          (sum, value) => sum + value,
          0,
        )}
        inheritedScore={(game.previousSurvivalScores.human ?? 0) * 0.2}
        balanceValue={(human?.money ?? 0) * 0.1}
        decimals={decimals}
        difficulty={survivalDifficultyLabel(game.aiDifficulty)}
        policy={
          game.aiDifficulty === 'highest'
            ? '原最高基线'
            : game.aiPolicy === 'role-aware-1'
              ? '角色适配'
              : '历史原版'
        }
        onReturnMenu={props.onReturnMenu}
        onRestart={() => setRestart(true)}
      />
    ) : (
      <section className="survival-status" aria-label="生存进度">
        <b>
          生存 · 第 {game.floorIndex + 1} 层 · {game.activePlayerIds.length} 人
        </b>
        <span>难度 {survivalDifficultyLabel(game.aiDifficulty)}</span>
        <span>
          AI策略{' '}
          {game.aiDifficulty === 'highest'
            ? '原最高基线'
            : game.aiPolicy === 'role-aware-1'
              ? '角色适配'
              : '历史原版'}
        </span>
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
    ));
  let page: ReactNode;
  if (!session)
    page = (
      <CharacterSelection
        startMessage={props.restoreMessage}
        selected={selectedCharacter}
        onSelect={setSelectedCharacter}
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
        <GameHeader
          navigation={
            <GameNavigation
              page={panel}
              onPageChange={(next) => {
                if (next === 'ranking') setRankingView('survival');
                setPanel(next);
              }}
            />
          }
        />
        {(panel === null || panel === 'ranking' || panel === 'build') && strip}
        <div
          className="survival-tools"
          hidden={panel === 'settings' || panel === 'rules'}
        >
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
        <GameHeader
          navigation={<span className="header-location">生存只读回放</span>}
          context={
            <div className="readonly-return-actions">
              <Button
                variant="secondary"
                onClick={() => {
                  setPanel(null);
                  if (props.onReturnImported) props.onReturnImported();
                  else props.onReplay(null);
                }}
              >
                {props.importedReturnLabel ?? '返回生存对局'}
              </Button>
              <Button variant="secondary" onClick={props.onReturnMenu}>
                返回主菜单
              </Button>
            </div>
          }
        />
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
        <AchievementFeedbackContext.Provider
          value={
            <AchievementNotice
              ids={liveSave.achievementNotice}
              onDismiss={liveSave.dismissNotice}
            />
          }
        >
          {page}
        </AchievementFeedbackContext.Provider>
        <output className="survival-save-message">
          {message || saveStatus}
          {props.restoreMessage && <span> · {props.restoreMessage}</span>}
        </output>
        {liveSave.message && (
          <Button disabled={liveSave.busy} onClick={liveSave.retry}>
            重试保存
          </Button>
        )}
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
                liveSave.invalidate();
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
