import type { BuiltInAnimatableProperty, ItemKeyframes } from '@/types/keyframe'
import type { TextItem } from '@/types/timeline'
import type { CanvasSettings } from '@/types/transform'
import { applyTextStylePresetToItem } from '@/shared/typography/text-style-presets'
import { getPropertyKeyframes, interpolatePropertyValue } from './interpolation'

export type TextAnimatableProperty =
  | 'textStyleScale'
  | 'fontSize'
  | 'lineHeight'
  | 'textPadding'
  | 'backgroundRadius'
  | 'textShadowOffsetX'
  | 'textShadowOffsetY'
  | 'textShadowBlur'
  | 'strokeWidth'

export const TEXT_ANIMATABLE_PROPERTIES: TextAnimatableProperty[] = [
  'textStyleScale',
  'fontSize',
  'lineHeight',
  'textPadding',
  'backgroundRadius',
  'textShadowOffsetX',
  'textShadowOffsetY',
  'textShadowBlur',
  'strokeWidth',
]

const TEXT_ANIMATABLE_PROPERTY_SET = new Set<TextAnimatableProperty>(TEXT_ANIMATABLE_PROPERTIES)
const DEFAULT_SHADOW_COLOR = '#000000'
const DEFAULT_STROKE_COLOR = '#111827'

export function isTextAnimatableProperty(
  property: BuiltInAnimatableProperty | string,
): property is TextAnimatableProperty {
  return TEXT_ANIMATABLE_PROPERTY_SET.has(property as TextAnimatableProperty)
}

export function getTextAnimatableBaseValue(
  item: TextItem,
  property: TextAnimatableProperty,
): number {
  switch (property) {
    case 'textStyleScale':
      return item.textStyleScale ?? 1
    case 'fontSize':
      return item.fontSize ?? 60
    case 'lineHeight':
      return item.lineHeight ?? 1.2
    case 'textPadding':
      return item.textPadding ?? 16
    case 'backgroundRadius':
      return item.backgroundRadius ?? 0
    case 'textShadowOffsetX':
      return item.textShadow?.offsetX ?? 0
    case 'textShadowOffsetY':
      return item.textShadow?.offsetY ?? 0
    case 'textShadowBlur':
      return item.textShadow?.blur ?? 0
    case 'strokeWidth':
      return item.stroke?.width ?? 0
  }
}

function resolveAnimatedTextProperty(
  item: TextItem,
  itemKeyframes: ItemKeyframes | undefined,
  frame: number,
  property: TextAnimatableProperty,
): number {
  return interpolatePropertyValue(
    getPropertyKeyframes(itemKeyframes, property),
    frame,
    getTextAnimatableBaseValue(item, property),
  )
}

function hasAnimatedTextProperty(
  itemKeyframes: ItemKeyframes | undefined,
  property: TextAnimatableProperty,
): boolean {
  return getPropertyKeyframes(itemKeyframes, property).length > 0
}

function normalizeShadow(shadow: NonNullable<TextItem['textShadow']>): TextItem['textShadow'] {
  if (shadow.offsetX === 0 && shadow.offsetY === 0 && shadow.blur === 0) {
    return undefined
  }

  return shadow
}

function normalizeStroke(stroke: NonNullable<TextItem['stroke']>): TextItem['stroke'] {
  if (stroke.width <= 0) {
    return undefined
  }

  return stroke
}

