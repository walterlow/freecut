import { describe, expect, it } from 'vite-plus/test'
import { buildEffectAnimatableProperty, type ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import type { ItemEffect } from '@/types/effects'
import {
  getAnimatableEffectPropertiesForItem,
  getEffectPropertyBaseValue,
  getResolvedAnimatedEffectParamValue,
  resolveAnimatedGpuEffects,
} from './effect-animatable-properties'

function createVideoItem(effectEntry: ItemEffect): TimelineItem {
  return {
    id: 'item-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 60,
    label: 'Clip',
    src: 'clip.mp4',
    effects: [effectEntry],
  }
}

describe('effect animatable properties', () => {
  it('only exposes currently visible numeric params', () => {
    const ditherItem = createVideoItem({
      id: 'effect-1',
      enabled: true,
      effect: {
        type: 'gpu-effect',
        gpuEffectType: 'gpu-dither',
        params: {
          mode: 'linear',
          cellSize: 8,
          angle: 45,
          scale: 100,
          offsetX: 0,
          offsetY: 0,
        },
      },
    })

    expect(getAnimatableEffectPropertiesForItem(ditherItem)).toEqual([
      buildEffectAnimatableProperty('gpu-dither', 'effect-1', 'cellSize'),
      buildEffectAnimatableProperty('gpu-dither', 'effect-1', 'angle'),
    ])
  })

  it('does not resolve hidden params while their branch is inactive', () => {
    const effectEntry: ItemEffect = {
      id: 'effect-1',
      enabled: true,
      effect: {
        type: 'gpu-effect',
        gpuEffectType: 'gpu-ascii',
        params: {
          matchSourceColor: false,
          colorSaturation: 100,
        },
      },
    }
    const property = buildEffectAnimatableProperty('gpu-ascii', 'effect-1', 'colorSaturation')
    const itemKeyframes: ItemKeyframes = {
      itemId: 'item-1',
      properties: [
        {
          property,
          keyframes: [
            { id: 'kf-1', frame: 0, value: 100, easing: 'linear' },
            { id: 'kf-2', frame: 10, value: 200, easing: 'linear' },
          ],
        },
      ],
    }

    expect(
      getResolvedAnimatedEffectParamValue(effectEntry, itemKeyframes, 5, 'colorSaturation'),
    ).toBe(100)

    const resolved = resolveAnimatedGpuEffects([effectEntry], itemKeyframes, 5)
    expect(resolved?.[0]?.effect.type).toBe('gpu-effect')
    if (resolved?.[0]?.effect.type !== 'gpu-effect') {
      throw new Error('Expected gpu effect')
    }
    expect(resolved[0].effect.params.colorSaturation).toBe(100)
  })

  it('exposes and resolves animatable color params as packed RGB keyframes', () => {
    const effectEntry: ItemEffect = {
      id: 'effect-1',
      enabled: true,
      effect: {
        type: 'gpu-effect',
        gpuEffectType: 'gpu-trigger-wave',
        params: {
          strength: 0.04,
          radius: 0.85,
          frequency: 18,
          decay: 0.08,
          phase: 0,
          speed: 1,
          centerX: 0.5,
          centerY: 0.5,
          chroma: 0.006,
          scanlineMix: 0.18,
          glowColor: '#ff0000',
        },
      },
    }
    const item = createVideoItem(effectEntry)
    const property = buildEffectAnimatableProperty('gpu-trigger-wave', 'effect-1', 'glowColor')
    const itemKeyframes: ItemKeyframes = {
      itemId: 'item-1',
      properties: [
        {
          property,
          keyframes: [
            { id: 'kf-1', frame: 0, value: 0xff0000, easing: 'linear' },
            { id: 'kf-2', frame: 10, value: 0x0000ff, easing: 'linear' },
          ],
        },
      ],
    }

    expect(getAnimatableEffectPropertiesForItem(item)).toContain(property)
    expect(getEffectPropertyBaseValue(item, property)).toBe(0xff0000)
    expect(getResolvedAnimatedEffectParamValue(effectEntry, itemKeyframes, 5, 'glowColor')).toBe(
      '#800080',
    )

    const resolved = resolveAnimatedGpuEffects([effectEntry], itemKeyframes, 5)
    expect(resolved?.[0]?.effect.type).toBe('gpu-effect')
    if (resolved?.[0]?.effect.type !== 'gpu-effect') {
      throw new Error('Expected gpu effect')
    }
    expect(resolved[0].effect.params.glowColor).toBe('#800080')
  })
})
