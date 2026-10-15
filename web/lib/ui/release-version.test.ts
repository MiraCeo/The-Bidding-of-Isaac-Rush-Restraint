import { describe, expect, it } from 'vitest';
import packageInfo from '../../package.json';
import lockInfo from '../../package-lock.json';
import releaseConfig from '../../release-config.json';
import {
  appReleaseNotes,
  appVersion,
  saveCompatibility,
  saveFormatVersion,
  replayFormatVersion,
  shortHash,
} from './game-version';
import { defaultRules } from '../game/config';
import { itemCatalog } from '../game/item-catalog';
import { characterCatalog } from '../game/characters';
import { createGameSession, reduceGameSession } from './game-session';
import { parseGameSave } from './game-save';
import { serializeSessionFixture as serializeGameSave } from './save-fixture.test-helper';
import { parseReplay, serializeReplay } from './game-replay';

describe('UI release version independent of save compatibility', () => {
  it('keeps package, lock and latest release note versions aligned', () => {
    expect(appVersion).toBe('0.5.5');
    expect(packageInfo.version).toBe(appReleaseNotes[0]!.version);
    expect(lockInfo.version).toBe(appVersion);
    expect(lockInfo.packages[''].version).toBe(appVersion);
    expect(saveFormatVersion).toBe(5);
    expect(replayFormatVersion).toBe(5);
  });
  it('separates the growth/collection patch from the initial 0.5.0 milestone without duplicating version entries', () => {
    const latest = appReleaseNotes.find((n) => n.version === '0.5.1')!,
      initial = appReleaseNotes.find((n) => n.version === '0.5.0')!;
    expect(new Set(appReleaseNotes.map((n) => n.version)).size).toBe(
      appReleaseNotes.length,
    );
    expect(latest.highlights.join(' ')).toContain('无损紧凑编码');
    expect(latest.highlights.join(' ')).toContain('紧凑徽章收藏');
    expect(initial.highlights).toHaveLength(8);
    expect(initial.highlights.join(' ')).not.toContain('无损紧凑编码');
    expect(initial.highlights.join(' ')).not.toContain('紧凑徽章收藏');
    expect(latest.compatibility).toContain('内部schema2');
  });
  it('keeps the desktop batch in 0.5.2 and records new awards/notes separately in 0.5.3', () => {
    const expansion = appReleaseNotes.find((n) => n.version === '0.5.3')!;
    expect(expansion.highlights.join(' ')).toContain('36项');
    expect(expansion.compatibility).toContain('schema3');
    expect(
      appReleaseNotes.find((n) => n.version === '0.5.4')!.compatibility,
    ).toContain('纯展示');
    expect(appReleaseNotes[0]!.version).toBe('0.5.5');
    expect(appReleaseNotes[0]!.title).toContain('达成回显');
    const desktop = appReleaseNotes.find((n) => n.version === '0.5.2')!;
    expect(desktop.title).toContain('PC');
    expect(desktop.highlights.join(' ')).toContain('主菜单版本胶囊');
  });
  it('retains the 0.1.0 engine compatibility hash unchanged', () => {
    const engineVersion = '20-personality-client-1';
    const old = `${engineVersion}-${shortHash(JSON.stringify({ engineVersion, rules: defaultRules, items: itemCatalog.map((item) => ({ ...item, name: item.id === 'moms_heart' ? '妈妈的心脏' : item.id === 'short_brimstone' ? '短程硫磺火' : item.name })), characters: characterCatalog })).replace(/^0+(?=.)/, '')}`;
    expect(releaseConfig.engineVersion).toBe(engineVersion);
    expect(saveCompatibility).toBe(old);
  });
  it('preserves current records and preserves their recorded historical build identity', () => {
    let session = reduceGameSession(createGameSession(42), {
      type: 'start_game',
      characterId: 'lost',
    });
    session = reduceGameSession(session, {
      type: 'submit_player_turn',
      turn: { playerId: 'human', actions: [{ type: 'withdraw' }] },
    });
    session.replay!.startedBuild = '0.1.0-3b5da081e60f';
    session.replay!.rooms[0]!.build = '0.1.0-3b5da081e60f';
    expect(parseGameSave(serializeGameSave(session)).session).toEqual(session);
    expect(
      parseReplay(serializeReplay(session.replay!, '0.1.0-3b5da081e60f'))
        .replay,
    ).toEqual(session.replay);
  });
});
