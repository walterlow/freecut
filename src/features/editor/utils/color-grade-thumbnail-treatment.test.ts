import { describe, expect, it } from 'vitest'
import type { ItemEffect } from '@/types/effects'
import { resolveColorGradeThumbnailTreatment } from './color-grade-thumbnail-treatment'

function effect(type: string, params: Record<string, number | boolean | string>): ItemEffect {
  return {
    id: type,
    enabled: true,
    effect: {
      type: 'gpu-effect',
      gpuEffectType: type,
      params,
    },
  }
}

describe('resolveColorGradeThumbnailTreatment', () => {
  it('does not style thumbnails without an enabled color effect', () => {
    expect(resolveColorGradeThumbnailTreatment(undefined)).toEqual({
      hasGrade: false,
      imageStyle: {},
      overlayStyle: null,
    })
    expect(
      resolveColorGradeThumbnailTreatment([
        { ...effect('gpu-saturation', { amount: 2 }), enabled: false },
      ]).hasGrade,
    ).toBe(false)
  })

  it('maps color wheels params to a visible thumbnail treatment', () => {
    const treatment = resolveColorGradeThumbnailTreatment([
      effect('gpu-color-wheels', {
        exposure: 1,
        contrast: 1.35,
        saturation: 45,
        hue: 65,
        temperature: 40,
        offsetHue: 315,
        offsetAmount: 0.5,
      }),
    ])

    expect(treatment.hasGrade).toBe(true)
    expect(treatment.imageStyle.filter).toContain('brightness(')
    expect(treatment.imageStyle.filter).toContain('contrast(')
    expect(treatment.imageStyle.filter).toContain('saturate(')
    expect(treatment.imageStyle.filter).toContain('hue-rotate(54deg)')
    expect(treatment.overlayStyle?.background).toContain('315')
  })

  it('maps generic color effects to CSS filters', () => {
    const treatment = resolveColorGradeThumbnailTreatment([
      effect('gpu-sepia', { amount: 0.7 }),
      effect('gpu-hue-shift', { shift: 0.25 }),
      effect('gpu-saturation', { amount: 1.5 }),
    ])

    expect(treatment.hasGrade).toBe(true)
    expect(treatment.imageStyle.filter).toContain('sepia(70%)')
    expect(treatment.imageStyle.filter).toContain('hue-rotate(90deg)')
    expect(treatment.imageStyle.filter).toContain('saturate(1.500)')
  })
})
