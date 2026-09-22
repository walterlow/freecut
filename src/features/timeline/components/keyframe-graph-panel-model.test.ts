import { describe, expect, it, vi } from 'vite-plus/test'
import type { TFunction } from 'i18next'

import type { ItemKeyframes, KeyframeClipboard, KeyframeRef } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import {
  applyKeyframeMoveEntry,
  buildKeyframePastePlan,
  buildPasteSkipReasons,
  clampFrameToBlockedRanges,
  type KeyframeMoveEntry,
  type PendingVectorMove,
} from './keyframe-graph-panel-model'

type BlockedRanges = Parameters<typeof clampFrameToBlockedRanges>[2]

const blocked = (...ranges: Array<[number, number]>): BlockedRanges =>
  ranges.map(
    ([start, end]) =>
      ({ start, end }) as BlockedRanges[number],
  )

const clip = (durationInFrames: number): TimelineItem =>
  ({ id: 'clip-1', type: 'video', durationInFrames }) as TimelineItem

const clipboard = (
  keyframes: KeyframeClipboard['keyframes'],
  sourceRefs: KeyframeRef[] = [],
): KeyframeClipboard => ({ keyframes, originFrame: 0, sourceRefs })

describe('clampFrameToBlockedRanges', () => {
  it('leaves frames outside the transition region alone', () => {
    const ranges = blocked([10, 20])

    expect(clampFrameToBlockedRanges(5, 5, ranges)).toBe(5)
    // The range end is exclusive, so the first frame after a transition is free.
    expect(clampFrameToBlockedRanges(20, 20, ranges)).toBe(20)
  })

  it('parks a frame dragged into a transition on the side it came from', () => {
    const ranges = blocked([10, 20])

    expect(clampFrameToBlockedRanges(15, 2, ranges)).toBe(9)
    expect(clampFrameToBlockedRanges(15, 25, ranges)).toBe(20)
  })

  it('snaps a keyframe already inside a transition to the nearest edge', () => {
    const ranges = blocked([10, 20])

    expect(clampFrameToBlockedRanges(12, 11, ranges)).toBe(9)
    expect(clampFrameToBlockedRanges(18, 11, ranges)).toBe(20)
  })
})

describe('buildKeyframePastePlan', () => {
  it('keeps pasted frames inside the item duration', () => {
    const plan = buildKeyframePastePlan({
      clipboard: clipboard([
        { property: 'opacity', frame: 0, value: 0.5, easing: 'linear' },
        { property: 'opacity', frame: 200, value: 0.25, easing: 'linear' },
      ]),
      item: clip(100),
      anchorFrame: 90,
      availableProperties: ['opacity'],
      blockedRanges: [],
      supportsVectors: true,
    })

    expect(plan.scalarPayloads.map((payload) => payload.frame)).toEqual([90, 99])
    expect(plan.scalarPayloads.map((payload) => payload.itemId)).toEqual(['clip-1', 'clip-1'])
    expect(plan.skippedUnsupported).toBe(0)
    expect(plan.skippedBlocked).toBe(0)
  })

  it('counts unsupported properties and transition-blocked frames as skips', () => {
    const plan = buildKeyframePastePlan({
      clipboard: clipboard([
        { property: 'rotation', frame: 0, value: 45, easing: 'linear' },
        { property: 'opacity', frame: 5, value: 0.5, easing: 'linear' },
      ]),
      item: clip(100),
      anchorFrame: 10,
      availableProperties: ['opacity'],
      blockedRanges: blocked([10, 20]),
      supportsVectors: true,
    })

    expect(plan.scalarPayloads).toEqual([])
    expect(plan.vectorPayloads).toEqual([])
    expect(plan.skippedUnsupported).toBe(1)
    expect(plan.skippedBlocked).toBe(1)
  })

  it('pastes a transform axis onto its coupled vector lane', () => {
    const plan = buildKeyframePastePlan({
      clipboard: clipboard([{ property: 'x', frame: 2, value: 42, easing: 'linear' }]),
      item: clip(100),
      anchorFrame: 10,
      availableProperties: ['x', 'y', 'width', 'height', 'opacity', 'rotation'],
      blockedRanges: [],
      supportsVectors: true,
      itemKeyframes: { itemId: 'clip-1', properties: [] },
    })

    expect(plan.vectorPayloads).toEqual([
      { property: 'x', vectorProperty: 'position', axis: 'x', frame: 12, value: 42, easing: 'linear', easingConfig: undefined },
    ])
    expect(plan.scalarPayloads).toEqual([])
  })

  it('falls back to a scalar paste when vectors are unavailable', () => {
    const plan = buildKeyframePastePlan({
      clipboard: clipboard([{ property: 'x', frame: 2, value: 42, easing: 'linear' }]),
      item: clip(100),
      anchorFrame: 10,
      availableProperties: ['x'],
      blockedRanges: [],
      supportsVectors: false,
    })

    expect(plan.vectorPayloads).toEqual([])
    expect(plan.scalarPayloads).toHaveLength(1)
    expect(plan.scalarPayloads[0]).toMatchObject({ property: 'x', frame: 12, value: 42 })
  })
})

