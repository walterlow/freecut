export interface WaveformRenderWindowOptions {
  renderWidth: number
  visibleWidth?: number
  visibleStartRatio?: number
  visibleEndRatio?: number
}

export interface WaveformRenderWindow {
  visibleStartPx: number
  visibleEndPx: number
}

export function computeWaveformRenderWindow({
  renderWidth,
  visibleWidth = renderWidth,
  visibleStartRatio = 0,
  visibleEndRatio = 1,
}: WaveformRenderWindowOptions): WaveformRenderWindow {
  const safeRenderWidth = Math.max(0, renderWidth)
  const safeVisibleWidth = Math.max(0, Math.min(visibleWidth, safeRenderWidth))
  const clampedStartRatio = Math.max(0, Math.min(1, visibleStartRatio))
  const clampedEndRatio = Math.max(clampedStartRatio, Math.min(1, visibleEndRatio))

  return {
    visibleStartPx: Math.max(0, Math.floor(safeVisibleWidth * clampedStartRatio)),
    visibleEndPx: Math.min(safeRenderWidth, Math.ceil(safeVisibleWidth * clampedEndRatio)),
  }
}
