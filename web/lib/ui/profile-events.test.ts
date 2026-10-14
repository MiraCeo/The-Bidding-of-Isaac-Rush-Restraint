// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import {
  notifyPlayerProfileChanged,
  progressChangedEvent,
  subscribePlayerProfileChanges,
} from './profile-events';
import { restorePlayerProfileBackup } from './player-profile-file';
import { profileFileFixture } from './player-profile-file.test-helper';
import { playerProfileKey } from './player-profile';
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
it('observes same-page profile changes, other-page storage changes and focus, with complete cleanup', () => {
  const listener = vi.fn(),
    unsubscribe = subscribePlayerProfileChanges(listener);
  notifyPlayerProfileChanged();
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: playerProfileKey,
      storageArea: localStorage,
    }),
  );
  window.dispatchEvent(new Event('focus'));
  expect(listener).toHaveBeenCalledTimes(3);
  unsubscribe();
  window.dispatchEvent(new Event(progressChangedEvent));
  window.dispatchEvent(new StorageEvent('storage', { key: playerProfileKey }));
  window.dispatchEvent(new Event('focus'));
  expect(listener).toHaveBeenCalledTimes(3);
});
it('ignores unrelated keys and session storage but observes a local clear', () => {
  const listener = vi.fn(),
    unsubscribe = subscribePlayerProfileChanges(listener);
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: 'unrelated',
      storageArea: localStorage,
    }),
  );
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: playerProfileKey,
      storageArea: sessionStorage,
    }),
  );
  expect(listener).not.toHaveBeenCalled();
  window.dispatchEvent(
    new StorageEvent('storage', { key: null, storageArea: localStorage }),
  );
  expect(listener).toHaveBeenCalledOnce();
  unsubscribe();
});
it('does not throw when the localStorage getter becomes blocked during a storage notification', () => {
  const area = localStorage,
    listener = vi.fn(),
    unsubscribe = subscribePlayerProfileChanges(listener);
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw Error('blocked');
  });
  expect(() =>
    window.dispatchEvent(
      new StorageEvent('storage', { key: playerProfileKey, storageArea: area }),
    ),
  ).not.toThrow();
  expect(listener).toHaveBeenCalledOnce();
  unsubscribe();
});
it('preserves a successful single-key write even if notification delivery throws', () => {
  vi.spyOn(window, 'dispatchEvent').mockImplementation(() => {
    throw Error('observer');
  });
  const result = restorePlayerProfileBackup(
    localStorage,
    profileFileFixture(),
    null,
  );
  expect(result.changed).toBe(true);
  expect(JSON.parse(localStorage.getItem(playerProfileKey)!)).toEqual(
    profileFileFixture(),
  );
});
