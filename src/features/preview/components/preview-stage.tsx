import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactNode,
  type RefObject,
} from 'react'
import { useTranslation } from 'react-i18next'
import { HeadlessPlayer, type PlayerRef } from '@/features/preview/deps/player-core'
import { MainComposition } from '@/features/preview/deps/composition-runtime'
import type { CompositionInputProps } from '@/types/export'
import { usePlaybackStore } from '@/shared/state/playback'
import { EDITOR_LAYOUT_CSS_VALUES } from '@/config/editor-layout'
import { FAST_SCRUB_RENDERER_ENABLED } from '../utils/preview-constants'
import { getPreviewPixelSnapOffset, ZERO_PIXEL_SNAP_OFFSET } from '../utils/preview-pixel-snap'
import type { ColorGradeComparisonMode } from '../stores/gizmo-store'

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
  isSplitGradeAfterVisible?: boolean
  colorGradeComparisonMode?: ColorGradeComparisonMode
  colorGradeSplitPosition?: number
  onColorGradeSplitPositionChange?: (position: number) => void
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
  isSplitGradeAfterVisible = false,
  colorGradeComparisonMode = 'off',
  colorGradeSplitPosition = 0.5,
  onColorGradeSplitPositionChange,
  inputProps,
  onBackgroundClick,
  onFrameChange,
  onPlayStateChange,
  setPlayerContainerRefCallback,
  perfPanel,
  comparisonOverlay,
  overlayControls,
}: PreviewStageProps) {
  const { t } = useTranslation()
  const useProxy = usePlaybackStore((s) => s.useProxy)
  const pixelSnapAnchorRef = useRef<HTMLDivElement | null>(null)
  const playerSurfaceRef = useRef<HTMLDivElement | null>(null)
  const [pixelSnapOffset, setPixelSnapOffset] = useState(ZERO_PIXEL_SNAP_OFFSET)

  const setPixelSnappedPlayerContainerRef = useCallback(
    (el: HTMLDivElement | null) => {
      playerSurfaceRef.current = el
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
  const isTimelineEmpty = inputProps.tracks.every((track) => track.items.length === 0)
  const isSplitGradeComparison = colorGradeComparisonMode === 'split'
  const splitPosition = Math.max(0.05, Math.min(0.95, colorGradeSplitPosition))
  const splitPercent = splitPosition * 100
  const splitClipPath = `inset(0 ${100 - splitPercent}% 0 0)`

  const updateSplitPositionFromPointer = useCallback(
    (event: { clientX: number }) => {
      const surface = playerSurfaceRef.current
      if (!surface || !onColorGradeSplitPositionChange) return
      const rect = surface.getBoundingClientRect()
      if (rect.width <= 0) return
      const next = (event.clientX - rect.left) / rect.width
      onColorGradeSplitPositionChange(Math.max(0.05, Math.min(0.95, next)))
    },
    [onColorGradeSplitPositionChange],
  )

  const handleSplitPointerDown: PointerEventHandler<HTMLButtonElement> = useCallback(
    (event) => {
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      updateSplitPositionFromPointer(event)
    },
    [updateSplitPositionFromPointer],
  )

  const handleSplitPointerMove: PointerEventHandler<HTMLButtonElement> = useCallback(
    (event) => {
      if (event.buttons !== 1) return
      event.preventDefault()
      updateSplitPositionFromPointer(event)
    },
    [updateSplitPositionFromPointer],
  )

  const handleSplitKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (!onColorGradeSplitPositionChange) return
      let next: number | null = null
      if (event.key === 'ArrowLeft') next = splitPosition - (event.shiftKey ? 0.1 : 0.01)
      if (event.key === 'ArrowRight') next = splitPosition + (event.shiftKey ? 0.1 : 0.01)
      if (event.key === 'Home') next = 0.05
      if (event.key === 'End') next = 0.95
      if (next === null) return
      event.preventDefault()
      onColorGradeSplitPositionChange(Math.max(0.05, Math.min(0.95, next)))
    },
    [onColorGradeSplitPositionChange, splitPosition],
  )

  return (
    <div
      ref={backgroundRef}
      className="w-full h-full bg-video-preview-background relative"
      style={{ overflow: needsOverflow ? 'auto' : 'visible' }}
      onClick={onBackgroundClick}
      aria-label={t('preview.stage.videoPreview')}
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
                overflow: 'hidden',
                contain: 'paint',
              }}
              onDoubleClick={(event) => event.preventDefault()}
            >
              {isResolving && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
                  <p className="text-white text-sm">{t('preview.stage.loadingMedia')}</p>
                </div>
              )}

              {!isResolving && isTimelineEmpty && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/35 px-6 text-center pointer-events-none">
                  <div className="max-w-sm rounded-xl border border-white/10 bg-black/50 px-5 py-4 text-white shadow-xl backdrop-blur-sm">
                    <p className="text-sm font-semibold mb-1">{t('preview.stage.emptyTitle')}</p>
                    <p className="text-xs text-white/75">{t('preview.stage.emptyDescription')}</p>
                  </div>
                </div>
              )}

              <HeadlessPlayer
                ref={playerRef}
                durationInFrames={totalFrames}
                fps={fps}
                width={playerRenderSize.width}
                height={playerRenderSize.height}
                autoPlay={false}
                loop={false}
                layoutSize={playerSize}
                style={{
                  width: '100%',
                  height: '100%',
                }}
                onFrameChange={onFrameChange}
                onPlayStateChange={onPlayStateChange}
              >
                <MainComposition {...inputProps} useProxyMedia={useProxy} />
              </HeadlessPlayer>

              {FAST_SCRUB_RENDERER_ENABLED && (
                <div
                  className="absolute left-0 top-0 pointer-events-none"
                  data-grade-comparison-before-layer={isSplitGradeComparison ? 'true' : undefined}
                  style={{
                    width: '100%',
                    height: '100%',
                    zIndex: 4,
                    visibility: isRenderedOverlayVisible ? 'visible' : 'hidden',
                    clipPath: isSplitGradeComparison ? splitClipPath : undefined,
                    backgroundColor: '#000',
                  }}
                >
                  <canvas
                    ref={scrubCanvasRef}
                    className="absolute left-0 top-0 pointer-events-none"
                    style={{
                      width: '100%',
                      height: '100%',
                      maxWidth: 'none',
                      maxHeight: 'none',
                      visibility: isRenderedOverlayVisible ? 'visible' : 'hidden',
                    }}
                  />
                </div>
              )}

              <canvas
                ref={gpuEffectsCanvasRef}
                className="absolute inset-0 pointer-events-none"
                data-grade-comparison-after-layer={isSplitGradeAfterVisible ? 'true' : undefined}
                style={{
                  width: '100%',
                  height: '100%',
                  zIndex: isSplitGradeAfterVisible ? 3 : 5,
                  visibility: isSplitGradeAfterVisible ? 'visible' : 'hidden',
                }}
              />

              {perfPanel}
              {comparisonOverlay}
              {isSplitGradeComparison && (
                <div
                  className="pointer-events-none absolute inset-0 z-[6]"
                  aria-label={t('preview.stage.gradeComparisonSplit')}
                >
                  <div className="absolute bottom-2 left-2 rounded-sm bg-black/65 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/90">
                    {t('preview.stage.gradeComparisonBefore')}
                  </div>
                  <div className="absolute bottom-2 right-2 rounded-sm bg-black/65 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/90">
                    {t('preview.stage.gradeComparisonAfter')}
                  </div>
                  <button
                    type="button"
                    role="slider"
                    aria-label={t('preview.stage.gradeComparisonWipe')}
                    aria-valuemin={5}
                    aria-valuemax={95}
                    aria-valuenow={Math.round(splitPercent)}
                    aria-valuetext={`${Math.round(splitPercent)}%`}
                    className="pointer-events-auto absolute top-0 h-full w-6 -translate-x-1/2 cursor-ew-resize touch-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/90"
                    style={{ left: `${splitPercent}%` }}
                    onPointerDown={handleSplitPointerDown}
                    onPointerMove={handleSplitPointerMove}
                    onKeyDown={handleSplitKeyDown}
                  >
                    <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.5)]" />
                    <span className="absolute left-1/2 top-1/2 flex h-8 w-3 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/70 bg-black/55 shadow-sm">
                      <span className="h-4 w-px bg-white/80" />
                    </span>
                  </button>
                </div>
              )}
            </div>

            {overlayControls}
          </div>
        </div>
      </div>
    </div>
  )
})
