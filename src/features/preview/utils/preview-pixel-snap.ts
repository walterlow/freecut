type PixelSnapOffset = { x: number; y: number }
type PixelSnapSize = { width: number; height: number }
type PreviewPlayerSizeInput = {
  sourceSize: PixelSnapSize
  containerSize: PixelSnapSize
  zoom: number
  devicePixelRatio?: number
}

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

function getDevicePixelRatio(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio
}

export function getPreviewPlayerSize({
  sourceSize,
  containerSize,
  zoom,
  devicePixelRatio = getDevicePixelRatio(),
}: PreviewPlayerSizeInput): PixelSnapSize {
  const aspectRatio = sourceSize.width / sourceSize.height

  if (zoom === -1) {
    if (containerSize.width > 0 && containerSize.height > 0) {
      const containerAspectRatio = containerSize.width / containerSize.height

      if (containerAspectRatio > aspectRatio) {
        const { height } = getPreviewPixelSnapSize(
          { width: containerSize.height * aspectRatio, height: containerSize.height },
          devicePixelRatio,
        )
        return { width: height * aspectRatio, height }
      }

      const { width } = getPreviewPixelSnapSize(
        { width: containerSize.width, height: containerSize.width / aspectRatio },
        devicePixelRatio,
      )
      return { width, height: width / aspectRatio }
    }

    return sourceSize
  }

  const { width } = getPreviewPixelSnapSize(
    { width: sourceSize.width * zoom, height: sourceSize.height * zoom },
    devicePixelRatio,
  )
  return { width, height: width / aspectRatio }
}

export function getPreviewNeedsOverflow({
  playerSize,
  containerSize,
  zoom,
}: {
  playerSize: PixelSnapSize
  containerSize: PixelSnapSize
  zoom: number
}): boolean {
  if (zoom === -1) return false
  if (containerSize.width === 0 || containerSize.height === 0) return false
  return playerSize.width > containerSize.width || playerSize.height > containerSize.height
}
