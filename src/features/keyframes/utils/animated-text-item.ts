import type { BuiltInAnimatableProperty, ItemKeyframes } from '@/types/keyframe'
import type { TextItem } from '@/types/timeline'
import type { CanvasSettings } from '@/types/transform'
import { applyTextStylePresetToItem } from '@/shared/typography/text-style-presets'
import {
  formatTextCounterValue,
  getTextCounterRampValue,
} from '@/shared/typography/text-counter'
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
  | 'counterValue'

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
  'counterValue',
]

const TEXT_ANIMATABLE_PROPERTY_SET = new Set<TextAnimatableProperty>(TEXT_ANIMATABLE_PROPERTIES)
const DEFAULT_SHADOW_COLOR = '#000000'
const DEFAULT_STROKE_COLOR = '#111827'
const TEXT_ANIMATABLE_BASE_VALUE: Record<TextAnimatableProperty, (item: TextItem) => number> = {
  textStyleScale: (item) => item.textStyleScale ?? 1,
  fontSize: (item) => item.fontSize ?? 60,
  lineHeight: (item) => item.lineHeight ?? 1.2,
  textPadding: (item) => item.textPadding ?? 16,
  backgroundRadius: (item) => item.backgroundRadius ?? 0,
  textShadowOffsetX: (item) => item.textShadow?.offsetX ?? 0,
  textShadowOffsetY: (item) => item.textShadow?.offsetY ?? 0,
  textShadowBlur: (item) => item.textShadow?.blur ?? 0,
  strokeWidth: (item) => item.stroke?.width ?? 0,
  counterValue: (item) => item.textCounter?.from ?? 0,
}

export function isTextAnimatableProperty(
  property: BuiltInAnimatableProperty | string,
): property is TextAnimatableProperty {
  return TEXT_ANIMATABLE_PROPERTY_SET.has(property as TextAnimatableProperty)
}

