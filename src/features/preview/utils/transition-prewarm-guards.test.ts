import { describe, expect, it } from 'vite-plus/test'
import {
  resolveTransitionPrerenderPlan,
  selectUpcomingTransitionStartFrame,
  shouldUsePausedTransitionOverlay,
} from './transition-prewarm-guards'

describe('selectUpcomingTransitionStartFrame', () => {
  const windows = [{ startFrame: 100 }, { startFrame: 180 }, { startFrame: 260 }]

  it('selects the first transition at or after the current frame within lookahead', () => {
    expect(
      selectUpcomingTransitionStartFrame({
        frame: 90,
        maxLookaheadFrames: 20,
        windows,
      }),
    ).toBe(100)
  })

  it('includes a transition that starts on the current frame', () => {
    expect(
      selectUpcomingTransitionStartFrame({
        frame: 100,
        maxLookaheadFrames: 0,
        windows,
      }),
    ).toBe(100)
  })

  it('ignores transitions that already started before the current frame', () => {
    expect(
      selectUpcomingTransitionStartFrame({
        frame: 101,
        maxLookaheadFrames: 100,
        windows,
      }),
    ).toBe(180)
  })

  it('returns null when the next transition is beyond the lookahead', () => {
    expect(
      selectUpcomingTransitionStartFrame({
        frame: 50,
        maxLookaheadFrames: 20,
        windows,
      }),
    ).toBeNull()
  })

  it('can restrict selection to complex transition starts', () => {
    expect(
      selectUpcomingTransitionStartFrame({
        frame: 90,
        maxLookaheadFrames: 120,
        windows,
        complexStartFrames: new Set([180]),
        complexOnly: true,
      }),
    ).toBe(180)
  })
})

describe('shouldUsePausedTransitionOverlay', () => {
  it('enables paused transition overlay only without playback, preview frame, or forced fast overlay', () => {
    expect(
      shouldUsePausedTransitionOverlay({
        isPlaying: false,
        previewFrame: null,
        forceFastScrubOverlay: false,
        hasActiveTransition: true,
      }),
    ).toBe(true)
  })

  it('disables paused transition overlay for each existing guard condition', () => {
    expect(
      shouldUsePausedTransitionOverlay({
        isPlaying: true,
        previewFrame: null,
        forceFastScrubOverlay: false,
        hasActiveTransition: true,
      }),
    ).toBe(false)
    expect(
      shouldUsePausedTransitionOverlay({
        isPlaying: false,
        previewFrame: 10,
        forceFastScrubOverlay: false,
        hasActiveTransition: true,
      }),
    ).toBe(false)
    expect(
      shouldUsePausedTransitionOverlay({
        isPlaying: false,
        previewFrame: null,
        forceFastScrubOverlay: true,
        hasActiveTransition: true,
      }),
    ).toBe(false)
    expect(
      shouldUsePausedTransitionOverlay({
        isPlaying: false,
        previewFrame: null,
        forceFastScrubOverlay: false,
        hasActiveTransition: false,
      }),
    ).toBe(false)
  })
})

describe('resolveTransitionPrerenderPlan', () => {
  it('renders and caches the target frame for forced fast overlay', () => {
    expect(
      resolveTransitionPrerenderPlan({
        targetFrame: 100,
        runwayFrames: 4,
        forceFastScrubOverlay: true,
        isComplexTransitionStart: false,
        isPlaying: false,
      }),
    ).toEqual({
      targetFrame: { action: 'render-and-cache', frame: 100 },
      runwayFrames: [
        { action: 'render-and-cache', frame: 101 },
        { action: 'render-and-cache', frame: 102 },
        { action: 'render-and-cache', frame: 103 },
      ],
      renderTargetAfterRunway: false,
    })
  })

  it('prewarms forced-overlay runway frames for complex transition starts', () => {
    expect(
      resolveTransitionPrerenderPlan({
        targetFrame: 100,
        runwayFrames: 3,
        forceFastScrubOverlay: true,
        isComplexTransitionStart: true,
        isPlaying: false,
      }),
    ).toEqual({
      targetFrame: { action: 'render-and-cache', frame: 100 },
      runwayFrames: [
        { action: 'prewarm', frame: 101 },
        { action: 'prewarm', frame: 102 },
      ],
      renderTargetAfterRunway: false,
    })
  })

  it('prewarms runway before rendering a complex target when not forced or playing', () => {
    expect(
      resolveTransitionPrerenderPlan({
        targetFrame: 100,
        runwayFrames: 3,
        forceFastScrubOverlay: false,
        isComplexTransitionStart: true,
        isPlaying: false,
      }),
    ).toEqual({
      targetFrame: { action: 'render-and-cache', frame: 100 },
      runwayFrames: [
        { action: 'prewarm', frame: 101 },
        { action: 'prewarm', frame: 102 },
      ],
      renderTargetAfterRunway: false,
    })
  })

  it('caches playback runway frames and renders the target before runway', () => {
    expect(
      resolveTransitionPrerenderPlan({
        targetFrame: 100,
        runwayFrames: 3,
        forceFastScrubOverlay: false,
        isComplexTransitionStart: false,
        isPlaying: true,
      }),
    ).toEqual({
      targetFrame: { action: 'render-and-cache', frame: 100 },
      runwayFrames: [
        { action: 'render-and-cache', frame: 101 },
        { action: 'render-and-cache', frame: 102 },
      ],
      renderTargetAfterRunway: false,
    })
  })

  it('prewarms runway and delays non-complex target render without forced overlay', () => {
    expect(
      resolveTransitionPrerenderPlan({
        targetFrame: 100,
        runwayFrames: 2,
        forceFastScrubOverlay: false,
        isComplexTransitionStart: false,
        isPlaying: false,
      }),
    ).toEqual({
      targetFrame: { action: 'render-and-cache', frame: 100 },
      runwayFrames: [{ action: 'prewarm', frame: 101 }],
      renderTargetAfterRunway: true,
    })
  })
})
