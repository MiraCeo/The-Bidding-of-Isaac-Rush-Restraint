import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ReplayLibraryPanel } from '@/components/game/replay-library-panel';
import { studyStats } from './large-library-study';
import type { ReplayLibraryEntry } from '../replay-library';

function waitDom(host: HTMLElement, check: () => boolean): Promise<void> {
  if (check()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (check()) {
        observer.disconnect();
        clearTimeout(timeout);
        resolve();
      }
    });
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(Error('正式界面DOM未在10秒内就绪。'));
    }, 10000);
    observer.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  });
}
/** Actual production component. DOM commit/readiness, not paint time or FPS. */
export async function measureLibraryUi(
  host: HTMLElement,
  entries: ReplayLibraryEntry[],
) {
  const mounts: number[] = [],
    filters: number[] = [],
    returns: number[] = [],
    classics = entries.filter((e) => e.mode === 'classic'),
    isaacs = classics.filter((e) => e.characterId === 'isaac');
  for (let i = 0; i < 3; i++) {
    const root = createRoot(host);
    try {
      let start = performance.now();
      root.render(
        createElement(ReplayLibraryPanel, {
          mode: 'classic',
          current: null,
          recent: null,
          archiveStatus: '',
          onReplay: () => {},
        }),
      );
      await waitDom(
        host,
        () =>
          !!host
            .querySelector('.library-capacity')
            ?.textContent?.includes(`${entries.length} / 100`) &&
          host.querySelectorAll('.replay-library tbody tr').length ===
            classics.length,
      );
      mounts.push(performance.now() - start);
      const select = host.querySelector<HTMLSelectElement>(
        'select[aria-label="回放库角色"]',
      )!;
      start = performance.now();
      select.value = 'isaac';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await waitDom(
        host,
        () =>
          host.querySelectorAll('.replay-library tbody tr').length ===
          isaacs.length,
      );
      filters.push(performance.now() - start);
      start = performance.now();
      select.value = 'all';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await waitDom(
        host,
        () =>
          host.querySelectorAll('.replay-library tbody tr').length ===
          classics.length,
      );
      returns.push(performance.now() - start);
    } finally {
      root.unmount();
    }
  }
  return {
    classicVisibleRows: classics.length,
    isaacVisibleRows: isaacs.length,
    mountDomIncludingIndexRead: studyStats(mounts),
    filterDom: studyStats(filters),
    returnAllDom: studyStats(returns),
    paintOrFrameRateMeasured: false,
  };
}
