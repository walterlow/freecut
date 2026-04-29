import { describe, expect, it } from 'vite-plus/test'
import type { Transition } from '@/types/transition'
import type { CompositionItem, VideoItem } from '@/types/timeline'
import {
  resolveTransitionTargetForEdge,
  resolveTransitionTargetFromSelection,
} from './transition-targets'

function createVideoClip(
  id: string,
  from: number,
  durationInFrames: number,
  sourceStart = 0,
  sourceEnd = sourceStart + durationInFrames,
  sourceDuration = Math.max(120, sourceEnd + 60),
): VideoItem {
  return {
    id,
    type: 'video',
    trackId: 'track-1',
    from,
    durationInFrames,
    label: id,
    src: `${id}.mp4`,
    sourceStart,
    sourceEnd,
    sourceDuration,
  }
}

function createTransition(leftClipId: string, rightClipId: string): Transition {
  return {
    id: 'transition-1',
    type: 'crossfade',
    leftClipId,
    rightClipId,
    trackId: 'track-1',
    durationInFrames: 18,
    presentation: 'fade',
    timing: 'linear',
    alignment: 0.5,
  }
}

function createCompoundClip(
  id: string,
  from: number,
  durationInFrames: number,
  sourceStart = 0,
  sourceEnd = sourceStart + durationInFrames,
  sourceDuration = Math.max(120, sourceEnd + 60),
): CompositionItem {
  return {
    id,
    type: 'composition',
    trackId: 'track-1',
    from,
    durationInFrames,
    label: id,
    compositionId: `${id}-composition`,
    compositionWidth: 1920,
    compositionHeight: 1080,
    sourceStart,
    sourceEnd,
    sourceDuration,
  }
}

describe('transition-targets', () => {
  it('returns a valid edge target with duration clamped to available handle', () => {
    const items = [
      createVideoClip('left', 0, 60, 0, 72, 120),
      createVideoClip('right', 60, 60, 8, 68, 120),
    ]

    const target = resolveTransitionTargetForEdge({
      itemId: 'left',
      edge: 'right',
      items,
      transitions: [],
      preferredDurationInFrames: 30,
    })

    expect(target).toMatchObject({
      leftClipId: 'left',
      rightClipId: 'right',
      canApply: true,
      hasExisting: false,
      maxDurationInFrames: 17,
      suggestedDurationInFrames: 17,
    })
  })

  it('returns an invalid target when there is not enough handle at the cut', () => {
    const items = [
      createVideoClip('left', 0, 60, 0, 60, 60),
      createVideoClip('right', 60, 60, 0, 60, 60),
    ]

    const target = resolveTransitionTargetForEdge({
      itemId: 'left',
      edge: 'right',
      items,
      transitions: [],
    })

    expect(target).toMatchObject({
      leftClipId: 'left',
      rightClipId: 'right',
      canApply: false,
      hasExisting: false,
    })
    expect(target?.reason).toContain('Not enough source handle')
  })

  it('rejects drop targets when the chosen alignment cannot keep the requested duration', () => {
    const items = [
      createVideoClip('left', 0, 60, 0, 72, 84),
      createVideoClip('right', 60, 60, 30, 90, 120),
    ]

    const target = resolveTransitionTargetForEdge({
      itemId: 'left',
      edge: 'right',
      items,
      transitions: [],
      preferredDurationInFrames: 30,
      alignment: 0,
      allowDurationClamp: false,
    })

    expect(target).toMatchObject({
      leftClipId: 'left',
      rightClipId: 'right',
      canApply: false,
      hasExisting: false,
      maxDurationInFrames: 12,
      suggestedDurationInFrames: 30,
      alignment: 0,
    })
    expect(target?.reason).toContain('placement and duration')
  })

  it('allows the same cut to accept a side-aligned drop when that placement has enough handle', () => {
    const items = [
      createVideoClip('left', 0, 60, 0, 72, 84),
      createVideoClip('right', 60, 60, 30, 90, 120),
    ]

    const target = resolveTransitionTargetForEdge({
      itemId: 'left',
      edge: 'right',
      items,
      transitions: [],
      preferredDurationInFrames: 30,
      alignment: 1,
      allowDurationClamp: false,
    })

    expect(target).toMatchObject({
      leftClipId: 'left',
      rightClipId: 'right',
      canApply: true,
      hasExisting: false,
      maxDurationInFrames: 30,
      suggestedDurationInFrames: 30,
      alignment: 1,
    })
  })

  it('resolves an existing transition from single-clip selection', () => {
    const items = [
      createVideoClip('left', 0, 60, 0, 90, 120),
      createVideoClip('right', 60, 60, 15, 75, 120),
    ]

    const target = resolveTransitionTargetFromSelection({
      selectedItemIds: ['left'],
      items,
      transitions: [createTransition('left', 'right')],
    })

    expect(target).toMatchObject({
      leftClipId: 'left',
      rightClipId: 'right',
      hasExisting: true,
      existingTransitionId: 'transition-1',
      canApply: true,
      suggestedDurationInFrames: 18,
    })
  })

  it('resolves a compound clip followed by a regular clip', () => {
    const items = [
      createCompoundClip('compound', 0, 60, 0, 72, 120),
      createVideoClip('regular', 60, 60, 8, 68, 120),
    ]

    const target = resolveTransitionTargetForEdge({
      itemId: 'compound',
      edge: 'right',
      items,
      transitions: [],
      preferredDurationInFrames: 30,
    })

    expect(target).toMatchObject({
      leftClipId: 'compound',
      rightClipId: 'regular',
      canApply: true,
      hasExisting: false,
      maxDurationInFrames: 17,
      suggestedDurationInFrames: 17,
    })
  })

  it('resolves a regular clip followed by a compound clip', () => {
    const items = [
      createVideoClip('regular', 0, 60, 0, 72, 120),
      createCompoundClip('compound', 60, 60, 8, 68, 120),
    ]

    const target = resolveTransitionTargetForEdge({
      itemId: 'compound',
      edge: 'left',
      items,
      transitions: [],
      preferredDurationInFrames: 30,
    })

    expect(target).toMatchObject({
      leftClipId: 'regular',
      rightClipId: 'compound',
      canApply: true,
      hasExisting: false,
      maxDurationInFrames: 17,
      suggestedDurationInFrames: 17,
    })
  })
})
