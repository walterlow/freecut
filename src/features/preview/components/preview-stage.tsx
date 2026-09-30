import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactNode,
  type RefObject,
} from 'react'
import { useTranslation } from 'react-i18next'
import { HeadlessPlayer, type PlayerRef } from '@/features/preview/deps/player-core'
import { MainComposition } from '@/features/preview/deps/composition-runtime'
import { useItemsStore } from '@/features/preview/deps/timeline-store'
import type { CompositionInputProps } from '@/types/export'
import { usePlaybackStore } from '@/shared/state/playback'
import { EDITOR_LAYOUT_CSS_VALUES } from '@/config/editor-layout'
import { FAST_SCRUB_RENDERER_ENABLED } from '../utils/preview-constants'
import { getPreviewDisplayCanvasStyle } from '../utils/preview-display-canvas'
import { getPreviewPixelSnapOffset } from '../utils/preview-pixel-snap'
import type { ColorGradeComparisonMode } from '../stores/gizmo-store'
import {
  isPlaybackColdStartPending,
  markPlaybackColdStart,
  resolvePlaybackColdStartVisibleFrame,
} from '../utils/playback-cold-start-event'
import { DomTextScrubOverlay } from './dom-text-scrub-overlay'

interface PreviewStageProps {
  backgroundRef: RefObject<HTMLDivElement | null>
  playerRef: RefObject<PlayerRef | null>
  scrubCanvasRef: RefObject<HTMLCanvasElement | null>
  gpuEffectsCanvasRef: RefObject<HTMLCanvasElement | null>
  needsOverflow: boolean
  playerSize: { width: number; height: number }
  playerRenderSize: { width: number; height: number }
  overlayRenderSize: { width: number; height: number }
  totalFrames: number
  fps: number
  /** Frame to start the player clock at on mount (preserves the playhead across remounts). */
  initialFrame?: number
  isResolving: boolean
  isRenderedOverlayVisible: boolean
  isSplitGradeAfterVisible?: boolean
  colorGradeComparisonMode?: ColorGradeComparisonMode
  colorGradeSplitPosition?: number
  onColorGradeSplitPositionChange?: (position: number) => void
  inputProps: CompositionInputProps
  domTextScrubInputProps?: CompositionInputProps
  onBackgroundClick: MouseEventHandler<HTMLDivElement>
  onFrameChange: (frame: number) => void
  onPlayStateChange: (playing: boolean) => void
  setPlayerContainerRefCallback: (el: HTMLDivElement | null) => void
  perfPanel?: ReactNode
  comparisonOverlay?: ReactNode
  overlayControls?: ReactNode
}

function canObservePlaybackPresentation(watchGeneration: number, generation: number): boolean {
  return (
    watchGeneration === generation &&
    usePlaybackStore.getState().isPlaying &&
    isPlaybackColdStartPending()
  )
}

function supportsVideoFrameCallback(video: HTMLVideoElement): boolean {
  return typeof video.requestVideoFrameCallback === 'function'
}

