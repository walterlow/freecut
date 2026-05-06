import { describe, expect, it } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import {
  getSlideOperationBoundsVisual,
  getSlipOperationBoundsVisual,
  getTrimOperationBoundsVisual,
} from './tool-operation-overlay-utils'

function createVideoItem(): VideoItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 100,
    durationInFrames: 60,
    label: 'clip-1',
    src: 'clip-1.mp4',
    sourceStart: 20,
    sourceEnd: 80,
    sourceDuration: 120,
    sourceFps: 30,
  }
}

describe('tool operation overlay utils', () => {
  it('moves the slip bounds box together with the slip preview delta', () => {
    const visual = getSlipOperationBoundsVisual({
      item: {
        ...createVideoItem(),
        sourceStart: 30,
        sourceEnd: 90,
      },
      fps: 30,
      frameToPixels: (frames) => frames,
      constraintEdge: null,
      constrained: false,
      currentLeftPx: 100,
      currentRightPx: 160,
    })

    expect(visual.boxLeftPx).toBe(70)
    expect(visual.boxWidthPx).toBe(120)
    expect(visual.limitEdgePositionsPx).toEqual([70, 190])
  })

  it('uses the rolling intersection span around the cut instead of the active clip span', () => {
    const left = {
      ...createVideoItem(),
      id: 'left',
      from: 100,
      durationInFrames: 60,
      sourceStart: 20,
      sourceEnd: 80,
      sourceDuration: 90,
    }
    const right = {
      ...createVideoItem(),
      id: 'right',
      from: 160,
      durationInFrames: 60,
      sourceStart: 0,
      sourceEnd: 60,
      sourceDuration: 60,
    }

    const visual = getTrimOperationBoundsVisual({
      item: left,
      items: [left, right],
      transitions: [],
      fps: 30,
      frameToPixels: (frames) => frames,
      handle: 'end',
      isRollingEdit: true,
      isRippleEdit: false,
      constrained: false,
      currentLeftPx: 100,
      currentRightPx: 160,
    })

    expect(visual.mode).toBe('rolling')
    expect(visual.boxLeftPx).toBe(160)
    expect(visual.boxWidthPx).toBe(10)
    expect(visual.limitEdgePositionsPx).toEqual([160, 170])
  })

  it('slide bounds box accounts for transition constraints', () => {
    // Setup: three clips with a transition between the left neighbor and the slid item.
    // The transition consumes source handles, limiting how far the item can slide left.
    const leftNeighbor: VideoItem = {
      ...createVideoItem(),
      id: 'left',
      from: 0,
      durationInFrames: 100,
      sourceStart: 0,
      sourceEnd: 100,
      sourceDuration: 110, // only 10 frames of right handle
    }
    const item: VideoItem = {
      ...createVideoItem(),
      id: 'center',
      from: 100,
      durationInFrames: 60,
      sourceStart: 10,
      sourceEnd: 70,
      sourceDuration: 120,
    }
    const rightNeighbor: VideoItem = {
      ...createVideoItem(),
      id: 'right',
      from: 160,
      durationInFrames: 60,
      sourceStart: 0,
      sourceEnd: 60,
      sourceDuration: 120,
    }
    const items = [leftNeighbor, item, rightNeighbor]

    // Without transitions the box should span the full neighbor-limited range
    const withoutTransitions = getSlideOperationBoundsVisual({
      item,
      items,
      transitions: [],
      fps: 30,
      frameToPixels: (f) => f,
      leftNeighbor,
      rightNeighbor,
      constraintEdge: null,
      constrained: false,
      currentLeftPx: 100,
      currentRightPx: 160,
    })

    // With a transition that consumes handles, the box should be tighter
    const transition: Transition = {
      id: 'trans-1',
      type: 'crossfade',
      presentation: 'fade',
      timing: 'linear',
      leftClipId: 'left',
      rightClipId: 'center',
      trackId: 'track-1',
      durationInFrames: 10,
      alignment: 0.5,
    }
    const withTransitions = getSlideOperationBoundsVisual({
      item,
      items,
      transitions: [transition],
      fps: 30,
      frameToPixels: (f) => f,
      leftNeighbor,
      rightNeighbor,
      constraintEdge: null,
      constrained: false,
      currentLeftPx: 100,
      currentRightPx: 160,
    })

    // The transition-constrained box should be equal or narrower than the unconstrained one
    expect(withTransitions.boxWidthPx!).toBeLessThanOrEqual(withoutTransitions.boxWidthPx!)
  })

  it('anchors ripple-start limits to the previewed right-edge span', () => {
    const item = createVideoItem()

    const visual = getTrimOperationBoundsVisual({
      item,
      items: [item],
      transitions: [],
      fps: 30,
      frameToPixels: (frames) => frames,
      handle: 'start',
      isRollingEdit: false,
      isRippleEdit: true,
      constrained: false,
      currentLeftPx: 100,
      currentRightPx: 170,
    })

    expect(visual.mode).toBe('ripple')
    expect(visual.boxLeftPx).toBe(100)
    expect(visual.boxWidthPx).toBe(80)
    expect(visual.limitEdgePositionsPx).toEqual([101, 180])
    expect(visual.edgePositionsPx).toEqual([170])
  })

  it('slide bounds box clamps to wall frames from non-adjacent clips', () => {
    const item: VideoItem = {
      ...createVideoItem(),
      id: 'center',
      from: 100,
      durationInFrames: 60,
      sourceStart: 0,
      sourceEnd: 60,
      sourceDuration: 200,
    }

    // No adjacent neighbors (null), but walls from non-adjacent clips
    const visual = getSlideOperationBoundsVisual({
      item,
      items: [item],
      transitions: [],
      fps: 30,
      frameToPixels: (f) => f,
      leftNeighbor: null,
      rightNeighbor: null,
      constraintEdge: null,
      constrained: false,
      currentLeftPx: 100,
      currentRightPx: 160,
      leftWallFrame: 50, // non-adjacent clip ends at frame 50
      rightWallFrame: 200, // non-adjacent clip starts at frame 200
    })

    // Box should be clamped: left edge at 50 (wall), right edge at 200 (wall)
    expect(visual.boxLeftPx).toBe(50)
    expect(visual.boxWidthPx).toBe(150) // 200 - 50
  })

  it('slide bounds with walls constrains both edges', () => {
    const item: VideoItem = {
      ...createVideoItem(),
      id: 'center',
      from: 100,
      durationInFrames: 60,
      sourceStart: 0,
      sourceEnd: 60,
      sourceDuration: 200,
    }

    const withWalls = getSlideOperationBoundsVisual({
      item,
      items: [item],
      transitions: [],
      fps: 30,
      frameToPixels: (f) => f,
      leftNeighbor: null,
      rightNeighbor: null,
      constraintEdge: null,
      constrained: false,
      currentLeftPx: 100,
      currentRightPx: 160,
      leftWallFrame: 80,
      rightWallFrame: 220,
    })

    // Left edge at wall (80), right edge at wall (220)
    expect(withWalls.boxLeftPx).toBe(80)
    expect(withWalls.boxWidthPx).toBe(140) // 220 - 80

    // Without walls: no constraints from neighbors → box is null (too wide)
    const withoutWalls = getSlideOperationBoundsVisual({
      item,
      items: [item],
      transitions: [],
      fps: 30,
      frameToPixels: (f) => f,
      leftNeighbor: null,
      rightNeighbor: null,
      constraintEdge: null,
      constrained: false,
      currentLeftPx: 100,
      currentRightPx: 160,
    })
    expect(withoutWalls.boxLeftPx).toBeNull()
  })

  it('slide bounds uses effectiveMinDelta/maxDelta when provided (shared range for linked A/V)', () => {
    const item: VideoItem = {
      ...createVideoItem(),
      id: 'center',
      from: 100,
      durationInFrames: 60,
      sourceStart: 0,
      sourceEnd: 60,
      sourceDuration: 200,
    }

    // With pre-computed range, neighbors/walls/transitions are ignored
    const visual = getSlideOperationBoundsVisual({
      item,
      items: [],
      transitions: [],
      fps: 30,
      frameToPixels: (f) => f,
      leftNeighbor: null,
      rightNeighbor: null,
      constraintEdge: null,
      constrained: false,
      currentLeftPx: 100,
      currentRightPx: 160,
      effectiveMinDelta: -40,
      effectiveMaxDelta: 30,
    })

    // Box left: min(100, 100 + (-40)) = 60
    // Box right: max(160, 160 + 30) = 190
    expect(visual.boxLeftPx).toBe(60)
    expect(visual.boxWidthPx).toBe(130) // 190 - 60
  })

  it('slide bounds with effectiveDeltas produces same box for primary and companion', () => {
    const primary: VideoItem = {
      ...createVideoItem(),
      id: 'primary',
      from: 100,
      durationInFrames: 60,
    }
    const companion: VideoItem = {
      ...createVideoItem(),
      id: 'companion',
      from: 100,
      durationInFrames: 60,
      speed: 1.28,
      sourceStart: 0,
      sourceEnd: 77, // 60 * 1.28 = 76.8
      sourceDuration: 200,
    }

    const sharedMin = -30
    const sharedMax = 20

    const primaryVisual = getSlideOperationBoundsVisual({
      item: primary,
      items: [],
      transitions: [],
      fps: 30,
      frameToPixels: (f) => f,
      leftNeighbor: null,
      rightNeighbor: null,
      constraintEdge: null,
      constrained: false,
      currentLeftPx: 100,
      currentRightPx: 160,
      effectiveMinDelta: sharedMin,
      effectiveMaxDelta: sharedMax,
    })

    const companionVisual = getSlideOperationBoundsVisual({
      item: companion,
      items: [],
      transitions: [],
      fps: 30,
      frameToPixels: (f) => f,
      leftNeighbor: null,
      rightNeighbor: null,
      constraintEdge: null,
      constrained: false,
      currentLeftPx: 100,
      currentRightPx: 160,
      effectiveMinDelta: sharedMin,
      effectiveMaxDelta: sharedMax,
    })

    // Both should produce the exact same box dimensions
    expect(primaryVisual.boxLeftPx).toBe(companionVisual.boxLeftPx)
    expect(primaryVisual.boxWidthPx).toBe(companionVisual.boxWidthPx)
  })
})
