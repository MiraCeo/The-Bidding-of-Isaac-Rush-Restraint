import isaac from '@/assets/characters/isaac.png?inline';
import lost from '@/assets/characters/lost.png?inline';
import azazel from '@/assets/characters/azazel.png?inline';
import eden from '@/assets/characters/eden.png?inline';
import jacob from '@/assets/characters/jacob.png?inline';
import esau from '@/assets/characters/esau.png?inline';
import type { CharacterId } from '@/lib/game/item-types';

const portraits: Readonly<Record<CharacterId, readonly string[]>> = {
  isaac: [isaac],
  lost: [lost],
  azazel: [azazel],
  eden: [eden],
  jacob_esau: [jacob, esau],
};

/** Preserve the supplied transparent 64px frames; scale whole pixels in CSS. */
export function CharacterArt({ characterId }: { characterId: CharacterId }) {
  return (
    <span
      className="character-art"
      aria-hidden="true"
      data-character-id={characterId}
    >
      {portraits[characterId].map((src) => (
        <span
          className="character-art-figure"
          key={src}
          style={{ backgroundImage: `url("${src}")` }}
        />
      ))}
    </span>
  );
}
