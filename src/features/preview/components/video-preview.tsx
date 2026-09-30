import { useMemo, useCallback, memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRafDeferredValue } from '@/shared/hooks/use-raf-deferred-value'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import { usePlaybackStore } from '@/shared/state/playback'
import type { ItemEffect } from '@/types/effects'
import type { TimelineItem } from '@/types/timeline'
import { GizmoOverlay } from './gizmo-overlay'
import { MaskEditorContainer } from './mask-editor-container'
import { CornerPinContainer } from './corner-pin-container'
import { PowerWindowOverlayContainer } from './power-window-overlay'
import { SpatialEffectPointOverlayContainer } from './spatial-effect-point-overlay'
import { Projection360OrbitContainer } from './projection-360-orbit-container'
import { PreviewPerfPanel } from './preview-perf-panel'
import { PreviewStage } from './preview-stage'
import { RollingEditOverlay } from './rolling-edit-overlay'
import { RippleEditOverlay } from './ripple-edit-overlay'
import { SlipEditOverlay } from './slip-edit-overlay'
import { SlideEditOverlay } from './slide-edit-overlay'
import { useSelectedComparisonCompositionPrewarm } from './use-selected-comparison-composition-prewarm'
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
import { useTransformStableItemsSnapshot } from '../hooks/use-transform-stable-items-snapshot'
import { usePreviewViewModel } from '../hooks/use-preview-view-model'
import { usePreviewTransitionSessionController } from '../hooks/use-preview-transition-session-controller'
import { useGizmoStore } from '../stores/gizmo-store'
import { useCornerPinStore } from '../stores/corner-pin-store'
import { useMaskEditorStore } from '../stores/mask-editor-store'
import { usePowerWindowEditorStore } from '../stores/power-window-editor-store'
import { useSpatialEffectEditorStore } from '../stores/spatial-effect-editor-store'
import { FAST_SCRUB_RENDERER_ENABLED } from '../utils/preview-constants'
import {
  drawSourceToPreviewDisplayCanvas,
  getPreviewDisplayCanvasBackingSize,
} from '../utils/preview-display-canvas'
import { buildDomTextScrubOverlayPlan } from '../utils/dom-text-scrub-overlay'
import { shouldPreferDomPlayerForGizmo } from '../utils/gizmo-preview-presentation'
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
  chrome?: PreviewOverlayChrome
}

type PreviewOverlayChrome = 'edit' | 'color'

