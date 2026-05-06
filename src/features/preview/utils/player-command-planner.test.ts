import { describe, expect, it } from 'vite-plus/test'
import {
  planCurrentFrameSyncCommand,
  planPlaybackStateCommand,
  planPreviewFrameSyncCommand,
} from './player-command-planner'
import { resolvePreviewTransitionDecision } from './preview-state-coordinator'

describe('planPlaybackStateCommand', () => {
  it('seeks and plays when playback resumes away from the player frame', () => {
    expect(
      planPlaybackStateCommand({
        wasPlaying: false,
        isPlaying: true,
        currentFrame: 120,
        playerFrame: 100,
      }),
    ).toEqual({
      clearPreviewFrame: true,
      command: { type: 'seek_and_play', targetFrame: 120 },
    })
  })

  it('plays without seeking when the player is already at the store frame', () => {
    expect(
      planPlaybackStateCommand({
        wasPlaying: false,
        isPlaying: true,
        currentFrame: 120,
        playerFrame: 120,
      }),
    ).toEqual({
      clearPreviewFrame: true,
      command: { type: 'play' },
    })
  })

  it('pauses when playback stops', () => {
    expect(
      planPlaybackStateCommand({
        wasPlaying: true,
        isPlaying: false,
        currentFrame: 120,
        playerFrame: 120,
      }),
    ).toEqual({
      clearPreviewFrame: false,
      command: { type: 'pause' },
    })
  })
})

describe('planCurrentFrameSyncCommand', () => {
  it('acknowledges current-frame updates that come from in-sync playback', () => {
    const transition = resolvePreviewTransitionDecision({
      prev: {
        isPlaying: true,
        previewFrame: null,
        currentFrame: 100,
        isGizmoInteracting: false,
      },
      next: {
        isPlaying: true,
        previewFrame: null,
        currentFrame: 101,
        isGizmoInteracting: false,
      },
    })

    expect(
      planCurrentFrameSyncCommand({
        transition,
        currentFrame: 101,
        lastSyncedFrame: 100,
        playerFrame: 101,
      }),
    ).toEqual({
      command: { type: 'noop' },
      acknowledgedFrame: 101,
    })
  })

  it('seeks when current-frame updates represent a real external jump', () => {
    const transition = resolvePreviewTransitionDecision({
      prev: {
        isPlaying: false,
        previewFrame: null,
        currentFrame: 100,
        isGizmoInteracting: false,
      },
      next: {
        isPlaying: false,
        previewFrame: null,
        currentFrame: 140,
        isGizmoInteracting: false,
      },
    })

    expect(
      planCurrentFrameSyncCommand({
        transition,
        currentFrame: 140,
        lastSyncedFrame: 100,
        playerFrame: 100,
      }),
    ).toEqual({
      command: { type: 'seek', targetFrame: 140 },
      acknowledgedFrame: null,
    })
  })
})

