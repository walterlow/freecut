import { useCallback, useRef, type MutableRefObject } from 'react'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import type { ResolvedTransitionWindow } from '@/shared/timeline/transitions/transition-planner'
import { usePlaybackStore } from '@/shared/state/playback'
import { getBrowserMediaPlaybackRate } from '@/shared/state/playback/shuttle'
import {
  getBestDomVideoElementForItem,
  transitionSafePlay,
  snapSourceTime,
} from '@/features/preview/deps/composition-runtime'
import { createLogger, createOperationId } from '@/shared/logging/logger'
import {
  resolveTransitionPrerenderPlan,
  selectUpcomingTransitionStartFrame,
  shouldUsePausedTransitionOverlay,
} from '../utils/transition-prewarm-guards'
import {
  resolveTransitionDomPlaybackState,
  synchronizePausedTransitionDomVideo,
  type TransitionDomPlaybackState,
} from '../utils/transition-dom-playback'

const logger = createLogger('VideoPreview')

type TransitionPreviewEvent = {
  success: (payload: Record<string, unknown>) => void
}

export type TransitionPreviewSessionTrace = {
  opId: string
  event: TransitionPreviewEvent
  startedAtMs: number
  startFrame: number
  endFrame: number
  mode: 'dom' | 'render'
  complex: boolean
  leftClipId: string
  rightClipId: string
  leftSpeed: number
  rightSpeed: number
  leftHasEffects: boolean
  rightHasEffects: boolean
  prepareStartedAtMs: number | null
  firstPreparedAtMs: number | null
  enteredAtMs: number | null
  exitedAtMs: number | null
  lastPrepareMs: number
  lastPreparedFrame: number
  bufferedFramesPeak: number
  entryMisses: number
  lastEntryMissFrame: number | null
}

export type TransitionPreviewTelemetry = {
  sessionCount: number
  lastPrepareMs: number
  lastReadyLeadMs: number
  lastEntryMisses: number
  lastSessionDurationMs: number
}

type TransitionRenderer = {
  renderFrame: (frame: number) => Promise<void>
  prewarmFrame: (frame: number) => Promise<void>
  setDomVideoElementProvider?: (provider: (itemId: string) => HTMLVideoElement | null) => void
}

interface UsePreviewTransitionSessionControllerParams {
  fps: number
  forceFastScrubOverlay: boolean
  pausedTransitionPrearmFrames: number
  playingComplexTransitionPrearmFrames: number
  playbackTransitionWindows: ResolvedTransitionWindow<TimelineItem>[]
  playbackTransitionComplexStartFrames: Set<number>
  playbackTransitionPrerenderRunwayFrames: number
  playbackTransitionCooldownFrames: number
  transitionWindowUsesDomProvider: (
    window: ResolvedTransitionWindow<TimelineItem> | null,
  ) => boolean
  getTransitionWindowByStartFrame: (
    startFrame: number,
  ) => ResolvedTransitionWindow<TimelineItem> | null
  getActiveTransitionWindowForFrame: (
    frame: number,
  ) => ResolvedTransitionWindow<TimelineItem> | null
  pushTransitionTrace: (phase: string, data?: Record<string, unknown>) => void
  ensureFastScrubRendererRef: MutableRefObject<() => Promise<TransitionRenderer | null>>
  scrubMountedRef: MutableRefObject<boolean>
  scrubRenderInFlightRef: MutableRefObject<boolean>
  scrubRequestedFrameRef: MutableRefObject<number | null>
  scrubOffscreenCanvasRef: MutableRefObject<OffscreenCanvas | null>
  scrubOffscreenRenderedFrameRef: MutableRefObject<number | null>
  resumeScrubLoopRef: MutableRefObject<() => void>
  playbackTransitionPreparePromiseRef: MutableRefObject<Promise<boolean> | null>
  playbackTransitionPreparingFrameRef: MutableRefObject<number | null>
  transitionSessionWindowRef: MutableRefObject<ResolvedTransitionWindow<TimelineItem> | null>
  transitionSessionPinnedElementsRef: MutableRefObject<Map<string, HTMLVideoElement | null>>
  transitionExitElementsRef: MutableRefObject<Map<string, HTMLVideoElement | null>>
  transitionSessionStallCountRef: MutableRefObject<Map<string, { ct: number; count: number }>>
  transitionSessionBufferedFramesRef: MutableRefObject<Map<number, OffscreenCanvas>>
  transitionPrewarmPromiseRef: MutableRefObject<Promise<void> | null>
  transitionSessionTraceRef: MutableRefObject<TransitionPreviewSessionTrace | null>
  transitionTelemetryRef: MutableRefObject<TransitionPreviewTelemetry>
}

type TransitionWindow = ResolvedTransitionWindow<TimelineItem>
type TransitionPlaybackSnapshot = ReturnType<typeof usePlaybackStore.getState>
type TransitionWindowDomProvider = (window: TransitionWindow | null) => boolean

function clearTransitionElementMarkers(element: HTMLVideoElement): void {
  delete element.dataset.transitionHold
  delete element.dataset.transitionPrearm
  delete element.dataset.transitionSourceRamp
}

