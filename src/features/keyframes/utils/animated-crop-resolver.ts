import type { CropSettings } from '@/types/transform'
import type { CropAnimatableProperty, ItemKeyframes } from '@/types/keyframe'
import {
  cropPixelsToRatio,
  cropRatioToPixels,
  cropSignedPixelsToRatio,
  cropSignedRatioToPixels,
  normalizeCropSettings,
} from '@/shared/utils/media-crop'
import { getPropertyKeyframes, interpolatePropertyValue } from './interpolation'

export interface CropSourceDimensions {
  width: number
  height: number
}

const CROP_ANIMATABLE_PROPERTIES: CropAnimatableProperty[] = [
  'cropLeft',
  'cropRight',
  'cropTop',
  'cropBottom',
  'cropSoftness',
]

export function getCropSoftnessReferenceDimension(dimensions: CropSourceDimensions): number {
  return Math.max(1, Math.min(dimensions.width, dimensions.height))
}

export function getCropPropertyValue(
  crop: CropSettings | undefined,
  property: CropAnimatableProperty,
  dimensions: CropSourceDimensions,
): number {
  switch (property) {
    case 'cropLeft':
      return cropRatioToPixels(crop?.left, Math.max(1, dimensions.width))
    case 'cropRight':
      return cropRatioToPixels(crop?.right, Math.max(1, dimensions.width))
    case 'cropTop':
      return cropRatioToPixels(crop?.top, Math.max(1, dimensions.height))
    case 'cropBottom':
      return cropRatioToPixels(crop?.bottom, Math.max(1, dimensions.height))
    case 'cropSoftness':
      return cropSignedRatioToPixels(crop?.softness, getCropSoftnessReferenceDimension(dimensions))
  }
}

export function setCropPropertyValue(
  crop: CropSettings | undefined,
  property: CropAnimatableProperty,
  value: number,
  dimensions: CropSourceDimensions,
): CropSettings | undefined {
  const nextCrop = { ...crop }
  const width = Math.max(1, dimensions.width)
  const height = Math.max(1, dimensions.height)

  switch (property) {
    case 'cropLeft':
      nextCrop.left = cropPixelsToRatio(value, width)
      break
    case 'cropRight':
      nextCrop.right = cropPixelsToRatio(value, width)
      break
    case 'cropTop':
      nextCrop.top = cropPixelsToRatio(value, height)
      break
    case 'cropBottom':
      nextCrop.bottom = cropPixelsToRatio(value, height)
      break
    case 'cropSoftness':
      nextCrop.softness = cropSignedPixelsToRatio(
        value,
        getCropSoftnessReferenceDimension(dimensions),
      )
      break
  }

  return normalizeCropSettings(nextCrop)
}

export function resolveAnimatedCrop(
  crop: CropSettings | undefined,
  itemKeyframes: ItemKeyframes | undefined,
  frame: number,
  dimensions: CropSourceDimensions,
): CropSettings | undefined {
  let resolvedCrop = normalizeCropSettings(crop)

  for (const property of CROP_ANIMATABLE_PROPERTIES) {
    const keyframes = getPropertyKeyframes(itemKeyframes, property)
    if (keyframes.length === 0) continue

    const baseValue = getCropPropertyValue(resolvedCrop, property, dimensions)
    const animatedValue = interpolatePropertyValue(keyframes, frame, baseValue)
    resolvedCrop = setCropPropertyValue(resolvedCrop, property, animatedValue, dimensions)
  }

  return resolvedCrop
}
