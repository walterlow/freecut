import type { CropSettings } from '@/types/transform'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface CropInsets {
  left: number
  right: number
  top: number
  bottom: number
}

export interface ResolvedCropSettings {
  left: number
  right: number
  top: number
  bottom: number
  softness: number
}

export interface MediaCropLayout {
  mediaRect: Rect
  cropViewportRect: Rect
  viewportRect: Rect
  cropPixels: CropInsets
  crop: ResolvedCropSettings
  softnessPixels: number
  featherPixels: CropInsets
}

const MAX_EDGE_SUM = 0.999

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function clampSigned01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value <= -1) return -1
  if (value >= 1) return 1
  return value
}

function clampAxisPair(start: number, end: number): [number, number] {
  const total = start + end
  if (total <= MAX_EDGE_SUM) {
    return [start, end]
  }

  if (total <= 0) {
    return [0, 0]
  }

  const scale = MAX_EDGE_SUM / total
  return [start * scale, end * scale]
}

function clampFeatherAxis(start: number, end: number, dimension: number): [number, number] {
  if (!Number.isFinite(dimension) || dimension <= 0) {
    return [0, 0]
  }

  const clampedStart = Math.max(0, Math.min(start, dimension))
  const clampedEnd = Math.max(0, Math.min(end, dimension))
  const total = clampedStart + clampedEnd
  if (total <= dimension) {
    return [clampedStart, clampedEnd]
  }

  if (total <= 0) {
    return [0, 0]
  }

  const scale = dimension / total
  return [clampedStart * scale, clampedEnd * scale]
}

export function getCropSoftnessReferenceDimension(width: number, height: number): number {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 0
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 0
  if (safeWidth === 0 || safeHeight === 0) {
    return Math.max(safeWidth, safeHeight)
  }
  return Math.min(safeWidth, safeHeight)
}

export function resolveCropSettings(crop?: CropSettings): ResolvedCropSettings {
  const [left, right] = clampAxisPair(clamp01(crop?.left ?? 0), clamp01(crop?.right ?? 0))
  const [top, bottom] = clampAxisPair(clamp01(crop?.top ?? 0), clamp01(crop?.bottom ?? 0))
  const softness = clampSigned01(crop?.softness ?? 0)

  return { left, right, top, bottom, softness }
}

export function normalizeCropSettings(crop?: CropSettings): CropSettings | undefined {
  if (!crop) return undefined

  const normalized = resolveCropSettings(crop)
  if (
    normalized.left === 0 &&
    normalized.right === 0 &&
    normalized.top === 0 &&
    normalized.bottom === 0
  ) {
    return undefined
  }

  return normalized
}

export function hasMediaCrop(crop?: CropSettings): boolean {
  const normalized = resolveCropSettings(crop)
  return normalized.left > 0 || normalized.right > 0 || normalized.top > 0 || normalized.bottom > 0
}

export function cropRatioToPixels(ratio: number | undefined, dimension: number): number {
  if (!Number.isFinite(dimension) || dimension <= 0) return 0
  return clamp01(ratio ?? 0) * dimension
}

export function cropPixelsToRatio(pixels: number, dimension: number): number {
  if (!Number.isFinite(dimension) || dimension <= 0) return 0
  return clamp01(pixels / dimension)
}

export function cropSignedRatioToPixels(ratio: number | undefined, dimension: number): number {
  if (!Number.isFinite(dimension) || dimension <= 0) return 0
  return clampSigned01(ratio ?? 0) * dimension
}

export function cropSignedPixelsToRatio(pixels: number, dimension: number): number {
  if (!Number.isFinite(dimension) || dimension <= 0) return 0
  return clampSigned01(pixels / dimension)
}

export function calculateContainedRect(
  sourceWidth: number,
  sourceHeight: number,
  containerWidth: number,
  containerHeight: number,
): Rect {
  if (
    !Number.isFinite(sourceWidth) ||
    sourceWidth <= 0 ||
    !Number.isFinite(sourceHeight) ||
    sourceHeight <= 0 ||
    !Number.isFinite(containerWidth) ||
    containerWidth <= 0 ||
    !Number.isFinite(containerHeight) ||
    containerHeight <= 0
  ) {
    return {
      x: 0,
      y: 0,
      width: Math.max(0, containerWidth),
      height: Math.max(0, containerHeight),
    }
  }

  const fitScale = Math.min(containerWidth / sourceWidth, containerHeight / sourceHeight)
  const width = sourceWidth * fitScale
  const height = sourceHeight * fitScale

  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height,
  }
}

