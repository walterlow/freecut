import { useEffect, useMemo, useRef } from 'react'
import { useBlobUrlVersion } from '@/infrastructure/browser/blob-url-manager'
import { backgroundBatchPreseek } from '@/features/preview/utils/decoder-prewarm'
import type { TimelineItem } from '@/types/timeline'
import { resolveMediaUrl, resolveProxyUrl } from '../utils/media-resolver'
import { collectEditOverlayDirectionalPrewarmTimes } from '../utils/edit-overlay-prewarm-plan'
import {
  getEditOverlayFrameCacheKey,
  hasCachedEditOverlayFrame,
} from '../utils/edit-overlay-frame-cache'
import { getCachedPredecodedBitmap } from '../utils/decoder-prewarm'

const CACHE_TIME_QUANTUM = 1 / 60
const EDIT_OVERLAY_PREWARM_MAX_TIMESTAMPS = 6

export function useEditOverlayPanelPrewarm(
  panels: ReadonlyArray<{ item: TimelineItem | null; sourceTime?: number }>,
): void {
  const blobUrlVersion = useBlobUrlVersion()
  const previousAnchorFrameByPanelRef = useRef(new Map<string, number | null>())
  const prewarmTargets = useMemo(
    () => panels.map((panel) => ({ item: panel.item, sourceTime: panel.sourceTime })),
    [panels],
  )

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const requests = await Promise.all(
        prewarmTargets.map(async (panel, index) => {
          const item = panel.item
          if (!item || item.type !== 'video' || !item.mediaId) {
            return null
          }

          const targetTime = Math.max(0, panel.sourceTime ?? 0)
          const panelKey = `${index}:${item.id}:${item.mediaId}`
          const fps = Math.max(1, Math.round(item.sourceFps ?? 60))
          const duration =
            item.sourceDuration && Number.isFinite(item.sourceDuration)
              ? Math.max(targetTime + CACHE_TIME_QUANTUM, item.sourceDuration / fps)
              : targetTime + 1
          const proxyUrl = resolveProxyUrl(item.mediaId)
          if (proxyUrl) {
            return { src: proxyUrl, targetTime, panelKey, fps, duration }
          }

          const mediaUrl = await resolveMediaUrl(item.mediaId).catch(() => null)
          if (!mediaUrl) {
            return null
          }

          return {
            src: mediaUrl,
            targetTime,
            panelKey,
            fps,
            duration,
          }
        }),
      )

      if (cancelled) return

      const groupedBySrc = new Map<string, number[]>()
      const activePanelKeys = new Set<string>()
      for (const request of requests) {
        if (!request) continue
        activePanelKeys.add(request.panelKey)

        const quantizedTime =
          Math.round(request.targetTime / CACHE_TIME_QUANTUM) * CACHE_TIME_QUANTUM
        const existing = groupedBySrc.get(request.src)
        if (existing) {
          if (!existing.includes(quantizedTime)) {
            existing.push(quantizedTime)
          }
        } else {
          groupedBySrc.set(request.src, [quantizedTime])
        }

        const previousAnchorFrame =
          previousAnchorFrameByPanelRef.current.get(request.panelKey) ?? null
        const directionalPlan = collectEditOverlayDirectionalPrewarmTimes({
          targetTime: request.targetTime,
          duration: request.duration,
          fps: request.fps,
          previousAnchorFrame,
          quantumSeconds: CACHE_TIME_QUANTUM,
          maxTimestamps: EDIT_OVERLAY_PREWARM_MAX_TIMESTAMPS,
          isCached: (time) => {
            const overlayCacheKey = getEditOverlayFrameCacheKey(
              request.src,
              time,
              CACHE_TIME_QUANTUM,
            )
            return (
              hasCachedEditOverlayFrame(overlayCacheKey) ||
              getCachedPredecodedBitmap(request.src, time, CACHE_TIME_QUANTUM) !== null
            )
          },
        })
        previousAnchorFrameByPanelRef.current.set(request.panelKey, directionalPlan.targetFrame)

        for (const time of directionalPlan.times) {
          const bySrc = groupedBySrc.get(request.src)
          if (!bySrc) {
            groupedBySrc.set(request.src, [time])
            continue
          }
          if (!bySrc.includes(time)) {
            bySrc.push(time)
          }
        }
      }

      for (const panelKey of [...previousAnchorFrameByPanelRef.current.keys()]) {
        if (!activePanelKeys.has(panelKey)) {
          previousAnchorFrameByPanelRef.current.delete(panelKey)
        }
      }

      for (const [src, timestamps] of groupedBySrc) {
        void backgroundBatchPreseek(src, timestamps).catch(() => null)
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [blobUrlVersion, prewarmTargets])
}
