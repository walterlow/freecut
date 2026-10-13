// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { buildEffectAnimatableProperty } from '@/types/keyframe'
import { getPropertyAccordionGroups, getPropertyDisplayGroups } from './property-groups'

describe('getPropertyAccordionGroups', () => {
  it('groups transform and audio properties in a stable order', () => {
    expect(
      getPropertyAccordionGroups(['volume', 'cropRight', 'anchorY', 'y', 'anchorX', 'x']),
    ).toEqual([
      {
        id: 'transform',
        label: 'Transform',
        properties: ['x', 'y', 'anchorX', 'anchorY'],
      },
      {
        id: 'crop',
        label: 'Crop',
        properties: ['cropRight'],
      },
      {
        id: 'audio',
        label: 'Audio',
        properties: ['volume'],
      },
    ])
  })

  it('separates composite and text properties into the Properties-panel order', () => {
    expect(
      getPropertyAccordionGroups([
        'strokeWidth',
        'backgroundRadius',
        'opacity',
        'lineHeight',
        'cornerRadius',
        'textShadowBlur',
        'fontSize',
        'textPadding',
        'textShadowOffsetY',
        'textStyleScale',
        'textShadowOffsetX',
        'rotation',
      ]),
    ).toEqual([
      {
        id: 'transform',
        label: 'Transform',
        properties: ['rotation'],
      },
      {
        id: 'composite',
        label: 'Composite',
        properties: ['opacity', 'cornerRadius'],
      },
      {
        id: 'textTypography',
        label: 'Text Typography',
        properties: ['textStyleScale', 'fontSize', 'lineHeight'],
      },
      {
        id: 'textBackground',
        label: 'Text Background',
        properties: ['textPadding', 'backgroundRadius'],
      },
      {
        id: 'textAppearance',
        label: 'Text Appearance',
        properties: ['textShadowOffsetX', 'textShadowOffsetY', 'textShadowBlur', 'strokeWidth'],
      },
    ])
  })

  it('keeps crop, audio, shape, and effects in their existing groups', () => {
    const blurRadius = buildEffectAnimatableProperty('gpu-gaussian-blur', 'blur-1', 'radius')

    expect(
      getPropertyAccordionGroups(['cropSoftness', 'volume', 'trimPathEnd', blurRadius]),
    ).toEqual([
      {
        id: 'crop',
        label: 'Crop',
        properties: ['cropSoftness'],
      },
      {
        id: 'audio',
        label: 'Audio',
        properties: ['volume'],
      },
      {
        id: 'shape',
        label: 'Shape',
        properties: ['trimPathEnd'],
      },
      {
        id: 'effects',
        label: 'Effects',
        properties: [blurRadius],
      },
    ])
  })
})

describe('getPropertyDisplayGroups', () => {
  it('keeps the Effects menu filter but groups displayed rows by effect instance', () => {
    const wheelsExposure = buildEffectAnimatableProperty('gpu-color-wheels', 'wheels-1', 'exposure')
    const wheelsTint = buildEffectAnimatableProperty('gpu-color-wheels', 'wheels-1', 'tint')
    const blurRadius = buildEffectAnimatableProperty('gpu-gaussian-blur', 'blur-1', 'radius')

    expect(getPropertyAccordionGroups([wheelsExposure, wheelsTint, blurRadius])).toEqual([
      {
        id: 'effects',
        label: 'Effects',
        properties: [wheelsExposure, wheelsTint, blurRadius],
      },
    ])
    expect(getPropertyDisplayGroups([wheelsExposure, wheelsTint, blurRadius])).toEqual([
      {
        id: 'effect:wheels-1',
        label: 'Color Wheels',
        properties: [wheelsExposure, wheelsTint],
      },
      {
        id: 'effect:blur-1',
        label: 'Gaussian Blur',
        properties: [blurRadius],
      },
    ])
  })
})
