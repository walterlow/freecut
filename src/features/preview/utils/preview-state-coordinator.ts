import {
  getPreviewAnchorFrame,
  getPreviewInteractionMode,
  type PreviewInteractionMode,
} from './preview-interaction-mode'
import { getPreloadBurstTrigger, type PreloadBurstTrigger } from './preload-burst'
import { shouldSkipCurrentFrameSeek } from './player-seek-guard'

export interface PreviewRuntimeState {
  isPlaying: boolean
  previewFrame: number | null
  currentFrame: number
  isGizmoInteracting: boolean
}

export type PreviewPlaybackState = Pick<
  PreviewRuntimeState,
  'isPlaying' | 'previewFrame' | 'currentFrame'
>

export interface PreviewRuntimeSnapshot {
  mode: PreviewInteractionMode
  anchorFrame: number
  currentFrame: number
  previewFrame: number | null
}

export interface PreviewTransitionDecision {
  prev: PreviewRuntimeSnapshot
  next: PreviewRuntimeSnapshot
  currentFrameChanged: boolean
  previewFrameChanged: boolean
  enteredPlaying: boolean
  exitedPlaying: boolean
  enteredScrubbing: boolean
  exitedScrubbing: boolean
  shouldSkipCurrentFrameSeek: boolean
  preloadBurstTrigger: PreloadBurstTrigger
}

export function getPreviewRuntimeSnapshot(state: PreviewRuntimeState): PreviewRuntimeSnapshot {
  const mode = getPreviewInteractionMode({
    isPlaying: state.isPlaying,
    previewFrame: state.previewFrame,
    isGizmoInteracting: state.isGizmoInteracting,
  })
  const anchorFrame = getPreviewAnchorFrame(mode, {
    currentFrame: state.currentFrame,
    previewFrame: state.previewFrame,
  })
  return {
    mode,
    anchorFrame,
    currentFrame: state.currentFrame,
    previewFrame: state.previewFrame,
  }
}

export function getPreviewRuntimeStateFromPlaybackState(
  state: PreviewPlaybackState,
  isGizmoInteracting: boolean,
): PreviewRuntimeState {
  return {
    isPlaying: state.isPlaying,
    previewFrame: state.previewFrame,
    currentFrame: state.currentFrame,
    isGizmoInteracting,
  }
}

export function getPreviewRuntimeSnapshotFromPlaybackState(
  state: PreviewPlaybackState,
  isGizmoInteracting: boolean,
): PreviewRuntimeSnapshot {
  return getPreviewRuntimeSnapshot(
    getPreviewRuntimeStateFromPlaybackState(state, isGizmoInteracting),
  )
}

export function resolvePreviewTransitionDecision(input: {
  prev: PreviewRuntimeState
  next: PreviewRuntimeState
  fps?: number
}): PreviewTransitionDecision {
  const prev = getPreviewRuntimeSnapshot(input.prev)
  const next = getPreviewRuntimeSnapshot(input.next)
  const currentFrameChanged = next.currentFrame !== prev.currentFrame
  const previewFrameChanged = next.previewFrame !== prev.previewFrame

  const preloadBurstTrigger =
    typeof input.fps === 'number'
      ? getPreloadBurstTrigger({
          interactionMode: next.mode,
          prevInteractionMode: prev.mode,
          currentFrame: next.currentFrame,
          prevCurrentFrame: prev.currentFrame,
          fps: input.fps,
        })
      : 'none'

  return {
    prev,
    next,
    currentFrameChanged,
    previewFrameChanged,
    enteredPlaying: next.mode === 'playing' && prev.mode !== 'playing',
    exitedPlaying: next.mode !== 'playing' && prev.mode === 'playing',
    enteredScrubbing: next.mode === 'scrubbing' && prev.mode !== 'scrubbing',
    exitedScrubbing: next.mode !== 'scrubbing' && prev.mode === 'scrubbing',
    shouldSkipCurrentFrameSeek: shouldSkipCurrentFrameSeek({
      interactionMode: next.mode,
      previewFrameChanged,
    }),
    preloadBurstTrigger,
  }
}

export function resolvePreviewTransitionFromPlaybackStates(input: {
  prev: PreviewPlaybackState
  next: PreviewPlaybackState
  isGizmoInteracting: boolean
  fps?: number
}): PreviewTransitionDecision {
  return resolvePreviewTransitionDecision({
    prev: getPreviewRuntimeStateFromPlaybackState(input.prev, input.isGizmoInteracting),
    next: getPreviewRuntimeStateFromPlaybackState(input.next, input.isGizmoInteracting),
    fps: input.fps,
  })
}
