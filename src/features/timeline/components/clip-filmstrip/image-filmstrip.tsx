import { memo, useEffect, useState, useRef, useMemo, useCallback, type RefCallback } from 'react'
import { useGifFrames } from '../../hooks/use-gif-frames'
import { useMediaBlobUrl } from '../../hooks/use-media-blob-url'
import { resolveMediaUrl } from '@/features/timeline/deps/media-library-resolver'
import { createLogger } from '@/shared/logging/logger'
import { computeFilmstripRenderWindow } from './render-window'

const logger = createLogger('ImageFilmstrip')

interface ImageFilmstripProps {
  /** Media ID from the timeline item */
  mediaId: string
  /** Whether the image is an animated format (GIF/WebP) */
  isAnimated: boolean
  /** Animation format for frame extraction */
  animationFormat?: 'gif' | 'webp'
  /** Visible width of the clip in pixels */
  clipWidth: number
  /** Optional overscan width used to hide trailing-edge width commit lag */
  renderWidth?: number
  /** Whether the clip is visible (from IntersectionObserver) */
  isVisible: boolean
  /** Source URL for the image (blob URL) */
  src: string
  /** Source start time in seconds */
  sourceStart: number
  /** Total source duration in seconds */
  sourceDuration: number
  /** Trim start in seconds */
  trimStart: number
  /** Playback speed multiplier */
  speed: number
  /** Frames per second */
  fps: number
  /** Visible horizontal range within this clip (0-1 ratios) */
  visibleStartRatio?: number
  visibleEndRatio?: number
  /** Pixels per second from parent */
  pixelsPerSecond: number
}

/**
 * A single tile for an animated image filmstrip.
 * Renders an ImageBitmap via canvas.
 */
const AnimatedTile = memo(function AnimatedTile({
  bitmap,
  x,
  width,
  height,
}: {
  bitmap: ImageBitmap
  x: number
  width: number
  height: number
}) {
  const canvasRefCallback: RefCallback<HTMLCanvasElement> = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas || !bitmap || bitmap.width === 0 || bitmap.height === 0) return
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')
      try {
        if (ctx) ctx.drawImage(bitmap, 0, 0)
      } catch {
        // Bitmap may have been closed/detached
      }
    },
    [bitmap],
  )

  return (
    <canvas
      ref={canvasRefCallback}
      className="absolute top-0"
      style={{ left: x, width, height, objectFit: 'cover' }}
    />
  )
})

const VIEWPORT_PAD_TILES = 2
const VIEWPORT_PAD_PX = 600

/**
 * Image Filmstrip Component
 *
 * For static images: tiles the image across the clip width.
 * For animated images (GIF/WebP): extracts frames and tiles them like a video filmstrip.
 */
