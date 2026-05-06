import { describe, expect, it } from 'vite-plus/test'
import {
  isAtomicPreviewTarget,
  resolveBackwardScrubFlags,
  resolveBackwardScrubFramePlan,
  resolveRenderPumpTargetFrame,
  resolveScrubDirectionPlan,
  selectBoundaryPrewarmFrames,
  selectBoundarySourcePrewarmSources,
  type RenderPumpFrameState,
} from './render-pump-frame-plan'

function makeState(overrides: Partial<RenderPumpFrameState> = {}): RenderPumpFrameState {
  return {
    currentFrame: 100,
    currentFrameEpoch: 1,
    previewFrame: null,
    previewFrameEpoch: 0,
    ...overrides,
  }
}

describe('render pump frame plan', () => {
  it('prefers preview frame over current frame', () => {
    const target = resolveRenderPumpTargetFrame({
      state: makeState({ previewFrame: 124 }),
      forceFastScrubOverlay: false,
      isPausedInsideTransition: false,
    })

    expect(target).toBe(124)
  })

  it('uses current frame when overlay is forced', () => {
    const target = resolveRenderPumpTargetFrame({
      state: makeState(),
      forceFastScrubOverlay: true,
      isPausedInsideTransition: false,
    })

    expect(target).toBe(100)
  })

  it('detects atomic preview targets', () => {
    expect(
      isAtomicPreviewTarget(
        makeState({
          currentFrame: 88,
          currentFrameEpoch: 9,
          previewFrame: 88,
          previewFrameEpoch: 9,
        }),
      ),
    ).toBe(true)

    expect(
      isAtomicPreviewTarget(
        makeState({
          currentFrame: 88,
          currentFrameEpoch: 9,
          previewFrame: 88,
          previewFrameEpoch: 8,
        }),
      ),
    ).toBe(false)
  })

  it('tracks scrub direction and dropped preview frames', () => {
    const plan = resolveScrubDirectionPlan({
      state: makeState({ previewFrame: 110 }),
      prev: makeState({ previewFrame: 104 }),
      targetFrame: 110,
      prevTargetFrame: 104,
    })

    expect(plan).toEqual({
      direction: 1,
      scrubUpdates: 1,
      scrubDroppedFrames: 5,
    })
  })

  it('falls back to player only for non-atomic backward scrubs without forced overlay', () => {
    expect(
      resolveBackwardScrubFlags({
        scrubDirection: -1,
        forceFastScrubOverlay: false,
        isAtomicScrubTarget: false,
        preserveHighFidelityBackwardPreview: false,
      }),
    ).toEqual({
      suppressBackgroundPrewarm: true,
      fallbackToPlayer: true,
    })

    expect(
      resolveBackwardScrubFlags({
        scrubDirection: -1,
        forceFastScrubOverlay: true,
        isAtomicScrubTarget: false,
        preserveHighFidelityBackwardPreview: false,
      }).fallbackToPlayer,
    ).toBe(false)
  })

  it('quantizes and throttles backward scrub renders', () => {
    const firstPlan = resolveBackwardScrubFramePlan({
      targetFrame: 119,
      scrubDirection: -1,
      isAtomicScrubTarget: false,
      preserveHighFidelityBackwardPreview: false,
      nowMs: 100,
      lastBackwardScrubRenderAt: 0,
      lastBackwardRequestedFrame: null,
    })

    expect(firstPlan).toEqual({
      requestedFrame: 118,
      throttleRequest: false,
      nextLastBackwardScrubRenderAt: 100,
      nextLastBackwardRequestedFrame: 118,
    })

    const throttledPlan = resolveBackwardScrubFramePlan({
      targetFrame: 117,
      scrubDirection: -1,
      isAtomicScrubTarget: false,
      preserveHighFidelityBackwardPreview: false,
      nowMs: 110,
      lastBackwardScrubRenderAt: 100,
      lastBackwardRequestedFrame: 118,
    })

    expect(throttledPlan.throttleRequest).toBe(true)
    expect(throttledPlan.requestedFrame).toBe(116)
  })

  it('keeps full-fidelity backward targets when preservation is required', () => {
    expect(
      resolveBackwardScrubFramePlan({
        targetFrame: 117,
        scrubDirection: -1,
        isAtomicScrubTarget: false,
        preserveHighFidelityBackwardPreview: true,
        nowMs: 110,
        lastBackwardScrubRenderAt: 100,
        lastBackwardRequestedFrame: 118,
      }),
    ).toEqual({
      requestedFrame: 117,
      throttleRequest: false,
      nextLastBackwardScrubRenderAt: 0,
      nextLastBackwardRequestedFrame: null,
    })
  })

  it('selects nearby boundary frames with direction bias', () => {
    const frames = selectBoundaryPrewarmFrames({
      boundaryFrames: [70, 95, 101, 108, 130],
      targetFrame: 100,
      direction: 1,
      fps: 30,
    })

    expect(frames).toEqual([100, 101, 102, 107, 108, 109])
  })

  it('selects nearby boundary sources and caps total sources', () => {
    const sources = selectBoundarySourcePrewarmSources({
      boundarySources: [
        { frame: 92, srcs: ['a', 'b', 'c'] },
        { frame: 101, srcs: ['d', 'e', 'f'] },
        { frame: 104, srcs: ['g', 'h', 'i'] },
      ],
      targetFrame: 100,
      direction: 1,
      fps: 30,
    })

    expect(sources).toEqual(['d', 'e', 'f', 'g', 'h', 'i'])
  })
})
