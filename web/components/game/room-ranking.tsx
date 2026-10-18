import { UtilityPageHeading } from './utility-page-heading';
import { GameHeader } from './game-header';
import { ItemIcon } from './item-icon';
import { ArrowLeft, ArrowRight, Coins, Trophy } from 'lucide-react';

import { PlayerRankingTable } from './player-ranking-table';
import { PublicRanking } from './public-ranking';
import { RankingSelfSummary, RankingScrollArea } from './ranking-self-summary';

import { Button } from '@/components/ui/button';
import type { ScoreDisplayDecimals } from '@/lib/ui/game-preferences';
import {
  characterNames,
  getItemDefinition,
  type ActiveClientGameState,
  type ClientRankingView,
  type RewardGroup,
} from '@/lib/game';

type RoomRankingProps = {
  embedded?: boolean;
  scoreDecimals?: ScoreDisplayDecimals;
  finalRoom?: boolean;
  advanceLabel?: string;
  scoreDescription?: string;
  hideViewTabs?: boolean;
  hideHeading?: boolean;
  hideFooter?: boolean;
  scoreScope?: 'classic' | 'survival';
} & (
  | {
      variant?: 'settled';
      game: ActiveClientGameState;
      onSwitch: (view: ClientRankingView) => void;
      onAdvance: () => void;
    }
  | {
      variant: 'public';
      game?: ActiveClientGameState;
      onReturn: () => void;
      returnLabel?: string;
    }
);

