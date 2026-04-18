import { useEffect, useMemo } from 'react';
import { usePlaybackStore } from '@/shared/state/playback';
import { useBlobUrlVersion } from '@/infrastructure/browser/blob-url-manager';
import { backgroundBatchPreseek } from '@/features/preview/utils/decoder-prewarm';
import type { TimelineItem } from '@/types/timeline';
import { resolveMediaUrl, resolveProxyUrl } from '../utils/media-resolver';

const CACHE_TIME_QUANTUM = 1 / 60;

export function useEditOverlayPanelPrewarm(
  panels: ReadonlyArray<{ item: TimelineItem | null; sourceTime?: number }>,
): void {
  const useProxy = usePlaybackStore((s) => s.useProxy);
  const blobUrlVersion = useBlobUrlVersion();
  const panelSignature = panels.map((panel) => {
    const item = panel.item;
    if (!item || item.type !== 'video') {
      return 'none';
    }
    return `${item.id}:${item.mediaId ?? 'none'}:${Math.max(0, panel.sourceTime ?? 0).toFixed(6)}`;
  }).join('|');
  const prewarmTargets = useMemo(
    () => panels.map((panel) => ({ item: panel.item, sourceTime: panel.sourceTime })),
    [panelSignature],
  );

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const requests = await Promise.all(prewarmTargets.map(async (panel) => {
        const item = panel.item;
        if (!item || item.type !== 'video' || !item.mediaId) {
          return null;
        }

        const targetTime = Math.max(0, panel.sourceTime ?? 0);
        if (useProxy) {
          const proxyUrl = resolveProxyUrl(item.mediaId);
          if (proxyUrl) {
            return { src: proxyUrl, targetTime };
          }
        }

        const mediaUrl = await resolveMediaUrl(item.mediaId).catch(() => null);
        if (!mediaUrl) {
          return null;
        }

        return { src: mediaUrl, targetTime };
      }));

      if (cancelled) return;

      const groupedBySrc = new Map<string, number[]>();
      for (const request of requests) {
        if (!request) continue;

        const quantizedTime = Math.round(request.targetTime / CACHE_TIME_QUANTUM) * CACHE_TIME_QUANTUM;
        const existing = groupedBySrc.get(request.src);
        if (existing) {
          if (!existing.includes(quantizedTime)) {
            existing.push(quantizedTime);
          }
        } else {
          groupedBySrc.set(request.src, [quantizedTime]);
        }
      }

      for (const [src, timestamps] of groupedBySrc) {
        void backgroundBatchPreseek(src, timestamps).catch(() => null);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [blobUrlVersion, prewarmTargets, useProxy]);
}