export function resolveAnimatedTextItem(
  item: TextItem,
  itemKeyframes: ItemKeyframes | undefined,
  frame: number,
  canvas: CanvasSettings,
): TextItem {
  let resolved = item
  const hasScaleAnimation = hasAnimatedTextProperty(itemKeyframes, 'textStyleScale')

  if (item.textStylePresetId) {
    if (hasScaleAnimation) {
      resolved = {
        ...item,
        ...applyTextStylePresetToItem(
          item,
          item.textStylePresetId,
          canvas,
          resolveAnimatedTextProperty(item, itemKeyframes, frame, 'textStyleScale'),
        ),
      }
    }
  }

  const hasFontSizeAnimation = hasAnimatedTextProperty(itemKeyframes, 'fontSize')
  const hasLineHeightAnimation = hasAnimatedTextProperty(itemKeyframes, 'lineHeight')
  const hasTextPaddingAnimation = hasAnimatedTextProperty(itemKeyframes, 'textPadding')
  const hasBackgroundRadiusAnimation = hasAnimatedTextProperty(itemKeyframes, 'backgroundRadius')
  const hasShadowOffsetXAnimation = hasAnimatedTextProperty(itemKeyframes, 'textShadowOffsetX')
  const hasShadowOffsetYAnimation = hasAnimatedTextProperty(itemKeyframes, 'textShadowOffsetY')
  const hasShadowBlurAnimation = hasAnimatedTextProperty(itemKeyframes, 'textShadowBlur')
  const hasStrokeWidthAnimation = hasAnimatedTextProperty(itemKeyframes, 'strokeWidth')

  const nextFontSize = hasFontSizeAnimation
    ? Math.max(1, resolveAnimatedTextProperty(item, itemKeyframes, frame, 'fontSize'))
    : resolved.fontSize
  const nextLineHeight = hasLineHeightAnimation
    ? Math.max(0.1, resolveAnimatedTextProperty(item, itemKeyframes, frame, 'lineHeight'))
    : resolved.lineHeight
  const nextTextPadding = hasTextPaddingAnimation
    ? Math.max(0, resolveAnimatedTextProperty(item, itemKeyframes, frame, 'textPadding'))
    : resolved.textPadding
  const nextBackgroundRadius = hasBackgroundRadiusAnimation
    ? Math.max(0, resolveAnimatedTextProperty(item, itemKeyframes, frame, 'backgroundRadius'))
    : resolved.backgroundRadius
  const nextShadowOffsetX = hasShadowOffsetXAnimation
    ? resolveAnimatedTextProperty(item, itemKeyframes, frame, 'textShadowOffsetX')
    : resolved.textShadow?.offsetX
  const nextShadowOffsetY = hasShadowOffsetYAnimation
    ? resolveAnimatedTextProperty(item, itemKeyframes, frame, 'textShadowOffsetY')
    : resolved.textShadow?.offsetY
  const nextShadowBlur = hasShadowBlurAnimation
    ? Math.max(0, resolveAnimatedTextProperty(item, itemKeyframes, frame, 'textShadowBlur'))
    : resolved.textShadow?.blur
  const nextStrokeWidth = hasStrokeWidthAnimation
    ? Math.max(0, resolveAnimatedTextProperty(item, itemKeyframes, frame, 'strokeWidth'))
    : resolved.stroke?.width

  return {
    ...resolved,
    fontSize: nextFontSize,
    lineHeight: nextLineHeight,
    textPadding: nextTextPadding,
    backgroundRadius: nextBackgroundRadius,
    textStyleScale: item.textStylePresetId
      ? hasScaleAnimation
        ? resolveAnimatedTextProperty(item, itemKeyframes, frame, 'textStyleScale')
        : resolved.textStyleScale
      : resolved.textStyleScale,
    textShadow:
      hasShadowOffsetXAnimation ||
      hasShadowOffsetYAnimation ||
      hasShadowBlurAnimation ||
      resolved.textShadow
        ? normalizeShadow({
            offsetX: nextShadowOffsetX ?? 0,
            offsetY: nextShadowOffsetY ?? 0,
            blur: nextShadowBlur ?? 0,
            color: resolved.textShadow?.color ?? item.textShadow?.color ?? DEFAULT_SHADOW_COLOR,
          })
        : undefined,
    stroke:
      hasStrokeWidthAnimation || resolved.stroke
        ? normalizeStroke({
            width: nextStrokeWidth ?? 0,
            color: resolved.stroke?.color ?? item.stroke?.color ?? DEFAULT_STROKE_COLOR,
          })
        : undefined,
  }
}
