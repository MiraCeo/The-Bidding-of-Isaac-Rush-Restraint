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
    expect(appVersion).toBe('0.3.9');
    expect(packageInfo.version).toBe(appReleaseNotes[0]!.version);
    expect(lockInfo.version).toBe(appVersion);
    expect(lockInfo.packages[''].version).toBe(appVersion);
    expect(saveFormatVersion).toBe(3);
    expect(replayFormatVersion).toBe(3);
  });
  it('retains the 0.1.0 engine compatibility hash unchanged', () => {
    const engineVersion = '20-personality-client-1';
    const old = `${engineVersion}-${shortHash(JSON.stringify({ engineVersion, rules: defaultRules, items: itemCatalog.map((item) => ({ ...item, name: item.id === 'moms_heart' ? '妈妈的心脏' : item.id === 'short_brimstone' ? '短程硫磺火' : item.name })), characters: characterCatalog })).replace(/^0+(?=.)/, '')}`;
    expect(releaseConfig.engineVersion).toBe(engineVersion);
    expect(saveCompatibility).toBe(old);
  });
  it('continues v2 records and preserves their recorded historical build identity', () => {
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
