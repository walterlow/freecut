import { TEXT_DEFAULTS } from '@/shared/typography/text-style'
import {
  getAutoKeyframeOperation,
  isFrameInTransitionRegion,
  type AutoKeyframeOperation,
} from '@/features/preview/deps/keyframes'
import { useTransitionsStore } from '@/features/preview/deps/timeline-store'
import type { ItemKeyframes } from '@/types/keyframe'
import type { TextItem, TextSpan, TimelineItem } from '@/types/timeline'
import type { Transform } from '../types/gizmo'

type GroupTextAnimatableProperty =
  | 'textStyleScale'
  | 'fontSize'
  | 'textPadding'
  | 'backgroundRadius'
  | 'textShadowOffsetX'
  | 'textShadowOffsetY'
  | 'textShadowBlur'
  | 'strokeWidth'

export interface GroupScaledTextProperties {
  fontSize: number
  letterSpacing: number
  textPadding: number
  backgroundRadius: number
  textShadow?: TextItem['textShadow']
  stroke?: TextItem['stroke']
  textSpans?: TextSpan[]
  textStyleScale?: number
}

export interface GroupTextScaleCommit {
  autoKeyframeOperations: AutoKeyframeOperation[]
  itemUpdates: Partial<TextItem>
}

function scaleTextProperties(item: TextItem, factor: number): GroupScaledTextProperties {
  return {
    fontSize: (item.fontSize ?? TEXT_DEFAULTS.fontSize) * factor,
    letterSpacing: (item.letterSpacing ?? TEXT_DEFAULTS.letterSpacing) * factor,
    textPadding: (item.textPadding ?? TEXT_DEFAULTS.textPadding) * factor,
    backgroundRadius: (item.backgroundRadius ?? 0) * factor,
    textShadow: item.textShadow
      ? {
          ...item.textShadow,
          offsetX: item.textShadow.offsetX * factor,
          offsetY: item.textShadow.offsetY * factor,
          blur: item.textShadow.blur * factor,
        }
      : undefined,
    stroke: item.stroke
      ? {
          ...item.stroke,
          width: item.stroke.width * factor,
        }
      : undefined,
    textSpans: item.textSpans?.map((span) => ({
      ...span,
      fontSize: span.fontSize === undefined ? undefined : span.fontSize * factor,
      letterSpacing: span.letterSpacing === undefined ? undefined : span.letterSpacing * factor,
    })),
    textStyleScale: item.textStyleScale === undefined ? undefined : item.textStyleScale * factor,
  }
}

/**
 * Build the non-transform updates that make text content participate in a
 * Figma-style group resize. Media content already follows its resized wrapper;
 * text metrics are authored independently and therefore need to be scaled too.
 */
export function buildGroupScaledTextProperties(
  items: readonly TimelineItem[],
  startTransforms: ReadonlyMap<string, Transform>,
  nextTransforms: ReadonlyMap<string, Transform>,
): Map<string, GroupScaledTextProperties> {
  const updates = new Map<string, GroupScaledTextProperties>()

  for (const item of items) {
    if (item.type !== 'text') continue
    const start = startTransforms.get(item.id)
    const next = nextTransforms.get(item.id)
    if (!start || !next || start.width <= 0) continue

    const factor = next.width / start.width
    if (!Number.isFinite(factor) || factor <= 0) continue
    updates.set(item.id, scaleTextProperties(item, factor))
  }

  return updates
}

function getGroupTextKeyframeOperation(
  item: TextItem,
  itemKeyframes: ItemKeyframes | undefined,
  property: GroupTextAnimatableProperty,
  value: number,
  currentFrame: number,
  forceFrameScoped: boolean,
): AutoKeyframeOperation | null {
  const automatic = getAutoKeyframeOperation(item, itemKeyframes, property, value, currentFrame)
  if (automatic || !forceFrameScoped) return automatic

  const relativeFrame = currentFrame - item.from
  if (
    relativeFrame < 0 ||
    relativeFrame >= item.durationInFrames ||
    isFrameInTransitionRegion(
      relativeFrame,
      item.id,
      item,
      useTransitionsStore.getState().transitions,
    )
  ) {
    return null
  }

  return {
    type: 'add',
    itemId: item.id,
    property,
    frame: relativeFrame,
    value,
    easing: 'linear',
  }
}

/**
 * Split a grouped text resize into frame-specific typography keyframes and
 * base-item writes. A keyed Scale/width/height commit forces the scalable text
 * metrics into the same frame even when those text lanes do not exist yet.
 */
export function buildGroupTextScaleCommit(
  item: TextItem,
  itemKeyframes: ItemKeyframes | undefined,
  updates: GroupScaledTextProperties,
  currentFrame: number,
  forceFrameScoped: boolean,
): GroupTextScaleCommit {
  const autoKeyframeOperations: AutoKeyframeOperation[] = []
  const itemUpdates: Partial<TextItem> = {
    letterSpacing: updates.letterSpacing,
    textSpans: updates.textSpans,
  }

  const commitScalar = (
    property: GroupTextAnimatableProperty,
    value: number | undefined,
    writeBase: (value: number) => void,
  ): boolean => {
    if (value === undefined) return false
    const operation = getGroupTextKeyframeOperation(
      item,
      itemKeyframes,
      property,
      value,
      currentFrame,
      forceFrameScoped,
    )
    if (operation) {
      autoKeyframeOperations.push(operation)
      return true
    }
    writeBase(value)
    return false
  }

  commitScalar('fontSize', updates.fontSize, (value) => {
    itemUpdates.fontSize = value
  })
  commitScalar('textPadding', updates.textPadding, (value) => {
    itemUpdates.textPadding = value
  })
  commitScalar('backgroundRadius', updates.backgroundRadius, (value) => {
    itemUpdates.backgroundRadius = value
  })
  commitScalar('textStyleScale', updates.textStyleScale, (value) => {
    itemUpdates.textStyleScale = value
  })

  if (updates.textShadow) {
    const baseShadow = { ...updates.textShadow }
    let hasBaseShadowUpdate = false
    const shadowProperties = [
      ['textShadowOffsetX', 'offsetX'],
      ['textShadowOffsetY', 'offsetY'],
      ['textShadowBlur', 'blur'],
    ] as const

    for (const [property, field] of shadowProperties) {
      const keyframed = commitScalar(property, updates.textShadow[field], (value) => {
        baseShadow[field] = value
        hasBaseShadowUpdate = true
      })
      if (keyframed) baseShadow[field] = item.textShadow?.[field] ?? 0
    }
    if (hasBaseShadowUpdate) itemUpdates.textShadow = baseShadow
  }

  if (updates.stroke) {
    const keyframed = commitScalar('strokeWidth', updates.stroke.width, () => {})
    if (!keyframed) itemUpdates.stroke = updates.stroke
  }

  return { autoKeyframeOperations, itemUpdates }
}