describe('planPreviewFrameSyncCommand', () => {
  it('still computes a background warm seek when fast scrub overlay owns the frame', () => {
    const transition = resolvePreviewTransitionDecision({
      prev: {
        isPlaying: false,
        previewFrame: 47,
        currentFrame: 47,
        isGizmoInteracting: false,
      },
      next: {
        isPlaying: false,
        previewFrame: 48,
        currentFrame: 48,
        isGizmoInteracting: false,
      },
    })

    expect(
      planPreviewFrameSyncCommand({
        transition,
        currentFrame: 48,
        previewFrame: 48,
        currentFrameEpoch: 5,
        previewFrameEpoch: 5,
        bypassPreviewSeek: false,
        preferPlayerForStyledTextScrub: false,
        nowMs: 1000,
        backwardScrubState: {
          lastSeekAtMs: 50,
          lastSeekFrame: 40,
        },
      }),
    ).toEqual({
      command: { type: 'seek', targetFrame: 48 },
      backwardScrubState: {
        lastSeekAtMs: 0,
        lastSeekFrame: null,
      },
      useBackgroundWarmSeek: true,
    })
  })

  it('warms the exact backward scrub target when the overlay owns presentation', () => {
    const transition = resolvePreviewTransitionDecision({
      prev: {
        isPlaying: false,
        previewFrame: 100,
        currentFrame: 100,
        isGizmoInteracting: false,
      },
      next: {
        isPlaying: false,
        previewFrame: 93,
        currentFrame: 93,
        isGizmoInteracting: false,
      },
    })

    expect(
      planPreviewFrameSyncCommand({
        transition,
        currentFrame: 93,
        previewFrame: 93,
        currentFrameEpoch: 6,
        previewFrameEpoch: 6,
        bypassPreviewSeek: false,
        preferPlayerForStyledTextScrub: false,
        nowMs: 1000,
        backwardScrubState: {
          lastSeekAtMs: 980,
          lastSeekFrame: 90,
        },
      }),
    ).toEqual({
      command: { type: 'seek', targetFrame: 93 },
      backwardScrubState: {
        lastSeekAtMs: 0,
        lastSeekFrame: null,
      },
      useBackgroundWarmSeek: true,
    })
  })

  it('quantizes backward scrub seeks and updates throttle state', () => {
    const transition = resolvePreviewTransitionDecision({
      prev: {
        isPlaying: false,
        previewFrame: 100,
        currentFrame: 80,
        isGizmoInteracting: false,
      },
      next: {
        isPlaying: false,
        previewFrame: 93,
        currentFrame: 80,
        isGizmoInteracting: false,
      },
    })

    const plan = planPreviewFrameSyncCommand({
      transition,
      currentFrame: 80,
      previewFrame: 93,
      currentFrameEpoch: 1,
      previewFrameEpoch: 2,
      bypassPreviewSeek: false,
      preferPlayerForStyledTextScrub: true,
      nowMs: 1000,
      backwardScrubState: {
        lastSeekAtMs: 0,
        lastSeekFrame: null,
      },
    })

    expect(plan.command.type).toBe('seek')
    if (plan.command.type !== 'seek') {
      throw new Error('Expected seek plan')
    }
    expect(plan.command.targetFrame).toBeLessThanOrEqual(93)
    expect(plan.useBackgroundWarmSeek).toBe(false)
    expect(plan.backwardScrubState).toEqual({
      lastSeekAtMs: 1000,
      lastSeekFrame: plan.command.targetFrame,
    })
  })

  it('throttles repeated backward scrub seeks within the same quantized bucket', () => {
    const transition = resolvePreviewTransitionDecision({
      prev: {
        isPlaying: false,
        previewFrame: 93,
        currentFrame: 80,
        isGizmoInteracting: false,
      },
      next: {
        isPlaying: false,
        previewFrame: 92,
        currentFrame: 80,
        isGizmoInteracting: false,
      },
    })

    expect(
      planPreviewFrameSyncCommand({
        transition,
        currentFrame: 80,
        previewFrame: 92,
        currentFrameEpoch: 1,
        previewFrameEpoch: 2,
        bypassPreviewSeek: false,
        preferPlayerForStyledTextScrub: true,
        nowMs: 1010,
        backwardScrubState: {
          lastSeekAtMs: 1000,
          lastSeekFrame: 90,
        },
      }),
    ).toEqual({
      command: { type: 'noop' },
      backwardScrubState: {
        lastSeekAtMs: 1000,
        lastSeekFrame: 90,
      },
      useBackgroundWarmSeek: false,
    })
  })

  it('marks bypassed scrub seeks as background warm seeks', () => {
    const transition = resolvePreviewTransitionDecision({
      prev: {
        isPlaying: false,
        previewFrame: 60,
        currentFrame: 60,
        isGizmoInteracting: false,
      },
      next: {
        isPlaying: false,
        previewFrame: 72,
        currentFrame: 72,
        isGizmoInteracting: false,
      },
    })

    expect(
      planPreviewFrameSyncCommand({
        transition,
        currentFrame: 72,
        previewFrame: 72,
        currentFrameEpoch: 9,
        previewFrameEpoch: 9,
        bypassPreviewSeek: true,
        preferPlayerForStyledTextScrub: false,
        nowMs: 1400,
        backwardScrubState: {
          lastSeekAtMs: 0,
          lastSeekFrame: null,
        },
      }),
    ).toEqual({
      command: { type: 'seek', targetFrame: 72 },
      backwardScrubState: {
        lastSeekAtMs: 0,
        lastSeekFrame: null,
      },
      useBackgroundWarmSeek: true,
    })
  })
})
