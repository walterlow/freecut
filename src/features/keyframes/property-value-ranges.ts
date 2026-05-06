import { getGpuEffect } from '@/infrastructure/gpu/effects'
import {
  isBuiltInAnimatableProperty,
  parseEffectAnimatableProperty,
  type AnimatableProperty,
  type BuiltInAnimatableProperty,
} from '@/types/keyframe'

export interface PropertyValueRange {
  property: AnimatableProperty
  min: number
  max: number
  unit: string
  decimals: number
}

const BUILT_IN_PROPERTY_VALUE_RANGES: Record<BuiltInAnimatableProperty, PropertyValueRange> = {
  x: { property: 'x', min: -1000, max: 2000, unit: 'px', decimals: 0 },
  y: { property: 'y', min: -1000, max: 2000, unit: 'px', decimals: 0 },
  width: { property: 'width', min: 0, max: 2000, unit: 'px', decimals: 0 },
  height: { property: 'height', min: 0, max: 2000, unit: 'px', decimals: 0 },
  anchorX: { property: 'anchorX', min: -1000, max: 2000, unit: 'px', decimals: 0 },
  anchorY: { property: 'anchorY', min: -1000, max: 2000, unit: 'px', decimals: 0 },
  rotation: { property: 'rotation', min: -360, max: 360, unit: '°', decimals: 1 },
  opacity: { property: 'opacity', min: 0, max: 1, unit: '', decimals: 2 },
  cornerRadius: { property: 'cornerRadius', min: 0, max: 1000, unit: 'px', decimals: 0 },
  cropLeft: { property: 'cropLeft', min: 0, max: 4000, unit: 'px', decimals: 0 },
  cropRight: { property: 'cropRight', min: 0, max: 4000, unit: 'px', decimals: 0 },
  cropTop: { property: 'cropTop', min: 0, max: 4000, unit: 'px', decimals: 0 },
  cropBottom: { property: 'cropBottom', min: 0, max: 4000, unit: 'px', decimals: 0 },
  cropSoftness: { property: 'cropSoftness', min: -2000, max: 2000, unit: 'px', decimals: 0 },
  volume: { property: 'volume', min: -60, max: 20, unit: 'dB', decimals: 1 },
  textStyleScale: { property: 'textStyleScale', min: 0.5, max: 3, unit: 'x', decimals: 2 },
  fontSize: { property: 'fontSize', min: 8, max: 500, unit: 'px', decimals: 0 },
  lineHeight: { property: 'lineHeight', min: 0.5, max: 3, unit: 'x', decimals: 2 },
  textPadding: { property: 'textPadding', min: 0, max: 160, unit: 'px', decimals: 0 },
  backgroundRadius: { property: 'backgroundRadius', min: 0, max: 200, unit: 'px', decimals: 0 },
  textShadowOffsetX: {
    property: 'textShadowOffsetX',
    min: -100,
    max: 100,
    unit: 'px',
    decimals: 0,
  },
  textShadowOffsetY: {
    property: 'textShadowOffsetY',
    min: -100,
    max: 100,
    unit: 'px',
    decimals: 0,
  },
  textShadowBlur: { property: 'textShadowBlur', min: 0, max: 80, unit: 'px', decimals: 0 },
  strokeWidth: { property: 'strokeWidth', min: 0, max: 24, unit: 'px', decimals: 0 },
}

function getDecimalsFromStep(step: number | undefined): number {
  if (step === undefined || !Number.isFinite(step) || step >= 1) {
    return 0
  }

  const normalized = step.toString()
  const decimalIndex = normalized.indexOf('.')
  return decimalIndex === -1 ? 0 : normalized.length - decimalIndex - 1
}

function inferUnit(label: string): string {
  if (label.includes('Hue')) return '°'
  if (label.includes('(EV)')) return 'EV'
  return ''
}

export function getPropertyValueRange(property: AnimatableProperty): PropertyValueRange | null {
  if (isBuiltInAnimatableProperty(property)) {
    return BUILT_IN_PROPERTY_VALUE_RANGES[property]
  }

  const parsed = parseEffectAnimatableProperty(property)
  if (!parsed) {
    return null
  }

  const definition = getGpuEffect(parsed.gpuEffectType)
  const param = definition?.params[parsed.paramKey]
  if (!definition || !param || param.type !== 'number') {
    return null
  }

  return {
    property,
    min: param.min ?? 0,
    max: param.max ?? 1,
    unit: inferUnit(param.label),
    decimals: getDecimalsFromStep(param.step),
  }
}

export const PROPERTY_VALUE_RANGES = new Proxy<Record<string, PropertyValueRange>>(
  { ...BUILT_IN_PROPERTY_VALUE_RANGES },
  {
    get(target, prop) {
      if (typeof prop !== 'string') {
        return undefined
      }

      return target[prop] ?? getPropertyValueRange(prop as AnimatableProperty) ?? undefined
    },
  },
) as Record<AnimatableProperty, PropertyValueRange>