export function RoomRanking(props: RoomRankingProps) {
  const Container = props.embedded ? 'div' : 'main';
  const { scoreDecimals = 2 } = props;
  if (props.variant === 'public') {
    const game = props.game;
    return (
      <section
        id="room-utilities"
        className="ranking-stage game-tools-stage"
        aria-labelledby="room-utilities-title"
        data-public-ranking={game ? 'active' : undefined}
      >
        <UtilityPageHeading
          eyebrow="PLAYER RANKING"
          title="当前公开排行"
          titleId="room-utilities-title"
          description={
            game ? `当前资金与积分 · ${game.players.length} 人` : '尚未开始对局'
          }
        >
          <Button type="button" variant="secondary" onClick={props.onReturn}>
            <ArrowLeft aria-hidden="true" />
            {props.returnLabel ?? '返回游戏'}
          </Button>
        </UtilityPageHeading>
        <PublicRanking game={game} scoreDecimals={scoreDecimals} />
        <footer className="result-actions ranking-actions utility-page-actions">
          <p>
            {game
              ? '返回后继续当前房间，不提交行动。Esc 可返回。'
              : '开始游戏后显示本局排行。Esc 可返回。'}
          </p>
        </footer>
      </section>
    );
  }
  const { game, onSwitch, onAdvance } = props;
  const settlement = game.roomSettlement;
  if (!settlement) throw new Error('排行榜页面缺少房间结算记录。');
  const ranking = [...settlement.players].sort(
    (left, right) =>
      right.score - left.score || left.id.localeCompare(right.id),
  );
  const human = settlement.players.find(
    (player) => player.id === game.humanPlayerId,
  );
  const humanRank =
    ranking.findIndex((player) => player.id === game.humanPlayerId) + 1;
  const playerName = (playerId: string) =>
    playerId === game.humanPlayerId
      ? '你'
      : (game.aiProfiles[playerId]?.name ?? playerId);
  const isFinalRoom =
    props.finalRoom ??
    (game.floorIndex === game.rooms.length - 1 &&
      game.roomIndex === game.rooms[game.floorIndex]!.length - 1);

  return (
    <Container className="ranking-page">
      {!props.embedded && (
        <GameHeader
          navigation={
            <nav className="main-nav" aria-label="主导航">
              <button type="button" className="nav-item" disabled>
                游戏
              </button>
              <button
                type="button"
                className="nav-item nav-item-active"
                aria-current="page"
              >
                排行
              </button>
              <button type="button" className="nav-item" disabled>
                设置
              </button>
              <button type="button" className="nav-item" disabled>
                规则
              </button>
            </nav>
          }
          context={
            <>
              <div className="round-status">
                <span className="status-chip">
                  <Trophy aria-hidden="true" />第 {humanRank} 名
                </span>
                <span className="status-chip status-chip-money">
                  <Coins aria-hidden="true" />
                  <strong>{human?.money ?? 0}</strong>
                </span>
              </div>
            </>
          }
        />
      )}

      <section className="ranking-stage" data-ranking-scope>
        {!props.hideHeading && (
          <UtilityPageHeading
            eyebrow="ROOM RANKING"
            titleId="room-ranking-title"
            title={
              game.roomRankingView === 'score' ? '当前积分排行' : '本房争夺榜'
            }
          />
        )}

        {!props.hideViewTabs && (
          <div
            className="ranking-view-tabs"
            role="tablist"
            aria-label="排行类型"
          >
            <button
              type="button"
              role="tab"
              aria-selected={game.roomRankingView === 'score'}
              className={
                game.roomRankingView === 'score'
                  ? 'ranking-view-tab-active'
                  : ''
              }
              onClick={() => onSwitch('score')}
            >
              积分排行
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={game.roomRankingView === 'contest'}
              className={
                game.roomRankingView === 'contest'
                  ? 'ranking-view-tab-active'
                  : ''
              }
              onClick={() => onSwitch('contest')}
            >
              争夺榜
            </button>
          </div>
        )}

        <div className="ranking-context-row">
          <p className="ranking-context">
            {props.scoreScope === 'survival' ? '生存' : '经典'} · 第{' '}
            {game.floorIndex + 1} 层 / 房间 {game.roomIndex + 1} · 已结算
          </p>
          {game.roomRankingView === 'score' && (
            <RankingSelfSummary
              label="你的积分顺位"
              rank={human ? humanRank : undefined}
            >
              {human && `${human.score.toFixed(scoreDecimals)} 分`}
            </RankingSelfSummary>
          )}
        </div>
        <p className="ranking-basis">
          {game.roomRankingView === 'score'
            ? (props.scoreDescription ??
              (props.scoreScope === 'survival'
                ? '按全局累计房间分降序；不含层末余额兑换或继承，不等同于生存榜累计分数。分层新增与生存分请查看生存榜。'
                : '按累计积分降序；本房积分是本次变化，不是排序依据。未含终局倍率，同分保留原顺位。'))
            : 'A／B分别按市场等价降序，扰乱同样占位；名义出价不等于实际扣款，获得道具以最终发放为准。'}
        </p>
        {game.roomRankingView === 'score' ? (
          <ScoreRanking
            game={game}
            playerName={playerName}
            ranking={ranking}
            scoreDecimals={scoreDecimals}
            scoreLabel={
              props.scoreScope === 'survival' ? '累计房间分' : '累计积分'
            }
          />
        ) : (
          <div className="contest-grid">
            {(['A', 'B'] as const).map((group) => (
              <ContestPanel
                key={group}
                game={game}
                group={group}
                playerName={playerName}
              />
            ))}
          </div>
        )}

        {!props.hideFooter && (
          <footer className="result-actions ranking-actions">
            <div>
              <span>
                {isFinalRoom ? '三层挑战已经结束' : '榜单可随时切换查看'}
              </span>
              <strong>
                {isFinalRoom
                  ? '进入整局最终排行'
                  : `下一房间 · ${game.roomIndex === 4 ? `第 ${game.floorIndex + 2} 层` : `${game.roomIndex + 2}/5`}`}
              </strong>
            </div>
            <Button type="button" size="lg" onClick={onAdvance}>
              {props.advanceLabel ??
                (isFinalRoom ? '最终排行' : '进入下一房间')}
              <ArrowRight aria-hidden="true" />
            </Button>
          </footer>
        )}
      </section>
    </Container>
  );
}

function ScoreRanking({
  game,
  ranking,
  playerName,
  scoreDecimals,
  scoreLabel,
}: {
  game: ActiveClientGameState;
  ranking: ActiveClientGameState['players'];
  playerName: (playerId: string) => string;
  scoreDecimals: ScoreDisplayDecimals;
  scoreLabel: string;
}) {
  const entries = ranking.map((player, index) => ({
    playerId: player.id,
    name: playerName(player.id),
    characterName: player.characterId
      ? characterNames[player.characterId]
      : '—',
    isHuman: player.isHuman,
    money: player.money,
    score: player.score,
    rank: index + 1,
  }));
  return (
    <PlayerRankingTable
      entries={entries}
      scoreDecimals={scoreDecimals}
      caption="本房结算后积分排行"
      settlement={game.roomSettlement!}
      scoreLabel={scoreLabel}
    />
  );
}