function setTransitionSourceRampMarker(
  element: HTMLVideoElement,
  state: TransitionDomPlaybackState | null,
): void {
  if (state?.hasActiveSourceRamp) {
    element.dataset.transitionSourceRamp = '1'
  } else {
    delete element.dataset.transitionSourceRamp
  }
}

function seekTransitionElement(
  element: HTMLVideoElement,
  sourceTime: number,
  toleranceSeconds: number,
): void {
  if (element.readyState < 1) return
  if (Math.abs(element.currentTime - sourceTime) <= toleranceSeconds) return
  try {
    element.currentTime = sourceTime
  } catch {
    // The pooled element can still be settling; a later maintenance pass retries.
  }
}

function completeTransitionSessionTrace(
  activeTrace: TransitionPreviewSessionTrace | null,
  telemetry: TransitionPreviewTelemetry,
  pushTransitionTrace: (phase: string, data?: Record<string, unknown>) => void,
): void {
  if (!activeTrace) return

  const finishedAtMs = performance.now()
  activeTrace.exitedAtMs = finishedAtMs
  telemetry.lastPrepareMs = activeTrace.lastPrepareMs
  telemetry.lastEntryMisses = activeTrace.entryMisses
  telemetry.lastSessionDurationMs = Math.max(0, finishedAtMs - activeTrace.startedAtMs)
  telemetry.lastReadyLeadMs =
    activeTrace.enteredAtMs !== null && activeTrace.firstPreparedAtMs !== null
      ? Math.max(0, activeTrace.enteredAtMs - activeTrace.firstPreparedAtMs)
      : 0
  activeTrace.event.success({
    startFrame: activeTrace.startFrame,
    endFrame: activeTrace.endFrame,
    mode: activeTrace.mode,
    complex: activeTrace.complex,
    leftClipId: activeTrace.leftClipId,
    rightClipId: activeTrace.rightClipId,
    leftSpeed: activeTrace.leftSpeed,
    rightSpeed: activeTrace.rightSpeed,
    leftHasEffects: activeTrace.leftHasEffects,
    rightHasEffects: activeTrace.rightHasEffects,
    prepareMs: activeTrace.lastPrepareMs,
    preparedFrame: activeTrace.lastPreparedFrame,
    bufferedFramesPeak: activeTrace.bufferedFramesPeak,
    entryMisses: activeTrace.entryMisses,
    readyLeadMs: telemetry.lastReadyLeadMs,
    sessionDurationMs: telemetry.lastSessionDurationMs,
  })
  pushTransitionTrace('session_end', {
    opId: activeTrace.opId,
    mode: activeTrace.mode,
    complex: activeTrace.complex,
    startFrame: activeTrace.startFrame,
    endFrame: activeTrace.endFrame,
    prepareMs: activeTrace.lastPrepareMs,
    preparedFrame: activeTrace.lastPreparedFrame,
    bufferedFramesPeak: activeTrace.bufferedFramesPeak,
    entryMisses: activeTrace.entryMisses,
    readyLeadMs: telemetry.lastReadyLeadMs,
    sessionDurationMs: telemetry.lastSessionDurationMs,
  })
}

function restoreTransitionElementTiming({
  element,
  targetTime,
  playbackRate,
}: {
  element: HTMLVideoElement
  targetTime: number
  playbackRate: number
}): void {
  const drift = Math.abs(element.currentTime - targetTime)
  if (drift > 0.15) {
    seekTransitionElement(element, targetTime, 0)
  } else if (drift > 0.016) {
    element.playbackRate = playbackRate
  }
}

function restoreTransitionClipPlaybackPosition({
  clip,
  element,
  currentFrame,
  timelineFps,
  transportRate,
}: {
  clip: VideoItem
  element: HTMLVideoElement | null
  currentFrame: number
  timelineFps: number
  transportRate: number
}): void {
  if (!element) return
  const localFrame = currentFrame - clip.from
  if (localFrame < 0 || localFrame >= clip.durationInFrames) return

  const sourceStart = clip.sourceStart ?? clip.trimStart ?? 0
  const sourceFps = clip.sourceFps ?? timelineFps
  const clipSpeed = clip.speed ?? 1
  const targetTime = snapSourceTime(
    sourceStart / sourceFps + (localFrame * clipSpeed) / timelineFps,
    sourceFps,
  )
  const videoDuration = element.duration || Infinity
  const clamped = Math.min(Math.max(0, targetTime), videoDuration - 0.05)
  restoreTransitionElementTiming({
    element,
    targetTime: clamped,
    playbackRate: getBrowserMediaPlaybackRate(clipSpeed, transportRate),
  })
}

function restoreTransitionSessionPlaybackPosition(
  window: TransitionWindow | null,
  elements: Map<string, HTMLVideoElement | null>,
  timelineFps: number,
): void {
  if (!window) return
  const playback = usePlaybackStore.getState()
  for (const clip of [window.leftClip, window.rightClip]) {
    if (clip.type !== 'video') continue
    restoreTransitionClipPlaybackPosition({
      clip,
      element: elements.get(clip.id) ?? null,
      currentFrame: playback.currentFrame,
      timelineFps,
      transportRate: playback.playbackRate,
    })
  }
}

