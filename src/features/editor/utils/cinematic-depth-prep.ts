import type { ImageItem } from '@/types/timeline'

export interface DepthPixelPlane {
  data: ArrayLike<number>
  width: number
  height: number
  channels: 1 | 2 | 3 | 4
}

export interface DepthSubjectMask {
  alpha: Uint8ClampedArray
  width: number
  height: number
  coverage: number
  contrast: number
  quality: number
  polarity: 'bright-near' | 'dark-near'
}

export interface SubjectMaskSelection {
  mask: DepthSubjectMask
  source: 'matting' | 'depth'
}

interface MaskCandidate {
  alpha: Uint8ClampedArray
  coverage: number
  centerBias: number
  edgeLeak: number
  polarity: DepthSubjectMask['polarity']
  score: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return x * x * (3 - 2 * x)
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const index = clamp(Math.round((sorted.length - 1) * fraction), 0, sorted.length - 1)
  return sorted[index] ?? 0
}

function pixelValue(plane: DepthPixelPlane, index: number): number {
  const offset = index * plane.channels
  if (plane.channels === 1) return plane.data[offset] ?? 0

  const red = plane.data[offset] ?? 0
  const green = plane.data[offset + 1] ?? red
  const blue = plane.data[offset + 2] ?? green
  return (red + green + blue) / 3
}

function alphaAt(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const sx = clamp(x, 0, width - 1)
  const sy = clamp(y, 0, height - 1)
  return alpha[sy * width + sx] ?? 0
}

function featherAlpha(alpha: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(alpha.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const total =
        alphaAt(alpha, width, height, x, y) * 4 +
        alphaAt(alpha, width, height, x - 1, y) * 2 +
        alphaAt(alpha, width, height, x + 1, y) * 2 +
        alphaAt(alpha, width, height, x, y - 1) * 2 +
        alphaAt(alpha, width, height, x, y + 1) * 2 +
        alphaAt(alpha, width, height, x - 1, y - 1) +
        alphaAt(alpha, width, height, x + 1, y - 1) +
        alphaAt(alpha, width, height, x - 1, y + 1) +
        alphaAt(alpha, width, height, x + 1, y + 1)
      out[y * width + x] = Math.round(total / 16)
    }
  }
  return out
}

function scoreAlpha(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
): {
  coverage: number
  centerBias: number
  edgeLeak: number
} {
  let alphaTotal = 0
  let centerTotal = 0
  let edgeTotal = 0
  const cx = (width - 1) / 2
  const cy = (height - 1) / 2
  const radius = Math.max(1, Math.min(width, height) * 0.5)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = (alpha[y * width + x] ?? 0) / 255
      alphaTotal += value

      const dx = (x - cx) / radius
      const dy = (y - cy) / radius
      const centerWeight = Math.exp(-(dx * dx + dy * dy) * 2.2)
      centerTotal += value * centerWeight

      const edgeDistance = Math.min(x, y, width - 1 - x, height - 1 - y)
      if (edgeDistance <= Math.max(1, Math.round(Math.min(width, height) * 0.06))) {
        edgeTotal += value
      }
    }
  }

  const pixelCount = Math.max(1, width * height)
  return {
    coverage: alphaTotal / pixelCount,
    centerBias: alphaTotal > 0 ? centerTotal / alphaTotal : 0,
    edgeLeak: edgeTotal / pixelCount,
  }
}

function createCandidate(params: {
  values: number[]
  width: number
  height: number
  low: number
  mid: number
  high: number
  polarity: DepthSubjectMask['polarity']
}): MaskCandidate {
  const alpha = new Uint8ClampedArray(params.values.length)
  for (let index = 0; index < params.values.length; index += 1) {
    const value = params.values[index] ?? 0
    const normalized =
      params.polarity === 'bright-near'
        ? smoothstep(params.mid, params.high, value)
        : 1 - smoothstep(params.low, params.mid, value)
    alpha[index] = Math.round(clamp(normalized, 0, 1) * 255)
  }

  const feathered = featherAlpha(
    featherAlpha(alpha, params.width, params.height),
    params.width,
    params.height,
  )
  const scored = scoreAlpha(feathered, params.width, params.height)
  const coverageTargetPenalty = Math.abs(scored.coverage - 0.34) * 1.65
  const tinyPenalty = scored.coverage < 0.08 ? 0.8 : 0
  const fullFramePenalty = scored.coverage > 0.68 ? 0.8 : 0
  const score =
    scored.centerBias * 1.3 -
    coverageTargetPenalty -
    scored.edgeLeak * 1.1 -
    tinyPenalty -
    fullFramePenalty

  return {
    alpha: feathered,
    coverage: scored.coverage,
    centerBias: scored.centerBias,
    edgeLeak: scored.edgeLeak,
    polarity: params.polarity,
    score,
  }
}

function averagePixels(
  values: number[],
  width: number,
  height: number,
  includePixel: (x: number, y: number) => boolean,
): number {
  let total = 0
  let count = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!includePixel(x, y)) continue
      total += values[y * width + x] ?? 0
      count += 1
    }
  }

  return count > 0 ? total / count : 0
}