export const ImageFilmstrip = memo(function ImageFilmstrip({
  mediaId,
  isAnimated,
  animationFormat = 'gif',
  clipWidth,
  renderWidth,
  isVisible,
  src,
  sourceStart,
  trimStart,
  speed,
  visibleStartRatio = 0,
  visibleEndRatio = 1,
  pixelsPerSecond,
}: ImageFilmstripProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)

  // Measure container height
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const measure = () => {
      const parent = container.parentElement
      if (parent) setHeight(parent.clientHeight)
    }
    measure()

    const resizeObserver = new ResizeObserver(measure)
    if (container.parentElement) resizeObserver.observe(container.parentElement)
    return () => resizeObserver.disconnect()
  }, [])

  // Resolve a fresh blob URL from the media library (survives page refresh)
  const { blobUrl, setBlobUrl, hasStartedLoadingRef, blobUrlVersion } = useMediaBlobUrl(mediaId)

  useEffect(() => {
    if (!isVisible || !mediaId || hasStartedLoadingRef.current) return
    hasStartedLoadingRef.current = true

    let mounted = true
    resolveMediaUrl(mediaId)
      .then((url) => {
        if (mounted && url) setBlobUrl(url)
      })
      .catch((error) => logger.error('Failed to load media blob URL:', error))
    return () => {
      mounted = false
    }
  }, [mediaId, isVisible, blobUrlVersion, hasStartedLoadingRef, setBlobUrl])

  const { frames, durations, totalDuration } = useGifFrames({
    mediaId,
    blobUrl,
    isVisible,
    enabled: isAnimated && !!blobUrl,
    format: animationFormat,
  })

  // Calculate thumbnail tile width based on height (maintain source aspect ratio roughly as 16:9)
  const tileWidth = Math.round(height * (16 / 9)) || 80
  const renderClipWidth = Math.max(clipWidth, renderWidth ?? clipWidth)

  // Resolve the URL to use: prefer freshly resolved blobUrl, fall back to item.src
  const resolvedSrc = blobUrl || src

  const effectiveStart = Math.max(0, sourceStart + trimStart)

  // Animated image filmstrip: tile extracted frames.
  // Must be called unconditionally (Rules of Hooks) — returns [] when not animated.
  const tiles = useMemo(() => {
    if (
      !isAnimated ||
      !frames ||
      frames.length === 0 ||
      !durations ||
      totalDuration === null ||
      totalDuration <= 0 ||
      height === 0
    ) {
      return []
    }

    const tileCount = Math.ceil(renderClipWidth / tileWidth)
    if (tileCount <= 0) return []

    // Viewport culling — only generate tiles in the visible range + padding
    const { startTile, endTile } = computeFilmstripRenderWindow({
      renderWidth: renderClipWidth,
      visibleWidth: clipWidth,
      tileWidth,
      visibleStartRatio,
      visibleEndRatio,
      minimumPadTiles: VIEWPORT_PAD_TILES,
      minimumPadPx: VIEWPORT_PAD_PX,
    })

    // Build cumulative durations for frame lookup
    const cumDurations: number[] = []
    let cumMs = 0
    for (const d of durations) {
      cumMs += d
      cumDurations.push(cumMs)
    }

    const result: { tileIndex: number; bitmap: ImageBitmap; x: number; width: number }[] = []

    for (let i = startTile; i < endTile; i++) {
      const x = i * tileWidth
      const w = Math.min(tileWidth, renderClipWidth - x)
      if (w <= 0) break

      // Map tile center pixel to source time in seconds, then to animation time (looped)
      const tileCenterX = x + w * 0.5
      const sourceTimeSeconds = effectiveStart + (tileCenterX / pixelsPerSecond) * speed
      const timeMs = (sourceTimeSeconds * 1000) % totalDuration

      // Find the frame at this time using cumulative durations
      let frameIndex = 0
      for (let f = 0; f < cumDurations.length; f++) {
        if ((cumDurations[f] ?? 0) > timeMs) {
          frameIndex = f
          break
        }
        frameIndex = f
      }

      const bitmap = frames[frameIndex % frames.length]
      if (bitmap) {
        result.push({ tileIndex: i, bitmap, x, width: w })
      }
    }

    return result
  }, [
    isAnimated,
    frames,
    durations,
    totalDuration,
    clipWidth,
    renderClipWidth,
    tileWidth,
    height,
    speed,
    effectiveStart,
    pixelsPerSecond,
    visibleStartRatio,
    visibleEndRatio,
  ])

  // Static image filmstrip: tile the image using CSS background-repeat
  if (!isAnimated) {
    if (height === 0 || !resolvedSrc) {
      return <div ref={containerRef} className="absolute inset-0" />
    }

    return (
      <div ref={containerRef} className="absolute inset-0">
        <div
          className="absolute left-0 top-0 overflow-hidden pointer-events-none"
          style={{
            width: renderClipWidth,
            height,
            backgroundImage: `url(${resolvedSrc})`,
            backgroundRepeat: 'repeat-x',
            backgroundSize: `${tileWidth}px ${height}px`,
            backgroundPosition: 'left center',
          }}
        />
      </div>
    )
  }

  if (height === 0 || !frames) {
    return <div ref={containerRef} className="absolute inset-0" />
  }

  return (
    <div ref={containerRef} className="absolute inset-0">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {tiles.map(({ tileIndex, bitmap, x, width }) => (
          <AnimatedTile key={tileIndex} bitmap={bitmap} x={x} width={width} height={height} />
        ))}
      </div>
    </div>
  )
})
