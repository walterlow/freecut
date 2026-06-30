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
