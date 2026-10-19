import { useRef, useState, type ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import {
  aiPersonalityNames,
  characterNames,
  getItemDefinition,
  type RuntimePlayerState,
  type ItemId,
} from '@/lib/game';
import { itemPresentations } from '@/lib/game/item-presentation';
import {
  aiDoctrinePresentation,
  aiPersonalityPresentation,
} from '@/lib/ui/ai-personality-presentation';
import type { ScoreDisplayDecimals } from '@/lib/ui/game-preferences';
import { ItemArtProvider, ItemIcon } from './item-icon';
import { ItemBadges } from './item-badges';
import { LocateSelfButton, RankingScrollArea } from './ranking-self-summary';

import type { AiClientProfile } from '@/lib/game/client-runtime';

export interface FinalRankingPlayerView {
  playerId: string;
  rank: number;
  name: string;
  isHuman: boolean;
  finalScore: number;
  gapLabel: string;
  player?: Pick<RuntimePlayerState, 'characterId' | 'items'>;
  profile?: Pick<AiClientProfile, 'doctrine' | 'personalities'>;
  status?: { label: string; active: boolean };
}

export function FinalPlayerRanking({
  rows,
  scoreDecimals,
  title = '完整排行',
  scoreLabel = '最终积分',
  scoreNote = '最终积分已含整局倍率',
  caption = '整局最终排行',
  tools,
}: {
  rows: readonly FinalRankingPlayerView[];
  scoreDecimals: ScoreDisplayDecimals;
  title?: string;
  scoreLabel?: string;
  scoreNote?: string;
  caption?: string;
  tools?: ReactNode;
}) {
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
          <h3>{title}</h3>
          <div className="final-ranking-tools">
            <span>{scoreNote}</span>
            {tools}
            <LocateSelfButton />
          </div>
        </div>
        <RankingScrollArea
          className="result-table-wrap ranking-data-scroll"
          label="完整最终排行表"
        >
          <table className="result-table final-table" aria-label={caption}>
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
                  {scoreLabel}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => {
                const { player, profile, isHuman, name } = entry;
                return (
                  <tr
                    key={entry.playerId}
                    data-player-id={entry.playerId}
                    data-rank={entry.rank}
                    className={isHuman ? 'result-self-row' : ''}
                    data-ranking-self={isHuman}
                    tabIndex={isHuman ? -1 : undefined}
                  >
                    <td>
                      <span className="ranking-position">{entry.rank}</span>
                    </td>
                    <th scope="row" className="ranking-player-cell">
                      <div className="final-player-heading">
                        <strong className="final-player-name">{name}</strong>
                        <span className="final-player-character">
                          {player?.characterId
                            ? characterNames[player.characterId]
                            : '—'}
                        </span>
                        {entry.status && (
                          <span
                            className={`final-survival-status ${entry.status.active ? 'is-alive' : 'is-out'}`}
                            data-final-status
                          >
                            {entry.status.label}
                          </span>
                        )}
                        <span
                          className={`final-identity-pill ${isHuman ? 'is-human' : 'is-ai'}`}
                          data-player-kind={isHuman ? 'human' : 'ai'}
                        >
                          {isHuman ? '真人' : 'AI'}
                        </span>
                        {!isHuman && (
                          <span
                            className="final-doctrine-pill"
                            title={
                              profile
                                ? aiDoctrinePresentation[profile.doctrine]
                                    .summary
                                : '此记录没有流派信息。'
                            }
                            data-ai-doctrine={profile?.doctrine}
                            aria-label={`AI流派：${profile ? aiDoctrinePresentation[profile.doctrine].name : '未记录'}`}
                          >
                            {profile
                              ? aiDoctrinePresentation[profile.doctrine].name
                              : '流派未记录'}
                          </span>
                        )}
                        {profile?.personalities.map((personality) => (
                          <span
                            className="final-personality-pill"
                            data-ai-personality={personality}
                            title={`${aiPersonalityNames[personality]}：${aiPersonalityPresentation[personality].summary}`}
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
                    </th>
                    <td
                      className="ranking-metric-primary"
                      title={String(entry.finalScore)}
                    >
                      <strong data-final-score>
                        {entry.finalScore.toFixed(scoreDecimals)}
                      </strong>
                      <small className="final-score-gap" data-final-gap>
                        {entry.gapLabel}
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