export function calculateMediaCropLayout(
  sourceWidth: number,
  sourceHeight: number,
  containerWidth: number,
  containerHeight: number,
  crop?: CropSettings,
): MediaCropLayout {
  const mediaRect = calculateContainedRect(
    sourceWidth,
    sourceHeight,
    containerWidth,
    containerHeight,
  )
  const resolvedCrop = resolveCropSettings(crop)

  const cropPixels: CropInsets = {
    left: mediaRect.width * resolvedCrop.left,
    right: mediaRect.width * resolvedCrop.right,
    top: mediaRect.height * resolvedCrop.top,
    bottom: mediaRect.height * resolvedCrop.bottom,
  }

  const cropViewportRect = {
    x: mediaRect.x + cropPixels.left,
    y: mediaRect.y + cropPixels.top,
    width: Math.max(0, mediaRect.width - cropPixels.left - cropPixels.right),
    height: Math.max(0, mediaRect.height - cropPixels.top - cropPixels.bottom),
  }
  const rawSoftnessPixels = cropSignedRatioToPixels(
    resolvedCrop.softness,
    getCropSoftnessReferenceDimension(mediaRect.width, mediaRect.height),
  )
  const softnessPixels = Math.abs(rawSoftnessPixels)
  const outerExpansion: CropInsets =
    rawSoftnessPixels > 0
      ? {
          left: cropPixels.left > 0 ? Math.min(softnessPixels, cropPixels.left) : 0,
          right: cropPixels.right > 0 ? Math.min(softnessPixels, cropPixels.right) : 0,
          top: cropPixels.top > 0 ? Math.min(softnessPixels, cropPixels.top) : 0,
          bottom: cropPixels.bottom > 0 ? Math.min(softnessPixels, cropPixels.bottom) : 0,
        }
      : { left: 0, right: 0, top: 0, bottom: 0 }
  // Round to pixel boundaries — fractional viewport edges cause 1px seams
  // in both DOM (percentage rounding) and canvas (sub-pixel clip rects).
  const rawVpX = cropViewportRect.x - outerExpansion.left
  const rawVpY = cropViewportRect.y - outerExpansion.top
  const rawVpR =
    rawVpX + Math.max(0, cropViewportRect.width + outerExpansion.left + outerExpansion.right)
  const rawVpB =
    rawVpY + Math.max(0, cropViewportRect.height + outerExpansion.top + outerExpansion.bottom)
  const viewportRect = {
    x: Math.floor(rawVpX),
    y: Math.floor(rawVpY),
    width: Math.ceil(rawVpR) - Math.floor(rawVpX),
    height: Math.ceil(rawVpB) - Math.floor(rawVpY),
  }
  const featherInput: CropInsets = {
    left: cropPixels.left > 0 ? (rawSoftnessPixels > 0 ? outerExpansion.left : softnessPixels) : 0,
    right:
      cropPixels.right > 0 ? (rawSoftnessPixels > 0 ? outerExpansion.right : softnessPixels) : 0,
    top: cropPixels.top > 0 ? (rawSoftnessPixels > 0 ? outerExpansion.top : softnessPixels) : 0,
    bottom:
      cropPixels.bottom > 0 ? (rawSoftnessPixels > 0 ? outerExpansion.bottom : softnessPixels) : 0,
  }
  const [leftFeather, rightFeather] = clampFeatherAxis(
    featherInput.left,
    featherInput.right,
    viewportRect.width,
  )
  const [topFeather, bottomFeather] = clampFeatherAxis(
    featherInput.top,
    featherInput.bottom,
    viewportRect.height,
  )
  const featherPixels: CropInsets = {
    left: leftFeather,
    right: rightFeather,
    top: topFeather,
    bottom: bottomFeather,
  }

  return {
    mediaRect,
    cropViewportRect,
    viewportRect,
    cropPixels,
    crop: resolvedCrop,
    softnessPixels,
    featherPixels,
  }
}
