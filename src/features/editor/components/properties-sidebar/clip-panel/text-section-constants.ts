import type { TextItem } from '@/types/timeline'
import { FONT_WEIGHT_MAP } from '@/shared/typography/fonts'

export const FONT_WEIGHT_OPTIONS = [
  { value: 'normal', labelKey: 'regular' },
  { value: 'medium', labelKey: 'medium' },
  { value: 'semibold', labelKey: 'semibold' },
  { value: 'bold', labelKey: 'bold' },
] as const

export type FontWeightOption = (typeof FONT_WEIGHT_OPTIONS)[number]

export const FONT_WEIGHT_VALUES = FONT_WEIGHT_MAP as Record<
  NonNullable<TextItem['fontWeight']>,
  number
>

export const EMPTY_TEXT_SHADOW: NonNullable<TextItem['textShadow']> = {
  offsetX: 0,
  offsetY: 0,
  blur: 0,
  color: '#000000',
}

export const EMPTY_TEXT_STROKE: NonNullable<TextItem['stroke']> = {
  width: 0,
  color: '#111827',
}

export const TEXT_EFFECT_PRESETS = [
  {
    id: 'none',
    labelKey: 'none',
    getUpdates: (): Pick<TextItem, 'textShadow' | 'stroke'> => ({
      textShadow: undefined,
      stroke: undefined,
    }),
  },
  {
    id: 'shadow',
    labelKey: 'shadow',
    getUpdates: (): Pick<TextItem, 'textShadow' | 'stroke'> => ({
      textShadow: {
        offsetX: 4,
        offsetY: 6,
        blur: 12,
        color: '#000000',
      },
      stroke: undefined,
    }),
  },
  {
    id: 'outline',
    labelKey: 'outline',
    getUpdates: (): Pick<TextItem, 'textShadow' | 'stroke'> => ({
      textShadow: undefined,
      stroke: {
        width: 3,
        color: '#111827',
      },
    }),
  },
  {
    id: 'glow',
    labelKey: 'glow',
    getUpdates: (color: string): Pick<TextItem, 'textShadow' | 'stroke'> => ({
      textShadow: {
        offsetX: 0,
        offsetY: 0,
        blur: 18,
        color,
      },
      stroke: {
        width: 1,
        color,
      },
    }),
  },
] as const
