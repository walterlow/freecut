import type { Keyframe } from '@/types/keyframe'
import { applyEasing, applyEasingConfig } from './easing'

export const MIN_PACKED_RGB = 0
export const MAX_PACKED_RGB = 0xffffff

interface RgbColor {
  r: number
  g: number
  b: number
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function normalizePackedRgb(value: number): number {
  if (!Number.isFinite(value)) return MIN_PACKED_RGB
  return Math.max(MIN_PACKED_RGB, Math.min(MAX_PACKED_RGB, Math.round(value)))
}

function rgbToPacked({ r, g, b }: RgbColor): number {
  return (clampChannel(r) << 16) + (clampChannel(g) << 8) + clampChannel(b)
}

function packedToRgb(value: number): RgbColor {
  const packed = normalizePackedRgb(value)
  return {
    r: (packed >> 16) & 0xff,
    g: (packed >> 8) & 0xff,
    b: packed & 0xff,
  }
}

export function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim()
  const match = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(trimmed)
  if (!match) return null

  const hex = match[1]!
  if (hex.length === 3) {
    return `#${hex
      .split('')
      .map((char) => char + char)
      .join('')
      .toLowerCase()}`
  }

  return `#${hex.slice(0, 6).toLowerCase()}`
}

export function colorStringToKeyframeValue(value: string): number | null {
  const normalized = normalizeHexColor(value)
  if (!normalized) return null
  return Number.parseInt(normalized.slice(1), 16)
}

export function keyframeValueToHexColor(value: number): string {
  return `#${normalizePackedRgb(value).toString(16).padStart(6, '0')}`
}

function interpolateRgb(prevValue: number, nextValue: number, progress: number): number {
  const prev = packedToRgb(prevValue)
  const next = packedToRgb(nextValue)
  return rgbToPacked({
    r: prev.r + (next.r - prev.r) * progress,
    g: prev.g + (next.g - prev.g) * progress,
    b: prev.b + (next.b - prev.b) * progress,
  })
}

export function interpolateColorKeyframeValue(
  keyframes: Keyframe[],
  frame: number,
  baseValue: number,
): number {
  if (keyframes.length === 0) return normalizePackedRgb(baseValue)

  const firstKf = keyframes[0]!
  if (keyframes.length === 1) return normalizePackedRgb(firstKf.value)
  if (frame <= firstKf.frame) return normalizePackedRgb(firstKf.value)

  const lastKf = keyframes[keyframes.length - 1]!
  if (frame >= lastKf.frame) return normalizePackedRgb(lastKf.value)

  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const prevKf = keyframes[i]!
    const nextKf = keyframes[i + 1]!
    if (prevKf.frame > frame || nextKf.frame <= frame) continue

    const frameRange = nextKf.frame - prevKf.frame
    if (frameRange <= 0) return normalizePackedRgb(prevKf.value)

    const progress = (frame - prevKf.frame) / frameRange
    const easedProgress = prevKf.easingConfig
      ? applyEasingConfig(progress, prevKf.easingConfig)
      : applyEasing(progress, prevKf.easing)

    return interpolateRgb(prevKf.value, nextKf.value, easedProgress)
  }

  return normalizePackedRgb(baseValue)
}

export function interpolateColorKeyframesToHex(
  keyframes: Keyframe[],
  frame: number,
  baseColor: string,
): string | null {
  const baseValue = colorStringToKeyframeValue(baseColor)
  if (baseValue === null) return null
  return keyframeValueToHexColor(interpolateColorKeyframeValue(keyframes, frame, baseValue))
}