function clearPausedTransitionRenderRetries(
  retryCleanupByElement: Map<HTMLVideoElement, () => void>,
): void {
  for (const cleanup of retryCleanupByElement.values()) cleanup()
  retryCleanupByElement.clear()
}

function schedulePausedTransitionRenderRetry({
  element,
  targetFrame,
  retryCleanupByElement,
  requestRender,
}: {
  element: HTMLVideoElement
  targetFrame: number
  retryCleanupByElement: Map<HTMLVideoElement, () => void>
  requestRender: (targetFrame: number) => void
}): void {
  retryCleanupByElement.get(element)?.()
  if (element.readyState >= 2 && !element.seeking) return

  const cleanup = () => {
    element.removeEventListener('seeked', retryWhenDrawable)
    element.removeEventListener('loadeddata', retryWhenDrawable)
    element.removeEventListener('canplay', retryWhenDrawable)
    retryCleanupByElement.delete(element)
  }
  function retryWhenDrawable() {
    if (element.readyState < 2) return
    cleanup()
    requestRender(targetFrame)
  }
  element.addEventListener('seeked', retryWhenDrawable)
  element.addEventListener('loadeddata', retryWhenDrawable)
  element.addEventListener('canplay', retryWhenDrawable)
  retryCleanupByElement.set(element, cleanup)
}

function synchronizePausedTransitionSessionElements({
  window,
  pausedTargetFrame,
  playback,
  timelineFps,
  pinnedElements,
  transitionWindowUsesDomProvider,
  retryCleanupByElement,
  requestRender,
}: {
  window: TransitionWindow
  pausedTargetFrame: number | undefined
  playback: TransitionPlaybackSnapshot
  timelineFps: number
  pinnedElements: Map<string, HTMLVideoElement | null>
  transitionWindowUsesDomProvider: TransitionWindowDomProvider
  retryCleanupByElement: Map<HTMLVideoElement, () => void>
  requestRender: (targetFrame: number) => void
}): void {
  if (playback.isPlaying || pausedTargetFrame === undefined) return
  if (!transitionWindowUsesDomProvider(window)) return

  for (const clip of [window.leftClip, window.rightClip]) {
    if (clip.type !== 'video') continue
    const element = pinnedElements.get(clip.id) ?? getBestDomVideoElementForItem(clip.id)
    pinnedElements.set(clip.id, element)
    if (!element) continue

    const transitionState = resolveTransitionDomPlaybackState({
      window,
      clip,
      frame: pausedTargetFrame,
      timelineFps,
      transportRate: playback.playbackRate,
    })
    if (!transitionState) continue
    synchronizePausedTransitionDomVideo(element, transitionState)
    schedulePausedTransitionRenderRetry({
      element,
      targetFrame: pausedTargetFrame,
      retryCleanupByElement,
      requestRender,
    })
  }
}

function startTransitionSessionTrace({
  window,
  transitionWindowUsesDomProvider,
  telemetry,
  pushTransitionTrace,
}: {
  window: TransitionWindow
  transitionWindowUsesDomProvider: TransitionWindowDomProvider
  telemetry: TransitionPreviewTelemetry
  pushTransitionTrace: (phase: string, data?: Record<string, unknown>) => void
}): TransitionPreviewSessionTrace {
  const opId = createOperationId()
  const event = logger.startEvent('preview_transition_session', opId) as TransitionPreviewEvent
  const leftSpeed = window.leftClip.speed ?? 1
  const rightSpeed = window.rightClip.speed ?? 1
  const leftHasEffects = Boolean(window.leftClip.effects?.some((effect) => effect.enabled))
  const rightHasEffects = Boolean(window.rightClip.effects?.some((effect) => effect.enabled))
  const mode = transitionWindowUsesDomProvider(window) ? 'dom' : 'render'
  const complex = mode === 'render'
  telemetry.sessionCount += 1
  const trace: TransitionPreviewSessionTrace = {
    opId,
    event,
    startedAtMs: performance.now(),
    startFrame: window.startFrame,
    endFrame: window.endFrame,
    mode,
    complex,
    leftClipId: window.leftClip.id,
    rightClipId: window.rightClip.id,
    leftSpeed,
    rightSpeed,
    leftHasEffects,
    rightHasEffects,
    prepareStartedAtMs: null,
    firstPreparedAtMs: null,
    enteredAtMs: null,
    exitedAtMs: null,
    lastPrepareMs: 0,
    lastPreparedFrame: -1,
    bufferedFramesPeak: 0,
    entryMisses: 0,
    lastEntryMissFrame: null,
  }
  pushTransitionTrace('session_start', {
    opId,
    mode,
    complex,
    startFrame: window.startFrame,
    endFrame: window.endFrame,
    leftClipId: window.leftClip.id,
    rightClipId: window.rightClip.id,
    leftSpeed,
    rightSpeed,
    leftHasEffects,
    rightHasEffects,
  })
  return trace
}

