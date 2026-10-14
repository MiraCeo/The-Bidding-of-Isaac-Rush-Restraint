import { playerProfileKey } from './player-profile';

export const progressChangedEvent = 'bidding-progress-changed';
/** Notifications never change the success/failure of an already completed write. */
export function notifyPlayerProfileChanged(): void {
  try {
    if (typeof window !== 'undefined')
      window.dispatchEvent(new Event(progressChangedEvent));
  } catch {
    /* UI observers must not invalidate persistence. */
  }
}
export function subscribePlayerProfileChanges(
  listener: () => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const storage = (event: StorageEvent) => {
    if (event.key !== playerProfileKey && event.key !== null) return;
    try {
      if (event.storageArea && event.storageArea !== window.localStorage)
        return;
    } catch {
      /* A blocked getter is handled by the subscriber's safe loader. */
    }
    listener();
  };
  window.addEventListener(progressChangedEvent, listener);
  window.addEventListener('storage', storage);
  window.addEventListener('focus', listener);
  return () => {
    window.removeEventListener(progressChangedEvent, listener);
    window.removeEventListener('storage', storage);
    window.removeEventListener('focus', listener);
  };
}
