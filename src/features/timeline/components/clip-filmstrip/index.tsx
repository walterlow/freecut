import { memo, useEffect, useState, useMemo, useCallback, useRef, type RefCallback } from 'react'
import { FilmstripSkeleton } from './filmstrip-skeleton'
import { useFilmstrip, type FilmstripFrame } from '../../hooks/use-filmstrip'
import { resolveMediaUrl, resolveProxyUrl } from '@/features/timeline/deps/media-library-resolver'
import { useMediaBlobUrl } from '../../hooks/use-media-blob-url'
import { filmstripCache, THUMBNAIL_WIDTH } from '../../services/filmstrip-cache'
import { createLogger } from '@/shared/logging/logger'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'

const logger = createLogger('ClipFilmstrip')

interface ClipFilmstripProps {
  /** Media ID from the timeline item */
  mediaId: string
  /** Visible width of the clip in pixels */
  clipWidth: number
  /** Optional overscan width used to hide trailing-edge width commit lag */
  renderWidth?: number
  /** Source start time in seconds (for trimmed clips) */
  sourceStart: number
  /** Source end time in seconds (for trimmed clips) */
  sourceEnd?: number
  /** Total source duration in seconds */
  sourceDuration: number
  /** Trim start in seconds (how much trimmed from beginning) */
  trimStart: number
  /** Playback speed multiplier */
  speed: number
  /** Whether the clip plays source media in reverse */
  isReversed?: boolean
  /** Frames per second */
  fps: number
  /** Whether the clip is visible (from IntersectionObserver) */
  isVisible: boolean
  /** Visible horizontal range within this clip (0-1 ratios) */
  visibleStartRatio?: number
  visibleEndRatio?: number
  /** Pixels per second from parent (avoids redundant zoom subscription) */
  pixelsPerSecond: number
  /** Disable deferred width/zoom while active edit previews are running */
  preferImmediateRendering?: boolean
}

/**
 * Simple filmstrip tile - memoized to prevent unnecessary re-renders.
 * Renders from ImageBitmap via canvas when available (instant, no JPEG decode),
 * falls back to <img> for blob URL sources (OPFS-loaded frames).
 */
const FilmstripTile = memo(function FilmstripTile({
  src,
  bitmap,
  x,
  height,
  width,
  sourceWidth,
  frameIndex,
  onSourceError,
}: {
  src: string
  bitmap?: ImageBitmap
  x: number
  height: number
  width: number
  sourceWidth: number
  frameIndex: number
  onSourceError?: (frameIndex: number) => void
}) {
  const [errorSrc, setErrorSrc] = useState<string | null>(null)

  // Draw bitmap to canvas when ref is attached or bitmap changes.
  // Assigning canvas.width/height resets the backing buffer even when the value
  // doesn't change, so guard against same-size writes to avoid wasted realloc.
  const canvasRefCallback: RefCallback<HTMLCanvasElement> = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas || !bitmap || bitmap.width === 0 || bitmap.height === 0) return
      const targetWidth = Math.max(1, Math.round(sourceWidth))
      const targetHeight = Math.max(1, Math.round(height))
      if (canvas.width !== targetWidth) canvas.width = targetWidth
      if (canvas.height !== targetHeight) canvas.height = targetHeight
      const ctx = canvas.getContext('2d')
      try {
        if (ctx) {
          const scale = Math.max(targetWidth / bitmap.width, targetHeight / bitmap.height)
          const drawWidth = bitmap.width * scale
          const drawHeight = bitmap.height * scale
          const drawX = (targetWidth - drawWidth) * 0.5
          const drawY = (targetHeight - drawHeight) * 0.5
          ctx.clearRect(0, 0, targetWidth, targetHeight)
          ctx.drawImage(bitmap, drawX, drawY, drawWidth, drawHeight)
        }
      } catch {
        // Bitmap may have been closed/detached by the time React renders
      }
    },
    [bitmap, height, sourceWidth],
  )

  const handleError = useCallback(() => {
    setErrorSrc(src)
    onSourceError?.(frameIndex)
  }, [frameIndex, onSourceError, src])

  // Bitmap path: render to canvas (instant, no JPEG decode)
  if (bitmap) {
    return (
      <div
        aria-hidden
        className="absolute top-0"
        style={{
          left: x,
          width,
          height,
          overflow: 'hidden',
        }}
      >
        <canvas
          ref={canvasRefCallback}
          className="absolute top-0 left-0"
          style={{
            width: sourceWidth,
            height,
          }}
        />
      </div>
    )
  }

  // Hide if this specific src failed, but allow new src to try again
  if (!src || errorSrc === src) {
    return null
  }

  const shouldRepeat = width > sourceWidth + 1
  if (shouldRepeat) {
    return (
      <div
        aria-hidden
        className="absolute top-0"
        style={{
          left: x,
          width,
          height,
          backgroundImage: `url(${src})`,
          backgroundRepeat: 'repeat-x',
          backgroundSize: `${sourceWidth}px ${height}px`,
          backgroundPosition: 'left top',
        }}
      >
        <img
          src={src}
          alt=""
          aria-hidden
          className="absolute h-px w-px opacity-0 pointer-events-none"
          onError={handleError}
          style={{ left: 0, top: 0 }}
        />
      </div>
    )
  }

  return (
    <div
      aria-hidden
      className="absolute top-0"
      style={{
        left: x,
        width,
        height,
        overflow: 'hidden',
      }}
    >
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        className="absolute top-0 left-0"
        onError={handleError}
        style={{
          width: sourceWidth,
          height,
          objectFit: 'cover',
        }}
      />
    </div>
  )
})

