export function getExclusiveSourceOutPoint(currentFrame: number, durationInFrames: number): number {
  return Math.max(1, Math.min(durationInFrames, currentFrame + 1))
}

export function getSourcePointPercent(
  point: number | null,
  durationInFrames: number,
): number | null {
  if (point === null || durationInFrames <= 0) {
    return null
  }

  const clampedPoint = Math.max(0, Math.min(durationInFrames, point))
  return (clampedPoint / durationInFrames) * 100
}

export function getSourceStripPointFromRatio(ratio: number, durationInFrames: number): number {
  const clampedRatio = Math.max(0, Math.min(1, ratio))
  return Math.round(clampedRatio * durationInFrames)
}

export function clampDraggedSourceInPoint(
  point: number,
  outPoint: number | null,
  lastFrame: number,
): number {
  const clampedPoint = Math.max(0, Math.min(lastFrame, point))
  if (outPoint === null) {
    return clampedPoint
  }

  return Math.min(clampedPoint, Math.max(0, outPoint - 1))
}

export function clampDraggedSourceOutPoint(
  point: number,
  inPoint: number | null,
  durationInFrames: number,
): number {
  const clampedPoint = Math.max(0, Math.min(durationInFrames, point))
  const minimumOutPoint = inPoint === null ? 1 : inPoint + 1
  return Math.max(minimumOutPoint, clampedPoint)
}

export function shiftSourceIoRange(
  startIn: number,
  startOut: number,
  delta: number,
  durationInFrames: number,
): { inPoint: number; outPoint: number } {
  const rangeDuration = Math.max(1, startOut - startIn)
  const maxInPoint = Math.max(0, durationInFrames - rangeDuration)
  const nextInPoint = Math.max(0, Math.min(maxInPoint, startIn + delta))

  return {
    inPoint: nextInPoint,
    outPoint: nextInPoint + rangeDuration,
  }
}