function centerMinusBorderMean(values: number[], width: number, height: number): number {
  const cx = (width - 1) / 2
  const cy = (height - 1) / 2
  const centerRadius = Math.min(width, height) * 0.3
  const borderSize = Math.max(1, Math.round(Math.min(width, height) * 0.14))
  const centerMean = averagePixels(values, width, height, (x, y) => {
    const dx = x - cx
    const dy = y - cy
    return Math.sqrt(dx * dx + dy * dy) <= centerRadius
  })
  const borderMean = averagePixels(
    values,
    width,
    height,
    (x, y) =>
      x < borderSize || y < borderSize || x >= width - borderSize || y >= height - borderSize,
  )
  return centerMean - borderMean
}

export function buildDepthSubjectMask(plane: DepthPixelPlane): DepthSubjectMask {
  const pixelCount = Math.max(0, plane.width * plane.height)
  const values = Array.from({ length: pixelCount }, (_, index) => pixelValue(plane, index))
  const sorted = [...values].sort((left, right) => left - right)
  const p10 = percentile(sorted, 0.1)
  const p25 = percentile(sorted, 0.25)
  const p75 = percentile(sorted, 0.75)
  const p90 = percentile(sorted, 0.9)
  const contrast = clamp((p90 - p10) / 255, 0, 1)

  const bright = createCandidate({
    values,
    width: plane.width,
    height: plane.height,
    low: p25,
    mid: p75,
    high: p90,
    polarity: 'bright-near',
  })
  const dark = createCandidate({
    values,
    width: plane.width,
    height: plane.height,
    low: p10,
    mid: p25,
    high: p75,
    polarity: 'dark-near',
  })
  const centerDelta = centerMinusBorderMean(values, plane.width, plane.height)
  const chosen =
    centerDelta > 8 ? bright : centerDelta < -8 ? dark : bright.score >= dark.score ? bright : dark
  const coverageFit = 1 - clamp(Math.abs(chosen.coverage - 0.34) / 0.34, 0, 1)
  const quality = clamp(
    0.48 + contrast * 0.32 + coverageFit * 0.16 + chosen.centerBias * 0.12,
    0.35,
    0.96,
  )

  return {
    alpha: chosen.alpha,
    width: plane.width,
    height: plane.height,
    coverage: chosen.coverage,
    contrast,
    quality,
    polarity: chosen.polarity,
  }
}

/**
 * Convert the alpha channel from a background-removal model into the mask
 * format used by the 2.5D plate builder. Flat or nearly empty mattes are
 * rejected so depth estimation remains a dependable fallback.
 */
export function buildAlphaSubjectMask(plane: DepthPixelPlane): DepthSubjectMask | null {
  if (plane.channels < 2 || plane.width < 1 || plane.height < 1) return null

  const pixelCount = plane.width * plane.height
  const alphaChannel = plane.channels - 1
  const rawAlpha = new Uint8ClampedArray(pixelCount)
  const values = new Array<number>(pixelCount)

  for (let index = 0; index < pixelCount; index += 1) {
    const value = clamp(plane.data[index * plane.channels + alphaChannel] ?? 0, 0, 255)
    rawAlpha[index] = Math.round(value)
    values[index] = value
  }

  const sorted = [...values].sort((left, right) => left - right)
  const contrast = clamp((percentile(sorted, 0.9) - percentile(sorted, 0.1)) / 255, 0, 1)
  const alpha = featherAlpha(rawAlpha, plane.width, plane.height)
  const scored = scoreAlpha(alpha, plane.width, plane.height)

  if (contrast < 0.08 || scored.coverage < 0.025 || scored.coverage > 0.88) return null

  const coverageFit = 1 - clamp(Math.abs(scored.coverage - 0.34) / 0.54, 0, 1)
  const quality = clamp(
    0.5 + contrast * 0.28 + coverageFit * 0.12 + scored.centerBias * 0.14 - scored.edgeLeak * 0.16,
    0.35,
    0.98,
  )

  return {
    alpha,
    width: plane.width,
    height: plane.height,
    coverage: scored.coverage,
    contrast,
    quality,
    polarity: 'bright-near',
  }
}

export function selectCinematicSubjectMask(params: {
  depthMask: DepthSubjectMask
  matteMask?: DepthSubjectMask | null
}): SubjectMaskSelection {
  const matte = params.matteMask
  if (matte && matte.quality >= Math.max(0.58, params.depthMask.quality - 0.08)) {
    return { mask: matte, source: 'matting' }
  }
  return { mask: params.depthMask, source: 'depth' }
}

export function createCinematicDepthSourceId(item: ImageItem): string {
  return item.cinematicDepthSourceId ?? `depth-${item.mediaId ?? item.id}`
}

export function createCinematicDepthAssetBaseName(item: ImageItem): string {
  const withoutExtension = (item.label || item.id).replace(/\.[a-z0-9]+$/i, '')
  return withoutExtension.trim() || item.id
}
