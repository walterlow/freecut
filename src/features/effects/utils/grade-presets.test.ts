import { describe, expect, it } from 'vite-plus/test'
import type { ItemEffect, VisualEffect } from '@/types/effects'
import {
  applyGradePresetToEffectStack,
  hasGradePresetEffects,
  isGradePresetEffect,
} from './grade-presets'

describe('grade presets', () => {
  it('detects presets that contain color grading effects', () => {
    expect(
      isGradePresetEffect({
        type: 'gpu-effect',
        gpuEffectType: 'gpu-color-wheels',
        params: {},
      }),
    ).toBe(true)
    expect(
      hasGradePresetEffects([
        { type: 'gpu-effect', gpuEffectType: 'gpu-gaussian-blur', params: { radius: 4 } },
        { type: 'gpu-effect', gpuEffectType: 'gpu-curves', params: {} },
      ]),
    ).toBe(true)
    expect(
      hasGradePresetEffects([
        { type: 'gpu-effect', gpuEffectType: 'gpu-gaussian-blur', params: { radius: 4 } },
      ]),
    ).toBe(false)
  })

  it('replaces current color grade effects while preserving non-grade effects', () => {
    let nextId = 0
    const createId = () => `grade-${++nextId}`
    const currentEffects: ItemEffect[] = [
      {
        id: 'old-wheels',
        enabled: true,
        effect: { type: 'gpu-effect', gpuEffectType: 'gpu-color-wheels', params: { exposure: 1 } },
      },
      {
        id: 'blur',
        enabled: false,
        effect: { type: 'gpu-effect', gpuEffectType: 'gpu-gaussian-blur', params: { radius: 8 } },
      },
      {
        id: 'old-curves',
        enabled: true,
        effect: { type: 'gpu-effect', gpuEffectType: 'gpu-curves', params: { master: '[]' } },
      },
    ]
    const presetEffects: VisualEffect[] = [
      { type: 'gpu-effect', gpuEffectType: 'gpu-color-wheels', params: { exposure: -0.25 } },
      { type: 'gpu-effect', gpuEffectType: 'gpu-curves', params: { master: '[[0,0],[1,1]]' } },
    ]

    const nextEffects = applyGradePresetToEffectStack(currentEffects, presetEffects, createId)

    expect(nextEffects).toHaveLength(3)
    expect(nextEffects[0]).toBe(currentEffects[1])
    expect(nextEffects.slice(1)).toMatchObject([
      {
        id: 'grade-1',
        enabled: true,
        effect: {
          type: 'gpu-effect',
          gpuEffectType: 'gpu-color-wheels',
          params: { exposure: -0.25 },
        },
      },
      {
        id: 'grade-2',
        enabled: true,
        effect: {
          type: 'gpu-effect',
          gpuEffectType: 'gpu-curves',
          params: { master: '[[0,0],[1,1]]' },
        },
      },
    ])
    expect(nextEffects[1]?.effect.params).not.toBe(presetEffects[0]?.params)
  })
})
