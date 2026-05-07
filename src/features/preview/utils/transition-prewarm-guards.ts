export type TransitionStartWindow = {
  startFrame: number
}

export type TransitionPrerenderAction = 'render-and-cache' | 'prewarm'

export type TransitionPrerenderFramePlan = {
  action: TransitionPrerenderAction
  frame: number
}

export interface TransitionPrerenderPlan {
  targetFrame: TransitionPrerenderFramePlan
  runwayFrames: TransitionPrerenderFramePlan[]
  renderTargetAfterRunway: boolean
}

type SelectUpcomingTransitionStartFrameParams = {
  frame: number
  maxLookaheadFrames: number
  windows: readonly TransitionStartWindow[]
} & (
  | { complexOnly?: false; complexStartFrames?: ReadonlySet<number> }
  | { complexOnly: true; complexStartFrames: ReadonlySet<number> }
)

export function selectUpcomingTransitionStartFrame({
  frame,
  maxLookaheadFrames,
  windows,
  complexStartFrames,
  complexOnly = false,
}: SelectUpcomingTransitionStartFrameParams): number | null {
  const nextWindow = windows.find((window) => {
    if (frame > window.startFrame) {
      return false
    }
    if (complexOnly && !complexStartFrames?.has(window.startFrame)) {
      return false
    }
    return true
  })
  if (!nextWindow) return null
  if (nextWindow.startFrame - frame > maxLookaheadFrames) {
    return null
  }
  return nextWindow.startFrame
}

export function shouldUsePausedTransitionOverlay({
  isPlaying,
  previewFrame,
  forceFastScrubOverlay,
  hasActiveTransition,
}: {
  isPlaying: boolean
  previewFrame: number | null
  forceFastScrubOverlay: boolean
  hasActiveTransition: boolean
}): boolean {
  return !isPlaying && previewFrame === null && !forceFastScrubOverlay && hasActiveTransition
}

export function resolveTransitionPrerenderPlan({
  targetFrame,
  runwayFrames,
  forceFastScrubOverlay,
  isComplexTransitionStart,
  isPlaying,
}: {
  targetFrame: number
  runwayFrames: number
  forceFastScrubOverlay: boolean
  isComplexTransitionStart: boolean
  isPlaying: boolean
}): TransitionPrerenderPlan {
  const shouldCachePlaybackRunway = isPlaying
  const shouldRenderFullTargetFrame =
    forceFastScrubOverlay || isComplexTransitionStart || shouldCachePlaybackRunway
  const shouldRenderRunway =
    shouldCachePlaybackRunway || (forceFastScrubOverlay && !isComplexTransitionStart)

  return {
    targetFrame: { action: 'render-and-cache', frame: targetFrame },
    runwayFrames: Array.from({ length: Math.max(0, runwayFrames - 1) }, (_, index) => ({
      action: shouldRenderRunway ? 'render-and-cache' : 'prewarm',
      frame: targetFrame + index + 1,
    })),
    renderTargetAfterRunway: !shouldRenderFullTargetFrame,
  }
}
