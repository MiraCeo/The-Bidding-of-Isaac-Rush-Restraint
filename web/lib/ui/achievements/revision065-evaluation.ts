import { decodeAchievementEvent } from './event-codec';
import { revision065NewSeries } from './revision065-catalog';
import type { AchievementId } from './catalog';
import type { AchievementReceipt } from './registry';
import { balance081Target } from './balance081-targets';
export function createRevision065Scan() {
  return {
    progress: Object.fromEntries(
      revision065NewSeries.flatMap((s) => s.ids.map((id) => [id, 0])),
    ) as Partial<Record<AchievementId, number>>,
    achievedAt: {} as Partial<Record<AchievementId, string>>,
  };
}
export function cloneRevision065Scan(
  s: ReturnType<typeof createRevision065Scan>,
) {
  return { progress: { ...s.progress }, achievedAt: { ...s.achievedAt } };
}
export function scanRevision065Receipt(
  s: ReturnType<typeof createRevision065Scan>,
  r: AchievementReceipt,
  active: boolean,
) {
  const e = decodeAchievementEvent(r);
  if (e.stage === 'room')
    for (const series of revision065NewSeries) {
      const occurred =
        e.facts[series.metric] &&
        (series.metric !== 'eternalCleared' ||
          (e.facts.scoreBeforeClear ?? 0) > 0);
      if (occurred)
        for (const id of series.ids) {
          const n = (s.progress[id] ?? 0) + 1;
          if (!Number.isSafeInteger(n))
            throw Error('成就房间累计超限，原档案保留。');
          s.progress[id] = n;
        }
    }
  // Old exact cause receipts may supply counts, but never retroactive grant time.
  if (active)
    for (const series of revision065NewSeries)
      series.ids.forEach((id, i) => {
        if (
          (s.progress[id] ?? 0) >= balance081Target(id, series.targets[i]!) &&
          !s.achievedAt[id]
        )
          s.achievedAt[id] = r.at;
      });
}
