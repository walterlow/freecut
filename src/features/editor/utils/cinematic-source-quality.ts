const NATIVE_4K_SHORT_EDGE = 2160
const NATIVE_4K_LONG_EDGE = 3840
const NATIVE_4K_PIXEL_COUNT = NATIVE_4K_SHORT_EDGE * NATIVE_4K_LONG_EDGE

export interface SourceDimensions {
  width?: number | null
  height?: number | null
}

export function isNative4kSource(source: SourceDimensions): boolean {
  const width = Number(source.width) || 0
  const height = Number(source.height) || 0
  const shortEdge = Math.min(width, height)
  const longEdge = Math.max(width, height)
  return (
    shortEdge >= NATIVE_4K_SHORT_EDGE &&
    longEdge >= NATIVE_4K_LONG_EDGE &&
    width * height >= NATIVE_4K_PIXEL_COUNT
  )
}

export function describeSourceResolution(source: SourceDimensions): string {
  const width = Math.max(0, Math.round(Number(source.width) || 0))
  const height = Math.max(0, Math.round(Number(source.height) || 0))
  return width > 0 && height > 0 ? `${width}x${height}` : 'unknown resolution'
}