function holdTransitionElementAtState(
  element: HTMLVideoElement,
  state: TransitionDomPlaybackState,
  toleranceSeconds: number,
): void {
  element.dataset.transitionPrearm = '1'
  seekTransitionElement(element, state.sourceTime, toleranceSeconds)
  if (!element.paused) element.pause()
  element.playbackRate = state.playbackRate
}

function playTransitionElementWhenReady(element: HTMLVideoElement, playbackRate: number): void {
  if (element.readyState >= 2) {
    transitionSafePlay(element, playbackRate)
    return
  }
  const onCanPlay = () => {
    element.removeEventListener('canplay', onCanPlay)
    if (element.dataset.transitionHold === '1' && element.paused) {
      transitionSafePlay(element, playbackRate)
    }
  }
  element.addEventListener('canplay', onCanPlay, { once: true })
}

type PinnedTransitionInitialization = {
  shouldSynchronizePausedTarget: boolean
  shouldPrepositionIncoming: boolean
  transitionState: TransitionDomPlaybackState | null
}

function resolvePinnedTransitionInitialization({
  clip,
  window,
  playback,
  pausedTargetFrame,
  timelineFps,
  useDomProvider,
}: {
  clip: VideoItem
  window: TransitionWindow
  playback: TransitionPlaybackSnapshot
  pausedTargetFrame: number | undefined
  timelineFps: number
  useDomProvider: boolean
}): PinnedTransitionInitialization | null {
  const shouldSynchronizePausedTarget =
    !playback.isPlaying && pausedTargetFrame !== undefined && useDomProvider
  const shouldPrepositionIncoming =
    playback.currentFrame < window.startFrame && clip.id === window.rightClip.id
  const shouldInitialize =
    playback.isPlaying || shouldPrepositionIncoming || shouldSynchronizePausedTarget
  if (!shouldInitialize) return null

  const stateFrame = shouldSynchronizePausedTarget
    ? pausedTargetFrame
    : shouldPrepositionIncoming
      ? window.startFrame
      : playback.currentFrame
  return {
    shouldSynchronizePausedTarget,
    shouldPrepositionIncoming,
    transitionState: resolveTransitionDomPlaybackState({
      window,
      clip,
      frame: stateFrame,
      timelineFps,
      transportRate: playback.playbackRate,
    }),
  }
}

function synchronizePinnedPausedTransitionElement({
  element,
  targetFrame,
  transitionState,
  retryCleanupByElement,
  requestRender,
}: {
  element: HTMLVideoElement
  targetFrame: number
  transitionState: TransitionDomPlaybackState
  retryCleanupByElement: Map<HTMLVideoElement, () => void>
  requestRender: (targetFrame: number) => void
}): void {
  synchronizePausedTransitionDomVideo(element, transitionState)
  schedulePausedTransitionRenderRetry({
    element,
    targetFrame,
    retryCleanupByElement,
    requestRender,
  })
}

function initializePausedPinnedTransitionElement({
  element,
  shouldSynchronize,
  targetFrame,
  transitionState,
  retryCleanupByElement,
  requestRender,
}: {
  element: HTMLVideoElement
  shouldSynchronize: boolean
  targetFrame: number | undefined
  transitionState: TransitionDomPlaybackState | null
  retryCleanupByElement: Map<HTMLVideoElement, () => void>
  requestRender: (targetFrame: number) => void
}): boolean {
  if (!shouldSynchronize || targetFrame === undefined || !transitionState) return false
  synchronizePinnedPausedTransitionElement({
    element,
    targetFrame,
    transitionState,
    retryCleanupByElement,
    requestRender,
  })
  return true
}

function initializePrepositionedTransitionElement({
  element,
  shouldPreposition,
  transitionState,
}: {
  element: HTMLVideoElement
  shouldPreposition: boolean
  transitionState: TransitionDomPlaybackState | null
}): boolean {
  if (!shouldPreposition || !transitionState) return false
  const positionAndHold = () => holdTransitionElementAtState(element, transitionState, 0.016)
  if (element.readyState >= 1) {
    positionAndHold()
  } else {
    element.addEventListener('loadedmetadata', positionAndHold, { once: true })
  }
  return true
}

