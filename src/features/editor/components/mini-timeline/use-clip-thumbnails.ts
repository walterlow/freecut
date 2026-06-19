import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  importMediaLibraryService,
  resolveMediaUrl,
  useMediaLibraryStore,
} from '@/features/editor/deps/media-library'
import { useFilmstrip, type FilmstripFrame } from '@/features/editor/deps/timeline-hooks'
import type { MiniFilmTileClip } from './types'

/**
 * Resolve poster thumbnails (the per-media frame captured at import) for clips
 * with no inline `thumbnailUrl`, so film tiles show a real frame instead of a
 * flat placeholder. The media library service owns/caches/revokes these blob
 * URLs — read only, never revoke here.
 */
export function useMediaPosterUrls(mediaIds: readonly string[]): Map<string, string> {
  const [posterUrls, setPosterUrls] = useState<Map<string, string>>(() => new Map())

  // Reactive snapshot of which media have a poster available, so a clip painted
  // before its thumbnail finishes generating re-resolves once it lands.
  const thumbnailIds = useMediaLibraryStore(
    useShallow((s) => {
      const out: Record<string, string | undefined> = {}
      for (const id of mediaIds) {
        out[id] = s.mediaById[id]?.thumbnailId
      }
      return out
    }),
  )

  useEffect(() => {
    const missing = Object.entries(thumbnailIds)
      .filter(([id, thumbnailId]) => thumbnailId && !posterUrls.has(id))
      .map(([id]) => id)
    if (missing.length === 0) return

    let cancelled = false
    void importMediaLibraryService().then(async ({ mediaLibraryService }) => {
      if (cancelled) return
      // allSettled (not all): one failed thumbnail must not drop the whole
      // batch of successfully-resolved posters.
      const settled = await Promise.allSettled(
        missing.map(async (id) => [id, await mediaLibraryService.getThumbnailBlobUrl(id)] as const),
      )
      if (cancelled) return
      const entries = settled.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      )
      setPosterUrls((prev) => {
        let changed = false
        const next = new Map(prev)
        for (const [id, url] of entries) {
          if (url && !next.has(id)) {
            next.set(id, url)
            changed = true
          }
        }
        return changed ? next : prev
      })
    })

    return () => {
      cancelled = true
    }
  }, [thumbnailIds, posterUrls])

  return posterUrls
}

/**
 * Extract the frame at a video clip's actual start (DaVinci-style), reusing the
 * shared filmstrip cache (1fps, worker-pooled, deduped per media, disk-cached).
 * Returns null for non-video clips or until the frame lands — callers fall back
 * to the import poster so a tile never flashes black.
 */
export function useClipStartFrameUrl(clip: MiniFilmTileClip, projectFps: number): string | null {
  const isVideo = clip.type === 'video' && Boolean(clip.mediaId)
  const mediaId = clip.mediaId ?? ''

  const mediaDuration = useMediaLibraryStore(
    useCallback((s) => s.mediaById[mediaId]?.duration ?? 0, [mediaId]),
  )
  const mediaFps = useMediaLibraryStore(
    useCallback((s) => s.mediaById[mediaId]?.fps ?? 0, [mediaId]),
  )

  // Tie the resolved URL to the media it belongs to so a tile reused for a new
  // mediaId (same clip.id, relinked/replaced source) doesn't keep feeding the
  // old blob URL into useFilmstrip — `blobUrl` falls back to null until the new
  // media resolves.
  const [resolved, setResolved] = useState<{ mediaId: string; url: string } | null>(null)
  const blobUrl = resolved?.mediaId === mediaId ? resolved.url : null

  useEffect(() => {
    if (!isVideo || !mediaId || blobUrl) return
    let cancelled = false
    void resolveMediaUrl(mediaId)
      .then((url) => {
        if (!cancelled && url) setResolved({ mediaId, url })
      })
      .catch(() => {
        /* extraction simply stays unavailable; poster fallback remains */
      })
    return () => {
      cancelled = true
    }
  }, [isVideo, mediaId, blobUrl])

  // Source-frame -> seconds, mirroring clip-content's conversion. Prefer the
  // media's real duration (duration-ratio) over source-fps division when known.
  const sourceFps = clip.sourceFps > 0 ? clip.sourceFps : mediaFps > 0 ? mediaFps : 30
  const sourceDurationSeconds =
    mediaDuration > 0 ? mediaDuration : clip.sourceDurationFrames / sourceFps
  const sourceStartSeconds =
    mediaDuration > 0
      ? (clip.sourceStartFrames / clip.sourceDurationFrames) * mediaDuration
      : clip.sourceStartFrames / sourceFps
  const startSeconds = Math.max(
    0,
    sourceStartSeconds + clip.trimStartFrames / Math.max(1, projectFps),
  )
  const startIndex = Math.floor(startSeconds)

  const targetFrameIndices = useMemo(() => [startIndex], [startIndex])
  const priorityWindow = useMemo(
    () => ({ startTime: startSeconds, endTime: startSeconds + 1 }),
    [startSeconds],
  )

  const { frames } = useFilmstrip({
    mediaId,
    blobUrl,
    duration: sourceDurationSeconds,
    isVisible: isVideo,
    enabled: isVideo,
    priorityWindow,
    targetFrameIndices,
  })

  return useMemo(() => {
    if (!frames || frames.length === 0) return null
    let best: FilmstripFrame | null = null
    for (const frame of frames) {
      if (!best || Math.abs(frame.index - startIndex) < Math.abs(best.index - startIndex)) {
        best = frame
      }
    }
    return best?.url ?? null
  }, [frames, startIndex])
}
