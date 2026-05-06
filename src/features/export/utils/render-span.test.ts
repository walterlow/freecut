import { describe, expect, it } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import type { ActiveTransition } from './canvas-transitions'
import {
  getItemRenderTimelineSpan,
  getRenderTimelineSourceStart,
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
})
