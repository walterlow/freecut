import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEventHandler,
  type ReactNode,
  type RefObject,
} from 'react'
import { Player, type PlayerRef } from '@/features/preview/deps/player-core'
import { MainComposition } from '@/features/preview/deps/composition-runtime'
import type { CompositionInputProps } from '@/types/export'
import { usePlaybackStore } from '@/shared/state/playback'
import { EDITOR_LAYOUT_CSS_VALUES } from '@/app/editor-layout'
import { FAST_SCRUB_RENDERER_ENABLED } from '../utils/preview-constants'
import { getPreviewPixelSnapOffset, ZERO_PIXEL_SNAP_OFFSET } from '../utils/preview-pixel-snap'

interface PreviewStageProps {
  backgroundRef: RefObject<HTMLDivElement | null>
  playerRef: RefObject<PlayerRef | null>
  scrubCanvasRef: RefObject<HTMLCanvasElement | null>
  gpuEffectsCanvasRef: RefObject<HTMLCanvasElement | null>
  needsOverflow: boolean
  playerSize: { width: number; height: number }
  playerRenderSize: { width: number; height: number }
  totalFrames: number
  fps: number
  isResolving: boolean
  isRenderedOverlayVisible: boolean
  inputProps: CompositionInputProps
  onBackgroundClick: MouseEventHandler<HTMLDivElement>
  onFrameChange: (frame: number) => void
  onPlayStateChange: (playing: boolean) => void
  setPlayerContainerRefCallback: (el: HTMLDivElement | null) => void
  perfPanel?: ReactNode
  comparisonOverlay?: ReactNode
  overlayControls?: ReactNode
}

export const PreviewStage = memo(function PreviewStage({
  backgroundRef,
  playerRef,
  scrubCanvasRef,
  gpuEffectsCanvasRef,
  needsOverflow,
  playerSize,
  playerRenderSize,
  totalFrames,
  fps,
  isResolving,
  isRenderedOverlayVisible,
  inputProps,
  onBackgroundClick,
  onFrameChange,
  onPlayStateChange,
  setPlayerContainerRefCallback,
  perfPanel,
  comparisonOverlay,
  overlayControls,
}: PreviewStageProps) {
  const useProxy = usePlaybackStore((s) => s.useProxy)
  const pixelSnapAnchorRef = useRef<HTMLDivElement | null>(null)
  const [pixelSnapOffset, setPixelSnapOffset] = useState(ZERO_PIXEL_SNAP_OFFSET)

  const setPixelSnappedPlayerContainerRef = useCallback(
    (el: HTMLDivElement | null) => {
      setPlayerContainerRefCallback(el)
    },
    [setPlayerContainerRefCallback],
  )

  useLayoutEffect(() => {
    const anchor = pixelSnapAnchorRef.current
    if (!anchor || typeof window === 'undefined') return

    let rafId: number | null = null

    const updatePixelSnapOffset = () => {
      rafId = null
      const rect = anchor.getBoundingClientRect()
      const nextOffset = getPreviewPixelSnapOffset(rect, window.devicePixelRatio)
      setPixelSnapOffset((prev) =>
        prev.x === nextOffset.x && prev.y === nextOffset.y ? prev : nextOffset,
      )
    }

    const scheduleUpdate = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(updatePixelSnapOffset)
    }

    updatePixelSnapOffset()

    const ResizeObserverCtor = typeof ResizeObserver === 'undefined' ? null : ResizeObserver
    const resizeObserver = ResizeObserverCtor ? new ResizeObserverCtor(scheduleUpdate) : null
    resizeObserver?.observe(anchor)
    window.addEventListener('resize', scheduleUpdate)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', scheduleUpdate)
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [playerSize.height, playerSize.width])

  const pixelSnapTransform =
    pixelSnapOffset.x !== 0 || pixelSnapOffset.y !== 0
      ? `translate3d(${pixelSnapOffset.x}px, ${pixelSnapOffset.y}px, 0)`
      : undefined

  return (
    <div
      ref={backgroundRef}
      className="w-full h-full bg-video-preview-background relative"
      style={{ overflow: needsOverflow ? 'auto' : 'visible' }}
      onClick={onBackgroundClick}
      aria-label="Video preview"
    >
      <div
        className="min-w-full min-h-full grid place-items-center"
        style={{ padding: `calc(${EDITOR_LAYOUT_CSS_VALUES.previewPadding} / 2)` }}
        onClick={onBackgroundClick}
      >
        <div
          ref={pixelSnapAnchorRef}
          className="relative"
          style={{
            width: `${playerSize.width}px`,
            height: `${playerSize.height}px`,
          }}
        >
          <div
            className="relative"
            style={{
              width: `${playerSize.width}px`,
              height: `${playerSize.height}px`,
              transform: pixelSnapTransform,
            }}
          >
            <div
              ref={setPixelSnappedPlayerContainerRef}
              data-player-container
              className="relative shadow-2xl"
              style={{
                width: `${playerSize.width}px`,
                height: `${playerSize.height}px`,
                transition: 'none',
                outline: '2px solid hsl(var(--border))',
                outlineOffset: 0,
              }}
              onDoubleClick={(event) => event.preventDefault()}
            >
              {isResolving && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
                  <p className="text-white text-sm">Loading media...</p>
                </div>
              )}

              <Player
                ref={playerRef}
                durationInFrames={totalFrames}
                fps={fps}
                width={playerRenderSize.width}
                height={playerRenderSize.height}
                autoPlay={false}
                loop={false}
                controls={false}
                style={{
                  width: '100%',
                  height: '100%',
                }}
                onFrameChange={onFrameChange}
                onPlayStateChange={onPlayStateChange}
              >
                <MainComposition {...inputProps} useProxyMedia={useProxy} />
              </Player>

              {FAST_SCRUB_RENDERER_ENABLED && (
                <canvas
                  ref={scrubCanvasRef}
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    width: '100%',
                    height: '100%',
                    zIndex: 4,
                    visibility: isRenderedOverlayVisible ? 'visible' : 'hidden',
                  }}
                />
              )}

              <canvas
                ref={gpuEffectsCanvasRef}
                className="absolute inset-0 pointer-events-none"
                style={{
                  width: '100%',
                  height: '100%',
                  zIndex: 5,
                  visibility: 'hidden',
                }}
              />

              {perfPanel}
              {comparisonOverlay}
            </div>

            {overlayControls}
          </div>
        </div>
      </div>
    </div>
  )
})
