// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { makeTimelineAudioItem, makeTimelineTrack, makeTimelineVideoItem } from '../../test-helpers'
import { useItemsStore } from '../items-store'
import { useKeyframesStore } from '../keyframes-store'
import { useTransitionsStore } from '../transitions-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import {
  applyBentoLayout,
  commitMaskEdit,
  resetItemTransform,
  updateItemTransform,
  updateItemsTransform,
  updateItemsTransformMap,
} from './transform-actions'
import { createNullParentForItems, setTransformParent, setTransformParents } from './item-actions'
import { setDirectPropertyLink } from './keyframe-actions'

function makeClip(id: string, overrides: Record<string, unknown> = {}) {
  return makeTimelineVideoItem({ id, transform: {}, ...overrides })
}

function getTransform(id: string) {
  const item = useItemsStore.getState().itemById[id]
  expect(item).toBeDefined()
  return (item as { transform?: Record<string, number> }).transform ?? {}
}

describe('transform actions', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useItemsStore
      .getState()
      .setTracks([makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 })])
    useItemsStore.getState().setItems([makeClip('a'), makeClip('b', { from: 60 })])
    useTransitionsStore.getState().setTransitions([])
    useKeyframesStore.getState().setKeyframes([])
  })

  describe('updateItemTransform', () => {
    it('merges partial transforms into the existing transform', () => {
      updateItemTransform('a', { x: 10, y: -5 })
      updateItemTransform('a', { opacity: 0.5 })

      expect(getTransform('a')).toMatchObject({ x: 10, y: -5, opacity: 0.5 })
      expect(useTimelineSettingsStore.getState().isDirty).toBe(true)
    })

    it('undo restores the previous transform', () => {
      updateItemTransform('a', { x: 10 })
      updateItemTransform('a', { x: 25 })

      useTimelineCommandStore.getState().undo()
      expect(getTransform('a').x).toBe(10)
    })

    it('does not invalidate items for an empty transform commit', () => {
      const itemsBefore = useItemsStore.getState().items
      const undoDepth = useTimelineCommandStore.getState().undoStack.length

      updateItemTransform('a', {})

      expect(useItemsStore.getState().items).toBe(itemsBefore)
      expect(useTimelineCommandStore.getState().undoStack).toHaveLength(undoDepth)
    })

    it('keeps the items reference stable for a keyframe-only transform commit', () => {
      const itemsBefore = useItemsStore.getState().items

      updateItemTransform(
        'a',
        {},
        {
          autoKeyframeOperations: [
            {
              type: 'vector-add',
              itemId: 'a',
              property: 'position',
              frame: 10,
              value: { x: 40, y: 50 },
              easing: 'linear',
            },
          ],
        },
      )

      expect(useItemsStore.getState().items).toBe(itemsBefore)
      expect(
        useKeyframesStore.getState().getKeyframesForItem('a')?.vectorProperties?.[0]?.keyframes[0]
          ?.value,
      ).toEqual({ x: 40, y: 50 })
    })

    it('commits coupled gizmo keyframes and base changes in one undo step', () => {
      const undoDepth = useTimelineCommandStore.getState().undoStack.length

      updateItemTransform(
        'a',
        { rotation: 12 },
        {
          operation: 'transform',
          autoKeyframeOperations: [
            {
              type: 'vector-add',
              itemId: 'a',
              property: 'position',
              frame: 10,
              value: { x: 40, y: 50 },
              easing: 'linear',
            },
          ],
        },
      )

      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth + 1)
      expect(
        useKeyframesStore.getState().getKeyframesForItem('a')?.vectorProperties?.[0]?.keyframes[0]
          ?.value,
      ).toEqual({ x: 40, y: 50 })
      expect(getTransform('a').rotation).toBe(12)

      useTimelineCommandStore.getState().undo()
      expect(useKeyframesStore.getState().getKeyframesForItem('a')).toBeUndefined()
      expect(getTransform('a').rotation).toBeUndefined()
    })
  })

  describe('multi-item transforms', () => {
    it('updateItemsTransform applies one transform to several items', () => {
      updateItemsTransform(['a', 'b'], { rotation: 45 })

      expect(getTransform('a').rotation).toBe(45)
      expect(getTransform('b').rotation).toBe(45)
    })

    it('updateItemsTransformMap applies per-item transforms in one undo entry', () => {
      const undoDepth = useTimelineCommandStore.getState().undoStack.length

      updateItemsTransformMap(
        new Map([
          ['a', { x: 1 }],
          ['b', { x: 2 }],
        ]),
      )

      expect(getTransform('a').x).toBe(1)
      expect(getTransform('b').x).toBe(2)
      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth + 1)
    })

    it('commits accompanying item properties in the same undo entry', () => {
      const undoDepth = useTimelineCommandStore.getState().undoStack.length
      let itemStorePublishes = 0
      const unsubscribe = useItemsStore.subscribe(() => {
        itemStorePublishes += 1
      })

      updateItemsTransformMap(new Map([['a', { width: 640, height: 360 }]]), {
        operation: 'resize',
        itemUpdates: new Map([['a', { label: 'Scaled title' }]]),
      })
      unsubscribe()

      expect(getTransform('a')).toMatchObject({ width: 640, height: 360 })
      expect(useItemsStore.getState().itemById.a?.label).toBe('Scaled title')
      expect(itemStorePublishes).toBe(1)
      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth + 1)

      useTimelineCommandStore.getState().undo()
      expect(getTransform('a').width).toBeUndefined()
      expect(useItemsStore.getState().itemById.a?.label).not.toBe('Scaled title')
    })

    it('does not create history or invalidate items for an empty transform map', () => {
      const itemsBefore = useItemsStore.getState().items
      const undoDepth = useTimelineCommandStore.getState().undoStack.length

      updateItemsTransformMap(new Map())

      expect(useItemsStore.getState().items).toBe(itemsBefore)
      expect(useTimelineCommandStore.getState().undoStack).toHaveLength(undoDepth)
    })
  })

  describe('resetItemTransform', () => {
    it('zeroes position and rotation', () => {
      updateItemTransform('a', { x: 10, y: 20, rotation: 90 })

      resetItemTransform('a')

      const transform = getTransform('a')
      expect(transform.x).toBe(0)
      expect(transform.y).toBe(0)
      expect(transform.rotation).toBe(0)
    })
  })

  describe('setTransformParent', () => {
    const canvas = { width: 1920, height: 1080, fps: 30 }

    beforeEach(() => {
      useItemsStore
        .getState()
        .setItems([
          makeClip('a', { transform: { x: 10, y: 0, width: 20, height: 20 } }),
          makeClip('b', { transform: { x: 0, y: 0, width: 100, height: 100 } }),
          makeClip('c', { transform: { x: 30, y: 5, width: 40, height: 40 } }),
        ])
    })

    it('attaches in one undo step and preserves the current pose', () => {
      const undoDepth = useTimelineCommandStore.getState().undoStack.length
      expect(setTransformParent({ childItemId: 'a', parentItemId: 'b', frame: 0, canvas })).toBe(
        true,
      )

      const child = useItemsStore.getState().itemById['a']!
      expect(child.transformParent?.parentItemId).toBe('b')
      expect(child.transformParent?.childWorldReference.x).toBe(10)
      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth + 1)

      useTimelineCommandStore.getState().undo()
      expect(useItemsStore.getState().itemById['a']?.transformParent).toBeUndefined()
    })

    it('detaches into a stable basis and blocks hierarchy cycles', () => {
      setTransformParent({ childItemId: 'a', parentItemId: 'b', frame: 0, canvas })
      updateItemTransform('b', { x: 50 })
      expect(setTransformParent({ childItemId: 'a', frame: 0, canvas })).toBe(true)
      const detached = useItemsStore.getState().itemById['a']!
      expect(detached.transformParent?.parentItemId).toBeUndefined()
      expect(detached.transformParent?.childWorldReference.x).toBeCloseTo(60)

      setTransformParent({ childItemId: 'a', parentItemId: 'b', frame: 0, canvas })
      expect(setTransformParent({ childItemId: 'b', parentItemId: 'a', frame: 0, canvas })).toBe(
        false,
      )
      expect(useItemsStore.getState().itemById['b']?.transformParent).toBeUndefined()
    })

    it('blocks transform-parent cycles that pass through property links', () => {
      setDirectPropertyLink('b', {
        type: 'link',
        targetProperty: 'position',
        sourceItemId: 'a',
        sourceProperty: 'position',
        enabled: true,
        timeOffsetFrames: 0,
      })

      expect(setTransformParent({ childItemId: 'a', parentItemId: 'b', frame: 0, canvas })).toBe(
        false,
      )
      expect(useItemsStore.getState().itemById['a']?.transformParent).toBeUndefined()
    })

    it('blocks property-link cycles that pass through transform parents', () => {
      expect(setTransformParent({ childItemId: 'a', parentItemId: 'b', frame: 0, canvas })).toBe(
        true,
      )

      setDirectPropertyLink('b', {
        type: 'link',
        targetProperty: 'position',
        sourceItemId: 'a',
        sourceProperty: 'position',
        enabled: true,
        timeOffsetFrames: 0,
      })

      expect(useKeyframesStore.getState().keyframesByItemId['b']?.propertyLinks).toBeUndefined()
    })

    it('blocks parenting when the child already links transform channels to that parent', () => {
      setDirectPropertyLink('a', {
        type: 'link',
        targetProperty: 'position',
        sourceItemId: 'b',
        sourceProperty: 'position',
        enabled: true,
        timeOffsetFrames: 0,
      })

      expect(setTransformParent({ childItemId: 'a', parentItemId: 'b', frame: 0, canvas })).toBe(
        false,
      )
      expect(useItemsStore.getState().itemById['a']?.transformParent).toBeUndefined()
    })

    it('blocks a redundant transform link to an existing parent', () => {
      expect(setTransformParent({ childItemId: 'a', parentItemId: 'b', frame: 0, canvas })).toBe(
        true,
      )

      setDirectPropertyLink('a', {
        type: 'link',
        targetProperty: 'position',
        sourceItemId: 'b',
        sourceProperty: 'position',
        enabled: true,
        timeOffsetFrames: 0,
      })

      expect(useKeyframesStore.getState().keyframesByItemId['a']?.propertyLinks).toBeUndefined()
    })

    it('allows non-inherited property links to an existing parent', () => {
      expect(setTransformParent({ childItemId: 'a', parentItemId: 'b', frame: 0, canvas })).toBe(
        true,
      )

      setDirectPropertyLink('a', {
        type: 'link',
        targetProperty: 'opacity',
        sourceItemId: 'b',
        sourceProperty: 'opacity',
        enabled: true,
        timeOffsetFrames: 0,
      })

      expect(useKeyframesStore.getState().keyframesByItemId['a']?.propertyLinks).toEqual([
        expect.objectContaining({ targetProperty: 'opacity', sourceItemId: 'b' }),
      ])
    })

    it('snaps to the parent position when explicitly requested', () => {
      updateItemTransform('b', { x: 80, y: -40 })

      expect(
        setTransformParent({
          childItemId: 'a',
          parentItemId: 'b',
          behavior: 'snap-to-parent',
          frame: 0,
          canvas,
        }),
      ).toBe(true)

      expect(useItemsStore.getState().itemById['a']?.transformParent).toMatchObject({
        parentItemId: 'b',
        childWorldReference: { x: 80, y: -40, width: 20, height: 20 },
      })
    })

    it('can detach without compensation and restore the authored local pose', () => {
      setTransformParent({ childItemId: 'a', parentItemId: 'b', frame: 0, canvas })
      updateItemTransform('b', { x: 50 })

      expect(
        setTransformParent({
          childItemId: 'a',
          behavior: 'restore-local',
          frame: 0,
          canvas,
        }),
      ).toBe(true)

      expect(useItemsStore.getState().itemById['a']?.transformParent).toBeUndefined()
      expect(getTransform('a')).toMatchObject({ x: 10, y: 0, width: 20, height: 20 })
    })

    it('parents several layers atomically with one undo entry', () => {
      const undoDepth = useTimelineCommandStore.getState().undoStack.length

      expect(
        setTransformParents({
          childItemIds: ['a', 'c'],
          parentItemId: 'b',
          frame: 0,
          canvas,
        }),
      ).toBe(true)

      expect(useItemsStore.getState().itemById['a']?.transformParent).toMatchObject({
        parentItemId: 'b',
        childWorldReference: { x: 10, y: 0 },
      })
      expect(useItemsStore.getState().itemById['c']?.transformParent).toMatchObject({
        parentItemId: 'b',
        childWorldReference: { x: 30, y: 5 },
      })
      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth + 1)

      useTimelineCommandStore.getState().undo()
      expect(useItemsStore.getState().itemById['a']?.transformParent).toBeUndefined()
      expect(useItemsStore.getState().itemById['c']?.transformParent).toBeUndefined()
    })

    it('creates a Null parent and attaches the selection in one undo entry', () => {
      const originalTrackCount = useItemsStore.getState().tracks.length
      const undoDepth = useTimelineCommandStore.getState().undoStack.length

      const parent = createNullParentForItems({ childItemIds: ['a', 'c'], frame: 0, canvas })

      expect(parent).toMatchObject({
        type: 'controller',
        controllerKind: 'null',
        label: 'Null Object',
      })
      expect(useItemsStore.getState().itemById['a']?.transformParent?.parentItemId).toBe(parent?.id)
      expect(useItemsStore.getState().itemById['c']?.transformParent?.parentItemId).toBe(parent?.id)
      expect(useItemsStore.getState().tracks).toHaveLength(originalTrackCount + 1)
      expect(
        useItemsStore.getState().tracks.find((track) => track.id === parent?.trackId)?.order,
      ).toBe(0)
      expect(useItemsStore.getState().tracks.find((track) => track.id === 'track-v1')?.order).toBe(
        1,
      )
      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth + 1)

      useTimelineCommandStore.getState().undo()
      expect(useItemsStore.getState().itemById[parent!.id]).toBeUndefined()
      expect(useItemsStore.getState().itemById['a']?.transformParent).toBeUndefined()
      expect(useItemsStore.getState().itemById['c']?.transformParent).toBeUndefined()
      expect(useItemsStore.getState().tracks).toHaveLength(originalTrackCount)
      expect(useItemsStore.getState().tracks.find((track) => track.id === 'track-v1')?.order).toBe(
        0,
      )
    })
  })

  describe('commitMaskEdit', () => {
    it('commits path vertices, transform, and auto-keyframes as one undo entry', () => {
      const undoDepth = useTimelineCommandStore.getState().undoStack.length
      const vertices = [
        {
          position: [0, 0] as [number, number],
          inHandle: [0, 0] as [number, number],
          outHandle: [0, 0] as [number, number],
        },
        {
          position: [1, 0] as [number, number],
          inHandle: [0, 0] as [number, number],
          outHandle: [0, 0] as [number, number],
        },
        {
          position: [1, 1] as [number, number],
          inHandle: [0, 0] as [number, number],
          outHandle: [0, 0] as [number, number],
        },
      ]

      commitMaskEdit('a', {
        pathVertices: vertices,
        transform: { x: 5 },
        autoKeyframeOperations: [{ type: 'add', itemId: 'a', property: 'x', frame: 0, value: 5 }],
      })

      const item = useItemsStore.getState().itemById['a'] as { pathVertices?: unknown }
      expect(item.pathVertices).toEqual(vertices)
      expect(getTransform('a').x).toBe(5)
      const keyframes = useKeyframesStore
        .getState()
        .getKeyframesForItem('a')
        ?.properties.find((group) => group.property === 'x')?.keyframes
      expect(keyframes).toHaveLength(1)
      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth + 1)
    })

    it('is a no-op when the commit is empty', () => {
      const undoDepth = useTimelineCommandStore.getState().undoStack.length

      commitMaskEdit('a', {})

      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth)
      expect(useTimelineSettingsStore.getState().isDirty).toBe(false)
    })
  })

  describe('applyBentoLayout', () => {
    it('lays out visual items and clears conflicting transform keyframes', () => {
      useKeyframesStore.getState()._addKeyframe('a', 'x', 0, 50)
      useKeyframesStore.getState()._addKeyframe('a', 'opacity', 0, 1)
      const undoDepth = useTimelineCommandStore.getState().undoStack.length

      applyBentoLayout(['a', 'b'], 1920, 1080)

      // Both items received computed layout transforms
      for (const id of ['a', 'b']) {
        const transform = getTransform(id)
        expect(typeof transform.x).toBe('number')
        expect(typeof transform.width).toBe('number')
        expect(transform.width).toBeGreaterThan(0)
      }
      // Bento-controlled keyframes cleared, others preserved
      const groups = useKeyframesStore.getState().getKeyframesForItem('a')?.properties ?? []
      expect(groups.find((group) => group.property === 'x')?.keyframes ?? []).toHaveLength(0)
      expect(groups.find((group) => group.property === 'opacity')?.keyframes).toHaveLength(1)
      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth + 1)
    })

    it('does nothing with fewer than two visual items', () => {
      const audio = makeTimelineAudioItem({ id: 'audio-1' })
      useItemsStore.getState().setItems([makeClip('a'), audio])
      const undoDepth = useTimelineCommandStore.getState().undoStack.length

      applyBentoLayout(['a', 'audio-1'], 1920, 1080)

      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth)
      expect(getTransform('a')).toEqual({})
    })
  })
})
