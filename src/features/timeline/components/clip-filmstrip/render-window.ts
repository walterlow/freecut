export interface FilmstripRenderWindowOptions {
  renderWidth: number
  visibleWidth?: number
  tileWidth: number
  visibleStartRatio?: number
  visibleEndRatio?: number
  minimumPadTiles?: number
  minimumPadPx?: number
  /** Hard redraw budget, normally viewport width plus prefetch margins. */
  maxWindowWidth?: number
}

export interface FilmstripRenderWindow {
  paddedStartX: number
  paddedEndX: number
  startTile: number
  endTile: number
}

export function computeFilmstripRenderWindow({
  renderWidth,
  visibleWidth = renderWidth,
  tileWidth,
  visibleStartRatio = 0,
  visibleEndRatio = 1,
  minimumPadTiles = 0,
  minimumPadPx = 0,
  maxWindowWidth = Number.POSITIVE_INFINITY,
}: FilmstripRenderWindowOptions): FilmstripRenderWindow {
  const safeRenderWidth = Math.max(0, renderWidth)
  const safeVisibleWidth = Math.max(0, Math.min(visibleWidth, safeRenderWidth))
  const safeTileWidth = Math.max(1, tileWidth)
  const tileCount = Math.ceil(safeRenderWidth / safeTileWidth)

  if (safeRenderWidth <= 0 || tileCount <= 0) {
    return {
      paddedStartX: 0,
      paddedEndX: 0,
      startTile: 0,
      endTile: 0,
    }
  }

  const clampedStartRatio = Math.max(0, Math.min(1, visibleStartRatio))
  const clampedEndRatio = Math.max(clampedStartRatio, Math.min(1, visibleEndRatio))
  const visibleStartX = safeVisibleWidth * clampedStartRatio
  const visibleEndX = safeVisibleWidth * clampedEndRatio
  const basePadPx = Math.max(minimumPadPx, safeTileWidth * Math.max(0, minimumPadTiles))
  const renderOverflowPx = Math.max(0, safeRenderWidth - safeVisibleWidth)
  let paddedStartX = Math.max(0, visibleStartX - basePadPx)
  let paddedEndX = Math.min(safeRenderWidth, visibleEndX + Math.max(basePadPx, renderOverflowPx))
  const safeMaxWindowWidth = Math.max(0, maxWindowWidth)
  if (paddedEndX - paddedStartX > safeMaxWindowWidth) {
    const cappedWidth = Math.min(safeRenderWidth, safeMaxWindowWidth)
    // Keep the capped canvas centered on the actual visible range. The render
    // overflow is intentionally one-sided so trailing width commits stay
    // covered, but centering on that asymmetric padded range can move the whole
    // bounded canvas beyond the viewport on long clips.
    const center = (visibleStartX + visibleEndX) / 2
    paddedStartX = Math.max(0, Math.min(safeRenderWidth - cappedWidth, center - cappedWidth / 2))
    paddedEndX = paddedStartX + cappedWidth
  }

  return {
    paddedStartX,
    paddedEndX,
    startTile: Math.max(0, Math.floor(paddedStartX / safeTileWidth)),
    endTile: Math.min(tileCount, Math.ceil(paddedEndX / safeTileWidth)),
  }
}
