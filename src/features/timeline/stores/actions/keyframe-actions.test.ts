import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { Keyframe } from '@/types/keyframe'
import type { Transition } from '@/types/transition'
import { makeTimelineTrack, makeTimelineVideoItem } from '../../test-helpers'
import { useItemsStore } from '../items-store'
import { useKeyframesStore } from '../keyframes-store'
import { useTransitionsStore } from '../transitions-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import {
  addKeyframe,
  addKeyframes,
  applyAutoKeyframeOperations,
  applyMotionPresetKeyframes,
  removeKeyframe,
  removeKeyframes,
  removeKeyframesForItem,
  removeKeyframesForProperty,
  removeDirectPropertyLink,
  removePropertyExpression,
  setDirectPropertyLink,
  setPropertyExpression,
  trimAnimationToItemBounds,
  updateKeyframe,
} from './keyframe-actions'

function makeFade(overrides: Partial<Transition> = {}): Transition {
  return {
    id: 'transition-1',
    type: 'crossfade',
    presentation: 'fade',
    timing: 'linear',
    leftClipId: 'a',
    rightClipId: 'b',
    trackId: 'track-v1',
    durationInFrames: 12,
    ...overrides,
  }
}

function getKeyframes(itemId: string, property: string): Keyframe[] {
  return (
    useKeyframesStore
      .getState()
      .getKeyframesForItem(itemId)
      ?.properties.find((group) => group.property === property)?.keyframes ?? []
  )
}

