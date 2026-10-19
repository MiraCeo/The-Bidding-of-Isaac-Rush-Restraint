import { useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import {
  aiPersonalityNames,
  characterNames,
  getItemDefinition,
  type ActiveClientGameState,
  type AiDoctrine,
  type ItemId,
} from '@/lib/game';
import { itemPresentations } from '@/lib/game/item-presentation';
import type { ScoreDisplayDecimals } from '@/lib/ui/game-preferences';
import { ItemArtProvider, ItemIcon } from './item-icon';
import { ItemBadges } from './item-badges';
import { LocateSelfButton, RankingScrollArea } from './ranking-self-summary';

const doctrineNames: Readonly<Record<AiDoctrine, string>> = {
  balanced: '均衡主义',
  cooperative: '合作主义',
  chaotic: '混乱主义',
};

/** Compare adjacent recorded entries, never resort or infer a tied placing. */
export function classicFinalGapLabel(
  score: number,
  previous: number | undefined,
  decimals: ScoreDisplayDecimals,
) {
  if (previous === undefined) return '榜首';
  const gap = previous - score;
  if (gap === 0) return '与上一名同分';
  const magnitude = Math.abs(gap);
  const value = magnitude.toFixed(decimals);
  if (Number(value) === 0)
    return `${gap > 0 ? '距上一名' : '较上一名高'}不足${(10 ** -decimals).toFixed(decimals)}分`;
  return `${gap > 0 ? '距上一名差' : '较上一名高'}${value}分`;
}

export function ClassicFinalRanking({
  game,
  scoreDecimals,
}: {
  game: ActiveClientGameState;
  scoreDecimals: ScoreDisplayDecimals;
}) {
  const playerById = new Map(game.players.map((p) => [p.id, p]));
  const [selectedItem, setSelectedItem] = useState<ItemId | null>(null);
  const origin = useRef<HTMLButtonElement | null>(null);
  const inspected = selectedItem ? getItemDefinition(selectedItem) : null;
  return (
    <Dialog.Root
      open={!!inspected}
      onOpenChange={(open) => {
        if (!open) setSelectedItem(null);
      }}
    >
      <section className="result-panel final-ranking-panel" data-ranking-scope>
        <div className="result-panel-heading">
          <h3>完整排行</h3>
          <div className="final-ranking-tools">
            <span>最终积分已含整局倍率</span>
            <LocateSelfButton />
          </div>
        </div>
        <RankingScrollArea
          className="result-table-wrap ranking-data-scroll"
          label="完整最终排行表"
        >
          <table className="result-table final-table" aria-label="整局最终排行">
            <colgroup>
              <col className="final-col-rank" />
              <col className="final-col-player" />
              <col className="final-col-score" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">排名</th>
                <th scope="col">玩家与道具</th>
                <th scope="col" className="ranking-metric-primary">
                  最终积分
                </th>
              </tr>
            </thead>
            <tbody>
              {game.finalRanking.map((entry, index) => {
                const player = playerById.get(entry.playerId);
                const profile = game.aiProfiles[entry.playerId];
                const isHuman = entry.playerId === game.humanPlayerId;
                const name = isHuman ? '你' : (profile?.name ?? entry.playerId);
                return (
                  <tr
                    key={entry.playerId}
                    data-player-id={entry.playerId}
                    data-rank={index + 1}
                    className={isHuman ? 'result-self-row' : ''}
                    data-ranking-self={isHuman}
                    tabIndex={isHuman ? -1 : undefined}
                  >
                    <td>
                      <span className="ranking-position">{index + 1}</span>
                    </td>
                    <th scope="row" className="ranking-player-cell">
                      <div className="final-player-heading">
                        <strong className="final-player-name">{name}</strong>
                        <span className="final-player-character">
                          {player?.characterId
                            ? characterNames[player.characterId]
                            : '—'}
                        </span>
                        <span
                          className={`final-identity-pill ${isHuman ? 'is-human' : 'is-ai'}`}
                          data-player-kind={isHuman ? 'human' : 'ai'}
                        >
                          {isHuman ? '真人' : 'AI'}
                        </span>
                        {profile?.personalities.map((personality) => (
                          <span
                            className="final-personality-pill"
                            data-ai-personality={personality}
                            key={personality}
                          >
                            {aiPersonalityNames[personality]}
                          </span>
                        ))}
                      </div>
                      <div className="final-inventory">
                        <span
                          className="final-inventory-count"
                          data-item-count={player?.items.length ?? 0}
                        >
                          {player?.items.length ?? 0}件道具
                        </span>
                        <ul
                          className="final-inventory-icons"
                          aria-label={`${name}的全部道具`}
                        >
                          {player?.items.map((instance) => {
                            const item = getItemDefinition(instance.itemId);
                            return (
                              <li key={instance.instanceId}>
                                <button
                                  type="button"
                                  className="final-item-button"
                                  data-item-instance={instance.instanceId}
                                  aria-label={`查看${item.name}`}
                                  title={`${item.name}：${itemPresentations[item.id].description}`}
                                  onClick={(event) => {
                                    origin.current = event.currentTarget;
                                    setSelectedItem(item.id);
                                  }}
                                >
                                  <ItemIcon itemId={item.id} />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                        {!player?.items.length && (
                          <span className="final-empty-inventory">
                            暂无道具
                          </span>
                        )}
                      </div>
                      <div className="final-player-metadata">
                        <span>
                          资金 <b data-final-money>{player?.money ?? 0}</b>
                        </span>
                        {!isHuman && (
                          <span data-ai-doctrine={profile?.doctrine}>
                            流派：
                            {profile
                              ? doctrineNames[profile.doctrine]
                              : '未记录'}
                          </span>
                        )}
                      </div>
                    </th>
                    <td
                      className="ranking-metric-primary"
                      title={String(entry.finalScore)}
                    >
                      <strong data-final-score>
                        {entry.finalScore.toFixed(scoreDecimals)}
                      </strong>
                      <small className="final-score-gap" data-final-gap>
                        {classicFinalGapLabel(
                          entry.finalScore,
                          game.finalRanking[index - 1]?.finalScore,
                          scoreDecimals,
                        )}
                      </small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </RankingScrollArea>
      </section>
      <Dialog.Portal>
        {inspected && (
          <ItemArtProvider>
            <Dialog.Backdrop className="final-item-backdrop" />
            <Dialog.Popup
              className="final-item-dialog"
              finalFocus={() =>
                origin.current?.isConnected ? origin.current : null
              }
            >
              <div className="final-item-dialog-heading">
                <ItemIcon itemId={inspected.id} size="large" />
                <Dialog.Title>{inspected.name}</Dialog.Title>
                <Dialog.Close
                  className="final-item-close"
                  aria-label="关闭道具详情"
                >
                  <X size={20} aria-hidden="true" />
                </Dialog.Close>
              </div>
              <Dialog.Description>
                {itemPresentations[inspected.id].description}
              </Dialog.Description>
              <ItemBadges item={inspected} />
              <p className="final-item-reference">
                道具说明仅供查看，实际计分与触发以本局结算记录为准。
              </p>
              <Dialog.Close className="final-item-done">返回排行</Dialog.Close>
            </Dialog.Popup>
          </ItemArtProvider>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}
