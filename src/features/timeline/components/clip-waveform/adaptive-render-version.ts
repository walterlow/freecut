import { useEffect, useMemo, useRef, useState } from 'react'
import { TILE_WIDTH as TILED_CANVAS_TILE_WIDTH } from '../clip-filmstrip/tiled-canvas'

interface WaveformActiveTileCountOptions {
  renderWidth: number
  visibleStartPx: number
  visibleEndPx: number
  overscanTiles?: number
}

interface AdaptiveWaveformRenderVersionOptions {
  baseVersion: string
  pixelsPerSecond: number
  /** Total canvas render width in px. Included in the throttled zoom signal so
   *  trim-extend (which grows width without changing pps) also triggers redraws. */
  renderWidth: number
  activeTileCount: number
  phaseKey?: string
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function getWaveformActiveTileCount({
  renderWidth,
  visibleStartPx,
  visibleEndPx,
  overscanTiles = 1,
}: WaveformActiveTileCountOptions): number {
  const safeRenderWidth = Math.max(0, renderWidth)
  if (safeRenderWidth <= 0) {
    return 1
  }

  const totalTiles = Math.max(1, Math.ceil(safeRenderWidth / TILED_CANVAS_TILE_WIDTH))
  const clampedStart = Math.max(0, Math.min(safeRenderWidth, visibleStartPx))
  const clampedEnd = Math.max(clampedStart, Math.min(safeRenderWidth, visibleEndPx))
  const visibleWidth = Math.max(0, clampedEnd - clampedStart)
  const visibleTiles = Math.max(1, Math.ceil(visibleWidth / TILED_CANVAS_TILE_WIDTH))
  const overscannedTiles = visibleTiles + Math.max(0, overscanTiles) * 2

  return Math.min(totalTiles, overscannedTiles)
}

export function getWaveformZoomRedrawIntervalMs(activeTileCount: number): number {
  if (activeTileCount <= 2) return 16
  if (activeTileCount <= 4) return 20
  if (activeTileCount <= 8) return 24
  return 32
}

function hashPhaseKey(phaseKey: string): number {
  let hash = 0
  for (let i = 0; i < phaseKey.length; i += 1) {
    hash = (hash << 5) - hash + phaseKey.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

export function getWaveformZoomCommitPhaseMs(activeTileCount: number, phaseKey?: string): number {
  if (!phaseKey || activeTileCount <= 2) {
    return 0
  }

  if (activeTileCount <= 4) {
    return (hashPhaseKey(phaseKey) % 2) * 8
  }

  if (activeTileCount <= 8) {
    return (hashPhaseKey(phaseKey) % 4) * 8
  }

  return (hashPhaseKey(phaseKey) % 6) * 10
}

export function useAdaptiveWaveformRenderVersion({
  baseVersion,
  pixelsPerSecond,
  renderWidth,
  activeTileCount,
  phaseKey,
}: AdaptiveWaveformRenderVersionOptions): string {
  const zoomVersion = useMemo(
    () => `e${Math.round(Math.max(1, pixelsPerSecond) * 1000)}:w${Math.round(renderWidth)}`,
    [pixelsPerSecond, renderWidth],
  )
  const redrawIntervalMs = useMemo(
    () => getWaveformZoomRedrawIntervalMs(activeTileCount),
    [activeTileCount],
  )
  const phaseDelayMs = useMemo(
    () => getWaveformZoomCommitPhaseMs(activeTileCount, phaseKey),
    [activeTileCount, phaseKey],
  )
  const [committedZoomVersion, setCommittedZoomVersion] = useState(zoomVersion)
  const latestZoomVersionRef = useRef(zoomVersion)
  const lastCommitAtRef = useRef(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef = useRef<number | null>(null)

  latestZoomVersionRef.current = zoomVersion

  useEffect(() => {
    if (committedZoomVersion === zoomVersion) {
      return
    }

    const clearPending = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }

    const commit = () => {
      lastCommitAtRef.current = nowMs()
      setCommittedZoomVersion(latestZoomVersionRef.current)
    }

    const now = nowMs()
    const elapsedMs = now - lastCommitAtRef.current
    if (lastCommitAtRef.current === 0 || (elapsedMs >= redrawIntervalMs && phaseDelayMs === 0)) {
      clearPending()
      commit()
      return
    }

    if (timeoutRef.current || rafRef.current !== null) {
      return
    }

    const remainingMs = Math.max(0, redrawIntervalMs - elapsedMs)
    const scheduledDelayMs =
      lastCommitAtRef.current === 0 ? phaseDelayMs : remainingMs + phaseDelayMs
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        commit()
      })
    }, scheduledDelayMs)
    return clearPending
  }, [committedZoomVersion, phaseDelayMs, redrawIntervalMs, zoomVersion])

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [])

  return `${baseVersion}:${committedZoomVersion}`
}