/**
 * Clip Filmstrip Component
 *
 * Renders video frame thumbnails as a tiled filmstrip.
 * Uses adaptive tile density during active zoom to keep interactions responsive
 * without deferring the zoom state itself.
 * Auto-fills container height.
 */
export const ClipFilmstrip = memo(function ClipFilmstrip({
  mediaId,
  clipWidth,
  renderWidth,
  sourceStart,
  sourceEnd,
  sourceDuration,
  trimStart,
  speed,
  isReversed = false,
  isVisible,
  pixelsPerSecond,
}: ClipFilmstripProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  const { blobUrl, setBlobUrl, hasStartedLoadingRef, blobUrlVersion } = useMediaBlobUrl(mediaId)
  const refreshingFrameIndicesRef = useRef<Set<number>>(new Set())
  const proxyStatus = useMediaLibraryStore((s) => s.proxyStatus.get(mediaId) ?? null)

  const proxyBlobUrl = useMemo(() => {
    if (proxyStatus !== 'ready') {
      return null
    }
    return resolveProxyUrl(mediaId)
  }, [mediaId, proxyStatus])
  const filmstripSourceUrl = proxyBlobUrl ?? blobUrl

  // Measure container height
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const measure = () => {
      const parent = container.parentElement
      if (parent) {
        setHeight(parent.clientHeight)
      }
    }

    measure()

    const resizeObserver = new ResizeObserver(measure)
    if (container.parentElement) {
      resizeObserver.observe(container.parentElement)
    }

    return () => resizeObserver.disconnect()
  }, [])

  // Calculate thumbnail width based on height (16:9 aspect ratio)
  const thumbnailWidth = Math.round(height * (16 / 9)) || THUMBNAIL_WIDTH

  const renderPixelsPerSecond = pixelsPerSecond
  const visibleClipWidth = clipWidth
  const renderClipWidth = Math.max(visibleClipWidth, renderWidth ?? visibleClipWidth)
  const effectiveStart = Math.max(0, sourceStart + trimStart)
  const effectiveEnd = Math.min(
    sourceDuration,
    Math.max(
      effectiveStart,
      sourceEnd ?? effectiveStart + (visibleClipWidth / Math.max(1, renderPixelsPerSecond)) * speed,
    ),
  )
  // No zoom-driven extraction targeting. Earlier we passed a priorityWindow +
  // targetFrameIndices that flipped on every pps change, which made the cache
  // mark frames as re-extracting and the tiles momentarily showed a "broken
  // thumbnail" while the cache published refining state. Letting the cache
  // extract its default 1fps coverage once per clip and never re-targeting on
  // zoom keeps already-loaded thumbnails stable across every zoom step.
  const priorityWindow = null
  const targetFrameCount = undefined
  const targetFrameIndices = undefined

  // Load blob URL lazily when visible, and retry after global invalidation.
  useEffect(() => {
    if (!isVisible || !mediaId || proxyBlobUrl || hasStartedLoadingRef.current) {
      return
    }
    hasStartedLoadingRef.current = true

    let mounted = true
    const loadBlobUrl = async () => {
      try {
        const url = await resolveMediaUrl(mediaId)
        if (mounted && url) {
          setBlobUrl(url)
        }
      } catch (error) {
        logger.error('Failed to load media blob URL:', error)
      }
    }

    loadBlobUrl()

    return () => {
      mounted = false
    }
  }, [mediaId, isVisible, proxyBlobUrl, blobUrlVersion, hasStartedLoadingRef, setBlobUrl])

  // Use filmstrip hook. `enabled` no longer requires the source blob URL —
  // disk-cached frames can render before useMediaBlobUrl resolves. The
  // extraction path inside the hook still gates on blobUrl.
  const { frames, isLoading, error } = useFilmstrip({
    mediaId,
    blobUrl: filmstripSourceUrl,
    duration: sourceDuration,
    isVisible,
    enabled: sourceDuration > 0,
    priorityWindow,
    targetFrameCount,
    targetFrameIndices,
  })

  const handleFrameSourceError = useCallback(
    (frameIndex: number) => {
      if (!mediaId || refreshingFrameIndicesRef.current.has(frameIndex)) {
        return
      }

      refreshingFrameIndicesRef.current.add(frameIndex)
      void filmstripCache
        .refreshFrames(mediaId, [frameIndex])
        .catch((refreshError) => {
          logger.warn('Failed to refresh stale filmstrip frame URL:', refreshError)
        })
        .finally(() => {
          refreshingFrameIndicesRef.current.delete(frameIndex)
        })
    },
    [mediaId],
  )

  // Pixel-aligned slot grid. Slots are at x = 0, thumbnailWidth, 2*thumbnailWidth, …
  // up to the clip's right edge. Each slot's content is the closest available
  // extracted frame for the source time at that slot's center — so extraction
  // gaps are silently filled with the nearest frame instead of producing an
  // alternating-size visual.
  //
  // - Tile width is exactly thumbnailWidth — never stretched, squashed, or
  //   merged. Segment boundaries are handled by overflow clipping outside the
  //   tile, so a short segment only reveals less of the full-size tile.
  // - key=slot is the integer slot index on the pixel grid. At fixed zoom the
  //   slot set never changes; scrolling can't refresh tiles, and a slot's
  //   frame prop updating as extraction lands doesn't remount its DOM.
  const tiles = useMemo(() => {
    if (!frames || frames.length === 0 || renderPixelsPerSecond <= 0) return []
    if (effectiveEnd <= effectiveStart) return []

    const pixelsPerSourceSecond = renderPixelsPerSecond / Math.max(0.0001, speed)
    const tileWidth = thumbnailWidth
    const slotCount = Math.ceil(renderClipWidth / tileWidth)
    if (slotCount === 0) return []

    const findClosestFrame = (targetTime: number): FilmstripFrame | null => {
      if (frames.length === 0) return null
      let lo = 0
      let hi = frames.length - 1
      let best = frames[0]!
      let bestDiff = Math.abs(best.index - targetTime)
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const f = frames[mid]!
        const diff = Math.abs(f.index - targetTime)
        if (diff < bestDiff) {
          best = f
          bestDiff = diff
        }
        if (f.index < targetTime) lo = mid + 1
        else hi = mid - 1
      }
      return best
    }

    const result: { slot: number; frame: FilmstripFrame; x: number; width: number }[] = []

    for (let slot = 0; slot < slotCount; slot++) {
      const slotX = slot * tileWidth
      const slotCenterX = slotX + tileWidth * 0.5
      const slotCenterTime = isReversed
        ? effectiveEnd - slotCenterX / pixelsPerSourceSecond
        : effectiveStart + slotCenterX / pixelsPerSourceSecond
      const frame = findClosestFrame(slotCenterTime)
      if (!frame) continue
      result.push({ slot, frame, x: slotX, width: tileWidth })
    }

    return result
  }, [
    frames,
    renderPixelsPerSecond,
    renderClipWidth,
    effectiveStart,
    effectiveEnd,
    isReversed,
    speed,
    thumbnailWidth,
  ])

  // Lock a stable cover-frame index on first paint. Without this, the middle
  // frame moves as refinement extraction adds new frames, so the repeating
  // background URL swaps mid-zoom and produces a visible flash. Resetting on
  // mediaId change keeps relinked clips correct.
  const [coverFrameIndex, setCoverFrameIndex] = useState<number | null>(null)
  useEffect(() => {
    setCoverFrameIndex(null)
  }, [mediaId])
  useEffect(() => {
    if (coverFrameIndex !== null) return
    if (!frames || frames.length === 0) return
    const mid = frames[Math.floor(frames.length / 2)] ?? frames[0] ?? null
    if (mid) setCoverFrameIndex(mid.index)
  }, [coverFrameIndex, frames])
  const coverFrame = useMemo(() => {
    if (!frames || frames.length === 0) return null
    if (coverFrameIndex !== null) {
      const exact = frames.find((frame) => frame.index === coverFrameIndex)
      if (exact) return exact
    }
    return frames[Math.floor(frames.length / 2)] ?? frames[0] ?? null
  }, [coverFrameIndex, frames])
  const coverFrameUrl = coverFrame?.url ?? null

  if (error) {
    return null
  }

  // Show skeleton while actively loading.
  if (!frames || frames.length === 0 || height === 0) {
    if (!isLoading && height > 0) {
      return <div ref={containerRef} className="absolute inset-0" />
    }
    return (
      <div ref={containerRef} className="absolute inset-0">
        <FilmstripSkeleton clipWidth={visibleClipWidth} height={height || 40} />
      </div>
    )
  }

  return (
    <div ref={containerRef} className="absolute inset-0">
      {/* No inline shimmer once we have any frames. The cover-frame background
          + already-rendered tiles are the user's visual feedback. The shimmer
          used to re-show whenever extraction refinement flipped `isComplete`
          to false (e.g. after a zoom-triggered target update), which read as
          a "blink/refresh" mid-zoom — even though the loaded frames never
          actually went away. */}
      {/* Stable cover-frame background layer — fills any gap before a tile's
          canvas has painted its bitmap, so the user never sees a black hole. */}
      {coverFrameUrl && (
        <div
          aria-hidden
          className="absolute inset-0 overflow-hidden pointer-events-none"
          style={{
            backgroundImage: `url(${coverFrameUrl})`,
            backgroundRepeat: 'repeat-x',
            backgroundSize: `${thumbnailWidth}px ${height}px`,
          }}
        />
      )}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {tiles.map(({ slot, frame, x, width }) => (
          <FilmstripTile
            key={slot}
            src={frame.url}
            bitmap={frame.bitmap}
            x={x}
            height={height}
            width={width}
            sourceWidth={thumbnailWidth}
            frameIndex={frame.index}
            onSourceError={handleFrameSourceError}
          />
        ))}
        {/* Hidden probe to detect stale cover background URL */}
        {coverFrame && !coverFrame.bitmap && (
          <img
            src={coverFrame.url}
            alt=""
            aria-hidden
            className="absolute h-px w-px opacity-0 pointer-events-none"
            style={{ left: 0, top: 0 }}
            onError={() => handleFrameSourceError(coverFrame.index)}
          />
        )}
      </div>
    </div>
  )
})