export const PreviewStage = memo(function PreviewStage({
  backgroundRef,
  playerRef,
  scrubCanvasRef,
  gpuEffectsCanvasRef,
  needsOverflow,
  playerSize,
  playerRenderSize,
  overlayRenderSize,
  totalFrames,
  fps,
  initialFrame = 0,
  isResolving,
  isRenderedOverlayVisible,
  isSplitGradeAfterVisible = false,
  colorGradeComparisonMode = 'off',
  colorGradeSplitPosition = 0.5,
  onColorGradeSplitPositionChange,
  inputProps,
  domTextScrubInputProps,
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
  const pixelSnappedPlayerRef = useRef<HTMLDivElement | null>(null)
  const playerSurfaceRef = useRef<HTMLDivElement | null>(null)
  const textOverlayPlayerRef = useRef<PlayerRef | null>(null)
  const renderedOverlayVisibleRef = useRef(isRenderedOverlayVisible)
  renderedOverlayVisibleRef.current = isRenderedOverlayVisible

  // Observe the browser's actual video presentation rather than treating a
  // Clock tick as visible output. The subscription is imperative so playback
  // transitions do not invalidate the PreviewStage React tree.
  useEffect(() => {
    let generation = 0
    const videoCallbackHandles = new Map<HTMLVideoElement, number>()
    const rafHandles = new Set<number>()

    const cancelPresentationWatch = () => {
      generation += 1
      for (const [video, handle] of videoCallbackHandles) {
        video.cancelVideoFrameCallback?.(handle)
      }
      videoCallbackHandles.clear()
      for (const handle of rafHandles) cancelAnimationFrame(handle)
      rafHandles.clear()
    }

    const scheduleRaf = (callback: () => void) => {
      const handle = requestAnimationFrame(() => {
        rafHandles.delete(handle)
        callback()
      })
      rafHandles.add(handle)
    }

    const isVisiblyComposited = (video: HTMLVideoElement) => {
      const style = getComputedStyle(video)
      return (
        video.isConnected &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        video.getClientRects().length > 0
      )
    }

    const armVideo = (video: HTMLVideoElement, watchGeneration: number) => {
      if (typeof video.requestVideoFrameCallback !== 'function') return
      const handle = video.requestVideoFrameCallback(() => {
        videoCallbackHandles.delete(video)
        if (
          watchGeneration !== generation ||
          !usePlaybackStore.getState().isPlaying ||
          renderedOverlayVisibleRef.current
        ) {
          return
        }
        const frame = Math.max(0, Math.round(playerRef.current?.getCurrentFrame() ?? 0))
        if (resolvePlaybackColdStartVisibleFrame(frame, 'dom_video')) {
          cancelPresentationWatch()
          return
        }
        // A callback for the already-paused frame can race the first Clock
        // advance. Keep listening until an advancing frame is presented.
        armVideo(video, watchGeneration)
      })
      videoCallbackHandles.set(video, handle)
    }

    const armPresentationWatch = (watchGeneration: number, attempt = 0) => {
      if (!canObservePlaybackPresentation(watchGeneration, generation)) return
      // The rendered canvas owns the visible surface in this mode and reports
      // directly from its draw path.
      if (renderedOverlayVisibleRef.current) return

      const surface = playerSurfaceRef.current
      const videos = surface
        ? Array.from(surface.querySelectorAll('video')).filter(isVisiblyComposited)
        : []
      const observableVideos = videos.filter(supportsVideoFrameCallback)
      if (observableVideos.length > 0) {
        markPlaybackColdStart({
          active_dom_video_count: observableVideos.length,
          active_video_ready_state_at_play: Math.min(
            ...observableVideos.map((video) => video.readyState),
          ),
          active_video_network_state_at_play: Math.max(
            ...observableVideos.map((video) => video.networkState),
          ),
        })
        for (const video of observableVideos) armVideo(video, watchGeneration)
        return
      }

      if (attempt < 2) {
        scheduleRaf(() => armPresentationWatch(watchGeneration, attempt + 1))
        return
      }

      // Static/image-only compositions have no media presentation callback.
      // Two animation frames after the committed Clock update is the earliest
      // paint-confirmed fallback for that surface.
      scheduleRaf(() => {
        scheduleRaf(() => {
          const frame = Math.max(0, Math.round(playerRef.current?.getCurrentFrame() ?? 0))
          if (resolvePlaybackColdStartVisibleFrame(frame, 'composition_paint')) {
            cancelPresentationWatch()
          }
        })
      })
    }

    const subscribe = usePlaybackStore.subscribe
    if (typeof subscribe !== 'function') {
      return cancelPresentationWatch
    }

    const unsubscribe = subscribe((state, previousState) => {
      if (state.isPlaying && !previousState.isPlaying) {
        cancelPresentationWatch()
        const watchGeneration = generation
        // Other playback subscribers begin the wide event in the same store
        // dispatch. Arm after that synchronous subscriber pass completes.
        queueMicrotask(() => armPresentationWatch(watchGeneration))
      } else if (!state.isPlaying && previousState.isPlaying) {
        cancelPresentationWatch()
      }
    })

    return () => {
      unsubscribe()
      cancelPresentationWatch()
    }
  }, [playerRef])

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
      const player = pixelSnappedPlayerRef.current
      if (!player) return
      const nextTransform =
        nextOffset.x !== 0 || nextOffset.y !== 0
          ? `translate3d(${nextOffset.x}px, ${nextOffset.y}px, 0)`
          : ''
      if (player.style.transform !== nextTransform) {
        // ResizeObserver/rAF runs before paint. Write the transient correction
        // directly so panel drags cannot spend one frame at stale geometry
        // while waiting for a React state commit.
        player.style.transform = nextTransform
      }
    }

    const scheduleUpdate = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(updatePixelSnapOffset)
    }

    updatePixelSnapOffset()

    const ResizeObserverCtor = typeof ResizeObserver === 'undefined' ? null : ResizeObserver
    const resizeObserver = ResizeObserverCtor ? new ResizeObserverCtor(scheduleUpdate) : null
    resizeObserver?.observe(anchor)
    if (anchor.parentElement) {
      resizeObserver?.observe(anchor.parentElement)
    }
    window.addEventListener('resize', scheduleUpdate)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', scheduleUpdate)
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [playerSize.height, playerSize.width])

  const isTimelineEmpty = inputProps.tracks.every((track) => track.items.length === 0)
  const isSplitGradeComparison = colorGradeComparisonMode === 'split'
  const splitPosition = Math.max(0.05, Math.min(0.95, colorGradeSplitPosition))
  const splitPercent = splitPosition * 100
  const splitClipPath = `inset(0 ${100 - splitPercent}% 0 0)`
  const displayCanvasStyle = getPreviewDisplayCanvasStyle(playerSize, overlayRenderSize)

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
            ref={pixelSnappedPlayerRef}
            className="relative"
            style={{
              width: `${playerSize.width}px`,
              height: `${playerSize.height}px`,
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
                initialFrame={initialFrame}
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
                <MainComposition
                  {...inputProps}
                  useProxyMedia={useProxy}
                  liveItemTransformSource={useItemsStore}
                />
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
                    backgroundColor: isSplitGradeComparison ? '#000' : 'transparent',
                  }}
                >
                  <canvas
                    ref={scrubCanvasRef}
                    className="absolute left-0 top-0 pointer-events-none"
                    style={{
                      ...displayCanvasStyle,
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
                  ...displayCanvasStyle,
                  zIndex: isSplitGradeAfterVisible ? 3 : 5,
                  visibility: isSplitGradeAfterVisible ? 'visible' : 'hidden',
                }}
              />

              {domTextScrubInputProps && (
                <DomTextScrubOverlay
                  playerRef={textOverlayPlayerRef}
                  visible={isRenderedOverlayVisible}
                  durationInFrames={totalFrames}
                  fps={fps}
                  renderSize={playerRenderSize}
                  layoutSize={playerSize}
                  inputProps={domTextScrubInputProps}
                />
              )}

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
