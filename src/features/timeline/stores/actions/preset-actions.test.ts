import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { buildEffectAnimatableProperty } from '@/types/keyframe'
import type { Keyframe } from '@/types/keyframe'
import type { AnimationPreset } from '@/infrastructure/storage'
import { makeTimelineTrack, makeTimelineVideoItem } from '../../test-helpers'
import { useItemsStore } from '../items-store'
import { useKeyframesStore } from '../keyframes-store'
import { useTransitionsStore } from '../transitions-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { applyAnimationPreset } from './preset-actions'

function getKeyframes(itemId: string, property: string): Keyframe[] {
  return (
    useKeyframesStore
      .getState()
      .getKeyframesForItem(itemId)
      ?.properties.find((group) => group.property === property)?.keyframes ?? []
  )
}

function makePreset(overrides: Partial<AnimationPreset> = {}): AnimationPreset {
  return {
    id: 'preset-1',
    name: 'Slide',
    sourceItemType: 'video',
    sourceDurationInFrames: 100,
    effects: [],
    createdAt: 0,
    properties: [
      {
        property: 'x',
        keyframes: [
          { id: 's1', frame: 0, value: 0, easing: 'linear' },
          { id: 's2', frame: 30, value: 100, easing: 'linear' },
        ],
      },
    ],
    ...overrides,
  }
}

describe('applyAnimationPreset', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useItemsStore
      .getState()
      .setTracks([makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 })])
    useItemsStore.getState().setItems([makeTimelineVideoItem({ id: 'a', durationInFrames: 100 })])
    useTransitionsStore.getState().setTransitions([])
    useKeyframesStore.getState().setKeyframes([])
  })

  it('applies a compatible preset as a single undo step', () => {
    const result = applyAnimationPreset('a', makePreset(), 0)

    expect(result.incompatible).toBe(false)
    expect(result.applied).toBe(2)
    expect(result.addedEffects).toBe(0)
    expect(getKeyframes('a', 'x').map((k) => k.frame)).toEqual([0, 30])

    // Single undo step removes the whole applied animation.
    useTimelineCommandStore.getState().undo()
    expect(getKeyframes('a', 'x')).toHaveLength(0)
  })

  it('replace mode clears prior keyframes on the preset properties before applying', () => {
    // Pre-existing animation on the same property the preset targets.
    useKeyframesStore
      .getState()
      ._addKeyframes([{ itemId: 'a', property: 'x', frame: 60, value: 5, easing: 'linear' }])
    expect(getKeyframes('a', 'x').map((k) => k.frame)).toEqual([60])

    applyAnimationPreset('a', makePreset(), 0, { replace: true })

    // The old frame-60 keyframe is gone; only the preset's keyframes remain.
    expect(getKeyframes('a', 'x').map((k) => k.frame)).toEqual([0, 30])
  })

  it('add mode (default) layers the preset onto existing keyframes', () => {
    useKeyframesStore
      .getState()
      ._addKeyframes([{ itemId: 'a', property: 'x', frame: 60, value: 5, easing: 'linear' }])

    applyAnimationPreset('a', makePreset(), 0, { replace: false })

    // Distinct-frame keyframes coexist (frame 60 survives alongside 0 and 30).
    expect(getKeyframes('a', 'x').map((k) => k.frame)).toEqual([0, 30, 60])
  })

  it('anchors the preset at the requested frame', () => {
    applyAnimationPreset('a', makePreset(), 20)
    expect(getKeyframes('a', 'x').map((k) => k.frame)).toEqual([20, 50])
  })

  it('blocks an incompatible target without mutating the timeline', () => {
    const result = applyAnimationPreset('a', makePreset({ sourceItemType: 'text' }), 0)

    expect(result.incompatible).toBe(true)
    expect(result.reason).toBe('type-mismatch')
    expect(result.applied).toBe(0)
    expect(getKeyframes('a', 'x')).toHaveLength(0)
  })

  it('auto-adds a missing effect and binds the remapped effect-param keyframes', () => {
    const sourceProperty = buildEffectAnimatableProperty('gpu-gaussian-blur', 'source-fx', 'radius')
    const preset = makePreset({
      effects: [{ type: 'gpu-effect', gpuEffectType: 'gpu-gaussian-blur', params: { radius: 5 } }],
      properties: [
        {
          property: sourceProperty,
          keyframes: [
            { id: 'e1', frame: 0, value: 0, easing: 'linear' },
            { id: 'e2', frame: 20, value: 10, easing: 'linear' },
          ],
        },
      ],
    })

    const result = applyAnimationPreset('a', preset, 0)

    expect(result.incompatible).toBe(false)
    expect(result.addedEffects).toBe(1)
    expect(result.applied).toBe(2)

    const target = useItemsStore.getState().itemById['a']
    const newEffect = target?.effects?.find((e) => e.effect.gpuEffectType === 'gpu-gaussian-blur')
    expect(newEffect).toBeDefined()

    // Keyframes bound to the target's (newly created) effect id, not the source's.
    const remapped = buildEffectAnimatableProperty('gpu-gaussian-blur', newEffect!.id, 'radius')
    expect(getKeyframes('a', remapped)).toHaveLength(2)
  })
})
