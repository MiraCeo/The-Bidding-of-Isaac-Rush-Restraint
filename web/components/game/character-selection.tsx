import { useCharacterAccess } from './use-character-access';
import { characterRequirementText } from '@/lib/ui/achievements/character-access';
import { GameHeader } from './game-header';
import { useEffect, useId, useState, type ReactNode } from 'react';
import {
  Check,
  Circle,
  LockKeyhole,
  PackageOpen,
  Sparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { survivalOfficialCutLines } from '@/lib/game/survival-rules';
import {
  survivalDifficulties,
  survivalDifficultyProfiles,
  type SurvivalDifficulty,
} from '@/lib/game/survival-difficulty';
import { GameNavigation } from './game-navigation';
import { RoomUtilities } from './room-utilities';
import { useUtilityPages } from './use-utility-pages';
import type { PreferenceSaveStatus } from './game-settings';
import type { GamePreferences } from '@/lib/ui/game-preferences';
import {
  characterCatalog,
  getItemDefinition,
  type CharacterId,
} from '@/lib/game';

interface CharacterPresentation {
  emoji: string;
  trait: string;
  startingItems: string;
}

const characterPresentation: Readonly<
  Record<CharacterId, CharacterPresentation>
> = {
  isaac: {
    emoji: '🎲',
    trait: '每层初始资金提高 10%。',
    startingItems: getItemDefinition('d6').name,
  },
  lost: {
    emoji: '👻',
    trait: '依靠屏障保护失手的竞拍。',
    startingItems: [
      getItemDefinition('holy_mantle').name,
      getItemDefinition('eternal_d6').name,
    ].join('、'),
  },
  azazel: {
    emoji: '🔥',
    trait: '从第一房间开始调整竞拍计分区间。',
    startingItems: getItemDefinition('brimstone').name,
  },
  eden: {
    emoji: '✨',
    trait: '每层初始资金在 ±10% 范围独立浮动。',
    startingItems: '两件不相同的随机道具（不含福袋）',
  },
  jacob_esau: {
    emoji: '♊',
    trait: '每层初始资金提高 20%，双行动不承受 0.75 倍积分修正。',
    startingItems: [
      getItemDefinition('more_options').name,
      getItemDefinition('more_options_question').name,
    ].join('、'),
  },
};

interface CharacterSelectionProps {
  selected?: CharacterId | null;
  startMessage?: string;
  onSelect?: (character: CharacterId) => void;
  aiDifficulty?: SurvivalDifficulty;
  onDifficultyChange?: (difficulty: SurvivalDifficulty) => void;
  mode?: 'classic' | 'survival';
  onReturnMenu?: () => void;
  renderUtilities?: (
    panel: import('./room-utilities').RoomUtilityPanel | null,
    onReturn: () => void,
  ) => ReactNode;
  onStart: (characterId: CharacterId) => void;
  preferences: GamePreferences;
  preferenceSaveStatus: PreferenceSaveStatus;
  onPreferencesChange: (preferences: GamePreferences) => void;
}

export function CharacterSelection({
  selected,
  startMessage,
  onSelect,
  aiDifficulty = 'standard',
  onDifficultyChange,
  mode = 'classic',
  onReturnMenu,
  renderUtilities,
  onStart,
  preferences,
  preferenceSaveStatus,
  onPreferencesChange,
}: CharacterSelectionProps) {
  const access = useCharacterAccess();
  const [localSelectedCharacter, setLocalSelectedCharacter] =
    useState<CharacterId | null>(null);
  const selectedCharacter =
    selected === undefined ? localSelectedCharacter : selected;
  const setSelectedCharacter = onSelect ?? setLocalSelectedCharacter;
  const { utilityPanel, changeUtilityPanel } = useUtilityPages();
  const descriptionId = useId();
  useEffect(() => {
    if (!renderUtilities || !utilityPanel) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        changeUtilityPanel(null);
      }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [renderUtilities, utilityPanel, changeUtilityPanel]);

  return (
    <main className={utilityPanel ? 'ranking-page' : 'character-page'}>
      <GameHeader
        showContext={
          utilityPanel !== null &&
          utilityPanel !== 'settings' &&
          utilityPanel !== 'rules'
        }
        navigation={
          <GameNavigation
            page={utilityPanel}
            onPageChange={changeUtilityPanel}
          />
        }
        context={
          <>
            <div className="character-step" aria-label="当前步骤">
              <span>{mode === 'survival' ? '生存模式' : '经典模式'}</span>
              <strong>{utilityPanel ? '未开始对局' : '选择角色'}</strong>
            </div>
          </>
        }
      />

      <section
        className="character-stage"
        aria-labelledby="character-title"
        hidden={utilityPanel !== null}
        inert={utilityPanel !== null}
      >
        <div className="character-intro">
          <div>
            <p className="eyebrow">CHOOSE YOUR CHARACTER</p>
            <div className="character-title-line">
              <h2 id="character-title">选择角色</h2>
              <span className="character-mode-label">
                {mode === 'survival' ? '生存模式' : '经典模式'}
              </span>
              <p>角色决定初始道具与每层资金特性。</p>
            </div>
          </div>
        </div>

        {startMessage && (
          <section
            className="character-session-message"
            aria-label="对局与存档提示"
          >
            <strong>对局与存档</strong>
            <output>{startMessage}</output>
          </section>
        )}

        {mode === 'survival' && (
          <section className="survival-difficulty-picker">
            <label>
              生存AI难度{' '}
              <select
                aria-label="生存AI难度"
                value={aiDifficulty}
                onChange={(event) =>
                  onDifficultyChange?.(event.target.value as SurvivalDifficulty)
                }
              >
                {survivalDifficulties.map((value) => (
                  <option key={value} value={value}>
                    {survivalDifficultyProfiles[value].label}
                  </option>
                ))}
              </select>
            </label>
            <p>
              {survivalDifficultyProfiles[aiDifficulty].description}{' '}
              难度开局后锁定，不改变斩杀线、角色或道具。
              {`每层基础资金1000，斩杀线${survivalOfficialCutLines.join('／')}；伊甸不抽取福袋和黑王子之冠。`}
            </p>
          </section>
        )}
        <div className="character-grid" role="radiogroup" aria-label="可选角色">
          {characterCatalog.map((character) => {
            const presentation = characterPresentation[character.id];
            const unlocked = access.available.includes(character.id);
            const selected = unlocked && selectedCharacter === character.id;
            return (
              <label
                key={character.id}
                className={`character-card ${selected ? 'character-card-selected' : ''}`}
                data-locked={!unlocked}
                data-selected={selected}
              >
                <input
                  type="radio"
                  name="character"
                  value={character.id}
                  className="character-radio"
                  disabled={!unlocked || access.busy}
                  checked={selected}
                  onChange={() => setSelectedCharacter(character.id)}
                  aria-label={`选择${character.name}`}
                  aria-describedby={`${descriptionId}-${character.id}-condition ${descriptionId}-${character.id}-items ${descriptionId}-${character.id}-trait`}
                />
                <span
                  className="character-state"
                  data-state={
                    !unlocked ? 'locked' : selected ? 'selected' : 'available'
                  }
                >
                  {!unlocked ? (
                    <LockKeyhole aria-hidden="true" size={12} />
                  ) : selected ? (
                    <Check aria-hidden="true" size={12} />
                  ) : (
                    <Circle aria-hidden="true" size={10} />
                  )}
                  {!unlocked ? '未解锁' : selected ? '已选择' : '可选'}
                </span>
                <span className="character-emoji" aria-hidden="true">
                  {presentation.emoji}
                </span>
                <span className="character-name">{character.name}</span>
                <span
                  className="character-unlock-condition"
                  id={`${descriptionId}-${character.id}-condition`}
                >
                  <small>
                    {character.id === 'isaac' ? '开放状态' : '解锁条件'}
                  </small>
                  {characterRequirementText(character.id)}
                </span>
                <span
                  className="character-detail"
                  id={`${descriptionId}-${character.id}-items`}
                >
                  <PackageOpen aria-hidden="true" />
                  <span>
                    <small>初始道具</small>
                    {mode === 'survival' && character.id === 'eden'
                      ? '两件不相同的随机道具（不含福袋与黑王子之冠）'
                      : presentation.startingItems}
                  </span>
                </span>
                <span
                  className="character-detail"
                  id={`${descriptionId}-${character.id}-trait`}
                >
                  <Sparkles aria-hidden="true" />
                  <span>
                    <small>角色特性</small>
                    {presentation.trait}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        <footer className="character-footer">
          <div className="character-secondary-actions">
            {onReturnMenu && (
              <Button type="button" variant="secondary" onClick={onReturnMenu}>
                返回主菜单
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              className="character-tutorial-button"
              disabled={utilityPanel !== null}
              onClick={() => changeUtilityPanel('tutorial')}
            >
              新手教程
            </Button>
          </div>
          <div className="character-start-actions">
            <div className="character-current-selection" aria-live="polite">
              <span>当前选择</span>
              <strong>
                {selectedCharacter &&
                access.available.includes(selectedCharacter)
                  ? characterCatalog.find(
                      (character) => character.id === selectedCharacter,
                    )?.name
                  : '尚未选择角色'}
              </strong>
            </div>
            <Button
              type="button"
              size="lg"
              className="character-start-button"
              disabled={
                !selectedCharacter ||
                !access.available.includes(selectedCharacter) ||
                access.busy ||
                utilityPanel !== null
              }
              onClick={() =>
                utilityPanel === null &&
                selectedCharacter &&
                access.available.includes(selectedCharacter) &&
                onStart(selectedCharacter)
              }
            >
              开始游戏
            </Button>
          </div>
        </footer>
        <section className="character-access" aria-label="角色权限">
          <p>
            默认开放以撒；其余角色按成就解锁。
            <small>已有续玩、教学及AI角色不受影响。</small>
          </p>
          <Button
            type="button"
            variant="secondary"
            disabled={
              access.busy ||
              access.invalid ||
              access.available.length === characterCatalog.length
            }
            onClick={() => void access.unlockAll()}
          >
            一键解锁全部角色
          </Button>
          {(access.operationMessage || access.message) && (
            <output>{access.operationMessage || access.message}</output>
          )}
        </section>
      </section>
      {renderUtilities ? (
        renderUtilities(utilityPanel, () => changeUtilityPanel(null))
      ) : (
        <RoomUtilities
          panel={utilityPanel}
          preferences={preferences}
          saveStatus={preferenceSaveStatus}
          onPanelChange={changeUtilityPanel}
          onPreferencesChange={onPreferencesChange}
        />
      )}
    </main>
  );
}
