import { useMemo, useCallback, memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import { usePlaybackStore } from '@/shared/state/playback'
import type { ItemEffect } from '@/types/effects'
import { GizmoOverlay } from './gizmo-overlay'
import { MaskEditorContainer } from './mask-editor-container'
import { CornerPinContainer } from './corner-pin-container'
import { PowerWindowOverlayContainer } from './power-window-overlay'
import { PreviewPerfPanel } from './preview-perf-panel'
import { PreviewStage } from './preview-stage'
import { RollingEditOverlay } from './rolling-edit-overlay'
import { RippleEditOverlay } from './ripple-edit-overlay'
import { SlipEditOverlay } from './slip-edit-overlay'
import { SlideEditOverlay } from './slide-edit-overlay'
import { useGpuEffectsOverlay } from '../hooks/use-gpu-effects-overlay'
import {
  usePreviewCompositionBaseModel,
  usePreviewCompositionModel,
} from '../hooks/use-preview-composition-model'
import { useCustomPlayer } from '../hooks/use-custom-player'
import { usePreviewDiagnostics } from '../hooks/use-preview-diagnostics'
import { usePreviewMediaResolution } from '../hooks/use-preview-media-resolution'
import { usePreviewMediaPreload } from '../hooks/use-preview-media-preload'
import { usePreviewOverlayController } from '../hooks/use-preview-overlay-controller'
import { usePreviewPerfPanel } from '../hooks/use-preview-perf-panel'
import { usePreviewPerfPublisher } from '../hooks/use-preview-perf-publisher'
import { usePreviewPlaybackController } from '../hooks/use-preview-playback-controller'
import { usePreviewRenderPump } from '../hooks/use-preview-render-pump-controller'
import { usePreviewRendererController } from '../hooks/use-preview-renderer-controller'
import { usePreviewRuntimeRefs } from '../hooks/use-preview-runtime-refs'
import { usePreviewSourceWarm } from '../hooks/use-preview-source-warm'
import { usePreviewTransitionModel } from '../hooks/use-preview-transition-model'
import { usePreviewViewModel } from '../hooks/use-preview-view-model'
import { usePreviewTransitionSessionController } from '../hooks/use-preview-transition-session-controller'
import { useGizmoStore } from '../stores/gizmo-store'
import { FAST_SCRUB_RENDERER_ENABLED } from '../utils/preview-constants'
import { importCompositionRenderer, type CompositionRendererInstance } from '../deps/export'

interface VideoPreviewProps {
  project: {
    width: number
    height: number
    backgroundColor?: string
  }
  containerSize: {
    width: number
    height: number
  }
  suspendOverlay?: boolean
}

type PreviewOverlayChrome = 'edit' | 'color'

/**
 * Video Preview Component
 *
 * Displays the custom Player with:
 * - Real-time video rendering
 * - Bidirectional sync with timeline
 * - Responsive sizing based on zoom and container
 * - Frame counter
 * - Fullscreen toggle
 *
 * Memoized to prevent expensive Player re-renders.
 */
const VideoPreviewBase = memo(function VideoPreviewBase({
  project,
  containerSize,
  suspendOverlay = false,
  overlayChrome,
}: VideoPreviewProps & { overlayChrome: PreviewOverlayChrome }) {
  const previewRuntimeRefs = usePreviewRuntimeRefs()
  const colorGradeComparisonMode = useGizmoStore((s) => s.colorGradeComparisonMode)
  const colorGradeSplitPosition = useGizmoStore((s) => s.colorGradeSplitPosition)
  const setColorGradeSplitPosition = useGizmoStore((s) => s.setColorGradeSplitPosition)
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const previewFrame = usePlaybackStore((s) => s.previewFrame)
  const displayedFrame = usePreviewBridgeStore((s) => s.displayedFrame)
  const livePreviewEdits = useGizmoStore((s) => s.preview)
  const [playerDisplayedFrame, setPlayerDisplayedFrame] = useState<number | null>(null)
  const latestPlayerDisplayedFrameRef = useRef<number | null>(null)
  const [splitAfterRenderedFrame, setSplitAfterRenderedFrame] = useState<number | null>(null)
  const splitAfterRendererRef = useRef<CompositionRendererInstance | null>(null)
  const splitAfterInitPromiseRef = useRef<Promise<CompositionRendererInstance | null> | null>(null)
  const splitAfterCanvasRef = useRef<OffscreenCanvas | null>(null)
  const splitAfterRendererStructureKeyRef = useRef<string | null>(null)
  const splitAfterRenderInFlightRef = useRef(false)
  const splitAfterPendingFrameRef = useRef<number | null>(null)
  const {
    playerRef,
    scrubCanvasRef,
    gpuEffectsCanvasRef,
    scrubFrameDirtyRef,
    bypassPreviewSeekRef,
    isGizmoInteractingRef,
    preferPlayerForStyledTextScrubRef,
    adaptiveQualityStateRef,
    scrubOffscreenCanvasRef,
    transitionSessionTraceRef,
    transitionTelemetryRef,
    transitionSessionBufferedFramesRef,
  } = previewRuntimeRefs
  const { showPerfPanel, perfPanelSnapshot, latestRenderSourceSwitch } = usePreviewPerfPanel()
  const {
    fps,
    tracks,
    keyframes,
    items,
    itemsByTrackId,
    mediaDependencyVersion,
    transitions,
    mediaById,
    brokenMediaCount,
    hasRolling2Up,
    hasRipple2Up,
    hasSlip4Up,
    hasSlide4Up,
    activeGizmoItemType,
    isGizmoInteracting,
    isPlaying,
    zoom,
    useProxy,
    busAudioEq,
    blobUrlVersion,
    proxyReadyCount,
    playerSize,
    needsOverflow,
    playerContainerRef,
    playerContainerRect,
    backgroundRef,
    setPlayerContainerRefCallback,
    handleBackgroundClick,
  } = usePreviewViewModel({
    project,
    containerSize,
    suspendOverlay,
  })
  const showGpuEffectsOverlay = useGpuEffectsOverlay(
    gpuEffectsCanvasRef,
    playerContainerRef,
    scrubOffscreenCanvasRef,
    scrubFrameDirtyRef,
  )
  const shouldPreferPlayerForPreview = useCallback(
    (previewFrame: number | null) => {
      return (
        previewRuntimeRefs.preferPlayerForTextGizmoRef.current ||
        (preferPlayerForStyledTextScrubRef.current && previewFrame !== null)
      )
    },
    [preferPlayerForStyledTextScrubRef, previewRuntimeRefs.preferPlayerForTextGizmoRef],
  )

  const setCaptureFrame = usePreviewBridgeStore((s) => s.setCaptureFrame)
  const setCaptureFrameImageData = usePreviewBridgeStore((s) => s.setCaptureFrameImageData)
  const setDisplayedFrame = usePreviewBridgeStore((s) => s.setDisplayedFrame)

  const {
    isRenderedOverlayVisible,
    showFastScrubOverlayRef,
    showPlaybackTransitionOverlayRef,
    renderSourceRef,
    renderSourceSwitchCountRef,
    renderSourceHistoryRef,
    hideFastScrubOverlay,
    hidePlaybackTransitionOverlay,
    showFastScrubOverlayForFrame,
    showPlaybackTransitionOverlayForFrame,
  } = usePreviewOverlayController({
    bypassPreviewSeekRef,
    setDisplayedFrame,
  })

  const { previewPerfRef, pushTransitionTrace, recordRenderFrameJitter } = usePreviewDiagnostics({
    renderSourceRef,
  })

  const { combinedTracks, mediaResolveCostById } = usePreviewCompositionBaseModel({
    tracks,
    itemsByTrackId,
    mediaById,
  })

  const {
    resolvedUrls,
    setResolvedUrls,
    isResolving,
    unresolvedMediaIdSetRef,
    preloadResolveInFlightRef,
    preloadBurstRemainingRef,
    preloadScanTrackCursorRef,
    preloadScanItemCursorRef,
    preloadLastAnchorFrameRef,
    getUnresolvedQueueSize,
    getPendingResolveCount,
    getResolveRetryAt,
    resolveMediaBatch,
    clearResolveRetryState,
    removeUnresolvedMediaIds,
    markResolveFailures,
    scheduleResolveRetryWake,
    kickResolvePass,
    resetResolveRetryState,
  } = usePreviewMediaResolution({
    fps,
    combinedTracks,
    mediaResolveCostById,
    mediaDependencyVersion,
    blobUrlVersion,
    brokenMediaCount,
    previewPerfRef: previewPerfRef as typeof previewPerfRef & {
      current: {
        resolveSamples: number
        resolveTotalMs: number
        resolveTotalIds: number
        resolveLastMs: number
        resolveLastIds: number
      }
    },
    isGizmoInteractingRef,
  })

  const { trackPlayerSeek, resolvePendingSeekLatency } = usePreviewPerfPublisher({
    previewPerfRef,
    adaptiveQualityStateRef,
    transitionSessionTraceRef,
    transitionTelemetryRef,
    transitionSessionBufferedFramesRef,
    renderSourceRef,
    renderSourceSwitchCountRef,
    renderSourceHistoryRef,
    getUnresolvedQueueSize,
    getPendingResolveCount,
  })

  const { ignorePlayerUpdatesRef } = useCustomPlayer(
    playerRef,
    bypassPreviewSeekRef,
    preferPlayerForStyledTextScrubRef,
    isGizmoInteractingRef,
    trackPlayerSeek,
  )

  const {
    playbackVideoSourceSpans,
    scrubVideoSourceSpans,
    fastScrubBoundaryFrames,
    fastScrubBoundarySources,
    totalFrames,
    inputProps,
    playerRenderSize,
    renderSize,
    fastScrubScaledTracks,
    fastScrubScaledKeyframes,
    fastScrubInputProps,
    fastScrubPreviewItems,
    fastScrubTracksTopologyFingerprint,
    getPreviewTransformOverride,
    getPreviewEffectsOverride,
    getPreviewCornerPinOverride,
    getPreviewPathVerticesOverride,
    getLiveItemSnapshot,
    getLiveKeyframes,
  } = usePreviewCompositionModel({
    combinedTracks,
    fps,
    items,
    keyframes,
    transitions,
    resolvedUrls,
    useProxy,
    busAudioEq,
    proxyReadyCount,
    blobUrlVersion,
    project,
  })

  usePreviewSourceWarm({
    resolvedUrlCount: resolvedUrls.size,
    playbackVideoSourceSpans,
    scrubVideoSourceSpans,
    fps,
    previewPerfRef: previewPerfRef as typeof previewPerfRef & {
      current: {
        sourceWarmTarget: number
        sourceWarmKeep: number
        sourceWarmEvictions: number
        sourcePoolSources: number
        sourcePoolElements: number
        sourcePoolActiveClips: number
      }
    },
    isGizmoInteractingRef,
  })
  const {
    playbackTransitionFingerprint,
    playbackTransitionWindows,
    playbackTransitionLookaheadFrames,
    playbackTransitionCooldownFrames,
    pausedTransitionPrearmFrames,
    playingComplexTransitionPrearmFrames,
    playbackTransitionPrerenderRunwayFrames,
    playbackTransitionComplexStartFrames,
    transitionWindowUsesDomProvider,
    getTransitionWindowByStartFrame,
    getTransitionWindowForFrame,
    getActiveTransitionWindowForFrame,
    playbackTransitionOverlayWindows,
    shouldPreserveHighFidelityBackwardPreview,
  } = usePreviewTransitionModel({
    fps,
    transitions,
    fastScrubScaledTracks,
    fastScrubPreviewItems,
  })

  const fastScrubRendererStructureKey = useMemo(
    () =>
      [
        fps,
        project.width,
        project.height,
        project.backgroundColor ?? '',
        fastScrubTracksTopologyFingerprint,
        playbackTransitionFingerprint,
      ].join('::'),
    [
      fastScrubTracksTopologyFingerprint,
      fps,
      playbackTransitionFingerprint,
      project.backgroundColor,
      project.height,
      project.width,
    ],
  )

  const getPreviewEffectsOverrideWithGradeApplied = useCallback(
    (itemId: string): ItemEffect[] | undefined => {
      return useGizmoStore.getState().preview?.[itemId]?.effects
    },
    [],
  )

  const disposeSplitAfterRenderer = useCallback(() => {
    splitAfterInitPromiseRef.current = null
    splitAfterRendererStructureKeyRef.current = null
    splitAfterCanvasRef.current = null
    splitAfterPendingFrameRef.current = null
    splitAfterRenderInFlightRef.current = false
    setSplitAfterRenderedFrame(null)

    const renderer = splitAfterRendererRef.current
    splitAfterRendererRef.current = null
    if (!renderer) return
    try {
      renderer.dispose()
    } catch {
      // Best effort; the main preview renderer can continue independently.
    }
  }, [])

  useLayoutEffect(() => {
    const canvas = gpuEffectsCanvasRef.current
    if (!canvas) return
    if (canvas.width !== playerRenderSize.width) canvas.width = playerRenderSize.width
    if (canvas.height !== playerRenderSize.height) canvas.height = playerRenderSize.height
  }, [gpuEffectsCanvasRef, playerRenderSize.height, playerRenderSize.width])

  const ensureSplitAfterRenderer =
    useCallback(async (): Promise<CompositionRendererInstance | null> => {
      if (!FAST_SCRUB_RENDERER_ENABLED) return null
      if (typeof OffscreenCanvas === 'undefined') return null
      if (isResolving) return null
      if (
        splitAfterRendererRef.current &&
        splitAfterRendererStructureKeyRef.current !== fastScrubRendererStructureKey
      ) {
        disposeSplitAfterRenderer()
      }
      if (splitAfterRendererRef.current) return splitAfterRendererRef.current
      if (splitAfterInitPromiseRef.current) return splitAfterInitPromiseRef.current

      splitAfterInitPromiseRef.current = (async () => {
        try {
          const canvas = new OffscreenCanvas(renderSize.width, renderSize.height)
          const ctx = canvas.getContext('2d')
          if (!ctx) return null

          const { createCompositionRenderer } = await importCompositionRenderer()
          const renderer = await createCompositionRenderer(fastScrubInputProps, canvas, ctx, {
            mode: 'preview',
            useProxyMedia: useProxy,
            getPreviewTransformOverride,
            getPreviewEffectsOverride: getPreviewEffectsOverrideWithGradeApplied,
            getPreviewCornerPinOverride,
            getPreviewPathVerticesOverride,
            getLiveItemSnapshot,
            getLiveKeyframes,
          })

          splitAfterCanvasRef.current = canvas
          splitAfterRendererRef.current = renderer
          splitAfterRendererStructureKeyRef.current = fastScrubRendererStructureKey
          if ('warmGpuPipeline' in renderer) {
            void renderer.warmGpuPipeline()
          }
          return renderer
        } catch {
          splitAfterCanvasRef.current = null
          splitAfterRendererRef.current = null
          splitAfterRendererStructureKeyRef.current = null
          return null
        } finally {
          splitAfterInitPromiseRef.current = null
        }
      })()

      return splitAfterInitPromiseRef.current
    }, [
      disposeSplitAfterRenderer,
      fastScrubInputProps,
      fastScrubRendererStructureKey,
      getLiveItemSnapshot,
      getLiveKeyframes,
      getPreviewCornerPinOverride,
      getPreviewEffectsOverrideWithGradeApplied,
      getPreviewPathVerticesOverride,
      getPreviewTransformOverride,
      isResolving,
      renderSize.height,
      renderSize.width,
      useProxy,
    ])

  const forceFastScrubOverlay = showGpuEffectsOverlay

  // While the GPU overlay owns the preview during playback, the DOM composition
  // tree is occluded — freeze its per-item visual recomputation so it stops
  // re-deriving transforms/masks/text on every frame behind the overlay. The
  // overlay composites the real frames; mount/visibility and video sync stay live.
  useEffect(() => {
    const frozen = forceFastScrubOverlay && isPlaying
    usePlaybackStore.getState().setCompositionVisualFrozen(frozen)
    return () => {
      usePlaybackStore.getState().setCompositionVisualFrozen(false)
    }
  }, [forceFastScrubOverlay, isPlaying])

  const {
    clearTransitionPlaybackSession,
    pinTransitionPlaybackSession,
    getPinnedTransitionElementForItem,
    getPausedTransitionPrewarmStartFrame,
    getPlayingAnyTransitionPrewarmStartFrame,
    isPausedTransitionOverlayActive,
    cacheTransitionSessionFrame,
    preparePlaybackTransitionFrame,
  } = usePreviewTransitionSessionController({
    fps,
    forceFastScrubOverlay,
    pausedTransitionPrearmFrames,
    playingComplexTransitionPrearmFrames,
    playbackTransitionWindows,
    playbackTransitionComplexStartFrames,
    playbackTransitionPrerenderRunwayFrames,
    playbackTransitionCooldownFrames,
    transitionWindowUsesDomProvider,
    getTransitionWindowByStartFrame,
    getActiveTransitionWindowForFrame,
    pushTransitionTrace,
    ...previewRuntimeRefs.transitionSessionControllerRefs,
  })
  const { handleFrameChange, handlePlayStateChange } = usePreviewPlaybackController({
    fps,
    combinedTracks,
    keyframes,
    activeGizmoItemType,
    isGizmoInteracting,
    isPlaying,
    forceFastScrubOverlay,
    previewPerfRef,
    isGizmoInteractingRef,
    preferPlayerForTextGizmoRef: previewRuntimeRefs.preferPlayerForTextGizmoRef,
    preferPlayerForStyledTextScrubRef,
    adaptiveQualityStateRef,
    adaptiveFrameSampleRef: previewRuntimeRefs.adaptiveFrameSampleRef,
    ignorePlayerUpdatesRef,
    resolvePendingSeekLatency,
  })

  const handleStageFrameChange = useCallback(
    (frame: number) => {
      const nextFrame = Math.max(0, Math.round(frame))
      latestPlayerDisplayedFrameRef.current = nextFrame
      setPlayerDisplayedFrame((prevFrame) => (prevFrame === nextFrame ? prevFrame : nextFrame))
      handleFrameChange(frame)
    },
    [handleFrameChange],
  )

  const getLivePlaybackFrame = useCallback(() => {
    const playerFrame = playerRef.current?.getCurrentFrame()
    if (playerFrame !== undefined && Number.isFinite(playerFrame)) {
      return Math.max(0, Math.round(playerFrame))
    }
    return latestPlayerDisplayedFrameRef.current
  }, [playerRef])

  const setCaptureCanvasSource = usePreviewBridgeStore((s) => s.setCaptureCanvasSource)

  const { disposeFastScrubRenderer, ensureFastScrubRenderer, ensureBgTransitionRenderer } =
    usePreviewRendererController({
      fps,
      isResolving,
      forceFastScrubOverlay,
      items,
      playerRenderSize,
      renderSize,
      fastScrubInputProps,
      fastScrubScaledTracks,
      fastScrubScaledKeyframes,
      fastScrubRendererStructureKey,
      showFastScrubOverlayRef,
      showPlaybackTransitionOverlayRef,
      previewPerfRef,
      getPreviewTransformOverride,
      getPreviewEffectsOverride,
      getPreviewCornerPinOverride,
      getPreviewPathVerticesOverride,
      getLivePlaybackFrame,
      getLiveItemSnapshot,
      getLiveKeyframes,
      clearTransitionPlaybackSession,
      resetResolveRetryState,
      setCaptureFrame,
      setCaptureFrameImageData,
      setCaptureCanvasSource,
      setDisplayedFrame,
      ...previewRuntimeRefs.rendererControllerRefs,
    })
  usePreviewRenderPump({
    fps,
    forceFastScrubOverlay,
    combinedTracks,
    fastScrubBoundaryFrames,
    fastScrubBoundarySources,
    playbackTransitionOverlayWindows,
    playbackTransitionLookaheadFrames,
    playbackTransitionCooldownFrames,
    playbackTransitionPrerenderRunwayFrames,
    previewPerfRef,
    showFastScrubOverlayRef,
    setDisplayedFrame,
    hideFastScrubOverlay,
    hidePlaybackTransitionOverlay,
    showFastScrubOverlayForFrame,
    showPlaybackTransitionOverlayForFrame,
    shouldPreferPlayerForPreview,
    shouldPreserveHighFidelityBackwardPreview,
    getTransitionWindowByStartFrame,
    getTransitionWindowForFrame,
    getPlayingAnyTransitionPrewarmStartFrame,
    getPausedTransitionPrewarmStartFrame,
    getPinnedTransitionElementForItem,
    pinTransitionPlaybackSession,
    clearTransitionPlaybackSession,
    cacheTransitionSessionFrame,
    preparePlaybackTransitionFrame,
    disposeFastScrubRenderer,
    ensureFastScrubRenderer,
    ensureBgTransitionRenderer,
    pushTransitionTrace,
    isPausedTransitionOverlayActive,
    trackPlayerSeek,
    recordRenderFrameJitter,
    ...previewRuntimeRefs.renderPumpRefs,
  })
  usePreviewMediaPreload({
    fps,
    combinedTracks,
    mediaResolveCostById,
    previewPerfRef,
    setResolvedUrls,
    isGizmoInteractingRef,
    unresolvedMediaIdSetRef,
    preloadResolveInFlightRef,
    preloadBurstRemainingRef,
    preloadScanTrackCursorRef,
    preloadScanItemCursorRef,
    preloadLastAnchorFrameRef,
    getResolveRetryAt,
    resolveMediaBatch,
    clearResolveRetryState,
    removeUnresolvedMediaIds,
    markResolveFailures,
    scheduleResolveRetryWake,
    kickResolvePass,
    ...previewRuntimeRefs.mediaPreloadRefs,
  })
  const perfPanel =
    import.meta.env.DEV && showPerfPanel && perfPanelSnapshot ? (
      <PreviewPerfPanel
        snapshot={perfPanelSnapshot}
        latestRenderSourceSwitch={latestRenderSourceSwitch}
      />
    ) : null

  const comparisonOverlay = hasRolling2Up ? (
    <RollingEditOverlay fps={fps} />
  ) : hasRipple2Up ? (
    <RippleEditOverlay fps={fps} />
  ) : hasSlip4Up ? (
    <SlipEditOverlay fps={fps} />
  ) : hasSlide4Up ? (
    <SlideEditOverlay fps={fps} />
  ) : null

  const overlayControls = !suspendOverlay ? (
    <>
      {overlayChrome === 'edit' && (
        <GizmoOverlay
          containerRect={playerContainerRect}
          playerSize={playerSize}
          projectSize={{ width: project.width, height: project.height }}
          zoom={zoom}
          hitAreaRef={backgroundRef as React.RefObject<HTMLDivElement>}
        />
      )}
      <MaskEditorContainer
        containerRect={playerContainerRect}
        playerSize={playerSize}
        projectSize={{ width: project.width, height: project.height }}
        zoom={zoom}
      />
      <CornerPinContainer
        containerRect={playerContainerRect}
        playerSize={playerSize}
        projectSize={{ width: project.width, height: project.height }}
        zoom={zoom}
      />
      <PowerWindowOverlayContainer
        containerRect={playerContainerRect}
        playerSize={playerSize}
        projectSize={{ width: project.width, height: project.height }}
        zoom={zoom}
      />
    </>
  ) : null
  const shouldShowAfterDuringSplitPlayback = isPlaying && colorGradeComparisonMode === 'split'
  const stageColorGradeComparisonMode = shouldShowAfterDuringSplitPlayback
    ? 'off'
    : colorGradeComparisonMode
  const baseComparisonTargetFrame = Math.max(0, Math.round(previewFrame ?? currentFrame))
  const comparisonTargetFrame =
    stageColorGradeComparisonMode === 'split' && displayedFrame !== null
      ? displayedFrame
      : baseComparisonTargetFrame

  useEffect(() => {
    if (stageColorGradeComparisonMode !== 'split') {
      splitAfterPendingFrameRef.current = null
      setSplitAfterRenderedFrame(null)
      return
    }

    let cancelled = false
    splitAfterPendingFrameRef.current = comparisonTargetFrame
    setSplitAfterRenderedFrame((frame) => (frame === comparisonTargetFrame ? frame : null))

    const renderPendingSplitAfter = async () => {
      if (splitAfterRenderInFlightRef.current) return
      splitAfterRenderInFlightRef.current = true

      try {
        while (!cancelled && splitAfterPendingFrameRef.current !== null) {
          const targetFrame = splitAfterPendingFrameRef.current
          splitAfterPendingFrameRef.current = null

          const renderer = await ensureSplitAfterRenderer()
          const offscreen = splitAfterCanvasRef.current
          const displayCanvas = gpuEffectsCanvasRef.current
          if (cancelled || !renderer || !offscreen || !displayCanvas) return

          try {
            renderer.invalidateFrameCache({ frames: [targetFrame] })
          } catch {
            // Some renderer doubles do not support selective invalidation.
          }
          await renderer.renderFrame(targetFrame)
          if (cancelled || splitAfterPendingFrameRef.current !== null) continue

          const displayCtx = displayCanvas.getContext('2d')
          if (!displayCtx) return
          displayCtx.clearRect(0, 0, displayCanvas.width, displayCanvas.height)
          displayCtx.drawImage(offscreen, 0, 0, displayCanvas.width, displayCanvas.height)
          setSplitAfterRenderedFrame(targetFrame)
        }
      } finally {
        splitAfterRenderInFlightRef.current = false
        if (!cancelled && splitAfterPendingFrameRef.current !== null) {
          void renderPendingSplitAfter()
        }
      }
    }

    void renderPendingSplitAfter()

    return () => {
      cancelled = true
    }
  }, [
    comparisonTargetFrame,
    ensureSplitAfterRenderer,
    gpuEffectsCanvasRef,
    livePreviewEdits,
    stageColorGradeComparisonMode,
  ])

  useEffect(() => () => disposeSplitAfterRenderer(), [disposeSplitAfterRenderer])

  const livePlayerFrame = playerRef.current?.getCurrentFrame()
  const normalizedLivePlayerFrame =
    livePlayerFrame === undefined || !Number.isFinite(livePlayerFrame)
      ? null
      : Math.max(0, Math.round(livePlayerFrame))
  const effectivePlayerDisplayedFrame = playerDisplayedFrame ?? normalizedLivePlayerFrame
  const isColorGradeComparisonActive = stageColorGradeComparisonMode !== 'off'
  const isSplitGradeComparison = stageColorGradeComparisonMode === 'split'
  const isColorGradeComparisonFrameReady =
    displayedFrame === comparisonTargetFrame &&
    (isSplitGradeComparison
      ? splitAfterRenderedFrame === comparisonTargetFrame
      : stageColorGradeComparisonMode === 'before' ||
        effectivePlayerDisplayedFrame === comparisonTargetFrame)
  const stageRenderedOverlayVisible = isColorGradeComparisonActive
    ? isRenderedOverlayVisible && isColorGradeComparisonFrameReady
    : isRenderedOverlayVisible
  const isSplitAfterVisible = isSplitGradeComparison && stageRenderedOverlayVisible

  return (
    <PreviewStage
      backgroundRef={backgroundRef}
      playerRef={playerRef}
      scrubCanvasRef={scrubCanvasRef}
      gpuEffectsCanvasRef={gpuEffectsCanvasRef}
      needsOverflow={needsOverflow}
      playerSize={playerSize}
      playerRenderSize={playerRenderSize}
      totalFrames={totalFrames}
      fps={fps}
      isResolving={isResolving}
      isRenderedOverlayVisible={stageRenderedOverlayVisible}
      isSplitGradeAfterVisible={isSplitAfterVisible}
      colorGradeComparisonMode={stageColorGradeComparisonMode}
      colorGradeSplitPosition={colorGradeSplitPosition}
      onColorGradeSplitPositionChange={setColorGradeSplitPosition}
      inputProps={inputProps}
      onBackgroundClick={handleBackgroundClick}
      onFrameChange={handleStageFrameChange}
      onPlayStateChange={handlePlayStateChange}
      setPlayerContainerRefCallback={setPlayerContainerRefCallback}
      perfPanel={perfPanel}
      comparisonOverlay={comparisonOverlay}
      overlayControls={overlayControls}
    />
  )
})

export const VideoPreview = memo(function VideoPreview(props: VideoPreviewProps) {
  return <VideoPreviewBase {...props} overlayChrome="edit" />
})

export const ColorVideoPreview = memo(function ColorVideoPreview(props: VideoPreviewProps) {
  return <VideoPreviewBase {...props} overlayChrome="color" />
})
