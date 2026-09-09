import { useState } from 'react';
import { Check, Coins, PackageOpen } from 'lucide-react';

import { Button } from '@/components/ui/button';
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

const characterPresentation: Readonly<Record<CharacterId, CharacterPresentation>> = {
  isaac: {
    emoji: '🎲',
    trait: '每层初始资金提高 10%。',
    startingItems: getItemDefinition('d6').name,
  },
  lost: {
    emoji: '👻',
    trait: '依靠屏障保护失手的竞拍。',
    startingItems: [getItemDefinition('holy_mantle').name, getItemDefinition('eternal_d6').name].join('、'),
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
  onStart: (characterId: CharacterId) => void;
}

export function CharacterSelection({ onStart }: CharacterSelectionProps) {
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterId | null>(null);

  return (
    <main className="character-page">
      <header className="character-header">
        <div className="brand-block">
          <p className="eyebrow">THE BIDDING OF ISAAC</p>
          <h1>以撒的竞合：冲 · 慎</h1>
        </div>
        <div className="character-step" aria-label="当前步骤">
          <span>新游戏</span>
          <strong>选择角色</strong>
        </div>
      </header>

      <section className="character-stage" aria-labelledby="character-title">
        <div className="character-intro">
          <div>
            <p className="eyebrow">CHOOSE YOUR CHARACTER</p>
            <h2 id="character-title">选择角色</h2>
          </div>
          <p>角色决定初始道具与每层资金特性。</p>
        </div>

        <div className="character-grid" role="radiogroup" aria-label="可选角色">
          {characterCatalog.map((character) => {
            const presentation = characterPresentation[character.id];
            const selected = selectedCharacter === character.id;
            return (
              <label
                key={character.id}
                className={`character-card ${selected ? 'character-card-selected' : ''}`}
              >
                <input
                  type="radio"
                  name="character"
                  value={character.id}
                  className="character-radio"
                  checked={selected}
                  onChange={() => setSelectedCharacter(character.id)}
                  aria-label={`选择${character.name}`}
                />
                <span className="character-check" aria-hidden="true">
                  {selected && <Check />}
                </span>
                <span className="character-emoji" aria-hidden="true">{presentation.emoji}</span>
                <span className="character-name">{character.name}</span>
                <span className="character-detail">
                  <PackageOpen aria-hidden="true" />
                  <span><small>初始道具</small>{presentation.startingItems}</span>
                </span>
                <span className="character-detail">
                  <Coins aria-hidden="true" />
                  <span><small>角色特性</small>{presentation.trait}</span>
                </span>
              </label>
            );
          })}
        </div>

        <footer className="character-footer">
          <div>
            <span>当前选择</span>
            <strong>{selectedCharacter
              ? characterCatalog.find((character) => character.id === selectedCharacter)?.name
              : '尚未选择角色'}</strong>
          </div>
          <Button
            type="button"
            size="lg"
            className="character-start-button"
            disabled={!selectedCharacter}
            onClick={() => selectedCharacter && onStart(selectedCharacter)}
          >
            开始游戏
          </Button>
        </footer>
      </section>
    </main>
  );
}
