import type { PreviewTransitionDecision } from './preview-state-coordinator'
import {
  PLAYER_BACKWARD_SCRUB_FORCE_JUMP_FRAMES,
  PLAYER_BACKWARD_SCRUB_SEEK_QUANTIZE_FRAMES,
  PLAYER_BACKWARD_SCRUB_SEEK_THROTTLE_MS,
  getFrameDirection,
} from './preview-constants'

export type PlayerCommand =
  | { type: 'noop' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; targetFrame: number }
  | { type: 'seek_and_play'; targetFrame: number }

export interface PlayerPlaybackSyncPlan {
  clearPreviewFrame: boolean
  command: PlayerCommand
}

export interface PlayerCurrentFrameSyncPlan {
  command: Extract<PlayerCommand, { type: 'noop' | 'seek' }>
  acknowledgedFrame: number | null
}

export interface BackwardScrubSeekState {
  lastSeekAtMs: number
  lastSeekFrame: number | null
}

export interface PlayerPreviewFrameSyncPlan {
  command: Extract<PlayerCommand, { type: 'noop' | 'seek' }>
  backwardScrubState: BackwardScrubSeekState
  useBackgroundWarmSeek: boolean
}

export function planPlaybackStateCommand(input: {
  wasPlaying: boolean
  isPlaying: boolean
  currentFrame: number
  playerFrame: number | null
}): PlayerPlaybackSyncPlan {
  const { wasPlaying, isPlaying, currentFrame, playerFrame } = input

  if (isPlaying && !wasPlaying) {
    const needsSeek = playerFrame === null || Math.abs(playerFrame - currentFrame) > 1
    return {
      clearPreviewFrame: true,
      command: needsSeek ? { type: 'seek_and_play', targetFrame: currentFrame } : { type: 'play' },
    }
  }

  if (!isPlaying && wasPlaying) {
    return {
      clearPreviewFrame: false,
      command: { type: 'pause' },
    }
  }

  return {
    clearPreviewFrame: false,
    command: { type: 'noop' },
  }
}

export function planCurrentFrameSyncCommand(input: {
  transition: PreviewTransitionDecision
  currentFrame: number
  lastSyncedFrame: number
  playerFrame: number | null
}): PlayerCurrentFrameSyncPlan {
  const { transition, currentFrame, lastSyncedFrame, playerFrame } = input

  if (!transition.currentFrameChanged) {
    return {
      command: { type: 'noop' },
      acknowledgedFrame: null,
    }
  }

  if (Math.abs(currentFrame - lastSyncedFrame) === 0) {
    return {
      command: { type: 'noop' },
      acknowledgedFrame: null,
    }
  }

  if (transition.next.mode === 'playing') {
    const withinPlayingDriftWindow =
      playerFrame !== null && Math.abs(playerFrame - currentFrame) <= 2
    if (withinPlayingDriftWindow) {
      return {
        command: { type: 'noop' },
        acknowledgedFrame: currentFrame,
      }
    }
  }

  if (transition.shouldSkipCurrentFrameSeek) {
    return {
      command: { type: 'noop' },
      acknowledgedFrame: currentFrame,
    }
  }

  return {
    command: { type: 'seek', targetFrame: currentFrame },
    acknowledgedFrame: null,
  }
}

export function planPreviewFrameSyncCommand(input: {
  transition: PreviewTransitionDecision
  currentFrame: number
  previewFrame: number | null
  currentFrameEpoch: number
  previewFrameEpoch: number
  bypassPreviewSeek: boolean
  preferPlayerForStyledTextScrub: boolean
  nowMs: number
  backwardScrubState: BackwardScrubSeekState
}): PlayerPreviewFrameSyncPlan {
  const {
    transition,
    currentFrame,
    previewFrame,
    currentFrameEpoch,
    previewFrameEpoch,
    bypassPreviewSeek,
    preferPlayerForStyledTextScrub,
    nowMs,
    backwardScrubState,
  } = input

  const resetBackwardScrubState: BackwardScrubSeekState = {
    lastSeekAtMs: 0,
    lastSeekFrame: null,
  }

  if (!transition.previewFrameChanged) {
    return {
      command: { type: 'noop' },
      backwardScrubState,
      useBackgroundWarmSeek: false,
    }
  }

  const interactionMode = transition.next.mode
  if (interactionMode === 'playing' || interactionMode === 'gizmo_dragging') {
    return {
      command: { type: 'noop' },
      backwardScrubState: resetBackwardScrubState,
      useBackgroundWarmSeek: false,
    }
  }

  const shouldUseFastScrubOnly =
    !preferPlayerForStyledTextScrub &&
    interactionMode === 'scrubbing' &&
    previewFrame !== null &&
    currentFrame === previewFrame &&
    currentFrameEpoch === previewFrameEpoch
  const useBackgroundWarmSeek =
    interactionMode === 'scrubbing' && (bypassPreviewSeek || shouldUseFastScrubOnly)

  const targetFrame = transition.next.anchorFrame
  if (useBackgroundWarmSeek) {
    return {
      command: { type: 'seek', targetFrame },
      backwardScrubState: resetBackwardScrubState,
      useBackgroundWarmSeek: true,
    }
  }

  const scrubDirection =
    interactionMode === 'scrubbing'
      ? getFrameDirection(transition.prev.anchorFrame, transition.next.anchorFrame)
      : 0

  if (scrubDirection < 0) {
    const quantizedFrame =
      Math.floor(targetFrame / PLAYER_BACKWARD_SCRUB_SEEK_QUANTIZE_FRAMES) *
      PLAYER_BACKWARD_SCRUB_SEEK_QUANTIZE_FRAMES
    const withinThrottle =
      nowMs - backwardScrubState.lastSeekAtMs < PLAYER_BACKWARD_SCRUB_SEEK_THROTTLE_MS
    const jumpDistance =
      backwardScrubState.lastSeekFrame === null
        ? Number.POSITIVE_INFINITY
        : Math.abs(quantizedFrame - backwardScrubState.lastSeekFrame)

    if (withinThrottle && jumpDistance < PLAYER_BACKWARD_SCRUB_FORCE_JUMP_FRAMES) {
      return {
        command: { type: 'noop' },
        backwardScrubState,
        useBackgroundWarmSeek,
      }
    }

    return {
      command: { type: 'seek', targetFrame: quantizedFrame },
      backwardScrubState: {
        lastSeekAtMs: nowMs,
        lastSeekFrame: quantizedFrame,
      },
      useBackgroundWarmSeek,
    }
  }

  return {
    command: { type: 'seek', targetFrame },
    backwardScrubState: resetBackwardScrubState,
    useBackgroundWarmSeek,
  }
}
