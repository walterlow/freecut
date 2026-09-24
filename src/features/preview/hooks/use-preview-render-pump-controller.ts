import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import { getBestDomVideoElementForItem } from '@/features/preview/deps/composition-runtime'
import type { PlayerRef } from '@/features/preview/deps/player-core'
import { getGlobalVideoSourcePool } from '@/features/preview/deps/player-pool'
import { usePlaybackStore } from '@/shared/state/playback'
import { getBrowserMediaPlaybackRate } from '@/shared/state/playback/shuttle'
import { useEditorStore } from '@/shared/state/editor'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import { useCompositionsStore } from '@/features/preview/deps/timeline-store'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import type { TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline'
import type { ResolvedTransitionWindow } from '@/shared/timeline/transitions/transition-planner'
import { useGizmoStore } from '../stores/gizmo-store'
import { useCornerPinStore } from '../stores/corner-pin-store'
import { useMaskEditorStore } from '../stores/mask-editor-store'
import {
  backgroundPreseek as workerBackgroundPreseek,
  backgroundBatchPreseek as workerBackgroundBatchPreseek,
  setActivePreviewRenderTarget,
  settleActivePreviewRenderTarget,
  subscribeActivePreviewReady,
} from '../utils/decoder-prewarm'
import { getDirectionalPrewarmOffsets } from '../utils/fast-scrub-prewarm'
import { resolveProxyUrl } from '../utils/media-resolver'
import { scheduleScrubProxyFallback } from '../utils/scrub-proxy-fallback'
import { shouldShowFastScrubOverlay } from '../utils/fast-scrub-overlay-guard'
import { shouldPreferDomPlayerForGizmo } from '../utils/gizmo-preview-presentation'
import { hasPendingPreviewInput, yieldToPendingPreviewInput } from '../utils/preview-input-yield'
import { resolvePlaybackTransitionOverlayState } from '../utils/playback-transition-overlay'
import {
  FAST_SCRUB_DIRECTIONAL_PREWARM_BACKWARD_STEPS,
  FAST_SCRUB_DIRECTIONAL_PREWARM_FORWARD_STEPS,
  FAST_SCRUB_DIRECTIONAL_PREWARM_NEUTRAL_RADIUS,
  FAST_SCRUB_DIRECTIONAL_PREWARM_OPPOSITE_STEPS,
  FAST_SCRUB_MAX_PREWARM_FRAMES,
  FAST_SCRUB_MAX_PREWARM_SOURCES,
  FAST_SCRUB_PREWARM_QUEUE_MAX,
  FAST_SCRUB_PREWARM_RENDER_BUDGET_MS,
  FAST_SCRUB_SOURCE_TOUCH_COOLDOWN_FRAMES,
  type FastScrubBoundarySource,
} from '../utils/preview-constants'
import {
  isAtomicPreviewTarget,
  resolveActivePreviewPresentationTarget,
  resolveBackwardScrubFlags,
  resolveBackwardScrubFramePlan,
  resolveReleasedScrubSnapshotGuardUntilMs,
  resolveRenderPumpTargetFrame,
  resolveScrubDirectionPlan,
  selectBoundaryPrewarmFrames,
  selectBoundarySourcePrewarmSources,
  shouldDropStalePausedPreviewRender,
  shouldRejectBlankTransportHandoff,
  shouldRestoreCommittedPreviewSnapshot,
  shouldUseRenderedPlaybackOverlay,
} from '../utils/render-pump-frame-plan'
import {
  collectClipVideoSourceTimesBySrcForFrame,
  collectClipVideoSourceTimesBySrcForFrameRange,
  collectPlaybackStartVariableSpeedPreseekTargets,
  collectPlaybackStartVariableSpeedPrewarmItemIds,
  collectVisibleTrackVideoSourceTimesBySrc,
  getVideoItemSourceTimeSeconds,
  resolvePreviewPreseekSource,
  resolvePausedVariableSpeedPrewarmPlan,
  shouldRunJumpPreseek,
} from '../utils/render-pump-preseek'
import { createReversePlaybackWindowScheduler } from '../utils/reverse-playback-window'
import {
  beginPlaybackColdStart,
  cancelPlaybackColdStart,
  markPlaybackColdStart,
  markPlaybackStartReadiness,
  resolvePlaybackColdStartVisibleFrame,
  type PlaybackStartLookaheadOrigin,
} from '../utils/playback-cold-start-event'
import {
  ensureAudioContextResumed,
  getPreviewAudioContextState,
} from '@/features/preview/deps/composition-runtime'
import {
  resolveBoundarySourcePrewarmCacheUpdate,
  resolvePrewarmFrameQueueAfterEnqueue,
  resolveScrubPrewarmIdleDelayMs,
  shouldUseCompositionScrubPrewarm,
} from '../utils/render-pump-prewarm-plan'
import { createActiveScrubPreseekScheduler } from '../utils/active-scrub-preseek-scheduler'
import type { CommittedPreviewSnapshotState } from '../utils/preview-display-canvas'
import { createPreviewPresentationGate } from '../utils/preview-presentation-gate'
import type { TransitionPreviewSessionTrace } from './use-preview-transition-session-controller'
import { resolveTransitionDomPlaybackState } from '../utils/transition-dom-playback'
import { createLogger } from '@/shared/logging/logger'
import { isPreviewTraceEnabled, recordPumpTrace } from '@/shared/logging/preview-trace'
import {
  recordPreviewScrubPresentationQuality,
  recordPreviewScrubPresented,
  recordPreviewPreseekPlan,
  recordPreviewScrubRenderCompleted,
  recordPreviewScrubRenderDequeued,
  recordPreviewScrubRenderStarted,
  recordPreviewScrubRequest,
} from '@/shared/logging/preview-scrub-performance'
import {
  resolveAATransitionRamps,
  type CompositionRendererInstance,
} from '@/features/preview/deps/export'

const logger = createLogger('VideoPreview')

type TransitionWindow = ResolvedTransitionWindow<TimelineItem>
type PlaybackTransitionOverlayWindows = Parameters<typeof resolvePlaybackTransitionOverlayState>[0]
type PlaybackStoreSnapshot = ReturnType<typeof usePlaybackStore.getState>
type GizmoStoreSnapshot = ReturnType<typeof useGizmoStore.getState>

type FastScrubRenderer = CompositionRendererInstance

function shouldReusePreparedLookaheadOnPlay(params: {
  state: PlaybackStoreSnapshot
  prev: PlaybackStoreSnapshot
  forceFastScrubOverlay: boolean
  isSplitComparison: boolean
  renderedFrame: number | null
}): boolean {
  return (
    params.state.isPlaying !== params.prev.isPlaying &&
    params.state.isPlaying &&
    params.forceFastScrubOverlay &&
    params.state.previewFrame === null &&
    !params.isSplitComparison &&
    params.renderedFrame === params.state.currentFrame + 1
  )
}

function shouldPresentPreparedPlaybackFrame(params: {
  state: PlaybackStoreSnapshot
  forceFastScrubOverlay: boolean
  targetFrame: number | null
  renderedFrame: number | null
}): params is typeof params & { targetFrame: number } {
  return (
    params.state.isPlaying &&
    params.forceFastScrubOverlay &&
    params.targetFrame !== null &&
    params.renderedFrame === params.targetFrame
  )
}

function getGizmoPreviewInvalidation(
  state: GizmoStoreSnapshot,
  prev: GizmoStoreSnapshot,
): 'all' | 'frame' | null {
  const unifiedPreviewChanged = state.preview !== prev.preview
  const transformPreviewChanged = state.previewTransform !== prev.previewTransform
  const gradeBypassChanged =
    state.colorGradeBypassed !== prev.colorGradeBypassed ||
    state.colorGradeComparisonMode !== prev.colorGradeComparisonMode

  if (gradeBypassChanged) return 'all'
  if (unifiedPreviewChanged || (transformPreviewChanged && state.activeGizmo)) return 'frame'
  return null
}

type PreviewPerfState = {
  fastScrubPrewarmSourceEvictions: number
  fastScrubPrewarmedSources: number
  staleScrubOverlayDrops: number
  scrubDroppedFrames: number
  scrubUpdates: number
}

function resolvePlaybackDomVideoElement(
  itemId: string,
  getPinnedTransitionElementForItem: (itemId: string) => HTMLVideoElement | null,
  getRegisteredElementForItem: (itemId: string) => HTMLVideoElement | null,
): HTMLVideoElement | null {
  return getPinnedTransitionElementForItem(itemId) ?? getRegisteredElementForItem(itemId)
}

interface UsePreviewRenderPumpParams {
  playerRef: RefObject<PlayerRef | null>
  fps: number
  forceFastScrubOverlay: boolean
  useProxy: boolean
  combinedTracks: TimelineTrack[]
  fastScrubBoundaryFrames: number[]
  fastScrubBoundarySources: FastScrubBoundarySource[]
  playbackTransitionOverlayWindows: PlaybackTransitionOverlayWindows
  playbackTransitionLookaheadFrames: number
  playbackTransitionCooldownFrames: number
  playbackTransitionPrerenderRunwayFrames: number
  previewPerfRef: MutableRefObject<PreviewPerfState>
  isGizmoInteractingRef: MutableRefObject<boolean>
  bypassPreviewSeekRef: MutableRefObject<boolean>
  showFastScrubOverlayRef: MutableRefObject<boolean>
  scrubCanvasRef: MutableRefObject<HTMLCanvasElement | null>
  scrubRendererRef: RefObject<FastScrubRenderer | null>
  scrubMountedRef: MutableRefObject<boolean>
  scrubRenderInFlightRef: MutableRefObject<boolean>
  scrubRenderGenerationRef: MutableRefObject<number>
  scrubDirectionRef: MutableRefObject<-1 | 0 | 1>
  scrubRequestedFrameRef: MutableRefObject<number | null>
  scrubPrewarmQueueRef: MutableRefObject<number[]>
  scrubPrewarmQueuedSetRef: MutableRefObject<Set<number>>
  scrubPrewarmedFramesRef: MutableRefObject<number[]>
  scrubPrewarmedFrameSetRef: MutableRefObject<Set<number>>
  scrubPrewarmedSourcesRef: MutableRefObject<Set<string>>
  scrubPrewarmedSourceOrderRef: MutableRefObject<string[]>
  scrubPrewarmedSourceTouchFrameRef: MutableRefObject<Map<string, number>>
  scrubOffscreenCanvasRef: MutableRefObject<OffscreenCanvas | null>
  scrubOffscreenRenderedFrameRef: MutableRefObject<number | null>
  committedPreviewSnapshotRef: MutableRefObject<CommittedPreviewSnapshotState>
  bgTransitionRenderInFlightRef: MutableRefObject<boolean>
  resumeScrubLoopRef: MutableRefObject<() => void>
  lastBackwardScrubPreloadAtRef: MutableRefObject<number>
  lastBackwardScrubRenderAtRef: MutableRefObject<number>
  lastBackwardRequestedFrameRef: MutableRefObject<number | null>
  suppressScrubBackgroundPrewarmRef: MutableRefObject<boolean>
  fallbackToPlayerScrubRef: MutableRefObject<boolean>
  lastPausedPrearmTargetRef: MutableRefObject<number | null>
  lastPlayingPrearmTargetRef: MutableRefObject<number | null>
  deferredPlaybackTransitionPrepareFrameRef: MutableRefObject<number | null>
  transitionPrepareTimeoutRef: MutableRefObject<number | null>
  transitionSessionWindowRef: MutableRefObject<TransitionWindow | null>
  transitionSessionPinnedElementsRef: MutableRefObject<Map<string, HTMLVideoElement | null>>
  transitionSessionStallCountRef: MutableRefObject<Map<string, { ct: number; count: number }>>
  transitionSessionBufferedFramesRef: MutableRefObject<Map<number, OffscreenCanvas>>
  transitionPrewarmPromiseRef: MutableRefObject<Promise<void> | null>
  transitionSessionTraceRef: MutableRefObject<TransitionPreviewSessionTrace | null>
  setDisplayedFrame: (frame: number | null) => void
  hideFastScrubOverlay: () => void
  hidePlaybackTransitionOverlay: () => void
  showFastScrubOverlayForFrame: () => void
  showPlaybackTransitionOverlayForFrame: () => void
  shouldPreferPlayerForPreview: (previewFrame: number | null) => boolean
  shouldPreserveHighFidelityBackwardPreview: (targetFrame: number | null) => boolean
  getTransitionWindowByStartFrame: (startFrame: number | null) => TransitionWindow | null
  getTransitionWindowForFrame: (frame: number) => TransitionWindow | null
  getPlayingAnyTransitionPrewarmStartFrame: (frame: number) => number | null
  getPausedTransitionPrewarmStartFrame: (frame: number) => number | null
  getPinnedTransitionElementForItem: (itemId: string) => HTMLVideoElement | null
  pinTransitionPlaybackSession: (
    window: TransitionWindow | null,
    pausedTargetFrame?: number,
  ) => TransitionWindow | null
  clearTransitionPlaybackSession: () => void
  cacheTransitionSessionFrame: (frame: number) => void
  preparePlaybackTransitionFrame: (frame: number) => Promise<boolean>
  disposeFastScrubRenderer: () => void
  ensureFastScrubRenderer: () => Promise<FastScrubRenderer | null>
  ensureBgTransitionRenderer: () => Promise<FastScrubRenderer | null>
  pushTransitionTrace: (phase: string, data?: Record<string, unknown>) => void
  isPausedTransitionOverlayActive: (
    frame: number,
    playbackState: { isPlaying: boolean; previewFrame: number | null },
  ) => boolean
  trackPlayerSeek: (targetFrame: number) => void
  recordRenderFrameJitter?: (
    frame: number,
    renderMs: number,
    inTransition: boolean,
    transitionId: string | null,
    progress: number | null,
  ) => void
}

export function usePreviewRenderPump({
  playerRef,
  fps,
  forceFastScrubOverlay,
  useProxy,
  combinedTracks,
  fastScrubBoundaryFrames,
  fastScrubBoundarySources,
  playbackTransitionOverlayWindows,
  playbackTransitionLookaheadFrames,
  playbackTransitionCooldownFrames,
  playbackTransitionPrerenderRunwayFrames,
  previewPerfRef,
  isGizmoInteractingRef,
  bypassPreviewSeekRef,
  showFastScrubOverlayRef,
  scrubCanvasRef,
  scrubRendererRef,
  scrubMountedRef,
  scrubRenderInFlightRef,
  scrubRenderGenerationRef,
  scrubDirectionRef,
  scrubRequestedFrameRef,
  scrubPrewarmQueueRef,
  scrubPrewarmQueuedSetRef,
  scrubPrewarmedFramesRef,
  scrubPrewarmedFrameSetRef,
  scrubPrewarmedSourcesRef,
  scrubPrewarmedSourceOrderRef,
  scrubPrewarmedSourceTouchFrameRef,
  scrubOffscreenCanvasRef,
  scrubOffscreenRenderedFrameRef,
  committedPreviewSnapshotRef,
  bgTransitionRenderInFlightRef,
  resumeScrubLoopRef,
  lastBackwardScrubPreloadAtRef,
  lastBackwardScrubRenderAtRef,
  lastBackwardRequestedFrameRef,
  suppressScrubBackgroundPrewarmRef,
  fallbackToPlayerScrubRef,
  lastPausedPrearmTargetRef,
  lastPlayingPrearmTargetRef,
  deferredPlaybackTransitionPrepareFrameRef,
  transitionPrepareTimeoutRef,
  transitionSessionWindowRef,
  transitionSessionPinnedElementsRef,
  transitionSessionStallCountRef,
  transitionSessionBufferedFramesRef,
  transitionPrewarmPromiseRef,
  transitionSessionTraceRef,
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
}: UsePreviewRenderPumpParams) {
  const unmountingRef = useRef(false)
  const pausedPlaybackLookaheadFrameRef = useRef<number | null>(null)
  const pausedPlaybackLookaheadOriginRef = useRef<PlaybackStartLookaheadOrigin | null>(null)
  const pausedPlaybackLookaheadStartedMsRef = useRef<number | null>(null)
  const initialLookaheadIdleIdRef = useRef<number | null>(null)
  const initialLookaheadTimeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    unmountingRef.current = false
    return () => {
      unmountingRef.current = true
    }
  }, [])

  useEffect(() => {
    let effectDisposed = false
    scrubMountedRef.current = true

    let transportSettlingUntilMs = 0
    let pausedTransportHeldFrame: number | null = null
    let pausedTransportHoldUntilMs = 0
    const committedPreviewSnapshot = committedPreviewSnapshotRef.current
    // Presentation decisions (blank-frame rejection, released-scrub guard,
    // paused transport hold) live in the gate; the pump only feeds it renders.
    const presentation = createPreviewPresentationGate({
      getDisplayCanvas: () => scrubCanvasRef.current,
      getDisplayedFrame: () => usePreviewBridgeStore.getState().displayedFrame,
      getPlaybackState: () => usePlaybackStore.getState(),
      isDisplayVisible: () => showFastScrubOverlayRef.current,
      getCommittedSnapshot: () => committedPreviewSnapshot,
      getOffscreenCanvas: () => scrubOffscreenCanvasRef.current,
      discardOffscreenRender: (source, renderedFrame, options) => {
        if (source !== scrubOffscreenCanvasRef.current) return
        scrubOffscreenRenderedFrameRef.current = null
        if (options.invalidateCache) {
          scrubRendererRef.current?.invalidateFrameCache({ frames: [renderedFrame] })
        }
      },
      getPausedTransportHold: () => ({
        heldFrame: pausedTransportHeldFrame,
        holdUntilMs: pausedTransportHoldUntilMs,
      }),
      getTransportSettlingUntilMs: () => transportSettlingUntilMs,
      setDisplayedFrame,
      recordPresentation: (frame, usedFallback) => {
        recordPreviewScrubPresentationQuality(frame, usedFallback)
        recordPreviewScrubPresented(frame)
      },
      settleActiveRenderTarget: settleActivePreviewRenderTarget,
      markColdStartVisibleFrame: (frame) =>
        resolvePlaybackColdStartVisibleFrame(frame, 'rendered_overlay'),
    })

    const usesRenderedPlaybackOverlay = (state: PlaybackStoreSnapshot) =>
      shouldUseRenderedPlaybackOverlay(state, forceFastScrubOverlay)

    const getPlaybackTransitionStateForFrame = (frame: number) =>
      resolvePlaybackTransitionOverlayState(
        playbackTransitionOverlayWindows,
        frame,
        playbackTransitionLookaheadFrames,
        playbackTransitionCooldownFrames,
      )

    const tryShowPreparedPlaybackTransitionOverlay = (frame: number) => {
      const bufferedFrame = transitionSessionBufferedFramesRef.current.get(frame)
      if (bufferedFrame) {
        const trace = transitionSessionTraceRef.current
        if (trace && trace.enteredAtMs === null) {
          trace.enteredAtMs = performance.now()
          pushTransitionTrace('entry_show', {
            opId: trace.opId,
            frame,
            via: 'buffer',
            bufferedFrames: transitionSessionBufferedFramesRef.current.size,
          })
        }
        presentation.drawSourceToDisplay(bufferedFrame, frame)
        showPlaybackTransitionOverlayForFrame()
        return true
      }
      if (scrubOffscreenRenderedFrameRef.current !== frame) {
        return false
      }
      const trace = transitionSessionTraceRef.current
      if (trace && trace.enteredAtMs === null) {
        trace.enteredAtMs = performance.now()
        pushTransitionTrace('entry_show', {
          opId: trace.opId,
          frame,
          via: 'offscreen',
          bufferedFrames: transitionSessionBufferedFramesRef.current.size,
        })
      }
      presentation.drawToDisplay(frame)
      showPlaybackTransitionOverlayForFrame()
      return true
    }

    const schedulePlaybackTransitionPrepare = (frame: number | null) => {
      if (frame === null) {
        deferredPlaybackTransitionPrepareFrameRef.current = null
        if (transitionPrepareTimeoutRef.current !== null) {
          clearTimeout(transitionPrepareTimeoutRef.current)
          transitionPrepareTimeoutRef.current = null
        }
        return
      }
      const playbackState = usePlaybackStore.getState()
      const transitionWindow = getTransitionWindowByStartFrame(frame)
      const aaRamps = transitionWindow
        ? resolveAATransitionRamps(
            transitionWindow.leftClip,
            transitionWindow.rightClip,
            {
              transitionStart: transitionWindow.startFrame,
              transitionEnd: transitionWindow.endFrame,
            },
            fps,
          )
        : null
      if (aaRamps && playbackState.previewFrame === null && playbackState.currentFrame < frame) {
        // Continuous-split A-A transitions use synchronized DOM video lanes. Rendering an
        // eight-frame MediaBunny runway before entry blocks the main thread
        // without producing frames the live transition will consume.
        deferredPlaybackTransitionPrepareFrameRef.current = null
        return
      }
      deferredPlaybackTransitionPrepareFrameRef.current = frame
      if (!scrubRenderInFlightRef.current) {
        void preparePlaybackTransitionFrame(frame)
      }
    }

    const clearScheduledTransitionPrepare = () => {
      if (transitionPrepareTimeoutRef.current !== null) {
        clearTimeout(transitionPrepareTimeoutRef.current)
        transitionPrepareTimeoutRef.current = null
      }
    }

    const clearPrewarmQueue = () => {
      scrubPrewarmQueueRef.current = []
      scrubPrewarmQueuedSetRef.current.clear()
    }

    const hideAllOverlays = () => {
      hideFastScrubOverlay()
      hidePlaybackTransitionOverlay()
    }

    const resetScrubLoopState = () => {
      scrubRequestedFrameRef.current = null
      scrubDirectionRef.current = 0
      suppressScrubBackgroundPrewarmRef.current = false
      fallbackToPlayerScrubRef.current = false
      lastBackwardScrubPreloadAtRef.current = 0
      lastBackwardScrubRenderAtRef.current = 0
      lastBackwardRequestedFrameRef.current = null
      clearPrewarmQueue()
    }

    const runBatchPreseek = (bySource: Map<string, number[]>) => {
      for (const [src, timestamps] of bySource) {
        void workerBackgroundBatchPreseek(src, timestamps)
      }
    }

    const runPreseekTargets = (targets: Array<{ src: string; time: number }>) => {
      for (const target of targets) {
        void workerBackgroundPreseek(target.src, target.time)
      }
    }

    const scheduleOpportunisticTransitionPrepare = () => {
      if (effectDisposed) return
      const deferredFrame = deferredPlaybackTransitionPrepareFrameRef.current
      if (deferredFrame === null) {
        clearScheduledTransitionPrepare()
        return
      }
      if (transitionPrepareTimeoutRef.current !== null) {
        return
      }

      transitionPrepareTimeoutRef.current = window.setTimeout(() => {
        transitionPrepareTimeoutRef.current = null
        if (effectDisposed || !scrubMountedRef.current) return

        const playbackState = usePlaybackStore.getState()
        if (!playbackState.isPlaying) return

        const playbackTransitionState = getPlaybackTransitionStateForFrame(
          playbackState.currentFrame,
        )
        if (
          !playbackTransitionState.shouldPrewarm ||
          playbackTransitionState.nextTransitionStartFrame !== deferredFrame
        ) {
          return
        }

        if (scrubRenderInFlightRef.current) {
          scheduleOpportunisticTransitionPrepare()
          return
        }

        const trace = transitionSessionTraceRef.current
        if (trace) {
          pushTransitionTrace('prepare_opportunistic', {
            opId: trace.opId,
            targetFrame: deferredFrame,
          })
        }

        deferredPlaybackTransitionPrepareFrameRef.current = null
        void preparePlaybackTransitionFrame(deferredFrame)
      }, 0)
    }

    let renderPumpRestartTimeoutId: ReturnType<typeof setTimeout> | null = null
    let scrubPrewarmIdleTimeoutId: ReturnType<typeof setTimeout> | null = null
    let onRenderOwnerDrained: (() => void) | null = null
    let playbackPrewarmInFlight = false
    let lastScrubTargetAtMs = 0
    let scrubPrewarmIdleDelayMs = 40
    // The held-scrub decode lane keeps its own schedule version and source
    // targets; the router only decides when to ask it for a window.
    const activeScrubPreseek = createActiveScrubPreseekScheduler({
      fps,
      useProxy,
      collectSourceTimes: (frame) =>
        collectVisibleTrackVideoSourceTimesBySrc(combinedTracks, frame, fps, {
          requireExplicitSourceFps: false,
          resolveComposition: resolvePreseekComposition,
          resolveItemSrc: resolvePreseekItemSrc,
        }),
      getPlaybackState: () => usePlaybackStore.getState(),
      isEffectDisposed: () => effectDisposed,
      isMounted: () => scrubMountedRef.current,
      isRenderInFlight: () => scrubRenderInFlightRef.current,
      clearOffscreenRenderedFrameIf: (frame) => {
        if (scrubOffscreenRenderedFrameRef.current === frame) {
          scrubOffscreenRenderedFrameRef.current = null
        }
      },
      requestFrame: (frame) => {
        scrubRequestedFrameRef.current = frame
      },
      pumpRenderLoop: () => void pumpRenderLoop(),
    })
    const cancelScrubPrewarmIdleRestart = () => {
      if (scrubPrewarmIdleTimeoutId === null) return
      clearTimeout(scrubPrewarmIdleTimeoutId)
      scrubPrewarmIdleTimeoutId = null
    }

    const scheduleScrubPrewarmIdleRestart = (minimumDelayMs = 0) => {
      if (effectDisposed) return
      cancelScrubPrewarmIdleRestart()
      const elapsedSinceInput = performance.now() - lastScrubTargetAtMs
      const remainingDelay = Math.max(minimumDelayMs, scrubPrewarmIdleDelayMs - elapsedSinceInput)
      scrubPrewarmIdleTimeoutId = setTimeout(() => {
        scrubPrewarmIdleTimeoutId = null
        if (
          effectDisposed ||
          !scrubMountedRef.current ||
          scrubPrewarmQueueRef.current.length === 0
        ) {
          return
        }
        if (scrubRequestedFrameRef.current !== null || scrubRenderInFlightRef.current) {
          scheduleScrubPrewarmIdleRestart(16)
          return
        }
        void pumpRenderLoop()
      }, remainingDelay)
    }

    const scheduleRenderPumpRestart = () => {
      if (effectDisposed || renderPumpRestartTimeoutId !== null || !scrubMountedRef.current) {
        return
      }
      renderPumpRestartTimeoutId = setTimeout(() => {
        renderPumpRestartTimeoutId = null
        if (
          !effectDisposed &&
          scrubMountedRef.current &&
          !scrubRenderInFlightRef.current &&
          scrubRequestedFrameRef.current !== null
        ) {
          void pumpRenderLoop()
        }
      }, 0)
    }

    // Single-owner async pump for scrub rendering. Callers never spawn a
    // second worker; they only replace `scrubRequestedFrameRef` and let the
    // current owner pick up the newest request on the next loop iteration.
    const pumpRenderLoop = async () => {
      if (scrubRenderInFlightRef.current) return
      scrubRenderInFlightRef.current = true
      const generation = scrubRenderGenerationRef.current
      // Fast bail-out: check if this pump has been superseded by a newer
      // seek/play cycle. Checked after every await to abandon stale work
      // as early as possible, freeing GPU/decoder resources for the new frame.
      const isStale = () => effectDisposed || scrubRenderGenerationRef.current !== generation

      try {
        const enqueuePrewarmFrame = (frame: number) => {
          const plan = resolvePrewarmFrameQueueAfterEnqueue({
            frame,
            queue: scrubPrewarmQueueRef.current,
            queuedFrames: scrubPrewarmQueuedSetRef.current,
            prewarmedFrames: scrubPrewarmedFrameSetRef.current,
            maxQueueSize: FAST_SCRUB_PREWARM_QUEUE_MAX,
          })
          scrubPrewarmQueueRef.current = plan.queue
          scrubPrewarmQueuedSetRef.current = plan.queuedFrames
        }

        const markPrewarmed = (frame: number) => {
          if (scrubPrewarmedFrameSetRef.current.has(frame)) return
          scrubPrewarmedFrameSetRef.current.add(frame)
          scrubPrewarmedFramesRef.current.push(frame)

          if (scrubPrewarmedFramesRef.current.length > FAST_SCRUB_MAX_PREWARM_FRAMES) {
            const dropped = scrubPrewarmedFramesRef.current.shift()
            if (dropped !== undefined) {
              scrubPrewarmedFrameSetRef.current.delete(dropped)
            }
          }
        }

        const enqueueBoundaryPrewarm = (targetFrame: number) => {
          const selectedFrames = selectBoundaryPrewarmFrames({
            boundaryFrames: fastScrubBoundaryFrames,
            targetFrame,
            direction: scrubDirectionRef.current,
            fps,
          })
          for (const frame of selectedFrames) {
            enqueuePrewarmFrame(frame)
          }
        }

        const enqueueBoundarySourcePrewarm = (targetFrame: number) => {
          if (fastScrubBoundarySources.length === 0) return

          const pool = getGlobalVideoSourcePool()
          const markBoundarySourcePrewarmed = (src: string, currentFrame: number): boolean => {
            const plan = resolveBoundarySourcePrewarmCacheUpdate({
              src,
              currentFrame,
              touchFrameMap: scrubPrewarmedSourceTouchFrameRef.current,
              prewarmedSources: scrubPrewarmedSourcesRef.current,
              prewarmedSourceOrder: scrubPrewarmedSourceOrderRef.current,
              cooldownFrames: FAST_SCRUB_SOURCE_TOUCH_COOLDOWN_FRAMES,
              maxSources: FAST_SCRUB_MAX_PREWARM_SOURCES,
            })

            if (!plan.touched) {
              return false
            }

            scrubPrewarmedSourceTouchFrameRef.current = plan.touchFrameMap
            scrubPrewarmedSourcesRef.current = plan.prewarmedSources
            scrubPrewarmedSourceOrderRef.current = plan.prewarmedSourceOrder
            previewPerfRef.current.fastScrubPrewarmSourceEvictions += plan.evictedSources.length
            previewPerfRef.current.fastScrubPrewarmedSources = plan.prewarmedSources.size
            return true
          }
          const selectedSources = selectBoundarySourcePrewarmSources({
            boundarySources: fastScrubBoundarySources,
            targetFrame,
            direction: scrubDirectionRef.current,
            fps,
          })

          for (const src of selectedSources) {
            const wasPrewarmed = scrubPrewarmedSourcesRef.current.has(src)
            const touched = markBoundarySourcePrewarmed(src, targetFrame)
            if (!touched) continue
            if (!wasPrewarmed) {
              pool.preloadSource(src).catch(() => {})
            }
          }
        }

        const enqueueDirectionalPrewarm = (targetFrame: number) => {
          const offsets = getDirectionalPrewarmOffsets(scrubDirectionRef.current, {
            forwardSteps: FAST_SCRUB_DIRECTIONAL_PREWARM_FORWARD_STEPS,
            backwardSteps: FAST_SCRUB_DIRECTIONAL_PREWARM_BACKWARD_STEPS,
            oppositeSteps: FAST_SCRUB_DIRECTIONAL_PREWARM_OPPOSITE_STEPS,
            neutralRadius: FAST_SCRUB_DIRECTIONAL_PREWARM_NEUTRAL_RADIUS,
          })
          for (const offset of offsets) {
            enqueuePrewarmFrame(targetFrame + offset)
          }
        }

        let prewarmBudgetStart = 0
        while (!effectDisposed && scrubMountedRef.current) {
          if (isStale()) break
          const inputState = usePlaybackStore.getState()
          if (hasPendingPreviewInput(inputState.isPlaying || inputState.previewFrame !== null)) {
            await yieldToPendingPreviewInput()
            if (isStale()) break
          }
          const currentPlaybackState = usePlaybackStore.getState()
          if (
            !usesRenderedPlaybackOverlay(currentPlaybackState) &&
            shouldPreferPlayerForPreview(currentPlaybackState.previewFrame)
          ) {
            hideFastScrubOverlay()
            hidePlaybackTransitionOverlay()
            scrubRequestedFrameRef.current = null
            break
          }
          if (fallbackToPlayerScrubRef.current) {
            scrubRequestedFrameRef.current = null
            clearPrewarmQueue()
            hideAllOverlays()
            break
          }

          const targetFrame = scrubRequestedFrameRef.current
          const isPriorityFrame = targetFrame !== null
          const frameToRender = isPriorityFrame
            ? targetFrame
            : (scrubPrewarmQueueRef.current.shift() ?? null)

          if (frameToRender === null) break

          if (isPriorityFrame) {
            scrubRequestedFrameRef.current = null
            recordPreviewScrubRenderDequeued(frameToRender)
            prewarmBudgetStart = 0 // Reset budget for prewarm after this priority frame
          } else {
            scrubPrewarmQueuedSetRef.current.delete(frameToRender)
            // Skip stale prewarm if a newer scrub frame is pending.
            if (scrubRequestedFrameRef.current !== null) {
              continue
            }
            if (suppressScrubBackgroundPrewarmRef.current) {
              continue
            }
            // Skip prewarm during playback — WASM decode prewarm renders
            // (40-80ms each) block the loop from processing priority frames,
            // causing the overlay to fall behind and show stale content.
            if (usePlaybackStore.getState().isPlaying) {
              break
            }
            // Time-budget prewarm renders to keep scrubbing responsive.
            // After exhausting the budget, yield so new priority frames aren't delayed.
            if (
              prewarmBudgetStart > 0 &&
              performance.now() - prewarmBudgetStart > FAST_SCRUB_PREWARM_RENDER_BUDGET_MS
            ) {
              break
            }
          }

          const renderer = await ensureFastScrubRenderer()
          if (isStale()) break
          if (!renderer || !scrubMountedRef.current) {
            hideFastScrubOverlay()
            break
          }
          // For background prewarm frames, bail if a newer scrub target arrived.
          // Priority frames proceed regardless — their rendered content is always useful.
          if (!isPriorityFrame && isStale()) break

          // Enable DOM video element provider during playback for zero-copy rendering.
          // During playback, the Player's <video> elements are already at
          // the correct frame — reading from them avoids mediabunny decode entirely.
          if ('setDomVideoElementProvider' in renderer) {
            const playbackNow = usePlaybackStore.getState()
            renderer.setNonBlockingVideoFrameTolerance?.(
              playbackNow.isPlaying && playbackNow.playbackRate < 0 ? 0.5 : undefined,
            )
            if (playbackNow.isPlaying && playbackNow.playbackRate >= 0) {
              // Only pin/clear the transition session when the rendered frame is
              // actually inside a transition window. Passing null for pre-transition
              // frames would destroy sessions that the prearm subscription just
              // pinned, causing churn and losing the DOM video element provider
              // needed for smooth transition entry.
              const windowForFrame = getTransitionWindowForFrame(frameToRender)
              if (windowForFrame) {
                const prevSession = transitionSessionWindowRef.current
                const isNewSession =
                  !prevSession || prevSession.transition.id !== windowForFrame.transition.id
                const aaRamps = resolveAATransitionRamps(
                  windowForFrame.leftClip,
                  windowForFrame.rightClip,
                  {
                    transitionStart: windowForFrame.startFrame,
                    transitionEnd: windowForFrame.endFrame,
                  },
                  fps,
                )
                pinTransitionPlaybackSession(windowForFrame)
                // Await the prearm prewarm so mediabunny decoders are positioned
                // at the correct source time before rendering. The prearm fires
                // ~2s ahead so this resolves near-instantly in the common case.
                // Without this, decoders may be at a stale position from a prior
                // playback, causing 100-300ms backward keyframe seeks per frame.
                if (transitionPrewarmPromiseRef.current) {
                  await transitionPrewarmPromiseRef.current
                  transitionPrewarmPromiseRef.current = null
                }
                // When entering a transition mid-playback (no prearm happened),
                // await the prewarm synchronously to position decoders.
                if (isNewSession && !aaRamps && 'prewarmItems' in renderer) {
                  await renderer.prewarmItems?.(
                    [windowForFrame.leftClip.id, windowForFrame.rightClip.id],
                    frameToRender,
                  )
                }
              }
              renderer.setDomVideoElementProvider?.((itemId) =>
                resolvePlaybackDomVideoElement(
                  itemId,
                  getPinnedTransitionElementForItem,
                  getBestDomVideoElementForItem,
                ),
              )
            } else if (!playbackNow.isPlaying) {
              // Scrubbing (paused): the composited render normally decodes video
              // via mediabunny on the main thread, which is slow (cold ~1-2s) and
              // makes scrubbing over clips that sit under text/effects lag badly.
              // The DOM <video> elements are already being seeked to the scrub
              // frame by the composition runtime (video-content.tsx), so expose
              // them here for zero-copy compositing. renderVideoItem still checks
              // freshness (0.2s drift) and falls back to mediabunny on large
              // jumps where the element hasn't caught up.
              const transitionWindow = getTransitionWindowForFrame(frameToRender)
              const isActiveTransitionFrame =
                transitionWindow !== null &&
                frameToRender >= transitionWindow.startFrame &&
                frameToRender < transitionWindow.endFrame
              if (transitionWindow && isActiveTransitionFrame) {
                // A-A transitions use an extended source-time ramp that the
                // ordinary paused DOM composition does not own. Pin and seek
                // both browser-video lanes to that ramp before compositing so
                // hover skims show the real effect without a cold exact decode.
                pinTransitionPlaybackSession(transitionWindow, frameToRender)
                renderer.setDomVideoElementProvider?.(getPinnedTransitionElementForItem)
              } else {
                renderer.setDomVideoElementProvider?.(getBestDomVideoElementForItem)
              }
            } else {
              // Reverse media elements retain only one outstanding seek and
              // coalesce every clock update to the newest target. Completed
              // browser-decoded frames are therefore a useful zero-copy source;
              // stale elements still fall through to worker/proxy bitmaps.
              renderer.setDomVideoElementProvider?.(getBestDomVideoElementForItem)
            }
          }

          let priorityRenderUsedFallback = false
          if (isPriorityFrame) {
            // Visible scrub targets still use full composition rendering.
            const renderStartMs = performance.now()
            recordPreviewScrubRenderStarted(frameToRender)
            await renderer.renderFrame(frameToRender)
            if ('wasLastRenderAborted' in renderer && renderer.wasLastRenderAborted?.()) {
              recordPreviewScrubRenderCompleted(frameToRender)
              // The renderer clears the shared offscreen canvas before it can
              // discover that a nested source is still settling. Never leave
              // the previous frame tag attached to those cleared pixels: the
              // playback rAF would otherwise reuse them as a black resume frame.
              scrubOffscreenRenderedFrameRef.current = null
              continue
            }
            if (isStale()) {
              recordPreviewScrubRenderCompleted(frameToRender)
              // Renderer disposal can start a replacement pump before the old
              // render promise settles. Drop that generation before it reads
              // or tags the replacement renderer's shared canvas refs.
              scrubOffscreenRenderedFrameRef.current = null
              break
            }
            priorityRenderUsedFallback =
              'wasLastRenderFallback' in renderer && renderer.wasLastRenderFallback?.() === true
            const renderMs = performance.now() - renderStartMs
            recordPreviewScrubRenderCompleted(frameToRender)
            const renderedSource = scrubOffscreenCanvasRef.current
            const displayedSource = scrubCanvasRef.current
            const displayedFrame = usePreviewBridgeStore.getState().displayedFrame
            if (
              renderedSource &&
              displayedSource &&
              performance.now() <= transportSettlingUntilMs &&
              displayedFrame !== null &&
              Math.abs(frameToRender - displayedFrame) <= 1 &&
              shouldRejectBlankTransportHandoff({
                isTransportSettling: true,
                renderedFrame: frameToRender,
                displayedFrame,
                probeRenderedFrameBlank: () =>
                  presentation.isEffectivelyBlankPreviewSource(renderedSource),
                probeDisplayedFrameBlank: () =>
                  presentation.isEffectivelyBlankPreviewSource(displayedSource),
              })
            ) {
              // The known-good same-frame front buffer remains visible. The
              // offscreen surface was cleared, so it must not be reused later.
              scrubOffscreenRenderedFrameRef.current = null
              continue
            }
            scrubOffscreenRenderedFrameRef.current = frameToRender
            // Dev: capture ALL frame times to window global for jitter debugging
            if (import.meta.env.DEV) {
              const log = (window as unknown as Record<string, unknown>).__ALL_FRAME_TIMES__ as
                | Array<{ f: number; ms: number }>
                | undefined
              if (log && log.length < 300) {
                log.push({ f: frameToRender, ms: Math.round(renderMs * 100) / 100 })
              }
              // Feed the frame jitter monitor with transition context
              const tw = transitionSessionWindowRef.current
              const inTrans =
                tw !== null && frameToRender >= tw.startFrame && frameToRender < tw.endFrame
              recordRenderFrameJitter?.(
                frameToRender,
                renderMs,
                inTrans,
                tw?.transition.id ?? null,
                inTrans && tw
                  ? (frameToRender - tw.startFrame) / (tw.endFrame - tw.startFrame)
                  : null,
              )
            }
            // Log transition-area frame timing for diagnostics.
            if (import.meta.env.DEV && transitionSessionWindowRef.current) {
              const tw = transitionSessionWindowRef.current
              if (frameToRender >= tw.startFrame - 10 && frameToRender <= tw.endFrame + 5) {
                pushTransitionTrace(renderMs > 16 ? 'render_frame_slow' : 'render_frame', {
                  frame: frameToRender,
                  renderMs: Math.round(renderMs * 100) / 100,
                  inTransition: frameToRender >= tw.startFrame && frameToRender < tw.endFrame,
                })
              }
            }
          } else {
            // Background scrub prewarm: collect eligible frames into a batch
            // for samplesAtTimestamps() optimized pipeline, then dispatch.
            const prewarmBatch: number[] = [frameToRender]
            // Drain more frames from the queue while within budget and not stale
            while (scrubPrewarmQueueRef.current.length > 0) {
              if (scrubRequestedFrameRef.current !== null) break
              if (suppressScrubBackgroundPrewarmRef.current) break
              if (usePlaybackStore.getState().isPlaying) break
              if (
                prewarmBudgetStart > 0 &&
                performance.now() - prewarmBudgetStart > FAST_SCRUB_PREWARM_RENDER_BUDGET_MS
              )
                break
              const next = scrubPrewarmQueueRef.current.shift()!
              scrubPrewarmQueuedSetRef.current.delete(next)
              prewarmBatch.push(next)
            }
            // Batch prewarm via samplesAtTimestamps — each packet decoded at most
            // once across the batch. Falls back to sequential drawFrame internally
            // for sources where batch mode has been disabled.
            await renderer.prewarmFrames(prewarmBatch)
            for (const f of prewarmBatch) {
              markPrewarmed(f)
            }
          }
          if (!scrubMountedRef.current || isStale()) {
            if (isPriorityFrame) {
              // Nested and compound renders can finish after a Play/Pause
              // lifecycle change. Their pixels may have been assembled from
              // providers owned by the previous mode, so force the current
              // generation to render the target again before it is displayed.
              scrubOffscreenRenderedFrameRef.current = null
            }
            break
          }

          if (isPriorityFrame) {
            const playbackState = usePlaybackStore.getState()
            if (pausedPlaybackLookaheadFrameRef.current === frameToRender) {
              const lookaheadReadyMs = performance.now()
              markPlaybackStartReadiness({
                lookaheadFrame: frameToRender,
                lookaheadOrigin: pausedPlaybackLookaheadOriginRef.current,
                lookaheadReadyMs,
              })
              if (pausedPlaybackLookaheadStartedMsRef.current !== null) {
                markPlaybackColdStart({
                  prepared_lookahead_render_ms: Math.round(
                    lookaheadReadyMs - pausedPlaybackLookaheadStartedMsRef.current,
                  ),
                })
              }
              // The offscreen canvas now holds the first frame after the
              // paused playhead. Keep the visible display canvas on the
              // paused frame until the Clock reaches this prepared frame —
              // but only while no scrub target is asking for a frame. A ruler
              // hover that lands on the very frame the lookahead prepared is
              // an explicit presentation request, and its requested-frame
              // slot was already consumed when this render was dequeued:
              // swallowing it here strands the overlay on the previous frame
              // until the next pointer move.
              if (
                playbackState.previewFrame === null &&
                playbackState.currentFrame !== frameToRender
              ) {
                continue
              }
              pausedPlaybackLookaheadFrameRef.current = null
              pausedPlaybackLookaheadOriginRef.current = null
              pausedPlaybackLookaheadStartedMsRef.current = null
            }
            if (
              shouldDropStalePausedPreviewRender({
                renderedFrame: frameToRender,
                currentFrame: playbackState.currentFrame,
                previewFrame: playbackState.previewFrame,
                isPlaying: playbackState.isPlaying,
              })
            ) {
              // A ruler hover can clear or move while a nested composition is
              // still rendering. Its pixels no longer own presentation and
              // must not retain the shared offscreen frame tag.
              scrubOffscreenRenderedFrameRef.current = null
              continue
            }
            const playbackTransitionState = getPlaybackTransitionStateForFrame(frameToRender)
            const renderedPlaybackOverlay = usesRenderedPlaybackOverlay(playbackState)
            const shouldShowPlaybackTransitionOverlay =
              playbackState.isPlaying &&
              playbackState.previewFrame === null &&
              (playbackTransitionState.hasActiveTransition ||
                playbackTransitionState.shouldHoldOverlay) &&
              !renderedPlaybackOverlay
            // DEV diagnostics: record which overlay path the pump chose per
            // priority frame. Tree-shaken from prod; no-op unless a trace runs.
            const tracePump = (
              act: 'transition-overlay' | 'fast-scrub' | 'hide' | 'fallback-hide',
            ) => {
              if (import.meta.env.DEV && isPreviewTraceEnabled()) {
                recordPumpTrace({
                  f: frameToRender,
                  act,
                  shouldShow: shouldShowPlaybackTransitionOverlay,
                  hasActive: playbackTransitionState.hasActiveTransition,
                  hold: playbackTransitionState.shouldHoldOverlay,
                  forceFast: renderedPlaybackOverlay,
                  fallback: fallbackToPlayerScrubRef.current,
                })
              }
            }
            if (fallbackToPlayerScrubRef.current) {
              tracePump('fallback-hide')
              hideAllOverlays()
              continue
            }
            // Guard against stale in-flight renders that finish after scrub has ended.
            // Without this, a completed old render can re-show the overlay and hide
            // live Player updates (e.g. ruler click + gizmo interaction).
            const isPausedOnTransitionFrame =
              frameToRender === playbackState.currentFrame &&
              isPausedTransitionOverlayActive(frameToRender, playbackState)
            const fastScrubTargetFrame = isGizmoInteractingRef.current
              ? playbackState.currentFrame
              : playbackState.previewFrame
            const shouldShowRenderedScrubOverlay = shouldShowFastScrubOverlay({
              isGizmoInteracting: isGizmoInteractingRef.current,
              isPlaying: playbackState.isPlaying,
              currentFrame: playbackState.currentFrame,
              previewFrame: playbackState.previewFrame,
              renderedFrame: frameToRender,
            })
            const targetNeedsRenderedPath =
              fastScrubTargetFrame !== null &&
              !playbackState.isPlaying &&
              (forceFastScrubOverlay ||
                shouldPreserveHighFidelityBackwardPreview(fastScrubTargetFrame))
            if (
              !shouldShowPlaybackTransitionOverlay &&
              !(forceFastScrubOverlay || renderedPlaybackOverlay) &&
              !isPausedOnTransitionFrame &&
              !shouldShowRenderedScrubOverlay
            ) {
              previewPerfRef.current.staleScrubOverlayDrops += 1
              if (
                showFastScrubOverlayRef.current &&
                !playbackState.isPlaying &&
                playbackState.previewFrame === null
              ) {
                if (frameToRender === playbackState.currentFrame) {
                  presentation.drawToDisplay(frameToRender, priorityRenderUsedFallback)
                  showFastScrubOverlayForFrame()
                }
                continue
              }
              if (
                showFastScrubOverlayRef.current &&
                !playbackState.isPlaying &&
                playbackState.previewFrame !== null
              ) {
                if (frameToRender === playbackState.previewFrame) {
                  presentation.drawToDisplay(frameToRender, priorityRenderUsedFallback)
                  showFastScrubOverlayForFrame()
                }
                continue
              }
              if (targetNeedsRenderedPath) {
                presentation.drawToDisplay(frameToRender, priorityRenderUsedFallback)
                showFastScrubOverlayForFrame()
                continue
              }
              tracePump('hide')
              hideAllOverlays()
              continue
            }

            presentation.drawToDisplay(frameToRender, priorityRenderUsedFallback)
            if (shouldShowPlaybackTransitionOverlay) {
              tracePump('transition-overlay')
              showPlaybackTransitionOverlayForFrame()
            } else {
              tracePump('fast-scrub')
              showFastScrubOverlayForFrame()
            }
            if (
              !shouldShowPlaybackTransitionOverlay &&
              !suppressScrubBackgroundPrewarmRef.current &&
              shouldUseCompositionScrubPrewarm(scrubPrewarmIdleDelayMs)
            ) {
              enqueueDirectionalPrewarm(frameToRender)
              enqueueBoundaryPrewarm(frameToRender)
              enqueueBoundarySourcePrewarm(frameToRender)
            } else if (!shouldUseCompositionScrubPrewarm(scrubPrewarmIdleDelayMs)) {
              // Overview/high-velocity drags are served by the cancellable
              // worker bitmap ring. Main-renderer prewarm can spend hundreds
              // of milliseconds inside MediaBunny and cannot be interrupted,
              // so retaining it here would block the next drag behind stale
              // speculative work.
              clearPrewarmQueue()
            }
            if (deferredPlaybackTransitionPrepareFrameRef.current !== null) {
              scheduleOpportunisticTransitionPrepare()
            }
            prewarmBudgetStart = performance.now()
            if (playbackState.previewFrame !== null && scrubPrewarmQueueRef.current.length > 0) {
              // Directional decode lookahead shares the same renderer lane as
              // the visible target. Do not enter an uninterruptible prewarm
              // await while pointer input is active; restart after an adaptive
              // input-idle window instead.
              scheduleScrubPrewarmIdleRestart()
              break
            }
          } else {
            markPrewarmed(frameToRender)
          }
        }
      } catch (error) {
        if (isStale()) {
          // A superseded nested render may reject while its media providers
          // are changing modes. Keep the last good front buffer visible; the
          // active generation will rerender instead of exposing Player mid-seek.
          logger.debug('Ignoring stale preview render failure:', error)
          scrubOffscreenRenderedFrameRef.current = null
        } else {
          logger.warn('Render failed, using Player seek fallback:', error)
          hideAllOverlays()
          disposeFastScrubRenderer()
        }
      } finally {
        const isCurrentGeneration =
          !effectDisposed && scrubRenderGenerationRef.current === generation
        // A lifecycle change invalidates this request, but never transfers
        // ownership while renderFrame is still touching the shared canvas.
        scrubRenderInFlightRef.current = false
        if (
          isCurrentGeneration &&
          scrubRequestedFrameRef.current === scrubOffscreenRenderedFrameRef.current
        ) {
          scrubRequestedFrameRef.current = null
        }
        if (isCurrentGeneration) {
          const deferredPrepareFrame = deferredPlaybackTransitionPrepareFrameRef.current
          if (deferredPrepareFrame !== null) {
            scheduleOpportunisticTransitionPrepare()
          }
        }
        const ownerDrained = onRenderOwnerDrained
        onRenderOwnerDrained = null
        ownerDrained?.()
        if (scrubRequestedFrameRef.current !== null && !playbackPrewarmInFlight) {
          // Break the promise-recursion chain. Under synchronous test doubles
          // (and occasionally a run of cache hits in browsers), an immediate
          // restart can recurse until the stack overflows.
          if (effectDisposed) {
            queueMicrotask(() => {
              void resumeScrubLoopRef.current()
            })
          } else {
            scheduleRenderPumpRestart()
          }
        }
      }
    }

    const schedulePausedPlaybackLookahead = (
      pausedAtFrame: number,
      origin: PlaybackStartLookaheadOrigin,
      deferUntilIdle = false,
    ) => {
      if (!forceFastScrubOverlay) return
      const queueLookahead = () => {
        initialLookaheadIdleIdRef.current = null
        initialLookaheadTimeoutIdRef.current = null
        const playback = usePlaybackStore.getState()
        if (
          playback.isPlaying ||
          playback.previewFrame !== null ||
          playback.currentFrame !== pausedAtFrame
        ) {
          return
        }

        const lookaheadFrame = pausedAtFrame + 1
        if (
          (pausedPlaybackLookaheadFrameRef.current === lookaheadFrame &&
            scrubRenderInFlightRef.current) ||
          scrubOffscreenRenderedFrameRef.current === lookaheadFrame
        ) {
          return
        }
        pausedPlaybackLookaheadFrameRef.current = lookaheadFrame
        pausedPlaybackLookaheadOriginRef.current = origin
        pausedPlaybackLookaheadStartedMsRef.current = performance.now()
        markPlaybackStartReadiness({
          lookaheadFrame,
          lookaheadOrigin: origin,
          lookaheadReadyMs: null,
        })
        scrubRequestedFrameRef.current = pausedPlaybackLookaheadFrameRef.current
        void pumpRenderLoop()
      }

      if (deferUntilIdle) {
        if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
          initialLookaheadIdleIdRef.current = (
            window as Window & {
              requestIdleCallback: (
                callback: IdleRequestCallback,
                options?: IdleRequestOptions,
              ) => number
            }
          ).requestIdleCallback(queueLookahead, { timeout: 600 })
        } else {
          initialLookaheadTimeoutIdRef.current = setTimeout(queueLookahead, 120)
        }
        return
      }

      queueMicrotask(queueLookahead)
    }

    resumeScrubLoopRef.current = () => {
      void pumpRenderLoop()
    }

    // rAF-driven render pump for playback — fires at display vsync (60Hz+),
    // catching frames the Zustand subscription misses due to event loop
    // contention from React renders, GC pauses, etc. This reduces the ~9%
    // frame drop rate during playback to near zero.
    let playbackRafId: number | null = null
    let lastRafRenderedFrame = -1
    // Playback start can wait on variable-speed decoder prewarm. While that
    // work is pending, subscription updates can retarget state but must not
    // start a competing async pump ahead of the rAF handoff.
    const pausePrewarmedItemIds = new Set<string>()

    let lastRafPresentedFrame = -1
    let lastReversePreseekFrame = -1
    // Reverse playback prepares a decoded window behind the transport clock.
    // The scheduler owns that window's state; the pump and the lifecycle
    // handler only decide when to ask for one, and reset on every transport
    // discontinuity.
    const reverseWindow = createReversePlaybackWindowScheduler({
      fps,
      useProxy,
      getPlaybackState: () => usePlaybackStore.getState(),
      collectSourceTimes: (frame) =>
        collectVisibleTrackVideoSourceTimesBySrc(combinedTracks, frame, fps, {
          requireExplicitSourceFps: false,
          resolveComposition: resolvePreseekComposition,
          resolveItemSrc: resolvePreseekItemSrc,
        }),
      batchPreseek: workerBackgroundBatchPreseek,
      scheduleProxyFallback: scheduleScrubProxyFallback,
    })

    // The rAF loop keeps playback aligned to display cadence, but it still
    // preserves the single-owner invariant: it only presents buffered frames
    // synchronously or queues the latest target for `pumpRenderLoop`.
    const playbackRafPump = () => {
      playbackRafId = null
      if (!scrubMountedRef.current) return
      const playbackState = usePlaybackStore.getState()
      if (!usesRenderedPlaybackOverlay(playbackState)) return
      const currentFrame = playbackState.currentFrame
      const renderOwnerActive = scrubRenderInFlightRef.current
      const playbackDirection = playbackState.playbackRate < 0 ? -1 : 1

      if (currentFrame !== lastRafRenderedFrame) {
        lastRafRenderedFrame = currentFrame
        if (playbackDirection < 0 && currentFrame !== lastReversePreseekFrame) {
          lastReversePreseekFrame = currentFrame
          reverseWindow.schedule(currentFrame)
        }
        if (!renderOwnerActive && scrubOffscreenRenderedFrameRef.current === currentFrame) {
          presentation.drawToDisplay(currentFrame)
          lastRafPresentedFrame = currentFrame
        } else {
          // Check if this frame was pre-rendered by the transition prepare.
          // If so, present it immediately (0ms) instead of going through the
          // async pumpRenderLoop (which would take 180-240ms for the first
          // transition frame due to mediabunny decode).
          const buffered = transitionSessionBufferedFramesRef.current.get(currentFrame)
          if (buffered) {
            presentation.drawSourceToDisplay(buffered, currentFrame)
            scrubOffscreenRenderedFrameRef.current = currentFrame
            lastRafPresentedFrame = currentFrame
            // Pre-start the render loop for the next uncached frame so the
            // GPU + decode pipeline is already warm when the buffer runs out.
            // Without this, the first post-cache frame stalls 100-200ms.
            const nextFrame = currentFrame + playbackDirection
            if (
              !transitionSessionBufferedFramesRef.current.has(nextFrame) &&
              !scrubRenderInFlightRef.current
            ) {
              scrubRequestedFrameRef.current = nextFrame
              void pumpRenderLoop()
            }
          } else if (!renderOwnerActive) {
            scrubRequestedFrameRef.current = currentFrame
            if (!scrubRenderInFlightRef.current) {
              void pumpRenderLoop()
            }
          }
        }
      } else if (
        !renderOwnerActive &&
        lastRafPresentedFrame !== currentFrame &&
        scrubOffscreenRenderedFrameRef.current === currentFrame
      ) {
        // Frame hasn't advanced but the async render completed since the
        // last vsync. Present it now synchronously to eliminate 3:2 pulldown
        // judder (50ms/16ms alternating intervals on 30fps@60Hz displays).
        presentation.drawToDisplay(currentFrame)
        lastRafPresentedFrame = currentFrame
      }

      playbackRafId = requestAnimationFrame(playbackRafPump)
    }

    // Playback store handlers are kept separate so the subscription reads like
    // the runtime state machine: cold-start tracking, preseek, lifecycle,
    // transition upkeep, paused prewarm, then target-frame routing. That
    // ordering matters because later handlers intentionally build on side
    // effects from earlier ones.
    const trackPlaybackColdStartLifecycle = (
      state: PlaybackStoreSnapshot,
      prev: PlaybackStoreSnapshot,
    ) => {
      if (state.isPlaying && !prev.isPlaying) {
        beginPlaybackColdStart({
          startFrame: state.currentFrame,
          forceFastScrubOverlay,
          audioContextState: getPreviewAudioContextState(),
        })
        // This subscriber runs synchronously inside the play dispatch, so we
        // are still within the user gesture's task — resume the shared
        // AudioContext now instead of waiting for the first per-element
        // effect/RVFC resume, which lands 50-100ms after first frame.
        ensureAudioContextResumed()
      } else if (!state.isPlaying && prev.isPlaying) {
        // No-op if the measurement already resolved on a frame advance.
        cancelPlaybackColdStart('paused_before_first_frame_advance')
      }
    }

    // Let jump preseek see through compound clips (resolve the referenced
    // sub-composition) and resolve current-session URLs by mediaId — stored
    // item src is empty or a stale blob URL on workspace projects, for
    // main-timeline and sub-comp items alike.
    const resolvePreseekComposition = (compositionId: string) => {
      const comp = useCompositionsStore.getState().compositions.find((c) => c.id === compositionId)
      return comp ? { fps: comp.fps, items: comp.items, tracks: comp.tracks } : null
    }
    const resolvePreseekItemSrc = (item: VideoItem) => {
      const proxyUrl = item.mediaId ? resolveProxyUrl(item.mediaId) : null
      const liveUrl = item.mediaId ? blobUrlManager.get(item.mediaId) : null
      return resolvePreviewPreseekSource({
        useProxy,
        proxySource: proxyUrl,
        liveSource: liveUrl,
        itemSource: item.src,
      })
    }

    // Direction-aware preseek: small forward jumps ride mediabunny sequential
    // advance (~1ms/frame), but large forward jumps and most backward jumps
    // need an off-thread keyframe seek (300-600ms) - see shouldRunJumpPreseek.
    const handleLargeJumpPreseek = (state: PlaybackStoreSnapshot, prev: PlaybackStoreSnapshot) => {
      // Held scrubs use the isolated active-preview lane below. Keep this
      // general-pool path for atomic paused jumps and keyboard stepping.
      if (state.previewFrame !== null) return
      const targetFrame = state.previewFrame ?? state.currentFrame
      const previousTargetFrame = prev.previewFrame ?? prev.currentFrame
      if (
        !shouldRunJumpPreseek({
          prevFrame: previousTargetFrame,
          nextFrame: targetFrame,
          fps,
          isPlaying: state.isPlaying,
        })
      ) {
        return
      }

      const bySource = collectVisibleTrackVideoSourceTimesBySrc(combinedTracks, targetFrame, fps, {
        requireExplicitSourceFps: true,
        resolveComposition: resolvePreseekComposition,
        resolveItemSrc: resolvePreseekItemSrc,
      })
      recordPreviewPreseekPlan(targetFrame, bySource)
      runBatchPreseek(bySource)
    }

    const handlePlaybackLifecycleUpdate = (
      state: PlaybackStoreSnapshot,
      prev: PlaybackStoreSnapshot,
    ) => {
      const renderedPlaybackActive = usesRenderedPlaybackOverlay(state)
      const renderedPlaybackWasActive = usesRenderedPlaybackOverlay(prev)

      if (
        state.isPlaying &&
        prev.isPlaying &&
        state.playbackRate !== prev.playbackRate &&
        (state.playbackRate < 0 || prev.playbackRate < 0)
      ) {
        reverseWindow.reset()
        lastReversePreseekFrame = -1
        if (state.playbackRate < 0) {
          reverseWindow.schedule(state.currentFrame)
        }
      }

      if (renderedPlaybackActive && !renderedPlaybackWasActive) {
        reverseWindow.reset()
        transportSettlingUntilMs = performance.now() + 300
        pausedTransportHeldFrame = null
        pausedTransportHoldUntilMs = 0
        if (playbackRafId !== null) {
          return
        }

        const frame = state.currentFrame
        const playbackDirection = state.playbackRate < 0 ? -1 : 1
        const hasPreparedLookahead =
          scrubOffscreenRenderedFrameRef.current === frame + playbackDirection
        lastRafRenderedFrame = hasPreparedLookahead ? frame : -1
        lastRafPresentedFrame = -1
        lastReversePreseekFrame = -1
        scrubDirectionRef.current = playbackDirection
        // Invalidate the prior request, but keep its mutex until renderFrame
        // has completely stopped touching the shared offscreen canvas.
        const renderOwnerActive = scrubRenderInFlightRef.current
        scrubRenderGenerationRef.current += 1
        clearPrewarmQueue()

        markPlaybackColdStart({
          paused_lookahead_hit: hasPreparedLookahead,
        })
        const prewarmItemIds = collectPlaybackStartVariableSpeedPrewarmItemIds(
          combinedTracks,
          frame,
        )
        if (playbackDirection > 0) {
          runPreseekTargets(
            collectPlaybackStartVariableSpeedPreseekTargets(
              combinedTracks,
              frame,
              fps,
              Math.round(fps * 3),
            ),
          )
        } else {
          reverseWindow.schedule(frame)
        }

        const startPlaybackPump = () => {
          if (!scrubMountedRef.current || !usesRenderedPlaybackOverlay(usePlaybackStore.getState()))
            return
          if (prewarmItemIds.length === 0) {
            if (playbackRafId === null) {
              playbackRafId = requestAnimationFrame(playbackRafPump)
            }
            return
          }

          markPlaybackColdStart({ variable_speed_items: prewarmItemIds.length })
          playbackPrewarmInFlight = true
          void (async () => {
            const prewarmGateStartMs = performance.now()
            const renderer = await ensureFastScrubRenderer()
            if (renderer && 'prewarmItems' in renderer) {
              const needsPrewarm = prewarmItemIds.filter((id) => !pausePrewarmedItemIds.has(id))
              if (needsPrewarm.length > 0) {
                await renderer.prewarmItems?.(needsPrewarm, frame)
              }
            }
            markPlaybackColdStart({
              prewarm_gate_ms: Math.round(performance.now() - prewarmGateStartMs),
            })
            pausePrewarmedItemIds.clear()
            playbackPrewarmInFlight = false
            if (
              playbackRafId === null &&
              usesRenderedPlaybackOverlay(usePlaybackStore.getState())
            ) {
              playbackRafId = requestAnimationFrame(playbackRafPump)
            }
          })()
        }

        if (renderOwnerActive) {
          onRenderOwnerDrained = startPlaybackPump
          const waitForRenderOwnerDrain = () => {
            if (
              onRenderOwnerDrained !== startPlaybackPump ||
              !usesRenderedPlaybackOverlay(usePlaybackStore.getState())
            ) {
              return
            }
            if (scrubRenderInFlightRef.current) {
              requestAnimationFrame(waitForRenderOwnerDrain)
              return
            }
            onRenderOwnerDrained = null
            startPlaybackPump()
          }
          requestAnimationFrame(waitForRenderOwnerDrain)
          return
        }
        startPlaybackPump()
        return
      }

      if (!state.isPlaying && prev.isPlaying) {
        reverseWindow.reset()
        transportSettlingUntilMs = performance.now() + 300
        if (playbackRafId !== null) {
          cancelAnimationFrame(playbackRafId)
          playbackRafId = null
        }
        lastPlayingPrearmTargetRef.current = null
        clearTransitionPlaybackSession()
        onRenderOwnerDrained = null
        // Any async playback render may finish offscreen, but it must not
        // present after pause. The new generation owns visible presentation.
        scrubRenderGenerationRef.current += 1

        // The playback clock can be ahead of the last frame the rendered
        // overlay actually presented. Pausing on the clock frame makes the
        // visible canvas jump forward while the exact paused render settles.
        // Re-anchor the authoritative playhead to the frame the user really
        // saw, then prepare the following frame offscreen for resume.
        const displayedFrame =
          renderedPlaybackWasActive && showFastScrubOverlayRef.current
            ? usePreviewBridgeStore.getState().displayedFrame
            : null
        const pausedFrame =
          displayedFrame !== null && Number.isFinite(displayedFrame)
            ? Math.max(0, Math.round(displayedFrame))
            : state.currentFrame

        pausedTransportHeldFrame = pausedFrame
        pausedTransportHoldUntilMs = performance.now() + 750
        presentation.captureCommittedSnapshot(pausedFrame)

        schedulePausedPlaybackLookahead(pausedFrame, 'post_pause')
        activeScrubPreseek.primeDecoderAtFrame(pausedFrame)

        if (pausedFrame !== state.currentFrame) {
          const latestPlayback = usePlaybackStore.getState()
          if (!latestPlayback.isPlaying && latestPlayback.currentFrame === state.currentFrame) {
            latestPlayback.setCurrentFrame(pausedFrame)
            return true
          }
        }
      }

      if (state.isPlaying && !renderedPlaybackActive && renderedPlaybackWasActive) {
        reverseWindow.reset()
        if (playbackRafId !== null) {
          cancelAnimationFrame(playbackRafId)
          playbackRafId = null
        }
        onRenderOwnerDrained = null
        scrubRenderGenerationRef.current += 1
        scrubRequestedFrameRef.current = null
        clearPrewarmQueue()
        hideFastScrubOverlay()
        setDisplayedFrame(null)
        lastReversePreseekFrame = -1
      }

      return false
    }

    const handleActivePlaybackTransitionMaintenance = (state: PlaybackStoreSnapshot) => {
      if (!state.isPlaying) {
        return
      }

      const activeTransitionWindow = getTransitionWindowForFrame(state.currentFrame)
      if (activeTransitionWindow && !transitionSessionWindowRef.current) {
        pinTransitionPlaybackSession(activeTransitionWindow)
        lastPlayingPrearmTargetRef.current = activeTransitionWindow.startFrame
        const renderer = scrubRendererRef.current
        if (renderer && 'prewarmItems' in renderer) {
          void renderer.prewarmItems?.(
            [activeTransitionWindow.leftClip.id, activeTransitionWindow.rightClip.id],
            state.currentFrame,
          )
        }
        runBatchPreseek(
          collectClipVideoSourceTimesBySrcForFrame(
            [activeTransitionWindow.leftClip, activeTransitionWindow.rightClip],
            state.currentFrame,
            fps,
            { requireExplicitSourceFps: true },
          ),
        )
      }

      const sessionWindow = transitionSessionWindowRef.current
      if (sessionWindow && transitionSessionPinnedElementsRef.current.size > 0) {
        for (const clip of [sessionWindow.leftClip, sessionWindow.rightClip]) {
          if (clip.type !== 'video') continue
          const el =
            transitionSessionPinnedElementsRef.current.get(clip.id) ??
            getPinnedTransitionElementForItem(clip.id)
          if (!el || el.dataset.transitionHold !== '1') continue
          const clipSpeed = clip.speed ?? 1
          const transitionState = resolveTransitionDomPlaybackState({
            window: sessionWindow,
            clip,
            frame: state.currentFrame,
            timelineFps: fps,
            transportRate: state.playbackRate,
          })
          const mediaPlaybackRate =
            transitionState?.playbackRate ??
            getBrowserMediaPlaybackRate(clipSpeed, state.playbackRate)
          const targetTime =
            transitionState?.sourceTime ??
            getVideoItemSourceTimeSeconds(clip, state.currentFrame, fps)
          if (targetTime === null) continue
          if (transitionState) {
            delete el.dataset.transitionPrearm
          }
          if (transitionState?.hasActiveSourceRamp) {
            el.dataset.transitionSourceRamp = '1'
          } else {
            delete el.dataset.transitionSourceRamp
          }
          if (state.playbackRate < 0) {
            el.pause()
            el.playbackRate = 1
            try {
              el.currentTime = targetTime
            } catch {
              /* settling */
            }
            continue
          }

          const stallEntry = transitionSessionStallCountRef.current.get(clip.id)
          if (stallEntry && Math.abs(el.currentTime - stallEntry.ct) < 0.001) {
            const newCount = stallEntry.count + 1
            transitionSessionStallCountRef.current.set(clip.id, {
              ct: stallEntry.ct,
              count: newCount,
            })
            if (newCount >= 3) {
              try {
                el.currentTime = targetTime
              } catch {
                /* settling */
              }
              el.playbackRate = mediaPlaybackRate
              el.play().catch(() => {
                /* best effort */
              })
              transitionSessionStallCountRef.current.set(clip.id, { ct: targetTime, count: 0 })
              continue
            }
          } else {
            transitionSessionStallCountRef.current.set(clip.id, { ct: el.currentTime, count: 0 })
          }

          const drift = el.currentTime - targetTime
          if (Math.abs(drift) > 0.2) {
            try {
              el.currentTime = targetTime
            } catch {
              /* settling */
            }
            el.playbackRate = mediaPlaybackRate
          } else if (Math.abs(drift) > 0.016) {
            const correction = -drift * 0.25
            const maxAdj = Math.max(0.03, mediaPlaybackRate * 0.06)
            el.playbackRate = Math.max(
              mediaPlaybackRate - maxAdj,
              Math.min(mediaPlaybackRate + maxAdj, mediaPlaybackRate + correction),
            )
          }
          if (el.paused && el.readyState >= 2) {
            el.playbackRate = mediaPlaybackRate
            el.play().catch(() => {
              /* best effort */
            })
          }
        }
      } else if (transitionSessionStallCountRef.current.size > 0) {
        transitionSessionStallCountRef.current.clear()
      }

      const prearmStartFrame =
        !activeTransitionWindow && !transitionSessionWindowRef.current
          ? getPlayingAnyTransitionPrewarmStartFrame(state.currentFrame)
          : null
      if (prearmStartFrame !== null) {
        const transitionWindow = getTransitionWindowByStartFrame(prearmStartFrame)
        if (transitionWindow) {
          pinTransitionPlaybackSession(transitionWindow)
        }
        if (lastPlayingPrearmTargetRef.current !== prearmStartFrame) {
          lastPlayingPrearmTargetRef.current = prearmStartFrame
          if (transitionWindow) {
            const aaRamps = resolveAATransitionRamps(
              transitionWindow.leftClip,
              transitionWindow.rightClip,
              {
                transitionStart: transitionWindow.startFrame,
                transitionEnd: transitionWindow.endFrame,
              },
              fps,
            )
            transitionPrewarmPromiseRef.current = (async () => {
              const renderer = await ensureFastScrubRenderer()
              if (!aaRamps && renderer && 'prewarmItems' in renderer) {
                await renderer.prewarmItems?.(
                  [transitionWindow.leftClip.id, transitionWindow.rightClip.id],
                  transitionWindow.startFrame,
                )
              }
            })()
            if (!aaRamps) {
              runBatchPreseek(
                collectClipVideoSourceTimesBySrcForFrameRange(
                  [transitionWindow.leftClip, transitionWindow.rightClip],
                  transitionWindow.startFrame,
                  Math.min(8, transitionWindow.endFrame - transitionWindow.startFrame),
                  fps,
                  { requireExplicitSourceFps: true },
                ),
              )
            }
          }
          pushTransitionTrace('playing_prearm', {
            targetFrame: prearmStartFrame,
          })
        }
        return
      }

      lastPlayingPrearmTargetRef.current = null
      const prevActiveWindow = transitionSessionWindowRef.current
      if (
        !activeTransitionWindow &&
        prevActiveWindow &&
        state.currentFrame >= prevActiveWindow.endFrame
      ) {
        clearTransitionPlaybackSession()
      }
    }

    const handlePausedVariableSpeedPrewarm = (
      state: PlaybackStoreSnapshot,
      prev: PlaybackStoreSnapshot,
    ) => {
      if (
        state.isPlaying ||
        state.previewFrame !== null ||
        prev.currentFrame === state.currentFrame
      ) {
        return
      }

      const pausedPrewarmPlan = resolvePausedVariableSpeedPrewarmPlan(
        combinedTracks,
        state.currentFrame,
        Math.round(fps * 3),
      )
      if (!pausedPrewarmPlan) {
        return
      }

      for (const id of pausedPrewarmPlan.itemIds) {
        pausePrewarmedItemIds.add(id)
      }

      const renderer = scrubRendererRef.current
      if (renderer && 'prewarmItems' in renderer) {
        void renderer.prewarmItems?.(pausedPrewarmPlan.itemIds, pausedPrewarmPlan.preseekFrame)
      }
    }

    const handlePausedTransitionPrewarm = (
      state: PlaybackStoreSnapshot,
      prev: PlaybackStoreSnapshot,
    ) => {
      if (state.isPlaying || state.previewFrame !== null) {
        return
      }

      const pausedActiveWindow = getTransitionWindowForFrame(state.currentFrame)
      const pausedPrewarmStartFrame =
        pausedActiveWindow?.startFrame ?? getPausedTransitionPrewarmStartFrame(state.currentFrame)
      if (pausedPrewarmStartFrame !== null) {
        if (forceFastScrubOverlay) {
          const tw = pausedActiveWindow ?? getTransitionWindowByStartFrame(pausedPrewarmStartFrame)
          if (tw) {
            pinTransitionPlaybackSession(tw)
            if (lastPausedPrearmTargetRef.current !== pausedPrewarmStartFrame) {
              void (async () => {
                if (bgTransitionRenderInFlightRef.current) return
                bgTransitionRenderInFlightRef.current = true
                try {
                  const bgRenderer = await ensureBgTransitionRenderer()
                  if (bgRenderer && 'prewarmItems' in bgRenderer) {
                    await bgRenderer.prewarmItems?.(
                      [tw.leftClip.id, tw.rightClip.id],
                      tw.startFrame,
                    )
                  }
                  runBatchPreseek(
                    collectClipVideoSourceTimesBySrcForFrame(
                      [tw.leftClip, tw.rightClip],
                      tw.startFrame,
                      fps,
                      { requireExplicitSourceFps: true },
                    ),
                  )
                  if (!usePlaybackStore.getState().isPlaying && bgRenderer) {
                    const preRenderCount = Math.min(
                      playbackTransitionPrerenderRunwayFrames,
                      tw.endFrame - tw.startFrame,
                    )
                    for (let fi = 0; fi < preRenderCount; fi++) {
                      if (usePlaybackStore.getState().isPlaying) break
                      const frame = tw.startFrame + fi
                      try {
                        await bgRenderer.renderFrame(frame)
                        if ('getCanvas' in bgRenderer) {
                          const srcCanvas = (
                            bgRenderer as { getCanvas: () => OffscreenCanvas }
                          ).getCanvas()
                          const snapshot = new OffscreenCanvas(srcCanvas.width, srcCanvas.height)
                          const snapshotCtx = snapshot.getContext('2d')
                          if (snapshotCtx) {
                            snapshotCtx.drawImage(srcCanvas, 0, 0)
                            transitionSessionBufferedFramesRef.current.set(frame, snapshot)
                          }
                        }
                      } catch {
                        break
                      }
                    }
                  }
                } finally {
                  bgTransitionRenderInFlightRef.current = false
                }
              })()
            }
          }
        } else if (pausedActiveWindow) {
          const tw = pausedActiveWindow
          pinTransitionPlaybackSession(tw)
          scrubRequestedFrameRef.current = state.currentFrame
          void pumpRenderLoop()
        } else {
          schedulePlaybackTransitionPrepare(pausedPrewarmStartFrame)
        }

        if (lastPausedPrearmTargetRef.current !== pausedPrewarmStartFrame) {
          lastPausedPrearmTargetRef.current = pausedPrewarmStartFrame
          pushTransitionTrace('paused_prearm', {
            targetFrame: pausedPrewarmStartFrame,
          })
        }
        return
      }

      if (prev.currentFrame !== state.currentFrame || prev.isPlaying !== state.isPlaying) {
        lastPausedPrearmTargetRef.current = null
        schedulePlaybackTransitionPrepare(null)
        // Don't clear the session when stepping out of a paused transition
        // frame — handleScrubTargetUpdate needs the session to render the
        // post-transition frame on the overlay before handing off to the
        // Player. The session will be cleared there after the handoff.
        const wasOnTransition =
          !prev.isPlaying && getTransitionWindowForFrame(prev.currentFrame) !== null
        if (!wasOnTransition) {
          clearTransitionPlaybackSession()
        }
      }
    }

    const handleScrubTargetUpdate = (state: PlaybackStoreSnapshot, prev: PlaybackStoreSnapshot) => {
      const renderedPlaybackActive = usesRenderedPlaybackOverlay(state)
      const renderedPlaybackWasActive = usesRenderedPlaybackOverlay(prev)
      if (state.previewFrame !== null && prev.previewFrame === null) {
        presentation.clearReleasedScrubGuard()
        // Snapshot at gesture entry, not only when the committed render first
        // completed. The preview controller can be rebuilt between those two
        // moments (resize/workspace/layout changes), while the visible canvas
        // remains the authoritative frame the hover must return to.
        presentation.captureCommittedSnapshot(prev.currentFrame)
      }
      if (state.isPlaying || state.currentFrame !== prev.currentFrame) {
        presentation.clearReleasedScrubGuard()
      }
      if (
        state.isPlaying ||
        state.previewFrame !== null ||
        (pausedTransportHeldFrame !== null && state.currentFrame !== pausedTransportHeldFrame)
      ) {
        pausedTransportHeldFrame = null
        pausedTransportHoldUntilMs = 0
      }
      const settlingReleasedScrubFrame =
        state.previewFrame === null && prev.previewFrame !== null ? state.currentFrame : null
      const shouldRestoreCommittedSnapshot =
        committedPreviewSnapshot.canvas &&
        shouldRestoreCommittedPreviewSnapshot({
          previewFrame: state.previewFrame,
          previousPreviewFrame: prev.previewFrame,
          currentFrame: state.currentFrame,
          snapshotFrame: committedPreviewSnapshot.frame,
        })
      if (shouldRestoreCommittedSnapshot && committedPreviewSnapshot.canvas) {
        // Hover skimming may end on a nested frame whose sources were still
        // settling. Restore the last committed pixels synchronously instead
        // of leaving that transient frame visible while currentFrame rerenders.
        presentation.drawSourceToDisplay(committedPreviewSnapshot.canvas, state.currentFrame)
        // Keep guarding until a nonblank exact render proves it can replace
        // this snapshot. Cancelled compound work can complete much later than
        // the pointer release and otherwise cache/present its cleared canvas.
        committedPreviewSnapshot.guardFrame = state.currentFrame
        committedPreviewSnapshot.guardUntilMs = resolveReleasedScrubSnapshotGuardUntilMs({
          nowMs: performance.now(),
        })
      } else if (settlingReleasedScrubFrame !== null) {
        presentation.clearReleasedScrubGuard()
      }
      const activePreviewPresentationTarget = resolveActivePreviewPresentationTarget({
        state,
        prev,
        settlingReleasedScrubFrame,
        forceFastScrubOverlay:
          forceFastScrubOverlay || renderedPlaybackActive || renderedPlaybackWasActive,
      })
      setActivePreviewRenderTarget(activePreviewPresentationTarget)
      if (!renderedPlaybackActive && shouldPreferPlayerForPreview(state.previewFrame)) {
        resetScrubLoopState()
        hideAllOverlays()
        return
      }

      if (state.isPlaying && !renderedPlaybackActive) {
        resetScrubLoopState()
        const playbackTransitionState = getPlaybackTransitionStateForFrame(state.currentFrame)
        if (playbackTransitionState.shouldPrewarm) {
          void ensureFastScrubRenderer()
          if (
            !playbackTransitionState.hasActiveTransition &&
            playbackTransitionState.nextTransitionStartFrame !== null
          ) {
            schedulePlaybackTransitionPrepare(playbackTransitionState.nextTransitionStartFrame)
          }
        }
        if (
          !(
            playbackTransitionState.hasActiveTransition || playbackTransitionState.shouldHoldOverlay
          )
        ) {
          const hasPinnedPrearm =
            getPlayingAnyTransitionPrewarmStartFrame(state.currentFrame) !== null
          if (!playbackTransitionState.shouldPrewarm && !hasPinnedPrearm) {
            clearTransitionPlaybackSession()
          }
          hideAllOverlays()
          return
        }
        if (showFastScrubOverlayRef.current) {
          hideFastScrubOverlay()
        }
        if (tryShowPreparedPlaybackTransitionOverlay(state.currentFrame)) {
          return
        }
        if (playbackTransitionState.hasActiveTransition) {
          const trace = transitionSessionTraceRef.current
          if (trace && trace.lastEntryMissFrame !== state.currentFrame) {
            trace.entryMisses += 1
            trace.lastEntryMissFrame = state.currentFrame
            pushTransitionTrace('entry_miss', {
              opId: trace.opId,
              frame: state.currentFrame,
              bufferedFrames: transitionSessionBufferedFramesRef.current.size,
            })
          }
        }
        scrubRequestedFrameRef.current = state.currentFrame
        void pumpRenderLoop()
        return
      }

      const isPausedInsideTransition = isPausedTransitionOverlayActive(state.currentFrame, state)
      const prevIsPausedInsideTransition = isPausedTransitionOverlayActive(prev.currentFrame, prev)
      // Overlay cleanup may run in a sibling subscriber before this handler.
      // The store transition is the stable signal that release needs an exact
      // committed-frame render instead of the ordinary Player handoff.
      const releasedScrubRenderFrame =
        settlingReleasedScrubFrame !== null && prev.previewFrame !== settlingReleasedScrubFrame
          ? settlingReleasedScrubFrame
          : null
      const targetFrame = resolveRenderPumpTargetFrame({
        state,
        forceFastScrubOverlay: forceFastScrubOverlay || renderedPlaybackActive,
        isPausedInsideTransition,
        settlingReleasedScrubFrame: releasedScrubRenderFrame,
      })
      const prevTargetFrame = resolveRenderPumpTargetFrame({
        state: prev,
        forceFastScrubOverlay: forceFastScrubOverlay || renderedPlaybackWasActive,
        isPausedInsideTransition: prevIsPausedInsideTransition,
        settlingReleasedScrubFrame: null,
      })
      const playStateChanged =
        state.isPlaying !== prev.isPlaying || renderedPlaybackActive !== renderedPlaybackWasActive
      const isAtomicScrubTarget = isAtomicPreviewTarget(state)

      // Pointer release keeps the same numerical target, but it is still a
      // first-class committed request. Let it refresh the latest-target
      // decoder lane and performance timestamp instead of returning as if
      // no interaction state changed.
      if (
        targetFrame === prevTargetFrame &&
        !playStateChanged &&
        settlingReleasedScrubFrame === null
      ) {
        return
      }
      if (
        shouldReusePreparedLookaheadOnPlay({
          state,
          prev,
          forceFastScrubOverlay: renderedPlaybackActive,
          isSplitComparison: useGizmoStore.getState().colorGradeComparisonMode === 'split',
          renderedFrame: scrubOffscreenRenderedFrameRef.current,
        })
      ) {
        // Playback lifecycle already handed control to the rAF pump. Keep the
        // prepared advancing frame intact instead of re-rendering the paused
        // start frame and overwriting it during the first display interval.
        scrubRequestedFrameRef.current = null
        // The already-rendered lookahead is immediately drawable, so this
        // play transition does not need the exact-source presentation gate.
        setActivePreviewRenderTarget(null)
        markPlaybackColdStart({ play_start_reused_prepared_lookahead: true })
        return
      }

      const scrubDirectionPlan = resolveScrubDirectionPlan({
        state,
        prev,
        targetFrame,
        prevTargetFrame: releasedScrubRenderFrame === null ? prevTargetFrame : null,
      })
      scrubDirectionRef.current = scrubDirectionPlan.direction
      previewPerfRef.current.scrubUpdates += scrubDirectionPlan.scrubUpdates
      previewPerfRef.current.scrubDroppedFrames += scrubDirectionPlan.scrubDroppedFrames
      if (activePreviewPresentationTarget !== null) {
        const nowMs = performance.now()
        scrubPrewarmIdleDelayMs = resolveScrubPrewarmIdleDelayMs({
          frameDelta:
            prevTargetFrame === null
              ? 0
              : Math.abs(activePreviewPresentationTarget - prevTargetFrame),
          elapsedMs:
            lastScrubTargetAtMs === 0 ? Number.POSITIVE_INFINITY : nowMs - lastScrubTargetAtMs,
          fps,
        })
        lastScrubTargetAtMs = nowMs
        cancelScrubPrewarmIdleRestart()
        if (state.previewFrame !== null || settlingReleasedScrubFrame !== null) {
          recordPreviewScrubRequest(
            useEditorStore.getState().workspace,
            activePreviewPresentationTarget,
            scrubDirectionRef.current,
          )
        }
        activeScrubPreseek.schedule(
          activePreviewPresentationTarget,
          scrubDirectionRef.current,
          nowMs,
          state.previewFrame !== null || settlingReleasedScrubFrame !== null,
        )
      }

      if (
        playStateChanged &&
        useGizmoStore.getState().colorGradeComparisonMode === 'split' &&
        scrubRendererRef.current
      ) {
        if (targetFrame !== null) {
          scrubRendererRef.current.invalidateFrameCache({ frames: [targetFrame] })
        } else {
          scrubRendererRef.current.invalidateFrameCache()
        }
        setDisplayedFrame(null)
      }

      if (
        targetFrame !== null &&
        scrubRendererRef.current &&
        'getScrubbingCache' in scrubRendererRef.current
      ) {
        scrubRendererRef.current
          .getScrubbingCache()
          ?.setEvictionHint(targetFrame, scrubDirectionRef.current)
      }

      const preserveHighFidelityBackwardPreview =
        shouldPreserveHighFidelityBackwardPreview(targetFrame)
      const backwardScrubFlags = resolveBackwardScrubFlags({
        scrubDirection: scrubDirectionRef.current,
        forceFastScrubOverlay: renderedPlaybackActive || forceFastScrubOverlay,
        isAtomicScrubTarget,
        preserveHighFidelityBackwardPreview,
      })
      if (
        backwardScrubFlags.suppressBackgroundPrewarm !== suppressScrubBackgroundPrewarmRef.current
      ) {
        suppressScrubBackgroundPrewarmRef.current = backwardScrubFlags.suppressBackgroundPrewarm
        clearPrewarmQueue()
      }
      if (backwardScrubFlags.fallbackToPlayer !== fallbackToPlayerScrubRef.current) {
        fallbackToPlayerScrubRef.current = backwardScrubFlags.fallbackToPlayer
        scrubRequestedFrameRef.current = null
        clearPrewarmQueue()
        if (backwardScrubFlags.fallbackToPlayer) {
          hideAllOverlays()
        }
      }
      if (fallbackToPlayerScrubRef.current && targetFrame !== null) {
        hideAllOverlays()
        return
      }

      if (targetFrame === null) {
        resetScrubLoopState()
        bypassPreviewSeekRef.current = false

        // When leaving a transition frame (e.g. 12714â†’12715), the
        // StableVideoSequence pool lane needs time to re-seek from the
        // stabilized left clip position to the right clip. Render this
        // frame on the fast-scrub overlay so the Player isn't revealed
        // until it has caught up.
        if (prevIsPausedInsideTransition && !isPausedInsideTransition) {
          scrubRequestedFrameRef.current = state.currentFrame
          void pumpRenderLoop()
          playerRef.current?.seekTo(state.currentFrame)
          return
        }

        try {
          const playerFrame = playerRef.current?.getCurrentFrame()
          const roundedFrame = Number.isFinite(playerFrame)
            ? Math.round(playerFrame as number)
            : null
          const requiresRenderedPath =
            forceFastScrubOverlay || shouldPreserveHighFidelityBackwardPreview(state.currentFrame)
          if (showFastScrubOverlayRef.current) {
            if (settlingReleasedScrubFrame !== null && requiresRenderedPath) {
              scrubRequestedFrameRef.current = state.currentFrame
              void pumpRenderLoop()
            }
            if (roundedFrame !== state.currentFrame) {
              trackPlayerSeek(state.currentFrame)
              playerRef.current?.seekTo(state.currentFrame)
            }
            return
          }
          if (requiresRenderedPath) {
            scrubRequestedFrameRef.current = state.currentFrame
            void pumpRenderLoop()
            if (roundedFrame !== state.currentFrame) {
              trackPlayerSeek(state.currentFrame)
              playerRef.current?.seekTo(state.currentFrame)
            }
            return
          }
          if (roundedFrame === state.currentFrame) {
            playerRef.current?.seekTo(state.currentFrame)
            hideAllOverlays()
            return
          }
          if (roundedFrame !== state.currentFrame) {
            trackPlayerSeek(state.currentFrame)
          }
          playerRef.current?.seekTo(state.currentFrame)
          hideAllOverlays()
        } catch {
          hideAllOverlays()
        }
        return
      }

      const preparedPlaybackFrame = {
        state,
        forceFastScrubOverlay: renderedPlaybackActive,
        targetFrame,
        renderedFrame: scrubOffscreenRenderedFrameRef.current,
      }
      if (shouldPresentPreparedPlaybackFrame(preparedPlaybackFrame)) {
        presentation.drawToDisplay(preparedPlaybackFrame.targetFrame)
        return
      }

      const displayedFrame = usePreviewBridgeStore.getState().displayedFrame
      if (showFastScrubOverlayRef.current && displayedFrame === targetFrame) {
        scrubRequestedFrameRef.current = targetFrame
        bypassPreviewSeekRef.current = true
        return
      }

      if (scrubRequestedFrameRef.current === targetFrame) {
        return
      }

      const backwardScrubFramePlan = renderedPlaybackActive
        ? {
            requestedFrame: targetFrame,
            throttleRequest: false,
            nextLastBackwardScrubRenderAt: 0,
            nextLastBackwardRequestedFrame: null,
          }
        : resolveBackwardScrubFramePlan({
            targetFrame,
            scrubDirection: scrubDirectionRef.current,
            isAtomicScrubTarget,
            preserveHighFidelityBackwardPreview,
            nowMs: performance.now(),
            lastBackwardScrubRenderAt: lastBackwardScrubRenderAtRef.current,
            lastBackwardRequestedFrame: lastBackwardRequestedFrameRef.current,
          })
      if (backwardScrubFramePlan.throttleRequest) {
        return
      }
      lastBackwardScrubRenderAtRef.current = backwardScrubFramePlan.nextLastBackwardScrubRenderAt
      lastBackwardRequestedFrameRef.current = backwardScrubFramePlan.nextLastBackwardRequestedFrame

      // Render-pump invariant: scrub updates never force-unlock. They only
      // replace the requested frame and let the current owner pick it up on
      // the next loop iteration, which prevents concurrent pumps.
      clearPrewarmQueue()
      scrubRequestedFrameRef.current = backwardScrubFramePlan.requestedFrame
      if (playbackRafId === null && !playbackPrewarmInFlight) {
        void pumpRenderLoop()
      }
    }

    const unsubscribe = usePlaybackStore.subscribe((state, prev) => {
      trackPlaybackColdStartLifecycle(state, prev)
      handleLargeJumpPreseek(state, prev)
      if (handlePlaybackLifecycleUpdate(state, prev)) return
      handleActivePlaybackTransitionMaintenance(state)
      handlePausedVariableSpeedPrewarm(state, prev)
      handlePausedTransitionPrewarm(state, prev)
      handleScrubTargetUpdate(state, prev)
    })
    const unsubscribeActivePreviewReady = subscribeActivePreviewReady(() => {
      const playbackState = usePlaybackStore.getState()
      const targetFrame = playbackState.previewFrame ?? playbackState.currentFrame
      if (!scrubMountedRef.current || playbackState.isPlaying) return
      scrubRequestedFrameRef.current = targetFrame
      if (!scrubRenderInFlightRef.current) {
        void pumpRenderLoop()
      }
    })
    // During gizmo drags or live preview changes, trigger re-renders even when
    // the frame is unchanged so the fast-scrub overlay does not reuse a stale
    // cached bitmap for the current frame.
    let domGizmoPresentationActive = false
    const unsubscribeGizmo = useGizmoStore.subscribe((state, prev) => {
      const playbackState = usePlaybackStore.getState()
      const previewFrame = playbackState.previewFrame
      const pausedTransitionPresentation = isPausedTransitionOverlayActive(
        playbackState.currentFrame,
        playbackState,
      )
      const requiresRenderedPresentation = forceFastScrubOverlay || pausedTransitionPresentation
      const prefersDomGizmo =
        !pausedTransitionPresentation &&
        shouldPreferDomPlayerForGizmo(
          requiresRenderedPresentation,
          state.activeGizmo?.itemType ?? null,
        )
      if (prefersDomGizmo) {
        // Vector transforms already update in the DOM Player. Drop any scrub
        // canvas that remained visible after a prior seek before it can
        // occlude the live shape/text preview during this drag.
        scrubRequestedFrameRef.current = null
        if (!domGizmoPresentationActive) {
          domGizmoPresentationActive = true
          // A render may already be past the Player-preference check when the
          // drag begins. Invalidate that generation so its eventual completion
          // cannot put the stale scrub canvas back on top of the live Player.
          // Keep the in-flight mutex owned until that render drains.
          scrubRenderGenerationRef.current += 1
          clearPrewarmQueue()
          hideAllOverlays()
        }
        return
      }

      // Store subscribers run before React updates preferPlayerForDomGizmoRef.
      // Reset from synchronous interaction state so release N cannot leave the
      // transition latched and make drag N+1 skip its overlay handoff.
      domGizmoPresentationActive = false
      if (shouldPreferPlayerForPreview(previewFrame)) {
        scrubRequestedFrameRef.current = null
        hideAllOverlays()
        return
      }
      // Without forceFastScrubOverlay, gizmo previews (transform, crop, etc.)
      // are handled by the DOM Player through React props. Activating the
      // overlay here would switch from browser video seek (±1 frame) to
      // mediabunny (exact), causing a visible frame shift — especially at
      // soft-edge crop boundaries where the content difference is amplified.
      //
      // Exception: if the rendered fast-scrub overlay is already the visible
      // layer (e.g. after a scrub/seek settled on the current frame), it sits
      // on top of the DOM Player and would freeze at the pre-drag frame while
      // the Player updates invisibly underneath — the dragged item appears
      // stuck until the next scrub. Refreshing the already-visible overlay is
      // safe: it is showing a rendered frame, so no browser-seek -> mediabunny
      // frame shift is introduced.
      if (!requiresRenderedPresentation && !showFastScrubOverlayRef.current) return
      const invalidation = getGizmoPreviewInvalidation(state, prev)
      if (!invalidation) return

      const currentFrame = playbackState.currentFrame
      presentation.clearReleasedScrubGuard()
      const gradeBypassChanged =
        state.colorGradeBypassed !== prev.colorGradeBypassed ||
        state.colorGradeComparisonMode !== prev.colorGradeComparisonMode

      // Preview-only changes don't advance the frame number, so the frame
      // cache would otherwise return the stale bitmap for the current frame.
      // Invalidate before requesting a repaint so gizmo resize/translate and
      // live panel previews re-composite immediately. Grade bypass affects
      // every frame, so it evicts the whole cache.
      if (invalidation === 'all' && scrubRendererRef.current) {
        scrubRendererRef.current.invalidateFrameCache()
        scrubOffscreenRenderedFrameRef.current = null
      } else if (scrubRendererRef.current) {
        scrubRendererRef.current.invalidateFrameCache({ frames: [currentFrame] })
        if (scrubOffscreenRenderedFrameRef.current === currentFrame) {
          scrubOffscreenRenderedFrameRef.current = null
        }
      }
      if (gradeBypassChanged) {
        setDisplayedFrame(null)
      }

      scrubRequestedFrameRef.current = currentFrame
      void pumpRenderLoop()
    })

    // During corner pin drag, re-render with the live preview values so the
    // scrub overlay reflects the warp in real-time instead of waiting for commit.
    const unsubscribeCornerPin = useCornerPinStore.subscribe((state, prev) => {
      if (state.previewCornerPin === prev.previewCornerPin) return
      const playbackState = usePlaybackStore.getState()
      if (
        !forceFastScrubOverlay &&
        !isPausedTransitionOverlayActive(playbackState.currentFrame, playbackState)
      )
        return

      const currentFrame = playbackState.currentFrame
      presentation.clearReleasedScrubGuard()
      if (scrubRendererRef.current) {
        scrubRendererRef.current.invalidateFrameCache({ frames: [currentFrame] })
      }
      scrubRequestedFrameRef.current = currentFrame
      void pumpRenderLoop()
    })

    const unsubscribeMaskEditor = useMaskEditorStore.subscribe((state, prev) => {
      const previewVerticesChanged = state.previewVertices !== prev.previewVertices
      const editingItemChanged = state.editingItemId !== prev.editingItemId
      if (!previewVerticesChanged && !editingItemChanged) return

      const playbackState = usePlaybackStore.getState()
      if (shouldPreferPlayerForPreview(playbackState.previewFrame)) return
      const targetFrame = playbackState.previewFrame ?? playbackState.currentFrame
      if (
        !forceFastScrubOverlay &&
        playbackState.previewFrame === null &&
        !isPausedTransitionOverlayActive(targetFrame, playbackState)
      )
        return

      presentation.clearReleasedScrubGuard()
      if (scrubRendererRef.current) {
        scrubRendererRef.current.invalidateFrameCache({ frames: [targetFrame] })
      }
      scrubRequestedFrameRef.current = targetFrame
      void pumpRenderLoop()
    })

    const initialPlaybackState = usePlaybackStore.getState()
    const initialRenderedPlayback = usesRenderedPlaybackOverlay(initialPlaybackState)
    if (initialRenderedPlayback) {
      // Check if playback starts inside an active transition — pin that
      // session immediately so the render pump has the DOM video provider.
      const activeWindow = getTransitionWindowForFrame(initialPlaybackState.currentFrame)
      if (activeWindow) {
        pinTransitionPlaybackSession(activeWindow)
        lastPlayingPrearmTargetRef.current = activeWindow.startFrame
      } else {
        const prearmStartFrame = getPlayingAnyTransitionPrewarmStartFrame(
          initialPlaybackState.currentFrame,
        )
        if (prearmStartFrame !== null) {
          lastPlayingPrearmTargetRef.current = prearmStartFrame
          const transitionWindow = getTransitionWindowByStartFrame(prearmStartFrame)
          if (transitionWindow) {
            pinTransitionPlaybackSession(transitionWindow)
          }
        }
      }
    }
    if (!initialPlaybackState.isPlaying && initialPlaybackState.previewFrame === null) {
      const initialPausedActiveWindow = getTransitionWindowForFrame(
        initialPlaybackState.currentFrame,
      )
      const pausedPrewarmStartFrame =
        initialPausedActiveWindow?.startFrame ??
        getPausedTransitionPrewarmStartFrame(initialPlaybackState.currentFrame)
      if (pausedPrewarmStartFrame !== null) {
        lastPausedPrearmTargetRef.current = pausedPrewarmStartFrame
        if (forceFastScrubOverlay) {
          // Pre-render the transition start frame using a DEDICATED background
          // renderer (separate canvas + decoders). This doesn't hold
          // scrubRenderInFlightRef and doesn't conflict with the rAF pump.
          // The rAF pump checks transitionSessionBufferedFramesRef and presents
          // the pre-rendered frame instantly (0ms vs 180-240ms first-frame stall).
          const tw = getTransitionWindowByStartFrame(pausedPrewarmStartFrame)
          if (tw) {
            pinTransitionPlaybackSession(tw)
            void (async () => {
              // Warm main renderer's decoders
              const mainRenderer = await ensureFastScrubRenderer()
              if (mainRenderer && 'prewarmItems' in mainRenderer) {
                await mainRenderer.prewarmItems?.([tw.leftClip.id, tw.rightClip.id], tw.startFrame)
              }
              // Pre-render via background renderer (separate instance)
              if (bgTransitionRenderInFlightRef.current) return
              bgTransitionRenderInFlightRef.current = true
              try {
                const bgRenderer = await ensureBgTransitionRenderer()
                if (bgRenderer && !usePlaybackStore.getState().isPlaying) {
                  await bgRenderer.renderFrame(tw.startFrame)
                  cacheTransitionSessionFrame(tw.startFrame)
                  pushTransitionTrace('bg_prerender', { frame: tw.startFrame })
                }
              } catch (error) {
                logger.debug('Background transition pre-render failed:', error)
              } finally {
                bgTransitionRenderInFlightRef.current = false
              }
            })()
          }
        } else if (initialPausedActiveWindow) {
          // Paused INSIDE a transition on initial mount — pin session and
          // render so the GPU transition is visible without forceFastScrubOverlay.
          pinTransitionPlaybackSession(initialPausedActiveWindow)
        } else {
          schedulePlaybackTransitionPrepare(pausedPrewarmStartFrame)
        }
        pushTransitionTrace('paused_prearm', {
          targetFrame: pausedPrewarmStartFrame,
        })
      }
    }

    // Paused inside a transition on initial mount — trigger a render so
    // the GPU transition is visible without forceFastScrubOverlay.
    if (isPausedTransitionOverlayActive(initialPlaybackState.currentFrame, initialPlaybackState)) {
      scrubRequestedFrameRef.current = initialPlaybackState.currentFrame
      void pumpRenderLoop()
    }

    if (
      !initialPlaybackState.isPlaying &&
      initialPlaybackState.previewFrame !== null &&
      !forceFastScrubOverlay &&
      !shouldPreferPlayerForPreview(initialPlaybackState.previewFrame)
    ) {
      const previewTransitionState = getPlaybackTransitionStateForFrame(
        initialPlaybackState.previewFrame,
      )
      if (
        previewTransitionState.shouldPrewarm &&
        !previewTransitionState.hasActiveTransition &&
        previewTransitionState.nextTransitionStartFrame !== null
      ) {
        schedulePlaybackTransitionPrepare(previewTransitionState.nextTransitionStartFrame)
      }
      scrubRequestedFrameRef.current = initialPlaybackState.previewFrame
      void pumpRenderLoop()
    } else if (forceFastScrubOverlay || initialRenderedPlayback) {
      const playbackState = usePlaybackStore.getState()
      const playbackTransitionState = getPlaybackTransitionStateForFrame(playbackState.currentFrame)
      if (
        playbackState.isPlaying &&
        playbackTransitionState.shouldPrewarm &&
        playbackTransitionState.nextTransitionStartFrame !== null
      ) {
        if (forceFastScrubOverlay) {
          // Non-blocking prewarm path
          const tw = getTransitionWindowByStartFrame(
            playbackTransitionState.nextTransitionStartFrame,
          )
          if (tw) {
            pinTransitionPlaybackSession(tw)
            const renderer = scrubRendererRef.current
            if (renderer && 'prewarmItems' in renderer) {
              void renderer.prewarmItems?.([tw.leftClip.id, tw.rightClip.id], tw.startFrame)
            }
          }
        } else {
          schedulePlaybackTransitionPrepare(playbackTransitionState.nextTransitionStartFrame)
        }
      }
      const initialFrame = playbackState.previewFrame ?? playbackState.currentFrame
      scrubRequestedFrameRef.current = initialFrame
      void pumpRenderLoop()
      if (!playbackState.isPlaying && playbackState.previewFrame === null) {
        activeScrubPreseek.primeDecoderAtFrame(initialFrame)
        schedulePausedPlaybackLookahead(initialFrame, 'initial_load', true)
      }
      // Start rAF pump if already playing
      if (usesRenderedPlaybackOverlay(playbackState) && playbackRafId === null) {
        playbackRafId = requestAnimationFrame(playbackRafPump)
      }
    } else if (usePlaybackStore.getState().isPlaying && !forceFastScrubOverlay) {
      const playbackState = usePlaybackStore.getState()
      const playbackTransitionState = getPlaybackTransitionStateForFrame(playbackState.currentFrame)
      if (playbackTransitionState.shouldPrewarm) {
        void ensureFastScrubRenderer()
        if (
          !playbackTransitionState.hasActiveTransition &&
          playbackTransitionState.nextTransitionStartFrame !== null
        ) {
          schedulePlaybackTransitionPrepare(playbackTransitionState.nextTransitionStartFrame)
        }
      }
      if (
        playbackTransitionState.hasActiveTransition ||
        playbackTransitionState.shouldHoldOverlay
      ) {
        if (!tryShowPreparedPlaybackTransitionOverlay(playbackState.currentFrame)) {
          if (playbackTransitionState.hasActiveTransition) {
            const trace = transitionSessionTraceRef.current
            if (trace && trace.lastEntryMissFrame !== playbackState.currentFrame) {
              trace.entryMisses += 1
              trace.lastEntryMissFrame = playbackState.currentFrame
              pushTransitionTrace('entry_miss', {
                opId: trace.opId,
                frame: playbackState.currentFrame,
                bufferedFrames: transitionSessionBufferedFramesRef.current.size,
              })
            }
          }
          scrubRequestedFrameRef.current = playbackState.currentFrame
          void pumpRenderLoop()
        }
      } else {
        const hasPinnedPrearm =
          getPlayingAnyTransitionPrewarmStartFrame(playbackState.currentFrame) !== null
        if (!playbackTransitionState.shouldPrewarm && !hasPinnedPrearm) {
          clearTransitionPlaybackSession()
        }
        hideAllOverlays()
      }
    } else if (shouldPreferPlayerForPreview(usePlaybackStore.getState().previewFrame)) {
      clearTransitionPlaybackSession()
      hideAllOverlays()
    } else if (
      usePlaybackStore.getState().previewFrame === null &&
      !showFastScrubOverlayRef.current
    ) {
      clearTransitionPlaybackSession()
      hideAllOverlays()
    }

    return () => {
      effectDisposed = true
      reverseWindow.reset()
      scrubMountedRef.current = false
      resetScrubLoopState()
      clearScheduledTransitionPrepare()
      clearTransitionPlaybackSession()
      if (unmountingRef.current) {
        hideAllOverlays()
      }
      if (playbackRafId !== null) {
        cancelAnimationFrame(playbackRafId)
        playbackRafId = null
      }
      if (
        initialLookaheadIdleIdRef.current !== null &&
        typeof window !== 'undefined' &&
        'cancelIdleCallback' in window
      ) {
        ;(window as Window & { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(
          initialLookaheadIdleIdRef.current,
        )
      }
      if (initialLookaheadTimeoutIdRef.current !== null) {
        clearTimeout(initialLookaheadTimeoutIdRef.current)
      }
      if (renderPumpRestartTimeoutId !== null) {
        clearTimeout(renderPumpRestartTimeoutId)
      }
      cancelScrubPrewarmIdleRestart()
      initialLookaheadIdleIdRef.current = null
      initialLookaheadTimeoutIdRef.current = null
      renderPumpRestartTimeoutId = null
      resumeScrubLoopRef.current = () => {}
      unsubscribe()
      unsubscribeActivePreviewReady()
      unsubscribeGizmo()
      unsubscribeCornerPin()
      unsubscribeMaskEditor()
    }
  }, [
    disposeFastScrubRenderer,
    ensureFastScrubRenderer,
    fastScrubBoundaryFrames,
    fastScrubBoundarySources,
    forceFastScrubOverlay,
    fps,
    useProxy,
    clearTransitionPlaybackSession,
    getPausedTransitionPrewarmStartFrame,
    getPinnedTransitionElementForItem,
    getTransitionWindowByStartFrame,
    getTransitionWindowForFrame,
    hideFastScrubOverlay,
    hidePlaybackTransitionOverlay,
    isPausedTransitionOverlayActive,
    pinTransitionPlaybackSession,
    preparePlaybackTransitionFrame,
    showPlaybackTransitionOverlayForFrame,
    bgTransitionRenderInFlightRef,
    bypassPreviewSeekRef,
    cacheTransitionSessionFrame,
    committedPreviewSnapshotRef,
    combinedTracks,
    deferredPlaybackTransitionPrepareFrameRef,
    ensureBgTransitionRenderer,
    isGizmoInteractingRef,
    playbackTransitionCooldownFrames,
    playbackTransitionLookaheadFrames,
    playbackTransitionOverlayWindows,
    playbackTransitionPrerenderRunwayFrames,
    playerRef,
    previewPerfRef,
    pushTransitionTrace,
    recordRenderFrameJitter,
    resumeScrubLoopRef,
    scrubCanvasRef,
    scrubDirectionRef,
    scrubMountedRef,
    scrubOffscreenCanvasRef,
    scrubOffscreenRenderedFrameRef,
    scrubPrewarmQueueRef,
    scrubPrewarmQueuedSetRef,
    scrubPrewarmedFrameSetRef,
    scrubPrewarmedFramesRef,
    scrubPrewarmedSourceOrderRef,
    scrubPrewarmedSourceTouchFrameRef,
    scrubPrewarmedSourcesRef,
    scrubRenderGenerationRef,
    scrubRenderInFlightRef,
    scrubRendererRef,
    scrubRequestedFrameRef,
    setDisplayedFrame,
    shouldPreserveHighFidelityBackwardPreview,
    shouldPreferPlayerForPreview,
    showFastScrubOverlayForFrame,
    showFastScrubOverlayRef,
    suppressScrubBackgroundPrewarmRef,
    trackPlayerSeek,
    transitionPrepareTimeoutRef,
    transitionPrewarmPromiseRef,
    transitionSessionBufferedFramesRef,
    transitionSessionPinnedElementsRef,
    transitionSessionStallCountRef,
    transitionSessionTraceRef,
    transitionSessionWindowRef,
    fallbackToPlayerScrubRef,
    getPlayingAnyTransitionPrewarmStartFrame,
    lastBackwardRequestedFrameRef,
    lastBackwardScrubPreloadAtRef,
    lastBackwardScrubRenderAtRef,
    lastPausedPrearmTargetRef,
    lastPlayingPrearmTargetRef,
  ])
}