export function getTextAnimatableBaseValue(
  item: TextItem,
  property: TextAnimatableProperty,
): number {
  return TEXT_ANIMATABLE_BASE_VALUE[property](item)
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

interface ResolvedTextAnimation {
  isAnimated: boolean
  value: number | undefined
}

function resolveTextAnimation(
  item: TextItem,
  itemKeyframes: ItemKeyframes | undefined,
  frame: number,
  property: TextAnimatableProperty,
  fallback: number | undefined,
  minimum?: number,
): ResolvedTextAnimation {
  const isAnimated = hasAnimatedTextProperty(itemKeyframes, property)
  if (!isAnimated) {
    return { isAnimated, value: fallback }
  }

  const value = resolveAnimatedTextProperty(item, itemKeyframes, frame, property)
  return {
    isAnimated,
    value: minimum === undefined ? value : Math.max(minimum, value),
  }
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

function resolvePresetTextItem(
  item: TextItem,
  canvas: CanvasSettings,
  scale: ResolvedTextAnimation,
): TextItem {
  if (!item.textStylePresetId || !scale.isAnimated) {
    return item
  }

  return {
    ...item,
    ...applyTextStylePresetToItem(item, item.textStylePresetId, canvas, scale.value ?? 1),
  }
}

function resolveTextStyleScale(
  item: TextItem,
  resolved: TextItem,
  scale: ResolvedTextAnimation,
): TextItem['textStyleScale'] {
  if (!item.textStylePresetId) {
    return resolved.textStyleScale
  }

  return scale.isAnimated ? scale.value : resolved.textStyleScale
}

function hasAnyResolvedAnimation(animations: ResolvedTextAnimation[]): boolean {
  return animations.some((animation) => animation.isAnimated)
}

function resolveAnimationValue(animation: ResolvedTextAnimation, fallback: number): number {
  if (animation.value === undefined) {
    return fallback
  }

  return animation.value
}

function resolveTextShadowColor(item: TextItem, resolved: TextItem): string {
  if (resolved.textShadow?.color) {
    return resolved.textShadow.color
  }

  if (item.textShadow?.color) {
    return item.textShadow.color
  }

  return DEFAULT_SHADOW_COLOR
}

function resolveTextShadow(
  item: TextItem,
  resolved: TextItem,
  offsetX: ResolvedTextAnimation,
  offsetY: ResolvedTextAnimation,
  blur: ResolvedTextAnimation,
): TextItem['textShadow'] {
  const hasShadowAnimation = hasAnyResolvedAnimation([offsetX, offsetY, blur])
  if (!hasShadowAnimation && !resolved.textShadow) {
    return undefined
  }

  return normalizeShadow({
    offsetX: resolveAnimationValue(offsetX, 0),
    offsetY: resolveAnimationValue(offsetY, 0),
    blur: resolveAnimationValue(blur, 0),
    color: resolveTextShadowColor(item, resolved),
  })
}

function resolveStroke(
  item: TextItem,
  resolved: TextItem,
  width: ResolvedTextAnimation,
): TextItem['stroke'] {
  if (!width.isAnimated && !resolved.stroke) {
    return undefined
  }

  return normalizeStroke({
    width: width.value ?? 0,
    color: resolved.stroke?.color ?? item.stroke?.color ?? DEFAULT_STROKE_COLOR,
  })
}

/**
 * Current numeric value of an enabled text counter: `counterValue` keyframes
 * when present, otherwise the eased `from` → `to` ramp across the clip.
 * Returns undefined when the item has no enabled counter.
 */
export function resolveTextCounterValue(
  item: TextItem,
  itemKeyframes: ItemKeyframes | undefined,
  frame: number,
): number | undefined {
  const counter = item.textCounter
  if (!counter?.enabled) return undefined

  const keyframes = getPropertyKeyframes(itemKeyframes, 'counterValue')
  if (keyframes.length > 0) {
    return interpolatePropertyValue(keyframes, frame, counter.from)
  }
  return getTextCounterRampValue(counter, frame, item.durationInFrames)
}

function applyTextCounter(
  item: TextItem,
  itemKeyframes: ItemKeyframes | undefined,
  frame: number,
): TextItem {
  const value = resolveTextCounterValue(item, itemKeyframes, frame)
  if (value === undefined || !item.textCounter) return item

  const text = formatTextCounterValue(item.textCounter, value)
  // Structured spans render instead of `text`; keep the first span's styling
  // so a styled counter still shows the generated number.
  const firstSpan = item.textSpans?.[0]
  return {
    ...item,
    text,
    textSpans: firstSpan ? [{ ...firstSpan, text }] : undefined,
  }
}

export function resolveAnimatedTextItem(
  item: TextItem,
  itemKeyframes: ItemKeyframes | undefined,
  frame: number,
  canvas: CanvasSettings,
): TextItem {
  const resolveProperty = (
    property: TextAnimatableProperty,
    fallback: number | undefined,
    minimum?: number,
  ) => resolveTextAnimation(item, itemKeyframes, frame, property, fallback, minimum)

  const scale = resolveProperty('textStyleScale', item.textStyleScale)
  const resolved = applyTextCounter(
    resolvePresetTextItem(item, canvas, scale),
    itemKeyframes,
    frame,
  )

  const fontSize = resolveProperty('fontSize', resolved.fontSize, 1)
  const lineHeight = resolveProperty('lineHeight', resolved.lineHeight, 0.1)
  const textPadding = resolveProperty('textPadding', resolved.textPadding, 0)
  const backgroundRadius = resolveProperty('backgroundRadius', resolved.backgroundRadius, 0)
  const shadowOffsetX = resolveProperty('textShadowOffsetX', resolved.textShadow?.offsetX)
  const shadowOffsetY = resolveProperty('textShadowOffsetY', resolved.textShadow?.offsetY)
  const shadowBlur = resolveProperty('textShadowBlur', resolved.textShadow?.blur, 0)
  const strokeWidth = resolveProperty('strokeWidth', resolved.stroke?.width, 0)

  return {
    ...resolved,
    fontSize: fontSize.value,
    lineHeight: lineHeight.value,
    textPadding: textPadding.value,
    backgroundRadius: backgroundRadius.value,
    textStyleScale: resolveTextStyleScale(item, resolved, scale),
    textShadow: resolveTextShadow(item, resolved, shadowOffsetX, shadowOffsetY, shadowBlur),
    stroke: resolveStroke(item, resolved, strokeWidth),
  }
}
