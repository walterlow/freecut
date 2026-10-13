import type { AnimatableProperty, CropAnimatableProperty } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import type { CanvasSettings } from '@/types/transform'
import { getSourceDimensions, resolveTransform } from '../deps/composition-runtime-contract'
import { getCropPropertyValue } from './animated-crop-resolver'
import { getEffectPropertyBaseValue } from './effect-animatable-properties'
import {
  getShapeAnimatableBaseValue,
  isShapeAnimatableProperty,
} from './shape-animatable-properties'
import { getTextAnimatableBaseValue, isTextAnimatableProperty } from './animated-text-item'
import {
  getPathVertexPropertyValue,
  isPathVertexAnimatableProperty,
} from './path-animatable-properties'

function isCropAnimatableProperty(
  property: AnimatableProperty,
): property is CropAnimatableProperty {
  return (
    property === 'cropLeft' ||
    property === 'cropRight' ||
    property === 'cropTop' ||
    property === 'cropBottom' ||
    property === 'cropSoftness'
  )
}

function getItemSpecificBaseValue(
  item: TimelineItem,
  property: AnimatableProperty,
): number | undefined {
  if (property === 'volume') return item.volume ?? 0
  if (item.type === 'text' && isTextAnimatableProperty(property)) {
    return getTextAnimatableBaseValue(item, property)
  }
  if (item.type === 'shape' && isShapeAnimatableProperty(property)) {
    return getShapeAnimatableBaseValue(item, property)
  }
  if (item.type === 'shape' && isPathVertexAnimatableProperty(property)) {
    return getPathVertexPropertyValue(item.pathVertices, property)
  }
  return undefined
}

export function getAnimatablePropertyBaseValue(
  item: TimelineItem,
  property: AnimatableProperty,
  canvas: CanvasSettings,
): number {
  if (property.startsWith('effect:')) {
    return getEffectPropertyBaseValue(item, property) ?? 0
  }

  const itemSpecificValue = getItemSpecificBaseValue(item, property)
  if (itemSpecificValue !== undefined) return itemSpecificValue

  if (isCropAnimatableProperty(property)) {
    const sourceDimensions = getSourceDimensions(item)
    return getCropPropertyValue(item.crop, property, {
      width: Math.max(1, sourceDimensions?.width ?? item.transform?.width ?? canvas.width),
      height: Math.max(1, sourceDimensions?.height ?? item.transform?.height ?? canvas.height),
    })
  }

  const resolved = resolveTransform(item, canvas, getSourceDimensions(item))
  return property in resolved ? resolved[property as keyof typeof resolved] : 0
}