describe('keyframe actions', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useItemsStore
      .getState()
      .setTracks([makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 })])
    useItemsStore
      .getState()
      .setItems([makeTimelineVideoItem({ id: 'a' }), makeTimelineVideoItem({ id: 'b', from: 60 })])
    useTransitionsStore.getState().setTransitions([])
    useKeyframesStore.getState().setKeyframes([])
  })

  describe('direct property links', () => {
    it('creates and removes links through undo and redo', () => {
      const expression = {
        type: 'link' as const,
        targetProperty: 'x' as const,
        sourceItemId: 'b',
        sourceProperty: 'x' as const,
        enabled: true,
        timeOffsetFrames: 0,
      }

      setDirectPropertyLink('a', expression)
      expect(useKeyframesStore.getState().getKeyframesForItem('a')?.propertyLinks).toEqual([
        expression,
      ])

      useTimelineCommandStore.getState().undo()
      expect(useKeyframesStore.getState().getKeyframesForItem('a')).toBeUndefined()

      useTimelineCommandStore.getState().redo()
      expect(useKeyframesStore.getState().getKeyframesForItem('a')?.propertyLinks).toEqual([
        expression,
      ])

      removeDirectPropertyLink('a', 'x')
      expect(useKeyframesStore.getState().getKeyframesForItem('a')).toBeUndefined()

      useTimelineCommandStore.getState().undo()
      expect(useKeyframesStore.getState().getKeyframesForItem('a')?.propertyLinks).toEqual([
        expression,
      ])
    })

    it('replaces scalar component links when a Vector2 link owns the channel pair', () => {
      setDirectPropertyLink('a', {
        type: 'link',
        targetProperty: 'x',
        sourceItemId: 'b',
        sourceProperty: 'x',
        enabled: true,
        timeOffsetFrames: 0,
      })
      setDirectPropertyLink('a', {
        type: 'link',
        targetProperty: 'position',
        sourceItemId: 'b',
        sourceProperty: 'position',
        enabled: true,
        timeOffsetFrames: 0,
      })

      expect(useKeyframesStore.getState().getKeyframesForItem('a')?.propertyLinks).toEqual([
        expect.objectContaining({ targetProperty: 'position' }),
      ])
    })
  })

  describe('property expressions', () => {
    it('creates, disables, removes, and restores expressions through history', () => {
      setPropertyExpression('a', {
        type: 'expression',
        targetProperty: 'x',
        source: 'value * 2',
        enabled: true,
      })
      setPropertyExpression('a', {
        type: 'expression',
        targetProperty: 'x',
        source: 'value * 2',
        enabled: false,
      })

      expect(useKeyframesStore.getState().getKeyframesForItem('a')?.expressions).toEqual([
        expect.objectContaining({ targetProperty: 'x', enabled: false }),
      ])

      removePropertyExpression('a', 'x')
      expect(useKeyframesStore.getState().getKeyframesForItem('a')).toBeUndefined()
      useTimelineCommandStore.getState().undo()
      expect(useKeyframesStore.getState().getKeyframesForItem('a')?.expressions).toEqual([
        expect.objectContaining({ source: 'value * 2', enabled: false }),
      ])
    })
  })

  describe('addKeyframe', () => {
    it('adds a keyframe, marks dirty, and pushes one undo entry', () => {
      const undoDepth = useTimelineCommandStore.getState().undoStack.length

      const id = addKeyframe('a', 'opacity', 10, 0.5)

      expect(id).not.toBe('')
      const keyframes = getKeyframes('a', 'opacity')
      expect(keyframes).toHaveLength(1)
      expect(keyframes[0]).toMatchObject({ frame: 10, value: 0.5 })
      expect(useTimelineSettingsStore.getState().isDirty).toBe(true)
      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth + 1)
    })

    it('refuses keyframes for unknown items', () => {
      const id = addKeyframe('missing', 'opacity', 10, 0.5)

      expect(id).toBe('')
      expect(useKeyframesStore.getState().keyframes).toHaveLength(0)
    })

    it('blocks keyframes inside an outgoing transition region', () => {
      // fade dur 12, alignment 0.5 → frames [54, 60) of clip a are blocked
      useTransitionsStore.getState().setTransitions([makeFade()])

      expect(addKeyframe('a', 'opacity', 55, 1)).toBe('')
      expect(getKeyframes('a', 'opacity')).toHaveLength(0)

      // Just outside the blocked range is fine
      expect(addKeyframe('a', 'opacity', 53, 1)).not.toBe('')
      expect(getKeyframes('a', 'opacity')).toHaveLength(1)
    })

    it('blocks keyframes inside an incoming transition region', () => {
      // Clip-relative frames [0, 6) of clip b are blocked
      useTransitionsStore.getState().setTransitions([makeFade()])

      expect(addKeyframe('b', 'opacity', 3, 1)).toBe('')
      expect(addKeyframe('b', 'opacity', 6, 1)).not.toBe('')
    })

    it('undo removes the added keyframe', () => {
      addKeyframe('a', 'opacity', 10, 0.5)
      expect(getKeyframes('a', 'opacity')).toHaveLength(1)

      useTimelineCommandStore.getState().undo()
      expect(getKeyframes('a', 'opacity')).toHaveLength(0)
    })

    it('preserves RGBA color values through undo and redo', () => {
      const property = 'effect:gpu-fluted-glass:fluted-1:colorBack'
      const rgbaValue = 0x100000000 + 0x12345678

      addKeyframe('a', property, 10, rgbaValue)
      expect(getKeyframes('a', property)[0]?.value).toBe(rgbaValue)

      useTimelineCommandStore.getState().undo()
      expect(getKeyframes('a', property)).toHaveLength(0)

      useTimelineCommandStore.getState().redo()
      expect(getKeyframes('a', property)[0]?.value).toBe(rgbaValue)
    })
  })

  describe('addKeyframes (batch)', () => {
    it('adds all keyframes as a single undo entry', () => {
      const undoDepth = useTimelineCommandStore.getState().undoStack.length

      const ids = addKeyframes([
        { itemId: 'a', property: 'opacity', frame: 0, value: 0 },
        { itemId: 'a', property: 'opacity', frame: 30, value: 1 },
        { itemId: 'a', property: 'rotation', frame: 0, value: 100 },
      ])

      expect(ids).toHaveLength(3)
      expect(getKeyframes('a', 'opacity')).toHaveLength(2)
      expect(getKeyframes('a', 'rotation')).toHaveLength(1)
      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth + 1)
    })

    it('filters out payloads landing in transition regions', () => {
      useTransitionsStore.getState().setTransitions([makeFade()])

      const ids = addKeyframes([
        { itemId: 'a', property: 'opacity', frame: 10, value: 0 }, // ok
        { itemId: 'a', property: 'opacity', frame: 56, value: 1 }, // blocked
      ])

      expect(ids).toHaveLength(1)
      expect(getKeyframes('a', 'opacity')).toHaveLength(1)
      expect(getKeyframes('a', 'opacity')[0]?.frame).toBe(10)
    })

    it('returns empty and adds nothing when every payload is blocked', () => {
      useTransitionsStore.getState().setTransitions([makeFade()])

      const ids = addKeyframes([{ itemId: 'a', property: 'opacity', frame: 56, value: 1 }])

      expect(ids).toEqual([])
      expect(useKeyframesStore.getState().keyframes).toHaveLength(0)
    })
  })

  describe('updateKeyframe', () => {
    it('updates value and frame', () => {
      const id = addKeyframe('a', 'opacity', 10, 0.5)

      updateKeyframe('a', 'opacity', id, { frame: 20, value: 0.8 })

      const keyframes = getKeyframes('a', 'opacity')
      expect(keyframes[0]).toMatchObject({ frame: 20, value: 0.8 })
    })

    it('refuses to move a keyframe into a transition region', () => {
      const id = addKeyframe('a', 'opacity', 10, 0.5)
      useTransitionsStore.getState().setTransitions([makeFade()])

      updateKeyframe('a', 'opacity', id, { frame: 56 })

      expect(getKeyframes('a', 'opacity')[0]?.frame).toBe(10)
    })
  })

  describe('applyAutoKeyframeOperations', () => {
    it('mixes adds and updates in one undo block', () => {
      const existingId = addKeyframe('a', 'opacity', 0, 0)
      const undoDepth = useTimelineCommandStore.getState().undoStack.length

      applyAutoKeyframeOperations([
        {
          type: 'update',
          itemId: 'a',
          property: 'opacity',
          keyframeId: existingId,
          updates: { value: 0.25 },
        },
        { type: 'add', itemId: 'a', property: 'opacity', frame: 30, value: 1 },
      ])

      const keyframes = getKeyframes('a', 'opacity')
      expect(keyframes).toHaveLength(2)
      expect(keyframes.find((keyframe) => keyframe.id === existingId)?.value).toBe(0.25)
      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth + 1)

      useTimelineCommandStore.getState().undo()
      const restored = getKeyframes('a', 'opacity')
      expect(restored).toHaveLength(1)
      expect(restored[0]?.value).toBe(0)
    })
  })

  describe('applyMotionPresetKeyframes (region-aware replace)', () => {
    it('clears only keyframes inside the window, preserving out-of-window animation', () => {
      // Existing: an entrance (width + opacity at 0,10) and an exit (opacity 90,100).
      addKeyframes([
        { itemId: 'a', property: 'width', frame: 0, value: 140 },
        { itemId: 'a', property: 'width', frame: 10, value: 100 },
        { itemId: 'a', property: 'opacity', frame: 0, value: 0 },
        { itemId: 'a', property: 'opacity', frame: 10, value: 1 },
        { itemId: 'a', property: 'opacity', frame: 90, value: 1 },
        { itemId: 'a', property: 'opacity', frame: 100, value: 0 },
      ])

      // Reapply a new entrance that only writes opacity in [0,10]; Replace clears
      // BOTH width and opacity within that window (so the old width entrance is
      // gone) but must leave the exit at 90/100 untouched.
      applyMotionPresetKeyframes(
        [
          { itemId: 'a', property: 'opacity', frame: 0, value: 0 },
          { itemId: 'a', property: 'opacity', frame: 10, value: 1 },
        ],
        [
          { itemId: 'a', property: 'width', fromFrame: 0, toFrame: 10 },
          { itemId: 'a', property: 'opacity', fromFrame: 0, toFrame: 10 },
        ],
      )

      // Leftover width entrance from the old preset is cleared and not re-added.
      expect(getKeyframes('a', 'width')).toHaveLength(0)
      // Opacity entrance replaced; exit preserved.
      expect(getKeyframes('a', 'opacity').map((kf) => kf.frame)).toEqual([0, 10, 90, 100])
    })

    it('clears the whole property when no frame range is given', () => {
      addKeyframes([
        { itemId: 'a', property: 'opacity', frame: 0, value: 0 },
        { itemId: 'a', property: 'opacity', frame: 90, value: 1 },
      ])

      applyMotionPresetKeyframes(
        [{ itemId: 'a', property: 'opacity', frame: 0, value: 0.5 }],
        [{ itemId: 'a', property: 'opacity' }],
      )

      expect(getKeyframes('a', 'opacity').map((kf) => kf.frame)).toEqual([0])
    })

    it('replaces a region of an existing coupled Position lane', () => {
      useKeyframesStore.getState()._upsertVectorKeyframe('a', 'position', {
        frame: 0,
        value: { x: 0, y: 0 },
      })
      useKeyframesStore.getState()._upsertVectorKeyframe('a', 'position', {
        frame: 30,
        value: { x: 30, y: 30 },
      })

      const ids = applyMotionPresetKeyframes(
        [],
        [],
        [
          {
            itemId: 'a',
            property: 'position',
            keyframes: [
              {
                frame: 5,
                value: { x: 100, y: 200 },
                easing: 'ease-out',
                source: {
                  applicationId: 'app-1',
                  kind: 'built-in-preset',
                  presetId: 'slide',
                  presetName: 'Slide',
                },
              },
            ],
            replaceRange: { fromFrame: 0, toFrame: 10 },
          },
        ],
      )

      expect(ids).toHaveLength(1)
      expect(
        useKeyframesStore
          .getState()
          .getKeyframesForItem('a')
          ?.vectorProperties?.find((property) => property.property === 'position')?.keyframes,
      ).toMatchObject([
        { frame: 5, value: { x: 100, y: 200 }, source: { applicationId: 'app-1' } },
        { frame: 30, value: { x: 30, y: 30 } },
      ])
    })

    it('keeps an existing coupled key on Merge collisions', () => {
      useKeyframesStore.getState()._upsertVectorKeyframe('a', 'position', {
        frame: 5,
        value: { x: 7, y: 8 },
        easing: 'hold',
      })

      const ids = applyMotionPresetKeyframes(
        [],
        [],
        [
          {
            itemId: 'a',
            property: 'position',
            keyframes: [
              { frame: 5, value: { x: 99, y: 99 } },
              { frame: 10, value: { x: 10, y: 20 } },
            ],
          },
        ],
      )

      expect(ids).toHaveLength(1)
      const position = useKeyframesStore
        .getState()
        .getKeyframesForItem('a')
        ?.vectorProperties?.find((property) => property.property === 'position')?.keyframes
      expect(position).toMatchObject([
        { frame: 5, value: { x: 7, y: 8 }, easing: 'hold' },
        { frame: 10, value: { x: 10, y: 20 } },
      ])
    })

    it('aborts without clearing when any payload is blocked (all-or-nothing)', () => {
      // fade dur 12, alignment 0.5 → frames [54, 60) of clip a are blocked.
      useTransitionsStore.getState().setTransitions([makeFade()])
      // Existing keyframe sits inside the clear window [0, 10].
      addKeyframes([{ itemId: 'a', property: 'opacity', frame: 5, value: 0.2 }])
      const undoDepth = useTimelineCommandStore.getState().undoStack.length

      // One replacement lands in the blocked transition region, so the whole
      // apply must be a no-op — the existing frame-5 keyframe must survive rather
      // than be wiped by a clear window it can't fully replace.
      const ids = applyMotionPresetKeyframes(
        [
          { itemId: 'a', property: 'opacity', frame: 0, value: 1 },
          { itemId: 'a', property: 'opacity', frame: 56, value: 0 },
        ],
        [{ itemId: 'a', property: 'opacity', fromFrame: 0, toFrame: 10 }],
      )

      expect(ids).toEqual([])
      expect(getKeyframes('a', 'opacity').map((kf) => kf.frame)).toEqual([5])
      // No mutation ⇒ no undo entry pushed.
      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth)
    })

    it('applies clear + add as a single undo entry', () => {
      addKeyframes([{ itemId: 'a', property: 'opacity', frame: 5, value: 0.2 }])
      const undoDepth = useTimelineCommandStore.getState().undoStack.length

      applyMotionPresetKeyframes(
        [{ itemId: 'a', property: 'opacity', frame: 0, value: 1 }],
        [{ itemId: 'a', property: 'opacity', fromFrame: 0, toFrame: 10 }],
      )

      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepth + 1)
      useTimelineCommandStore.getState().undo()
      // Undo restores exactly the pre-apply state (the frame-5 keyframe).
      expect(getKeyframes('a', 'opacity').map((kf) => kf.frame)).toEqual([5])
    })
  })

  describe('removal', () => {
    it('trims parked keyframes with a boundary value in one undoable action', () => {
      useItemsStore
        .getState()
        .setItems([
          makeTimelineVideoItem({ id: 'a', durationInFrames: 11 }),
          makeTimelineVideoItem({ id: 'b', from: 60 }),
        ])
      useKeyframesStore.getState().setKeyframes([
        {
          itemId: 'a',
          properties: [
            {
              property: 'opacity',
              keyframes: [
                { id: 'start', frame: 0, value: 0, easing: 'linear' },
                { id: 'trimmed', frame: 20, value: 1, easing: 'linear' },
              ],
            },
          ],
        },
      ])
      const undoDepth = useTimelineCommandStore.getState().undoStack.length

      expect(trimAnimationToItemBounds('a')).toBe(1)
      expect(getKeyframes('a', 'opacity')).toEqual([
        { id: 'start', frame: 0, value: 0, easing: 'linear' },
        expect.objectContaining({ frame: 10, value: 0.5 }),
      ])
      expect(useTimelineCommandStore.getState().undoStack).toHaveLength(undoDepth + 1)

      useTimelineCommandStore.getState().undo()
      expect(getKeyframes('a', 'opacity').map((keyframe) => keyframe.frame)).toEqual([0, 20])
    })

    it('removeKeyframe deletes a single keyframe', () => {
      const id = addKeyframe('a', 'opacity', 10, 0.5)
      addKeyframe('a', 'opacity', 20, 1)

      removeKeyframe('a', 'opacity', id)

      const keyframes = getKeyframes('a', 'opacity')
      expect(keyframes).toHaveLength(1)
      expect(keyframes[0]?.frame).toBe(20)
    })

    it('removeKeyframes deletes by refs across properties', () => {
      const opacityId = addKeyframe('a', 'opacity', 10, 0.5)
      const scaleId = addKeyframe('a', 'rotation', 10, 100)
      addKeyframe('a', 'opacity', 20, 1)

      removeKeyframes([
        { itemId: 'a', property: 'opacity', keyframeId: opacityId },
        { itemId: 'a', property: 'rotation', keyframeId: scaleId },
      ])

      expect(getKeyframes('a', 'opacity')).toHaveLength(1)
      expect(getKeyframes('a', 'rotation')).toHaveLength(0)
    })

    it('removeKeyframesForProperty clears one property only', () => {
      addKeyframe('a', 'opacity', 10, 0.5)
      addKeyframe('a', 'rotation', 10, 100)

      removeKeyframesForProperty('a', 'opacity')

      expect(getKeyframes('a', 'opacity')).toHaveLength(0)
      expect(getKeyframes('a', 'rotation')).toHaveLength(1)
    })

    it('removeKeyframesForItem clears everything for the item', () => {
      addKeyframe('a', 'opacity', 10, 0.5)
      addKeyframe('a', 'rotation', 10, 100)
      addKeyframe('b', 'opacity', 5, 1)

      removeKeyframesForItem('a')

      expect(useKeyframesStore.getState().getKeyframesForItem('a')).toBeUndefined()
      expect(getKeyframes('b', 'opacity')).toHaveLength(1)
    })
  })
})
