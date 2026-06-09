import { describe, expect, it } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import type { ActiveTransition } from './canvas-transitions'
import {
  getItemRenderTimelineSpan,
  getRenderTimelineSourceStart,
  getSourceFrameRampOffset,
  isAAContinuousSplit,
  resolveAATransitionRamps,
  resolveTransitionRenderTimelineSpan,
} from './render-span'

function createVideoItem(overrides?: Partial<VideoItem>): VideoItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 60,
    durationInFrames: 40,
    label: 'Clip',
    src: 'clip.mp4',
    ...overrides,
  }
}

function createActiveTransition(overrides?: Partial<ActiveTransition>): ActiveTransition {
  return {
    transition: {
      id: 'transition-1',
      type: 'crossfade',
      presentation: 'iris',
      timing: 'linear',
      leftClipId: 'left',
      rightClipId: 'right',
      trackId: 'track-1',
      durationInFrames: 20,
    },
    leftClip: createVideoItem({ id: 'left', from: 0, durationInFrames: 60 }),
    rightClip: createVideoItem({ id: 'right', from: 60, durationInFrames: 60 }),
    progress: 0,
    transitionStart: 50,
    transitionEnd: 70,
    durationInFrames: 20,
    leftPortion: 10,
    rightPortion: 10,
    cutPoint: 60,
    ...overrides,
  } as ActiveTransition
}

describe('render-span', () => {
  it('falls back to legacy offset when deriving source start', () => {
    const clip = createVideoItem({ offset: 18 })

    expect(getItemRenderTimelineSpan(clip)).toEqual({
      from: 60,
      durationInFrames: 40,
      sourceStart: 18,
    })
    expect(getRenderTimelineSourceStart(clip)).toBe(18)
  })

  it('uses legacy offset when resolving transition preroll source anchoring', () => {
    const clip = createVideoItem({ id: 'right', offset: 18 })
    const transition = createActiveTransition({ rightClip: clip })

    expect(resolveTransitionRenderTimelineSpan(clip, transition, 30)).toEqual({
      from: 50,
      durationInFrames: 50,
      sourceStart: 8,
    })
  })

  describe('A-A continuous-split ramps', () => {
    // Continuous split at frame 60 of an originally-single clip with mediaId
    // 'm1'. Source frames 0..60 went to left, 60..120 to right. Centered
    // 20-frame transition spans timeline [50, 70].
    function makeSplitPair() {
      const left = createVideoItem({
        id: 'left',
        mediaId: 'm1',
        from: 0,
        durationInFrames: 60,
        sourceStart: 0,
      })
      const right = createVideoItem({
        id: 'right',
        mediaId: 'm1',
        from: 60,
        durationInFrames: 60,
        sourceStart: 60,
      })
      return { left, right }
    }

    function makeAARampContext() {
      const { left, right } = makeSplitPair()
      const transition = createActiveTransition({
        leftClip: left,
        rightClip: right,
        transitionStart: 50,
        transitionEnd: 70,
        cutPoint: 60,
      })
      const ramps = resolveAATransitionRamps(left, right, transition, 30)
      if (!ramps) {
        throw new Error('Expected continuous A-A split ramps')
      }
      return { left, right, transition, ramps }
    }

    it('detects continuous A-A split via shared media and source continuity', () => {
      const { left, right } = makeSplitPair()
      expect(isAAContinuousSplit(left, right, 30)).toBe(true)
    })

    it('rejects pairs with different media', () => {
      const { left, right } = makeSplitPair()
      expect(isAAContinuousSplit(left, { ...right, mediaId: 'm2' }, 30)).toBe(false)
    })

    it('rejects pairs with a source-time gap (post-trim)', () => {
      const { left, right } = makeSplitPair()
      expect(isAAContinuousSplit(left, { ...right, sourceStart: 75 }, 30)).toBe(false)
    })

    it('rejects reversed clips (ramp formula assumes forward playback)', () => {
      const { left, right } = makeSplitPair()
      expect(isAAContinuousSplit({ ...left, isReversed: true }, right, 30)).toBe(false)
    })

    it('emits symmetric anchored ramps for A-A splits', () => {
      const { ramps } = makeAARampContext()
      expect(ramps.left).toEqual({ anchor: 'start', slope: 0.5, rampStart: 50, rampEnd: 70 })
      expect(ramps.right).toEqual({ anchor: 'end', slope: 0.5, rampStart: 50, rampEnd: 70 })
    })

    it('returns null for non-A-A pairs', () => {
      const { left, right } = makeSplitPair()
      const transition = createActiveTransition({ leftClip: left, rightClip: right })
      expect(resolveAATransitionRamps(left, { ...right, mediaId: 'm2' }, transition, 30)).toBeNull()
    })

    it('threads ramp through into the render span', () => {
      const { left, right, transition, ramps } = makeAARampContext()
      const leftSpan = resolveTransitionRenderTimelineSpan(left, transition, 30, ramps.left)
      const rightSpan = resolveTransitionRenderTimelineSpan(right, transition, 30, ramps.right)
      expect(leftSpan.sourceTimeRamp).toEqual(ramps.left)
      expect(rightSpan.sourceTimeRamp).toEqual(ramps.right)
    })

    it('ramp offset is zero at the anchor boundary (no jump where clip continues)', () => {
      const { ramps } = makeAARampContext()
      // Left exists naturally for F<50, so anchor='start' (frame=50 → offset 0).
      expect(getSourceFrameRampOffset(ramps.left, 50)).toBe(0)
      // Right exists naturally for F>70, so anchor='end' (frame=70 → offset 0).
      expect(getSourceFrameRampOffset(ramps.right, 70)).toBe(0)
    })

    it('ramp offset is also zero outside the window (no effect on adjacent frames)', () => {
      const { ramps } = makeAARampContext()
      expect(getSourceFrameRampOffset(ramps.left, 49)).toBe(0)
      expect(getSourceFrameRampOffset(ramps.left, 71)).toBe(0)
      expect(getSourceFrameRampOffset(ramps.right, 49)).toBe(0)
      expect(getSourceFrameRampOffset(ramps.right, 71)).toBe(0)
    })

    it('midpoint separates left/right rendered source by half the window duration', () => {
      const { ramps } = makeAARampContext()
      // At midpoint F=60 with slope=0.5: left offset = +5, right offset = -5.
      // Combined difference = 10 source frames = windowDuration / 2.
      expect(getSourceFrameRampOffset(ramps.left, 60)).toBe(5)
      expect(getSourceFrameRampOffset(ramps.right, 60)).toBe(-5)
    })

    it('non-anchor boundary offset equals half window duration (max separation)', () => {
      const { ramps } = makeAARampContext()
      expect(getSourceFrameRampOffset(ramps.left, 70)).toBe(10)
      expect(getSourceFrameRampOffset(ramps.right, 50)).toBe(-10)
    })
  })
})
