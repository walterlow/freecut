import { describe, expect, it } from 'vite-plus/test'
import {
  getVideoSyncTargetContext,
  planLayoutVideoSync,
  planPausedVideoFrameSync,
  planPlayingVideoDriftCorrection,
  planPlayingVideoInitialSync,
  planPremountedVideoSync,
  planVideoFrameCallbackCorrection,
  shouldReactOwnPlaybackRate,
} from './video-sync-plan'

describe('shouldReactOwnPlaybackRate', () => {
  it('lets RVFC own playback rate during active playback', () => {
    expect(
      shouldReactOwnPlaybackRate({
        isPlaying: true,
        supportsRequestVideoFrameCallback: true,
        sharedTransitionSync: false,
      }),
    ).toBe(false)
  })

  it('keeps React in control when playback is paused', () => {
    expect(
      shouldReactOwnPlaybackRate({
        isPlaying: false,
        supportsRequestVideoFrameCallback: true,
        sharedTransitionSync: false,
      }),
    ).toBe(true)
  })

  it('lets RVFC own playback rate during shared transition sync with RVFC support', () => {
    expect(
      shouldReactOwnPlaybackRate({
        isPlaying: true,
        supportsRequestVideoFrameCallback: true,
        sharedTransitionSync: true,
      }),
    ).toBe(false)
  })

  it('keeps React in control during shared transition sync without RVFC', () => {
    expect(
      shouldReactOwnPlaybackRate({
        isPlaying: true,
        supportsRequestVideoFrameCallback: false,
        sharedTransitionSync: false,
      }),
    ).toBe(true)
  })
})

describe('getVideoSyncTargetContext', () => {
  it('derives premount target times from trim start', () => {
    expect(
      getVideoSyncTargetContext({
        frame: 10,
        sequenceFrameOffset: 20,
        safeTrimBefore: 90,
        sourceFps: 30,
        targetTime: 5,
        readyState: 4,
        videoDuration: 12,
        currentTime: 0,
      }),
    ).toMatchObject({
      relativeFrame: -10,
      isPremounted: true,
      canSeek: true,
      effectiveTargetTime: 3,
      clampedTargetTime: 3,
    })
  })
})

describe('planPremountedVideoSync', () => {
  it('keeps transition-held videos untouched during premount', () => {
    expect(
      planPremountedVideoSync({
        isTransitionHeld: true,
        canSeek: true,
        currentTime: 0,
        targetTime: 2,
        seekToleranceSeconds: 0.016,
      }),
    ).toEqual({
      shouldPause: false,
      seekTo: null,
    })
  })
})

describe('planLayoutVideoSync', () => {
  it('forces a hard sync on the first ready layout pass', () => {
    expect(
      planLayoutVideoSync({
        isPremounted: false,
        isTransitionHeld: false,
        canSeek: true,
        currentTime: 1,
        targetTime: 2,
        isPlaying: true,
        needsInitialSync: true,
      }),
    ).toEqual({
      shouldPause: false,
      seekTo: 2,
      shouldMarkInitialSyncComplete: true,
    })
  })
})

describe('planPlayingVideoInitialSync', () => {
  it('marks initial sync complete even when the video is already in place', () => {
    expect(
      planPlayingVideoInitialSync({
        needsInitialSync: true,
        canSeek: true,
        currentTime: 2,
        targetTime: 2,
      }),
    ).toEqual({
      seekTo: null,
      shouldMarkInitialSyncComplete: true,
      shouldUpdateLastSyncTime: true,
    })
  })
})

describe('planPlayingVideoDriftCorrection', () => {
  it('seeks when the playing video drifts too far behind for too long', () => {
    expect(
      planPlayingVideoDriftCorrection({
        canSeek: true,
        currentTime: 1,
        targetTime: 1.3,
        lastSyncTimeMs: 0,
        nowMs: 100,
      }),
    ).toEqual({
      shouldPause: false,
      seekTo: 1.3,
    })
  })
})

describe('planPausedVideoFrameSync', () => {
  it('seeks paused video only when the frame changed and drift is meaningful', () => {
    expect(
      planPausedVideoFrameSync({
        frameChanged: true,
        canSeek: true,
        currentTime: 1,
        targetTime: 1.1,
      }),
    ).toEqual({
      shouldPause: false,
      seekTo: 1.1,
    })
  })
})

describe('planVideoFrameCallbackCorrection', () => {
  it('hard seeks for large drift', () => {
    expect(
      planVideoFrameCallbackCorrection({
        currentTime: 1.5,
        targetTime: 1,
        nominalRate: 1,
        readyState: 4,
      }),
    ).toEqual({
      kind: 'seek',
      seekTo: 1,
      playbackRate: 1,
      shouldUpdateLastSyncTime: true,
    })
  })

  it('adjusts playback rate for small drift', () => {
    const plan = planVideoFrameCallbackCorrection({
      currentTime: 1.05,
      targetTime: 1,
      nominalRate: 1,
      readyState: 4,
    })

    expect(plan.kind).toBe('adjust_rate')
    if (plan.kind !== 'adjust_rate') {
      throw new Error('Expected rate adjustment plan')
    }
    expect(plan.playbackRate).toBeLessThan(1)
  })

  it('returns nominal_rate when drift is negligible', () => {
    const plan = planVideoFrameCallbackCorrection({
      currentTime: 1.008,
      targetTime: 1,
      nominalRate: 1,
      readyState: 4,
    })

    expect(plan.kind).toBe('nominal_rate')
    if (plan.kind !== 'nominal_rate') {
      throw new Error('Expected nominal_rate plan')
    }
    expect(plan.playbackRate).toBe(1)
  })
})
