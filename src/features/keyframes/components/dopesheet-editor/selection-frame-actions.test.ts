import { describe, expect, it, vi } from 'vite-plus/test'
import type { Transition } from '@/types/transition'
import {
  buildSelectionFramePreview,
  commitSelectionFramePreview,
  duplicateSelectionFramePreview,
} from './selection-frame-actions'

describe('selection frame actions', () => {
  const keyframesByProperty = {
    x: [
      { id: 'kf-1', frame: 20, value: 100, easing: 'linear' as const },
      { id: 'kf-2', frame: 30, value: 140, easing: 'linear' as const },
    ],
    y: [{ id: 'kf-3', frame: 12, value: 200, easing: 'linear' as const }],
  }
  const [firstXKeyframe, secondXKeyframe] = keyframesByProperty.x
  const firstYKeyframe = keyframesByProperty.y[0]!
  const blockedTransition = {} as Transition

  const keyframeMetaById = new Map([
    ['kf-1', { property: 'x' as const, keyframe: firstXKeyframe! }],
    ['kf-2', { property: 'x' as const, keyframe: secondXKeyframe! }],
    ['kf-3', { property: 'y' as const, keyframe: firstYKeyframe }],
  ])

  it('builds a preview that respects frame constraints and blocked ranges', () => {
    expect(
      buildSelectionFramePreview({
        selectionIds: ['kf-1'],
        requestedDeltaFrames: 20,
        keyframeMetaById,
        isPropertyLocked: () => false,
        keyframesByProperty,
        totalFrames: 100,
        transitionBlockedRanges: [],
      }),
    ).toEqual({
      movableSelectionIds: ['kf-1'],
      previewFrames: { 'kf-1': 29 },
      appliedDeltaFrames: 9,
    })

    expect(
      buildSelectionFramePreview({
        selectionIds: ['kf-3'],
        requestedDeltaFrames: 4,
        keyframeMetaById,
        isPropertyLocked: () => false,
        keyframesByProperty,
        totalFrames: 100,
        transitionBlockedRanges: [
          { start: 15, end: 18, transition: blockedTransition, role: 'outgoing' },
        ],
      }),
    ).toEqual({
      movableSelectionIds: ['kf-3'],
      previewFrames: { 'kf-3': 14 },
      appliedDeltaFrames: 2,
    })
  })

  it('commits only movable previewed keyframes', () => {
    const onKeyframeMove = vi.fn()

    expect(
      commitSelectionFramePreview({
        selectionIds: ['kf-1', 'kf-3'],
        previewFrames: { 'kf-1': 24, 'kf-3': 15 },
        keyframeMetaById,
        isPropertyLocked: (property) => property === 'y',
        itemId: 'item-1',
        onKeyframeMove,
      }),
    ).toBe(true)

    expect(onKeyframeMove).toHaveBeenCalledTimes(1)
    expect(onKeyframeMove).toHaveBeenCalledWith(
      { itemId: 'item-1', property: 'x', keyframeId: 'kf-1' },
      24,
      100,
    )
  })

  it('duplicates only movable previewed keyframes', () => {
    const onDuplicateKeyframes = vi.fn()

    expect(
      duplicateSelectionFramePreview({
        selectionIds: ['kf-1', 'kf-3'],
        previewFrames: { 'kf-1': 24, 'kf-3': 15 },
        keyframeMetaById,
        isPropertyLocked: (property) => property === 'y',
        itemId: 'item-1',
        onDuplicateKeyframes,
      }),
    ).toBe(true)

    expect(onDuplicateKeyframes).toHaveBeenCalledWith([
      {
        ref: { itemId: 'item-1', property: 'x', keyframeId: 'kf-1' },
        frame: 24,
        value: 100,
      },
    ])
  })
})
