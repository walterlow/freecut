// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import { useAutoKeyframeStore } from '../stores/auto-keyframe-store'
import { useTransitionsStore } from '../deps/timeline-contract'
import { getAutoKeyframeOperation, getVectorAutoKeyframeOperation } from './auto-keyframe'

const item: TimelineItem = {
  id: 'item-1',
  type: 'video',
  trackId: 'track-1',
  from: 10,
  durationInFrames: 30,
  label: 'Clip',
  src: 'clip.mp4',
}

beforeEach(() => {
  useTransitionsStore.getState().setTransitions([])
  useAutoKeyframeStore.getState().reset()
})

describe('getAutoKeyframeOperation', () => {
  it('extends an already animated property at the edited frame', () => {
    const itemKeyframes: ItemKeyframes = {
      itemId: item.id,
      properties: [
        {
          property: 'x',
          keyframes: [{ id: 'kf-1', frame: 2, value: 100, easing: 'linear' }],
        },
      ],
    }

    expect(getAutoKeyframeOperation(item, itemKeyframes, 'x', 200, 15)).toEqual({
      type: 'add',
      itemId: item.id,
      property: 'x',
      frame: 5,
      value: 200,
      easing: 'linear',
    })
  })

  it('adds a keyframe when the dopesheet auto-key toggle is enabled', () => {
    useAutoKeyframeStore.getState().setAutoKeyframeEnabled(item.id, 'x', true)

    expect(getAutoKeyframeOperation(item, undefined, 'x', 200, 15)).toEqual({
      type: 'add',
      itemId: item.id,
      property: 'x',
      frame: 5,
      value: 200,
      easing: 'linear',
    })
  })

  it('still updates an existing keyframe at the current frame when auto-key is off', () => {
    const itemKeyframes: ItemKeyframes = {
      itemId: item.id,
      properties: [
        {
          property: 'x',
          keyframes: [{ id: 'kf-1', frame: 5, value: 100, easing: 'linear' }],
        },
      ],
    }

    expect(getAutoKeyframeOperation(item, itemKeyframes, 'x', 200, 15)).toEqual({
      type: 'update',
      itemId: item.id,
      property: 'x',
      keyframeId: 'kf-1',
      updates: { value: 200 },
    })
  })

  it('does not auto-key outside the clip bounds even when enabled', () => {
    useAutoKeyframeStore.getState().setAutoKeyframeEnabled(item.id, 'x', true)

    expect(getAutoKeyframeOperation(item, undefined, 'x', 200, 9)).toBeNull()
    expect(getAutoKeyframeOperation(item, undefined, 'x', 200, 40)).toBeNull()
  })
})

describe('getVectorAutoKeyframeOperation', () => {
  it('extends an existing coupled Position lane', () => {
    const itemKeyframes: ItemKeyframes = {
      itemId: item.id,
      properties: [],
      vectorProperties: [
        {
          property: 'position',
          keyframes: [{ id: 'position-1', frame: 0, value: { x: 10, y: 20 }, easing: 'linear' }],
        },
      ],
    }

    expect(
      getVectorAutoKeyframeOperation(item, itemKeyframes, 'position', { x: 100, y: 200 }, 15),
    ).toEqual({
      type: 'vector-add',
      itemId: item.id,
      property: 'position',
      frame: 5,
      value: { x: 100, y: 200 },
      easing: 'linear',
    })
  })

  it('updates the coupled keyframe already at the edited frame', () => {
    const itemKeyframes: ItemKeyframes = {
      itemId: item.id,
      properties: [],
      vectorProperties: [
        {
          property: 'scale',
          keyframes: [{ id: 'scale-1', frame: 5, value: { x: 100, y: 100 }, easing: 'linear' }],
        },
      ],
    }

    expect(
      getVectorAutoKeyframeOperation(item, itemKeyframes, 'scale', { x: 125, y: 80 }, 15),
    ).toEqual({
      type: 'vector-update',
      itemId: item.id,
      property: 'scale',
      keyframeId: 'scale-1',
      updates: { value: { x: 125, y: 80 } },
    })
  })
})
