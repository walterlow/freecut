type PixelSnapOffset = { x: number; y: number }
type PixelSnapSize = { width: number; height: number }

const MIN_PIXEL_SNAP_DELTA = 0.001

export const ZERO_PIXEL_SNAP_OFFSET: PixelSnapOffset = { x: 0, y: 0 }

function normalizeDevicePixelRatio(devicePixelRatio: number): number {
  return Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
}

function snapCssPixel(value: number, devicePixelRatio: number): number {
  if (!Number.isFinite(value)) return 0
  const dpr = normalizeDevicePixelRatio(devicePixelRatio)
  return Math.max(0, Math.round(value * dpr) / dpr)
}

export function getPreviewPixelSnapOffset(
  rect: Pick<DOMRect, 'left' | 'top'>,
  devicePixelRatio: number,
): PixelSnapOffset {
  const dpr = normalizeDevicePixelRatio(devicePixelRatio)
  const snap = (value: number) => Math.round(value * dpr) / dpr - value
  const x = snap(rect.left)
  const y = snap(rect.top)

  return {
    x: Math.abs(x) < MIN_PIXEL_SNAP_DELTA ? 0 : x,
    y: Math.abs(y) < MIN_PIXEL_SNAP_DELTA ? 0 : y,
  }
}

export function getPreviewPixelSnapSize(
  size: PixelSnapSize,
  devicePixelRatio: number,
): PixelSnapSize {
  return {
    width: snapCssPixel(size.width, devicePixelRatio),
    height: snapCssPixel(size.height, devicePixelRatio),
  }
}
