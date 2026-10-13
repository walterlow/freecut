import { describe, expect, it } from 'vite-plus/test'
import type { ItemKeyframes, KeyframeRef } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import {
  buildMotionSelectionDragState,
  buildMotionSelectionFrameUpdates,
  buildMotionSelectionRetimeUpdates,
  constrainMotionSelectionDelta,
  getMotionCompositionSnapFrames,
  mergeMotionKeyframeSelection,
} from './motion-keyframe-selection'

function item(id: string, from: number, durationInFrames = 100): TimelineItem {
  return { id, from, durationInFrames } as TimelineItem
}

function scalarKeyframes(
  itemId: string,
  property: 'x' | 'opacity',
  frames: number[],
): ItemKeyframes {
  return {
    itemId,
    properties: [
      {
        property,
        keyframes: frames.map((frame, index) => ({
          id: `${itemId}-${index}`,
          frame,
          value: index,
          easing: 'linear',
        })),
      },
    ],
  }
}

describe('motion composition keyframe selection', () => {
  it('preserves other layers for additive selection while replacing the active layer slice', () => {
    const current: KeyframeRef[] = [
      { itemId: 'layer-a', property: 'x', keyframeId: 'a-1' },
      { itemId: 'layer-b', property: 'opacity', keyframeId: 'b-1' },
    ]
    const nextLocal: KeyframeRef[] = [{ itemId: 'layer-b', property: 'opacity', keyframeId: 'b-2' }]

    expect(mergeMotionKeyframeSelection(current, 'layer-b', nextLocal, true)).toEqual([
      current[0],
      nextLocal[0],
    ])
    expect(mergeMotionKeyframeSelection(current, 'layer-b', nextLocal, false)).toEqual(nextLocal)
  })

  it('moves a cross-layer selection by one collision-safe shared delta', () => {
    const keyframesByItemId = {
      'layer-a': scalarKeyframes('layer-a', 'x', [10, 20]),
      'layer-b': scalarKeyframes('layer-b', 'opacity', [95]),
    }
    const itemById = {
      'layer-a': item('layer-a', 0),
      'layer-b': item('layer-b', 30),
    }
    const selection: KeyframeRef[] = [
      { itemId: 'layer-a', property: 'x', keyframeId: 'layer-a-0' },
      { itemId: 'layer-b', property: 'opacity', keyframeId: 'layer-b-0' },
    ]

    const drag = buildMotionSelectionDragState(selection, keyframesByItemId, itemById)

    expect(drag?.spansMultipleItems).toBe(true)
    expect(constrainMotionSelectionDelta(drag!, 20)).toBe(4)
    expect(buildMotionSelectionFrameUpdates(drag!, 20).scalar).toEqual([
      { itemId: 'layer-a', property: 'x', keyframeId: 'layer-a-0', frame: 14 },
      { itemId: 'layer-b', property: 'opacity', keyframeId: 'layer-b-0', frame: 99 },
    ])
  })

  it('deduplicates the two projected axes of one vector keyframe', () => {
    const keyframesByItemId: Record<string, ItemKeyframes> = {
      layer: {
        itemId: 'layer',
        properties: [],
        vectorProperties: [
          {
            property: 'position',
            keyframes: [{ id: 'vector-1', frame: 12, value: { x: 10, y: 20 }, easing: 'linear' }],
          },
        ],
      },
    }
    const selection: KeyframeRef[] = [
      { itemId: 'layer', property: 'x', keyframeId: 'vector-1' },
      { itemId: 'layer', property: 'y', keyframeId: 'vector-1:y' },
    ]

    const drag = buildMotionSelectionDragState(selection, keyframesByItemId, {
      layer: item('layer', 50),
    })

    expect(drag?.entries).toHaveLength(1)
    expect(buildMotionSelectionFrameUpdates(drag!, 3).vector).toEqual([
      {
        itemId: 'layer',
        property: 'position',
        keyframeId: 'vector-1',
        frame: 15,
      },
    ])
  })

  it('moves coupled Anchor keys through their projected row reference', () => {
    const keyframesByItemId: Record<string, ItemKeyframes> = {
      layer: {
        itemId: 'layer',
        properties: [],
        vectorProperties: [
          {
            property: 'anchor',
            keyframes: [{ id: 'anchor-1', frame: 8, value: { x: 50, y: 60 }, easing: 'linear' }],
          },
        ],
      },
    }
    const drag = buildMotionSelectionDragState(
      [{ itemId: 'layer', property: 'anchorX', keyframeId: 'anchor-1' }],
      keyframesByItemId,
      { layer: item('layer', 0) },
    )

    expect(buildMotionSelectionFrameUpdates(drag!, 4).vector).toEqual([
      { itemId: 'layer', property: 'anchor', keyframeId: 'anchor-1', frame: 12 },
    ])
  })

  it('scales selected keyframes from either range edge without overwriting unselected keys', () => {
    const keyframesByItemId = {
      'layer-a': scalarKeyframes('layer-a', 'x', [10, 20, 30]),
      'layer-b': scalarKeyframes('layer-b', 'opacity', [0, 40]),
    }
    const itemById = {
      'layer-a': item('layer-a', 0, 80),
      'layer-b': item('layer-b', 10, 80),
    }
    const selection: KeyframeRef[] = [
      { itemId: 'layer-a', property: 'x', keyframeId: 'layer-a-0' },
      { itemId: 'layer-a', property: 'x', keyframeId: 'layer-a-2' },
      { itemId: 'layer-b', property: 'opacity', keyframeId: 'layer-b-1' },
    ]
    const drag = buildMotionSelectionDragState(selection, keyframesByItemId, itemById)!

    expect(buildMotionSelectionRetimeUpdates(drag, itemById, 'end', 30, 100).scalar).toEqual([
      { itemId: 'layer-a', property: 'x', keyframeId: 'layer-a-0', frame: 10 },
      { itemId: 'layer-a', property: 'x', keyframeId: 'layer-a-2', frame: 19 },
      { itemId: 'layer-b', property: 'opacity', keyframeId: 'layer-b-1', frame: 20 },
    ])
  })

  it('snaps to composition keyframes and layer boundaries but excludes selected keys', () => {
    const keyframesByItemId = {
      'layer-a': scalarKeyframes('layer-a', 'x', [10]),
      'layer-b': scalarKeyframes('layer-b', 'opacity', [5]),
    }
    const selection: KeyframeRef[] = [{ itemId: 'layer-a', property: 'x', keyframeId: 'layer-a-0' }]

    expect(
      getMotionCompositionSnapFrames(
        keyframesByItemId,
        {
          'layer-a': item('layer-a', 0, 40),
          'layer-b': item('layer-b', 100, 20),
        },
        selection,
      ).toSorted((left, right) => left - right),
    ).toEqual([0, 39, 100, 105, 119])
  })
})