interface PreviewItemsSnapshot {
  items: TimelineItem[]
  itemsByTrackId: Record<string, TimelineItem[]>
}

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
  itemsSnapshot,
}: VideoPreviewProps & {
  overlayChrome: PreviewOverlayChrome
  itemsSnapshot: PreviewItemsSnapshot
}) {
  const previewRuntimeRefs = usePreviewRuntimeRefs()
  const colorGradeComparisonMode = useGizmoStore((s) => s.colorGradeComparisonMode)
  const colorGradeSplitPosition = useGizmoStore((s) => s.colorGradeSplitPosition)
  const setColorGradeSplitPosition = useGizmoStore((s) => s.setColorGradeSplitPosition)
  // Frame values are only consumed by the color-grade comparison branch near
  // the bottom of this component. Returning a stable sentinel while comparison
  // is off keeps ordinary playback/scrubbing from re-rendering this large tree.
  const comparisonEnabled = colorGradeComparisonMode !== 'off'
  const comparisonCurrentFrame = usePlaybackStore((s) =>
    comparisonEnabled ? s.currentFrame : null,
  )
  const comparisonPreviewFrame = usePlaybackStore((s) =>
    comparisonEnabled ? s.previewFrame : null,
  )
  // Capture the playhead once at mount so a workspace-driven remount (switching
  // to/from Color swaps VideoPreview<->ColorVideoPreview, remounting the Player)
  // starts the fresh clock at the current frame. Without this the new Player
  // fires an initial onFrameChange(0) that, while playing, overwrites the
  // playhead back to 0.
  const initialPlayheadFrameRef = useRef<number | null>(null)
  if (initialPlayheadFrameRef.current === null) {
    initialPlayheadFrameRef.current = usePlaybackStore.getState().currentFrame
  }
  const comparisonDisplayedFrame = usePreviewBridgeStore((s) =>
    comparisonEnabled ? s.displayedFrame : null,
  )
  const livePreviewEdits = useGizmoStore((s) => s.preview)
  const [playerDisplayedFrame, setPlayerDisplayedFrame] = useState<number | null>(null)
  const latestPlayerDisplayedFrameRef = useRef<number | null>(null)
  const [splitAfterRenderedFrame, setSplitAfterRenderedFrame] = useState<number | null>(null)
  const splitAfterRendererRef = useRef<CompositionRendererInstance | null>(null)
  const splitAfterInitPromiseRef = useRef<Promise<CompositionRendererInstance | null> | null>(null)
  const splitAfterInitGenerationRef = useRef(0)
  const splitAfterCanvasRef = useRef<OffscreenCanvas | null>(null)
  const splitAfterRendererStructureKeyRef = useRef<string | null>(null)
  const splitAfterRenderInFlightRef = useRef(false)
  const splitAfterPendingFrameRef = useRef<number | null>(null)
  const {
    playerRef,
    scrubCanvasRef,
    gpuEffectsCanvasRef,
    bypassPreviewSeekRef,
    isGizmoInteractingRef,
    preferPlayerForStyledTextScrubRef,
    adaptiveQualityStateRef,
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
    zoom,
    useProxy,
    busAudioEq,
    blobUrlVersion,
    proxyReadyCount,
    playerSize,
    needsOverflow,
    playerContainerRect,
    backgroundRef,
    setPlayerContainerRefCallback,
    handleBackgroundClick,
  } = usePreviewViewModel({
    project,
    containerSize,
    suspendOverlay,
    itemsSnapshot,
  })
  useSelectedComparisonCompositionPrewarm({
    fps,
    items,
    useProxyMedia: useProxy,
    blobUrlVersion,
  })
  const { needsOverlay: showGpuEffectsOverlay, shouldWarmRenderer: shouldWarmGpuEffectsRenderer } =
    useGpuEffectsOverlay(fps)
  const isMaskEditing = useMaskEditorStore((s) => s.isEditing)
  const isCornerPinEditing = useCornerPinStore((s) => s.isEditing)
  const isPowerWindowEditing = usePowerWindowEditorStore((s) => s.isEditing)
  const isSpatialEffectEditing = useSpatialEffectEditorStore((s) => s.isEditing)
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
    playerSize,
  })
  const domTextScrubOverlayPlan = useMemo(
    () => buildDomTextScrubOverlayPlan(fastScrubScaledTracks, fastScrubScaledKeyframes),
    [fastScrubScaledKeyframes, fastScrubScaledTracks],
  )
  const domTextScrubInputProps = useMemo(
    () =>
      domTextScrubOverlayPlan.enabled
        ? {
            ...inputProps,
            tracks: domTextScrubOverlayPlan.textTracks,
            backgroundColor: 'transparent',
            keyframes: domTextScrubOverlayPlan.textKeyframes,
          }
        : undefined,
    [domTextScrubOverlayPlan, inputProps],
  )

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
        renderSize.width,
        renderSize.height,
        project.backgroundColor ?? '',
        useProxy ? 'proxy' : 'source',
        fastScrubTracksTopologyFingerprint,
        domTextScrubOverlayPlan.enabled ? 'dom-text-overlay' : 'composited-text',
        playbackTransitionFingerprint,
      ].join('::'),
    [
      fastScrubTracksTopologyFingerprint,
      domTextScrubOverlayPlan.enabled,
      fps,
      playbackTransitionFingerprint,
      project.backgroundColor,
      project.height,
      project.width,
      renderSize.height,
      renderSize.width,
      useProxy,
    ],
  )

  const getPreviewEffectsOverrideWithGradeApplied = useCallback(
    (itemId: string): ItemEffect[] | undefined => {
      return useGizmoStore.getState().preview?.[itemId]?.effects
    },
    [],
  )

  const disposeSplitAfterRenderer = useCallback(() => {
    splitAfterInitGenerationRef.current += 1
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
    const backingSize = getPreviewDisplayCanvasBackingSize(playerSize, renderSize)
    if (canvas.width !== backingSize.width) canvas.width = backingSize.width
    if (canvas.height !== backingSize.height) canvas.height = backingSize.height
  }, [gpuEffectsCanvasRef, playerSize, renderSize])

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

      const initGeneration = splitAfterInitGenerationRef.current
      let initPromise!: Promise<CompositionRendererInstance | null>
      initPromise = (async () => {
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
            renderText: !domTextScrubOverlayPlan.enabled,
          })
          if (splitAfterInitGenerationRef.current !== initGeneration) {
            renderer.dispose()
            return null
          }

          splitAfterCanvasRef.current = canvas
          splitAfterRendererRef.current = renderer
          splitAfterRendererStructureKeyRef.current = fastScrubRendererStructureKey
          if ('warmGpuPipeline' in renderer) {
            void renderer.warmGpuPipeline()
          }
          return renderer
        } catch {
          if (splitAfterInitGenerationRef.current === initGeneration) {
            splitAfterCanvasRef.current = null
            splitAfterRendererRef.current = null
            splitAfterRendererStructureKeyRef.current = null
          }
          return null
        } finally {
          if (splitAfterInitPromiseRef.current === initPromise) {
            splitAfterInitPromiseRef.current = null
          }
        }
      })()
      splitAfterInitPromiseRef.current = initPromise

      return initPromise
    }, [
      disposeSplitAfterRenderer,
      fastScrubInputProps,
      fastScrubRendererStructureKey,
      domTextScrubOverlayPlan.enabled,
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

  useEffect(() => {
    disposeSplitAfterRenderer()
  }, [disposeSplitAfterRenderer, fastScrubRendererStructureKey])

  // Enter the composited path in the same render that activates the editor.
  // Waiting for the timeline-wide effect scan adds a reactive round trip that
  // makes the first neutral-EV drag look stuck until another parameter changes.
  const forceFastScrubOverlay =
    showGpuEffectsOverlay || isPowerWindowEditing || isSpatialEffectEditing
  const previousForceFastScrubOverlayRef = useRef(forceFastScrubOverlay)

  // The split comparison is the only render-time branch that needs playback
  // state. Keep the selected value stable for the normal (non-split) preview
  // so pressing Play does not invalidate the entire VideoPreview tree.
  const isPlayingForSplitComparison = usePlaybackStore(
    (state) => colorGradeComparisonMode === 'split' && state.isPlaying,
  )

  // While the GPU overlay owns the preview during playback, the DOM composition
  // tree is occluded — freeze its per-item visual recomputation so it stops
  // re-deriving transforms/masks/text on every frame behind the overlay. The
  // overlay composites the real frames; mount/visibility and video sync stay live.
  useEffect(() => {
    const applyFrozenState = (isPlaying: boolean) => {
      usePlaybackStore.getState().setCompositionVisualFrozen(forceFastScrubOverlay && isPlaying)
    }

    applyFrozenState(usePlaybackStore.getState().isPlaying)
    const unsubscribe = usePlaybackStore.subscribe((state, previousState) => {
      if (state.isPlaying !== previousState.isPlaying) {
        applyFrozenState(state.isPlaying)
      }
    })

    return () => {
      unsubscribe()
      usePlaybackStore.getState().setCompositionVisualFrozen(false)
    }
  }, [forceFastScrubOverlay])

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
  useEffect(() => {
    const wasForced = previousForceFastScrubOverlayRef.current
    previousForceFastScrubOverlayRef.current = forceFastScrubOverlay
    if (!wasForced && forceFastScrubOverlay) {
      const playback = usePlaybackStore.getState()
      const currentFrame = playback.previewFrame ?? playback.currentFrame
      usePreviewBridgeStore.getState().requestPostEditWarm(
        currentFrame,
        items.map((i) => i.id),
      )
      return
    }
    if (!wasForced || forceFastScrubOverlay) return

    const playbackState = usePlaybackStore.getState()
    if (
      playbackState.previewFrame !== null ||
      isPausedTransitionOverlayActive(playbackState.currentFrame, playbackState)
    ) {
      return
    }

    // A rendered-only item just left the routing window. Release its last
    // bitmap immediately so an ordinary Player frame cannot remain occluded.
    hideFastScrubOverlay()
    setDisplayedFrame(null)
  }, [
    forceFastScrubOverlay,
    hideFastScrubOverlay,
    isPausedTransitionOverlayActive,
    items,
    setDisplayedFrame,
  ])
  const shouldPreferPlayerForPreview = useCallback(
    (previewFrame: number | null) => {
      const playbackState = usePlaybackStore.getState()
      const requiresRenderedPresentation =
        forceFastScrubOverlay ||
        isPausedTransitionOverlayActive(playbackState.currentFrame, playbackState)
      if (requiresRenderedPresentation) return false
      const preservesRenderedPreview =
        previewFrame !== null && shouldPreserveHighFidelityBackwardPreview(previewFrame)
      if (preservesRenderedPreview) {
        // Styled DOM text normally keeps skimming on the Player to preserve
        // typography. Transition frames are the exception: the Player does
        // not composite the authored transition, so retain the rendered media
        // path (and its separate DOM text overlay when that split is safe).
        return false
      }

      const activeGizmoItemType = useGizmoStore.getState().activeGizmo?.itemType ?? null
      return (
        shouldPreferDomPlayerForGizmo(false, activeGizmoItemType) ||
        previewRuntimeRefs.preferPlayerForDomGizmoRef.current ||
        (preferPlayerForStyledTextScrubRef.current && previewFrame !== null)
      )
    },
    [
      forceFastScrubOverlay,
      isPausedTransitionOverlayActive,
      preferPlayerForStyledTextScrubRef,
      previewRuntimeRefs.preferPlayerForDomGizmoRef,
      shouldPreserveHighFidelityBackwardPreview,
    ],
  )
  const { handleFrameChange, handlePlayStateChange } = usePreviewPlaybackController({
    fps,
    combinedTracks,
    keyframes,
    forceFastScrubOverlay,
    domTextScrubOverlayEnabled: domTextScrubOverlayPlan.enabled,
    previewPerfRef,
    isGizmoInteractingRef,
    preferPlayerForDomGizmoRef: previewRuntimeRefs.preferPlayerForDomGizmoRef,
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
      // Ordinary playback consumes this imperatively through the ref below.
      // Mirroring every Clock tick into React state invalidates the entire
      // VideoPreview tree (including editor overlays) even though only color
      // comparison needs a rendered-frame state value.
      if (comparisonEnabled) {
        setPlayerDisplayedFrame((prevFrame) => (prevFrame === nextFrame ? prevFrame : nextFrame))
      }
      handleFrameChange(frame)
    },
    [comparisonEnabled, handleFrameChange],
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
      preserveRendererAcrossOverlayRouting: shouldWarmGpuEffectsRenderer,
      domTextScrubOverlayEnabled: domTextScrubOverlayPlan.enabled,
      items,
      useProxy,
      playerSize,
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
  useEffect(() => {
    if (!shouldWarmGpuEffectsRenderer || isResolving) return

    let cancelled = false
    const warmRenderer = () => {
      if (!cancelled) void ensureFastScrubRenderer()
    }
    if (typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(warmRenderer, { timeout: 750 })
      return () => {
        cancelled = true
        window.cancelIdleCallback(idleId)
      }
    }

    const timeoutId = window.setTimeout(warmRenderer, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [ensureFastScrubRenderer, isResolving, shouldWarmGpuEffectsRenderer])
  usePreviewRenderPump({
    fps,
    forceFastScrubOverlay,
    useProxy,
    // Scrub decoding must use the same proxy/source URLs as the renderer.
    // Feeding unresolved project tracks here silently made the worker decode
    // full-resolution originals while the composition rendered proxies.
    combinedTracks: fastScrubScaledTracks,
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
          itemsSnapshot={itemsSnapshot.items}
          containerRect={playerContainerRect}
          playerSize={playerSize}
          projectSize={{ width: project.width, height: project.height }}
          zoom={zoom}
          hitAreaRef={backgroundRef as React.RefObject<HTMLDivElement>}
        />
      )}
      {isMaskEditing && (
        <MaskEditorContainer
          containerRect={playerContainerRect}
          playerSize={playerSize}
          projectSize={{ width: project.width, height: project.height }}
          zoom={zoom}
        />
      )}
      {isCornerPinEditing && (
        <CornerPinContainer
          containerRect={playerContainerRect}
          playerSize={playerSize}
          projectSize={{ width: project.width, height: project.height }}
          zoom={zoom}
        />
      )}
      {isPowerWindowEditing && (
        <PowerWindowOverlayContainer
          containerRect={playerContainerRect}
          playerSize={playerSize}
          projectSize={{ width: project.width, height: project.height }}
          zoom={zoom}
        />
      )}
      {isSpatialEffectEditing && (
        <SpatialEffectPointOverlayContainer
          containerRect={playerContainerRect}
          playerSize={playerSize}
          projectSize={{ width: project.width, height: project.height }}
          zoom={zoom}
        />
      )}
      <Projection360OrbitContainer containerRect={playerContainerRect} />
    </>
  ) : null
  const shouldShowAfterDuringSplitPlayback = isPlayingForSplitComparison
  const stageColorGradeComparisonMode = shouldShowAfterDuringSplitPlayback
    ? 'off'
    : colorGradeComparisonMode
  const baseComparisonTargetFrame = Math.max(
    0,
    Math.round(comparisonPreviewFrame ?? comparisonCurrentFrame ?? 0),
  )
  const comparisonTargetFrame =
    stageColorGradeComparisonMode === 'split' && comparisonDisplayedFrame !== null
      ? comparisonDisplayedFrame
      : baseComparisonTargetFrame

  // Leaving split comparison clears the rendered after-frame. Kept as its own
  // effect keyed only on the mode so the per-frame `comparisonTargetFrame`
  // churn doesn't re-run the heavier split render effect on every frame.
  useEffect(() => {
    if (stageColorGradeComparisonMode === 'split') return
    splitAfterPendingFrameRef.current = null
    setSplitAfterRenderedFrame((frame) => (frame === null ? frame : null))
  }, [stageColorGradeComparisonMode])

  useEffect(() => {
    if (stageColorGradeComparisonMode !== 'split') return

    let cancelled = false
    splitAfterPendingFrameRef.current = comparisonTargetFrame
    // Intentionally NOT resetting `splitAfterRenderedFrame` here: the readiness
    // check (`splitAfterRenderedFrame === comparisonTargetFrame`) already gates
    // the overlay, so a stale frame stays hidden until the async render catches
    // up. The previous synchronous reset fed a render cascade
    // (displayedFrame → comparisonTargetFrame → setState → displayedFrame …)
    // that tripped React's "maximum update depth".

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
          drawSourceToPreviewDisplayCanvas(displayCtx, displayCanvas, offscreen)
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
    comparisonDisplayedFrame === comparisonTargetFrame &&
    (isSplitGradeComparison
      ? splitAfterRenderedFrame === comparisonTargetFrame
      : stageColorGradeComparisonMode === 'before' ||
        effectivePlayerDisplayedFrame === comparisonTargetFrame)
  const stageRenderedOverlayVisible = isColorGradeComparisonActive
    ? isRenderedOverlayVisible && isColorGradeComparisonFrameReady
    : isRenderedOverlayVisible || forceFastScrubOverlay
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
      overlayRenderSize={renderSize}
      totalFrames={totalFrames}
      fps={fps}
      initialFrame={initialPlayheadFrameRef.current ?? 0}
      isResolving={isResolving}
      isRenderedOverlayVisible={stageRenderedOverlayVisible}
      isSplitGradeAfterVisible={isSplitAfterVisible}
      colorGradeComparisonMode={stageColorGradeComparisonMode}
      colorGradeSplitPosition={colorGradeSplitPosition}
      onColorGradeSplitPositionChange={setColorGradeSplitPosition}
      inputProps={inputProps}
      domTextScrubInputProps={domTextScrubInputProps}
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
  const { chrome = 'edit', ...previewProps } = props
  const itemsSnapshot = useTransformStableItemsSnapshot()
  return (
    <DeferredVideoPreview {...previewProps} overlayChrome={chrome} itemsSnapshot={itemsSnapshot} />
  )
})

const DeferredVideoPreview = memo(function DeferredVideoPreview({
  itemsSnapshot,
  ...props
}: VideoPreviewProps & {
  overlayChrome: PreviewOverlayChrome
  itemsSnapshot: PreviewItemsSnapshot
}) {
  const deferredItemsSnapshot = useRafDeferredValue(itemsSnapshot)
  return <VideoPreviewBase {...props} itemsSnapshot={deferredItemsSnapshot} />
})

export const ColorVideoPreview = memo(function ColorVideoPreview(props: VideoPreviewProps) {
  return <VideoPreview {...props} chrome="color" />
})
