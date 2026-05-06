import { describe, expect, it } from 'vite-plus/test'
import {
  getPreviewRuntimeStateFromPlaybackState,
  getPreviewRuntimeSnapshot,
  getPreviewRuntimeSnapshotFromPlaybackState,
  resolvePreviewTransitionFromPlaybackStates,
  resolvePreviewTransitionDecision,
} from './preview-state-coordinator'

describe('getPreviewRuntimeStateFromPlaybackState', () => {
  it('adds interaction flags to raw playback state', () => {
    expect(
      getPreviewRuntimeStateFromPlaybackState(
        {
          isPlaying: false,
          previewFrame: 42,
          currentFrame: 10,
        },
        true,
      ),
    ).toEqual({
      isPlaying: false,
      previewFrame: 42,
      currentFrame: 10,
      isGizmoInteracting: true,
    })
  })
})

describe('getPreviewRuntimeSnapshot', () => {
  it('derives mode and anchor frame from playback state', () => {
    const snapshot = getPreviewRuntimeSnapshot({
      isPlaying: false,
      previewFrame: 42,
      currentFrame: 10,
      isGizmoInteracting: false,
    })

    expect(snapshot.mode).toBe('scrubbing')
    expect(snapshot.anchorFrame).toBe(42)
  })
})

describe('getPreviewRuntimeSnapshotFromPlaybackState', () => {
  it('derives a runtime snapshot directly from playback store state', () => {
    expect(
      getPreviewRuntimeSnapshotFromPlaybackState(
        {
          isPlaying: false,
          previewFrame: 42,
          currentFrame: 10,
        },
        false,
      ),
    ).toEqual({
      mode: 'scrubbing',
      anchorFrame: 42,
      currentFrame: 10,
      previewFrame: 42,
    })
  })
})

describe('resolvePreviewTransitionDecision', () => {
  it('can derive transitions directly from playback state', () => {
    const decision = resolvePreviewTransitionFromPlaybackStates({
      prev: {
        isPlaying: false,
        previewFrame: null,
        currentFrame: 20,
      },
      next: {
        isPlaying: false,
        previewFrame: 48,
        currentFrame: 20,
      },
      isGizmoInteracting: false,
      fps: 30,
    })

    expect(decision.enteredScrubbing).toBe(true)
    expect(decision.previewFrameChanged).toBe(true)
    expect(decision.currentFrameChanged).toBe(false)
    expect(decision.preloadBurstTrigger).toBe('scrub_enter')
  })

  it('detects scrub enter and frame change flags', () => {
    const decision = resolvePreviewTransitionDecision({
      prev: {
        isPlaying: false,
        previewFrame: null,
        currentFrame: 20,
        isGizmoInteracting: false,
      },
      next: {
        isPlaying: false,
        previewFrame: 48,
        currentFrame: 20,
        isGizmoInteracting: false,
      },
      fps: 30,
    })

    expect(decision.enteredScrubbing).toBe(true)
    expect(decision.previewFrameChanged).toBe(true)
    expect(decision.currentFrameChanged).toBe(false)
    expect(decision.preloadBurstTrigger).toBe('scrub_enter')
  })

  it('marks current-frame seek skip during active scrub updates', () => {
    const decision = resolvePreviewTransitionDecision({
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

    expect(decision.shouldSkipCurrentFrameSeek).toBe(true)
  })

  it('detects paused short-seek burst trigger', () => {
    const decision = resolvePreviewTransitionDecision({
      prev: {
        isPlaying: false,
        previewFrame: null,
        currentFrame: 100,
        isGizmoInteracting: false,
      },
      next: {
        isPlaying: false,
        previewFrame: null,
        currentFrame: 120,
        isGizmoInteracting: false,
      },
      fps: 30,
    })

    expect(decision.preloadBurstTrigger).toBe('paused_short_seek')
  })

  it('does not compute burst trigger without fps', () => {
    const decision = resolvePreviewTransitionDecision({
      prev: {
        isPlaying: false,
        previewFrame: null,
        currentFrame: 100,
        isGizmoInteracting: false,
      },
      next: {
        isPlaying: false,
        previewFrame: null,
        currentFrame: 120,
        isGizmoInteracting: false,
      },
    })

    expect(decision.preloadBurstTrigger).toBe('none')
  })
})