describe('buildPasteSkipReasons', () => {
  const t = ((key: string, options?: { count?: number }) =>
    `${key}:${options?.count ?? 0}`) as TFunction

  it('reports nothing when every copied keyframe was placed', () => {
    expect(buildPasteSkipReasons(t, 0, 0)).toEqual([])
  })

  it('reports each skip reason with its count', () => {
    expect(buildPasteSkipReasons(t, 2, 3)).toEqual([
      'timeline.keyframeEditor.reasonUnsupported:2',
      'timeline.keyframeEditor.reasonBlocked:3',
    ])
  })
})

describe('applyKeyframeMoveEntry', () => {
  const itemKeyframes: ItemKeyframes = {
    itemId: 'clip-1',
    properties: [
      { property: 'opacity', keyframes: [{ id: 'op-1', frame: 2, value: 1, easing: 'linear' }] },
    ],
    vectorProperties: [
      {
        property: 'position',
        keyframes: [{ id: 'pos-1', frame: 3, value: { x: 10, y: 20 }, easing: 'linear' }],
      },
    ],
  }

  it('commits a scalar move with the frame clamped against its own start frame', () => {
    const updateKeyframe = vi.fn()
    const entry: KeyframeMoveEntry = {
      ref: { itemId: 'clip-1', property: 'opacity', keyframeId: 'op-1' },
      newFrame: 12.4,
      newValue: 0.5,
    }

    applyKeyframeMoveEntry({
      entry,
      itemKeyframes,
      selectedItemKeyframes: undefined,
      blockedRanges: blocked([10, 20]),
      storedIdByDragKey: new Map(),
      pendingMoves: new Map(),
      updateKeyframe,
    })

    expect(updateKeyframe).toHaveBeenCalledWith('clip-1', 'opacity', 'op-1', {
      frame: 9,
      value: 0.5,
    })
  })

  it('queues a vector-axis move on its stored keyframe and merges both axes', () => {
    const updateKeyframe = vi.fn()
    const pendingMoves = new Map<string, PendingVectorMove>()
    const shared = {
      itemKeyframes,
      selectedItemKeyframes: itemKeyframes,
      blockedRanges: [] as BlockedRanges,
      storedIdByDragKey: new Map<string, string>(),
      pendingMoves,
      updateKeyframe,
    }

    applyKeyframeMoveEntry({
      ...shared,
      entry: {
        ref: { itemId: 'clip-1', property: 'x', keyframeId: 'pos-1' },
        newFrame: 25,
        newValue: 55,
      },
    })
    applyKeyframeMoveEntry({
      ...shared,
      entry: {
        ref: { itemId: 'clip-1', property: 'y', keyframeId: 'pos-1:y' },
        newFrame: 25,
        newValue: 77,
      },
    })

    expect(updateKeyframe).not.toHaveBeenCalled()
    expect(pendingMoves.get('position:pos-1')).toEqual({
      property: 'position',
      keyframeId: 'pos-1',
      frame: 25,
      value: { x: 55, y: 77 },
    })
  })
})
