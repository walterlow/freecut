// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { buildEffectAnimatableProperty } from '@/types/keyframe'
import type { Keyframe, VectorKeyframe } from '@/types/keyframe'
import type { AnimationPreset } from '@/infrastructure/storage'
import { makeTimelineTrack, makeTimelineVideoItem } from '../../test-helpers'
import { useItemsStore } from '../items-store'
import { useKeyframesStore } from '../keyframes-store'
import { useTransitionsStore } from '../transitions-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { removePresetKeyframeApplication } from './keyframe-actions'
import { applyAnimationPreset } from './preset-actions'

function getKeyframes(itemId: string, property: string): Keyframe[] {
  return (
    useKeyframesStore
      .getState()
      .getKeyframesForItem(itemId)
      ?.properties.find((group) => group.property === property)?.keyframes ?? []
  )
}

function getVectorKeyframes(itemId: string, property: 'position' | 'scale'): VectorKeyframe[] {
  return (
    useKeyframesStore
      .getState()
      .getKeyframesForItem(itemId)
      ?.vectorProperties?.find((group) => group.property === property)?.keyframes ?? []
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
    expect(result.appliedProcedural).toBe(0)
    expect(getKeyframes('a', 'x').map((k) => k.frame)).toEqual([0, 30])
    expect(
      getKeyframes('a', 'x').every((keyframe) => keyframe.source?.presetId === 'preset-1'),
    ).toBe(true)

    // Single undo step removes the whole applied animation.
    useTimelineCommandStore.getState().undo()
    expect(getKeyframes('a', 'x')).toHaveLength(0)
  })

  it('applies and undoes a saved procedural-only animation', () => {
    const result = applyAnimationPreset(
      'a',
      makePreset({
        properties: [],
        motionModifiers: [
          {
            id: 'saved-spin',
            type: 'spin',
            enabled: true,
            amplitude: 1,
            frequency: 0.3,
            phaseFrames: 0,
            seed: 1,
          },
        ],
      }),
      0,
      { replace: true },
    )

    expect(result).toMatchObject({
      incompatible: false,
      applied: 0,
      appliedProcedural: 1,
    })
    expect(useItemsStore.getState().itemById['a']?.motionModifiers?.[0]).toMatchObject({
      type: 'spin',
      frequency: 0.3,
    })
    expect(useItemsStore.getState().itemById['a']?.motionModifiers?.[0]?.id).not.toBe('saved-spin')

    useTimelineCommandStore.getState().undo()
    expect(useItemsStore.getState().itemById['a']?.motionModifiers).toBeUndefined()
  })

  it('restores saved additive layers with fresh ids', () => {
    const result = applyAnimationPreset(
      'a',
      makePreset({
        properties: [],
        motionLayers: [
          {
            id: 'saved-layer',
            name: 'Slide offset',
            enabled: true,
            source: 'built-in-preset',
            sourcePresetId: 'slide-left',
            tracks: [
              {
                property: 'x',
                blend: 'add',
                keyframes: [{ id: 'saved-layer-key', frame: 0, value: -100, easing: 'ease-out' }],
              },
            ],
          },
        ],
      }),
      0,
      { replace: false },
    )

    expect(result.appliedProcedural).toBe(1)
    const restored = useItemsStore.getState().itemById['a']?.motionLayers?.[0]
    expect(restored).toMatchObject({ name: 'Slide offset', source: 'saved-preset' })
    expect(restored?.id).not.toBe('saved-layer')
    expect(restored?.tracks[0]?.keyframes[0]?.id).not.toBe('saved-layer-key')
  })

  it('restores saved per-unit text motion without baking glyph keyframes', () => {
    useItemsStore.getState().setItems([
      {
        ...makeTimelineVideoItem({ id: 'text-a', durationInFrames: 100 }),
        type: 'text',
        text: 'Hello world',
        fontSize: 64,
        color: '#ffffff',
      } as unknown as ReturnType<typeof makeTimelineVideoItem>,
    ])

    const result = applyAnimationPreset(
      'text-a',
      makePreset({
        sourceItemType: 'text',
        properties: [],
        textMotion: {
          in: {
            presetId: 'rise',
            durationFrames: 14,
            staggerFrames: 4,
            intensity: 1,
            order: 'forward',
            easing: 'ease-out',
            seed: 0,
            unit: 'word',
          },
        },
      }),
      0,
      { replace: true },
    )

    expect(result.applied).toBe(0)
    expect(result.appliedProcedural).toBe(1)
    const textItem = useItemsStore.getState().itemById['text-a']
    expect(textItem?.type).toBe('text')
    if (textItem?.type === 'text') {
      expect(textItem.textMotion?.in).toMatchObject({ presetId: 'rise', unit: 'word' })
    }

    useTimelineCommandStore.getState().undo()
    const restored = useItemsStore.getState().itemById['text-a']
    if (restored?.type === 'text') expect(restored.textMotion).toBeUndefined()
  })

  it('replace mode clears only the incoming preset region', () => {
    // Pre-existing animation on the same property the preset targets.
    useKeyframesStore
      .getState()
      ._addKeyframes([{ itemId: 'a', property: 'x', frame: 60, value: 5, easing: 'linear' }])
    expect(getKeyframes('a', 'x').map((k) => k.frame)).toEqual([60])

    applyAnimationPreset('a', makePreset(), 0, { replace: true })

    // The frame-60 animation is outside the applied [0,30] region and survives.
    expect(getKeyframes('a', 'x').map((k) => k.frame)).toEqual([0, 30, 60])
  })

  it('add mode (default) layers the preset onto existing keyframes', () => {
    useKeyframesStore
      .getState()
      ._addKeyframes([{ itemId: 'a', property: 'x', frame: 60, value: 5, easing: 'linear' }])

    applyAnimationPreset('a', makePreset(), 0, { replace: false })

    // Distinct-frame keyframes coexist (frame 60 survives alongside 0 and 30).
    expect(getKeyframes('a', 'x').map((k) => k.frame)).toEqual([0, 30, 60])
  })

  it('merge keeps an authored key when the preset lands on the same frame', () => {
    useKeyframesStore
      .getState()
      ._addKeyframes([{ itemId: 'a', property: 'x', frame: 0, value: 42, easing: 'hold' }])

    const result = applyAnimationPreset('a', makePreset(), 0, { replace: false })

    expect(result.applied).toBe(1)
    expect(result.skipped).toBe(1)
    expect(getKeyframes('a', 'x')).toMatchObject([
      { frame: 0, value: 42, easing: 'hold', source: undefined },
      { frame: 30, value: 100, source: { presetId: 'preset-1' } },
    ])
  })

  it('anchors the preset at the requested frame', () => {
    applyAnimationPreset('a', makePreset(), 20)
    // Saved animations retime to the remaining target-clip duration.
    expect(getKeyframes('a', 'x').map((k) => k.frame)).toEqual([20, 44])
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

  it('applies v2 Position motion with velocity and spatial data as one undo step', () => {
    const preset = makePreset({
      properties: [],
      vectorProperties: [
        {
          property: 'position',
          keyframes: [
            {
              id: 'p1',
              frame: 0,
              value: { x: -100, y: 20 },
              easing: 'linear',
              temporalEase: { out: { speed: 240, influence: 60 } },
              spatial: {
                inTangent: { x: 0, y: 0 },
                outTangent: { x: 80, y: -50 },
                continuous: false,
              },
            },
            {
              id: 'p2',
              frame: 30,
              value: { x: 100, y: 20 },
              easing: 'ease-out',
            },
          ],
        },
      ],
    })

    const result = applyAnimationPreset('a', preset, 10)

    expect(result.applied).toBe(2)
    expect(getVectorKeyframes('a', 'position').map((keyframe) => keyframe.frame)).toEqual([10, 37])
    expect(getVectorKeyframes('a', 'position')[0]).toMatchObject({
      value: { x: -100, y: 20 },
      temporalEase: { out: { speed: expect.any(Number), influence: 60 } },
      spatial: {
        inTangent: { x: 0, y: 0 },
        outTangent: { x: 80, y: -50 },
      },
    })

    useTimelineCommandStore.getState().undo()
    expect(getVectorKeyframes('a', 'position')).toEqual([])
  })

  it('replaces or merges v2 vector lanes without leaving legacy scalar channels behind', () => {
    useKeyframesStore.getState()._addKeyframes([
      { itemId: 'a', property: 'x', frame: 5, value: 1 },
      { itemId: 'a', property: 'y', frame: 5, value: 2 },
    ])
    useKeyframesStore.getState()._upsertVectorKeyframe('a', 'position', {
      frame: 70,
      value: { x: 7, y: 8 },
    })
    const preset = makePreset({
      properties: [],
      vectorProperties: [
        {
          property: 'position',
          keyframes: [{ id: 'p', frame: 10, value: { x: 10, y: 20 }, easing: 'linear' }],
        },
      ],
    })

    applyAnimationPreset('a', preset, 0, { replace: false })
    expect(getVectorKeyframes('a', 'position').map((keyframe) => keyframe.frame)).toEqual([10, 70])
    expect(getKeyframes('a', 'x')).toEqual([])
    expect(getKeyframes('a', 'y')).toEqual([])

    applyAnimationPreset('a', preset, 20, { replace: true })
    expect(getVectorKeyframes('a', 'position').map((keyframe) => keyframe.frame)).toEqual([
      10, 28, 70,
    ])
  })

  it('merge keeps an authored Vector2 key on a frame collision', () => {
    useKeyframesStore.getState()._upsertVectorKeyframe('a', 'position', {
      frame: 0,
      value: { x: 44, y: 55 },
      easing: 'hold',
    })
    const preset = makePreset({
      properties: [],
      vectorProperties: [
        {
          property: 'position',
          keyframes: [
            { id: 'p0', frame: 0, value: { x: -10, y: -20 }, easing: 'linear' },
            { id: 'p1', frame: 20, value: { x: 10, y: 20 }, easing: 'linear' },
          ],
        },
      ],
    })

    const result = applyAnimationPreset('a', preset, 0, { replace: false })

    expect(result.applied).toBe(1)
    expect(getVectorKeyframes('a', 'position')).toMatchObject([
      { frame: 0, value: { x: 44, y: 55 }, easing: 'hold', source: undefined },
      { frame: 20, value: { x: 10, y: 20 }, source: { presetId: 'preset-1' } },
    ])
  })

  it('removes one generated application without touching manual keys', () => {
    applyAnimationPreset('a', makePreset(), 0, { replace: false })
    useKeyframesStore
      .getState()
      ._addKeyframes([{ itemId: 'a', property: 'x', frame: 70, value: 12, easing: 'linear' }])
    const applicationId = getKeyframes('a', 'x').find((keyframe) => keyframe.source)?.source
      ?.applicationId
    expect(applicationId).toBeDefined()

    removePresetKeyframeApplication('a', applicationId!)

    expect(getKeyframes('a', 'x')).toMatchObject([{ frame: 70, value: 12, source: undefined }])
  })
})