function initializePinnedTransitionElement({
  element,
  clip,
  window,
  playback,
  pausedTargetFrame,
  timelineFps,
  useDomProvider,
  retryCleanupByElement,
  requestRender,
}: {
  element: HTMLVideoElement | null
  clip: TimelineItem
  window: TransitionWindow
  playback: TransitionPlaybackSnapshot
  pausedTargetFrame: number | undefined
  timelineFps: number
  useDomProvider: boolean
  retryCleanupByElement: Map<HTMLVideoElement, () => void>
  requestRender: (targetFrame: number) => void
}): void {
  if (!element || clip.type !== 'video') return
  const initialization = resolvePinnedTransitionInitialization({
    clip,
    window,
    playback,
    pausedTargetFrame,
    timelineFps,
    useDomProvider,
  })
  if (!initialization) return

  element.dataset.transitionHold = '1'
  const { shouldSynchronizePausedTarget, shouldPrepositionIncoming, transitionState } =
    initialization
  setTransitionSourceRampMarker(element, transitionState)

  const initializedPausedTarget = initializePausedPinnedTransitionElement({
    element,
    shouldSynchronize: shouldSynchronizePausedTarget,
    targetFrame: pausedTargetFrame,
    transitionState,
    retryCleanupByElement,
    requestRender,
  })
  if (initializedPausedTarget) return
  const initializedPreposition = initializePrepositionedTransitionElement({
    element,
    shouldPreposition: shouldPrepositionIncoming,
    transitionState,
  })
  if (initializedPreposition) return
  const playbackRate =
    transitionState?.playbackRate ??
    getBrowserMediaPlaybackRate(clip.speed ?? 1, playback.playbackRate)
  playTransitionElementWhenReady(element, playbackRate)
}

function createPinnedTransitionElements({
  window,
  playback,
  pausedTargetFrame,
  timelineFps,
  transitionWindowUsesDomProvider,
  retryCleanupByElement,
  requestRender,
}: {
  window: TransitionWindow
  playback: TransitionPlaybackSnapshot
  pausedTargetFrame: number | undefined
  timelineFps: number
  transitionWindowUsesDomProvider: TransitionWindowDomProvider
  retryCleanupByElement: Map<HTMLVideoElement, () => void>
  requestRender: (targetFrame: number) => void
}): Map<string, HTMLVideoElement | null> {
  const pinnedElements = new Map<string, HTMLVideoElement | null>()
  const useDomProvider = transitionWindowUsesDomProvider(window)
  for (const clip of [window.leftClip, window.rightClip]) {
    const element = getBestDomVideoElementForItem(clip.id)
    pinnedElements.set(clip.id, element)
    initializePinnedTransitionElement({
      element,
      clip,
      window,
      playback,
      pausedTargetFrame,
      timelineFps,
      useDomProvider,
      retryCleanupByElement,
      requestRender,
    })
  }
  return pinnedElements
}

function getTransitionSessionClip(
  window: TransitionWindow | null,
  itemId: string,
): TimelineItem | null {
  if (window?.leftClip.id === itemId) return window.leftClip
  if (window?.rightClip.id === itemId) return window.rightClip
  return null
}

function getNonSessionTransitionElement(
  itemId: string,
  exitElements: Map<string, HTMLVideoElement | null>,
): HTMLVideoElement | null {
  const registryElement = getBestDomVideoElementForItem(itemId)
  if (registryElement) {
    exitElements.delete(itemId)
    return registryElement
  }
  const exitElement = exitElements.get(itemId)
  if (exitElement?.isConnected && exitElement.readyState >= 2) return exitElement
  exitElements.delete(itemId)
  return null
}

function isReusableTransitionElement(
  element: HTMLVideoElement | null,
): element is HTMLVideoElement {
  return Boolean(
    element && element.isConnected && element.readyState >= 2 && element.videoWidth > 0,
  )
}

function clearReplacedTransitionElement(
  pinnedElement: HTMLVideoElement | null,
  nextElement: HTMLVideoElement | null,
): void {
  if (pinnedElement && pinnedElement !== nextElement) {
    clearTransitionElementMarkers(pinnedElement)
  }
}

function resolvePlayingTransitionElementState({
  window,
  clip,
  timelineFps,
  playback,
}: {
  window: TransitionWindow | null
  clip: TimelineItem | null
  timelineFps: number
  playback: TransitionPlaybackSnapshot
}): {
  shouldPrepositionIncoming: boolean
  transitionState: TransitionDomPlaybackState | null
} {
  const shouldPrepositionIncoming =
    window !== null && playback.currentFrame < window.startFrame && clip?.id === window.rightClip.id
  const transitionState =
    window && clip?.type === 'video'
      ? resolveTransitionDomPlaybackState({
          window,
          clip,
          frame: shouldPrepositionIncoming ? window.startFrame : playback.currentFrame,
          timelineFps,
          transportRate: playback.playbackRate,
        })
      : null
  return { shouldPrepositionIncoming, transitionState }
}

function synchronizePlayingTransitionRamp(
  element: HTMLVideoElement,
  transitionState: TransitionDomPlaybackState | null,
): void {
  setTransitionSourceRampMarker(element, transitionState)
  if (transitionState?.hasActiveSourceRamp) {
    seekTransitionElement(element, transitionState.sourceTime, 0.12)
  }
}

