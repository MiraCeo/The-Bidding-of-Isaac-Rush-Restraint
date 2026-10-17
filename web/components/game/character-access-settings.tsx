import { Button } from '@/components/ui/button';
import { characterCatalog } from '@/lib/game/characters';
import { useCharacterAccess } from './use-character-access';

export function CharacterAccessSettings() {
  // Merely visiting settings must not initialize or rewrite the player profile.
  const access = useCharacterAccess(false);
  const message = access.operationMessage || access.message;
  return (
    <fieldset className="settings-group settings-character-access">
      <legend>角色</legend>
      <div className="settings-character-action">
        <p>手动开放全部角色，不补发成就或增加统计进度。</p>
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
      </div>
      {message && <output>{message}</output>}
    </fieldset>
  );
}