function ContestPanel({
  game,
  group,
  playerName,
}: {
  game: ActiveClientGameState;
  group: RewardGroup;
  playerName: (playerId: string) => string;
}) {
  const settlement = game.roomSettlement!;
  const reward = settlement.room.rewards.find(
    (entry) => entry.group === group,
  )!;
  const competitors = settlement.resolvedActions
    .filter(
      (entry) =>
        entry.action.type !== 'withdraw' && entry.action.group === group,
    )
    .sort(
      (left, right) =>
        (right.marketEquivalent ?? 0) - (left.marketEquivalent ?? 0) ||
        left.playerId.localeCompare(right.playerId),
    );
  const disruptedSlots = new Set(
    [...settlement.highPricePlacements, ...settlement.cooperationPlacements]
      .filter(
        (entry) => entry.group === group && entry.actionType === 'disrupt',
      )
      .map((entry) => entry.playerId),
  );
  const awards = new Map(
    settlement.awards
      .filter((award) => award.group === group)
      .map((award) => [award.playerId, award.copies]),
  );
  const ownIndex = competitors.findIndex(
    (entry) => entry.playerId === game.humanPlayerId,
  );

  return (
    <section
      className="result-panel contest-panel"
      data-ranking-scope
      aria-label={`道具 ${group} 争夺排行`}
    >
      <header className="contest-panel-heading">
        <div className="contest-item-title">
          <ItemIcon itemId={reward.itemId} size="large" />
          <div>
            <small>道具 {group}</small>
            <h3>{getItemDefinition(reward.itemId).name}</h3>
          </div>
        </div>
        <strong>{competitors.length} 项行动</strong>
      </header>
      {ownIndex >= 0 ? (
        <RankingSelfSummary label="你的本组顺位" rank={ownIndex + 1} />
      ) : (
        <p className="ranking-basis">你未参与本组争夺</p>
      )}
      <RankingScrollArea
        className="ranking-data-scroll contest-data-scroll"
        label={`道具 ${group} 已公开行动`}
      >
        <table className="contest-ranking-table">
          <caption className="sr-only">
            道具 {group} · 按市场等价降序，同值保留原顺位
          </caption>
          <thead>
            <tr>
              <th scope="col">顺位 / 玩家</th>
              <th
                scope="col"
                className="ranking-metric-primary"
                aria-sort="descending"
              >
                市场等价 <span aria-hidden="true">↓</span>
              </th>
              <th scope="col">名义出价</th>
              <th scope="col">行动</th>
              <th scope="col">结果</th>
            </tr>
          </thead>
          <tbody>
            {competitors.length === 0 && (
              <tr>
                <td colSpan={5} className="contest-empty">
                  本房间没有玩家争夺该道具。
                </td>
              </tr>
            )}
            {competitors.map((entry, index) => {
              if (entry.action.type === 'withdraw') return null;
              const copies = awards.get(entry.playerId) ?? 0;
              const disrupted = disruptedSlots.has(entry.playerId);
              const className =
                copies > 0
                  ? 'contest-result-row contest-row-awarded'
                  : disrupted
                    ? 'contest-result-row contest-row-disrupted'
                    : 'contest-result-row';
              return (
                <tr
                  key={`${entry.playerId}-${entry.actionIndex}`}
                  className={className}
                  data-player-id={entry.playerId}
                  data-action-index={entry.actionIndex}
                  data-ranking-self={entry.playerId === game.humanPlayerId}
                  tabIndex={
                    entry.playerId === game.humanPlayerId ? -1 : undefined
                  }
                >
                  <th scope="row" className="contest-player-cell">
                    <b>{index + 1}</b>
                    <strong>{playerName(entry.playerId)}</strong>
                    {entry.playerId === game.humanPlayerId && (
                      <em className="ranking-self-badge">本人</em>
                    )}
                  </th>
                  <td
                    className="ranking-metric-primary"
                    title={String(entry.marketEquivalent ?? '—')}
                  >
                    {entry.marketEquivalent?.toFixed(2) ?? '—'}
                  </td>
                  <td className="ranking-number">{entry.action.amount}</td>
                  <td
                    className={
                      entry.action.type === 'disrupt'
                        ? 'contest-action-disrupt'
                        : ''
                    }
                  >
                    {entry.action.type === 'bid' ? '竞拍' : '扰乱'}
                  </td>
                  <td>
                    <span className="contest-statuses">
                      {copies > 0 && (
                        <em className="contest-badge contest-badge-awarded">
                          获得道具{copies > 1 ? ` ×${copies}` : ''}
                        </em>
                      )}
                      {disrupted && (
                        <em className="contest-badge contest-badge-disrupted">
                          扰乱占位
                        </em>
                      )}
                      {copies === 0 && !disrupted && (
                        <em className="contest-badge">未获得</em>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </RankingScrollArea>
    </section>
  );
}