function ensureTransitionElementPlaying({
  element,
  window,
  clip,
  timelineFps,
  isPlaying,
}: {
  element: HTMLVideoElement
  window: TransitionWindow | null
  clip: TimelineItem | null
  timelineFps: number
  isPlaying: boolean
}): void {
  if (!isPlaying) return
  const playback = usePlaybackStore.getState()
  const { shouldPrepositionIncoming, transitionState } = resolvePlayingTransitionElementState({
    window,
    clip,
    timelineFps,
    playback,
  })

  element.dataset.transitionHold = '1'
  synchronizePlayingTransitionRamp(element, transitionState)
  if (shouldPrepositionIncoming && transitionState) {
    holdTransitionElementAtState(element, transitionState, 0.016)
    return
  }

  delete element.dataset.transitionPrearm
  transitionSafePlay(
    element,
    transitionState?.playbackRate ??
      getBrowserMediaPlaybackRate(clip?.speed ?? 1, playback.playbackRate),
  )
}

export function usePreviewTransitionSessionController({
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
  ensureFastScrubRendererRef,
  scrubMountedRef,
  scrubRenderInFlightRef,
  scrubRequestedFrameRef,
  scrubOffscreenCanvasRef,
  scrubOffscreenRenderedFrameRef,
  resumeScrubLoopRef,
  playbackTransitionPreparePromiseRef,
  playbackTransitionPreparingFrameRef,
  transitionSessionWindowRef,
  transitionSessionPinnedElementsRef,
  transitionExitElementsRef,
  transitionSessionStallCountRef,
  transitionSessionBufferedFramesRef,
  transitionPrewarmPromiseRef,
  transitionSessionTraceRef,
  transitionTelemetryRef,
}: UsePreviewTransitionSessionControllerParams) {
  const pausedTransitionRenderRetryCleanupRef = useRef(new Map<HTMLVideoElement, () => void>())

  const clearTransitionPlaybackSession = useCallback(() => {
    completeTransitionSessionTrace(
      transitionSessionTraceRef.current,
      transitionTelemetryRef.current,
      pushTransitionTrace,
    )
    transitionSessionTraceRef.current = null

    restoreTransitionSessionPlaybackPosition(
      transitionSessionWindowRef.current,
      transitionSessionPinnedElementsRef.current,
      fps,
    )

    transitionSessionWindowRef.current = null
    for (const element of transitionSessionPinnedElementsRef.current.values()) {
      if (element) clearTransitionElementMarkers(element)
    }
    transitionExitElementsRef.current = new Map(transitionSessionPinnedElementsRef.current)
    transitionSessionPinnedElementsRef.current.clear()
    transitionSessionStallCountRef.current.clear()
    transitionSessionBufferedFramesRef.current.clear()
    transitionPrewarmPromiseRef.current = null
    clearPausedTransitionRenderRetries(pausedTransitionRenderRetryCleanupRef.current)
  }, [
    fps,
    pushTransitionTrace,
    transitionExitElementsRef,
    transitionPrewarmPromiseRef,
    transitionSessionBufferedFramesRef,
    transitionSessionPinnedElementsRef,
    transitionSessionStallCountRef,
    transitionSessionTraceRef,
    transitionSessionWindowRef,
    transitionTelemetryRef,
  ])

  const pinTransitionPlaybackSession = useCallback(
    (window: ResolvedTransitionWindow<TimelineItem> | null, pausedTargetFrame?: number) => {
      if (!window) {
        clearTransitionPlaybackSession()
        return null
      }

      const playback = usePlaybackStore.getState()
      const requestPausedTransitionRender = (targetFrame: number) => {
        const latestPlayback = usePlaybackStore.getState()
        if (latestPlayback.isPlaying || latestPlayback.previewFrame !== targetFrame) return
        scrubRequestedFrameRef.current = targetFrame
        resumeScrubLoopRef.current()
      }

      const activeWindow = transitionSessionWindowRef.current
      if (
        activeWindow?.transition.id === window.transition.id &&
        activeWindow.startFrame === window.startFrame
      ) {
        synchronizePausedTransitionSessionElements({
          window: activeWindow,
          pausedTargetFrame,
          playback,
          timelineFps: fps,
          pinnedElements: transitionSessionPinnedElementsRef.current,
          transitionWindowUsesDomProvider,
          retryCleanupByElement: pausedTransitionRenderRetryCleanupRef.current,
          requestRender: requestPausedTransitionRender,
        })
        return activeWindow
      }

      clearTransitionPlaybackSession()

      transitionSessionWindowRef.current = window
      transitionSessionTraceRef.current = startTransitionSessionTrace({
        window,
        transitionWindowUsesDomProvider,
        telemetry: transitionTelemetryRef.current,
        pushTransitionTrace,
      })
      transitionSessionPinnedElementsRef.current = createPinnedTransitionElements({
        window,
        playback,
        pausedTargetFrame,
        timelineFps: fps,
        transitionWindowUsesDomProvider,
        retryCleanupByElement: pausedTransitionRenderRetryCleanupRef.current,
        requestRender: requestPausedTransitionRender,
      })
      transitionSessionBufferedFramesRef.current.clear()
      return window
    },
    [
      clearTransitionPlaybackSession,
      fps,
      pushTransitionTrace,
      resumeScrubLoopRef,
      scrubRequestedFrameRef,
      transitionSessionBufferedFramesRef,
      transitionSessionPinnedElementsRef,
      transitionSessionTraceRef,
      transitionSessionWindowRef,
      transitionTelemetryRef,
      transitionWindowUsesDomProvider,
    ],
  )

  const getPinnedTransitionElementForItem = useCallback(
    (itemId: string) => {
      const sessionWindow = transitionSessionWindowRef.current
      const sessionClip = getTransitionSessionClip(sessionWindow, itemId)
      if (!sessionClip) {
        return getNonSessionTransitionElement(itemId, transitionExitElementsRef.current)
      }

      const isPlaying = usePlaybackStore.getState().isPlaying
      if (!isPlaying && !transitionWindowUsesDomProvider(sessionWindow ?? null)) {
        return null
      }

      const ensurePlaying = (element: HTMLVideoElement) =>
        ensureTransitionElementPlaying({
          element,
          window: sessionWindow,
          clip: sessionClip,
          timelineFps: fps,
          isPlaying,
        })

      const pinned = transitionSessionPinnedElementsRef.current.get(itemId) ?? null
      if (isReusableTransitionElement(pinned)) {
        ensurePlaying(pinned)
        return pinned
      }

      const next = getBestDomVideoElementForItem(itemId)
      clearReplacedTransitionElement(pinned, next)
      if (next && next.readyState >= 2) {
        ensurePlaying(next)
      }
      transitionSessionPinnedElementsRef.current.set(itemId, next)
      return next
    },
    [
      transitionExitElementsRef,
      fps,
      transitionSessionPinnedElementsRef,
      transitionSessionWindowRef,
      transitionWindowUsesDomProvider,
    ],
  )

  const getUpcomingTransitionStartFrame = useCallback(
    (frame: number, maxLookaheadFrames: number, options?: { complexOnly?: boolean }) =>
      selectUpcomingTransitionStartFrame({
        frame,
        maxLookaheadFrames,
        windows: playbackTransitionWindows,
        complexStartFrames: playbackTransitionComplexStartFrames,
        complexOnly: options?.complexOnly,
      }),
    [playbackTransitionComplexStartFrames, playbackTransitionWindows],
  )

  const getPausedTransitionPrewarmStartFrame = useCallback(
    (frame: number) => {
      return getUpcomingTransitionStartFrame(frame, pausedTransitionPrearmFrames)
    },
    [getUpcomingTransitionStartFrame, pausedTransitionPrearmFrames],
  )

  const getPlayingAnyTransitionPrewarmStartFrame = useCallback(
    (frame: number) => {
      return getUpcomingTransitionStartFrame(frame, playingComplexTransitionPrearmFrames)
    },
    [getUpcomingTransitionStartFrame, playingComplexTransitionPrearmFrames],
  )

  const isPausedTransitionOverlayActive = useCallback(
    (frame: number, playbackState: { isPlaying: boolean; previewFrame: number | null }) => {
      return shouldUsePausedTransitionOverlay({
        isPlaying: playbackState.isPlaying,
        previewFrame: playbackState.previewFrame,
        forceFastScrubOverlay,
        hasActiveTransition: getActiveTransitionWindowForFrame(frame) !== null,
      })
    },
    [forceFastScrubOverlay, getActiveTransitionWindowForFrame],
  )

  const cacheTransitionSessionFrame = useCallback(
    (frame: number) => {
      const offscreen = scrubOffscreenCanvasRef.current
      if (!offscreen || !transitionSessionWindowRef.current) return

      const snapshot = new OffscreenCanvas(offscreen.width, offscreen.height)
      const snapshotCtx = snapshot.getContext('2d')
      if (!snapshotCtx) return

      snapshotCtx.drawImage(offscreen, 0, 0)
      transitionSessionBufferedFramesRef.current.set(frame, snapshot)
      const trace = transitionSessionTraceRef.current
      if (trace) {
        trace.lastPreparedFrame = frame
        trace.bufferedFramesPeak = Math.max(
          trace.bufferedFramesPeak,
          transitionSessionBufferedFramesRef.current.size,
        )
        if (trace.firstPreparedAtMs === null) {
          trace.firstPreparedAtMs = performance.now()
          pushTransitionTrace('prepare_ready', {
            opId: trace.opId,
            preparedFrame: frame,
            bufferedFrames: transitionSessionBufferedFramesRef.current.size,
          })
        }
      }

      const maxBufferedFrames =
        playbackTransitionPrerenderRunwayFrames + playbackTransitionCooldownFrames + 2
      while (transitionSessionBufferedFramesRef.current.size > maxBufferedFrames) {
        const oldestFrame = transitionSessionBufferedFramesRef.current.keys().next().value
        if (oldestFrame === undefined) break
        transitionSessionBufferedFramesRef.current.delete(oldestFrame)
      }
    },
    [
      playbackTransitionCooldownFrames,
      playbackTransitionPrerenderRunwayFrames,
      pushTransitionTrace,
      scrubOffscreenCanvasRef,
      transitionSessionBufferedFramesRef,
      transitionSessionTraceRef,
      transitionSessionWindowRef,
    ],
  )

  const preparePlaybackTransitionFrame = useCallback(
    async (targetFrame: number): Promise<boolean> => {
      if (targetFrame < 0) return false
      if (scrubOffscreenRenderedFrameRef.current === targetFrame) {
        return true
      }
      if (
        playbackTransitionPreparingFrameRef.current === targetFrame &&
        playbackTransitionPreparePromiseRef.current
      ) {
        return playbackTransitionPreparePromiseRef.current
      }
      if (scrubRenderInFlightRef.current) {
        return false
      }

      playbackTransitionPreparingFrameRef.current = targetFrame
      const isPlaybackPrepare = usePlaybackStore.getState().isPlaying && forceFastScrubOverlay
      const task = (async () => {
        if (!isPlaybackPrepare) {
          scrubRenderInFlightRef.current = true
        }
        try {
          pinTransitionPlaybackSession(getTransitionWindowByStartFrame(targetFrame))
          const prepareStartedAtMs = performance.now()
          const trace = transitionSessionTraceRef.current
          if (trace) {
            trace.prepareStartedAtMs = prepareStartedAtMs
            pushTransitionTrace('prepare_start', {
              opId: trace.opId,
              targetFrame,
              mode: trace.mode,
              complex: trace.complex,
            })
          }
          const renderer = await ensureFastScrubRendererRef.current()
          if (!renderer || !scrubMountedRef.current) return false

          if ('setDomVideoElementProvider' in renderer && renderer.setDomVideoElementProvider) {
            renderer.setDomVideoElementProvider(getPinnedTransitionElementForItem)
          }

          const isComplexTransitionStart = playbackTransitionComplexStartFrames.has(targetFrame)
          const prerenderPlan = resolveTransitionPrerenderPlan({
            targetFrame,
            runwayFrames: playbackTransitionPrerenderRunwayFrames,
            forceFastScrubOverlay,
            isComplexTransitionStart,
            isPlaying: usePlaybackStore.getState().isPlaying,
          })
          if (!prerenderPlan.renderTargetAfterRunway) {
            await renderer.renderFrame(prerenderPlan.targetFrame.frame)
            cacheTransitionSessionFrame(prerenderPlan.targetFrame.frame)
          }
          for (const runwayFrame of prerenderPlan.runwayFrames) {
            if (runwayFrame.action === 'render-and-cache') {
              await renderer.renderFrame(runwayFrame.frame)
              cacheTransitionSessionFrame(runwayFrame.frame)
            } else {
              await renderer.prewarmFrame(runwayFrame.frame)
            }
          }
          if (prerenderPlan.renderTargetAfterRunway) {
            await renderer.renderFrame(prerenderPlan.targetFrame.frame)
            cacheTransitionSessionFrame(prerenderPlan.targetFrame.frame)
          }
          if (!scrubMountedRef.current) return false
          scrubOffscreenRenderedFrameRef.current = targetFrame
          const finishedAtMs = performance.now()
          if (trace) {
            trace.lastPrepareMs = Math.max(0, finishedAtMs - prepareStartedAtMs)
            pushTransitionTrace('prepare_done', {
              opId: trace.opId,
              targetFrame,
              prepareMs: trace.lastPrepareMs,
              preparedFrame: trace.lastPreparedFrame,
              bufferedFrames: transitionSessionBufferedFramesRef.current.size,
            })
          }
          return true
        } catch (error) {
          logger.debug('Hidden transition prerender failed:', targetFrame, error)
          return false
        } finally {
          if (!isPlaybackPrepare) {
            scrubRenderInFlightRef.current = false
          }
          if (playbackTransitionPreparingFrameRef.current === targetFrame) {
            playbackTransitionPreparingFrameRef.current = null
            playbackTransitionPreparePromiseRef.current = null
          }
          if (scrubRequestedFrameRef.current !== null) {
            resumeScrubLoopRef.current()
          }
        }
      })()

      playbackTransitionPreparePromiseRef.current = task
      return task
    },
    [
      cacheTransitionSessionFrame,
      ensureFastScrubRendererRef,
      forceFastScrubOverlay,
      getPinnedTransitionElementForItem,
      getTransitionWindowByStartFrame,
      pinTransitionPlaybackSession,
      playbackTransitionComplexStartFrames,
      playbackTransitionPreparePromiseRef,
      playbackTransitionPreparingFrameRef,
      playbackTransitionPrerenderRunwayFrames,
      pushTransitionTrace,
      resumeScrubLoopRef,
      scrubMountedRef,
      scrubOffscreenRenderedFrameRef,
      scrubRenderInFlightRef,
      scrubRequestedFrameRef,
      transitionSessionBufferedFramesRef,
      transitionSessionTraceRef,
    ],
  )

  return {
    clearTransitionPlaybackSession,
    pinTransitionPlaybackSession,
    getPinnedTransitionElementForItem,
    getPausedTransitionPrewarmStartFrame,
    getPlayingAnyTransitionPrewarmStartFrame,
    isPausedTransitionOverlayActive,
    cacheTransitionSessionFrame,
    preparePlaybackTransitionFrame,
  }
}
