import { useEffect, useRef, useState } from 'react'
import { TILE_WIDTH as TILED_CANVAS_TILE_WIDTH } from '../clip-filmstrip/tiled-canvas'
import { useZoomStore } from '../../stores/zoom-store'

interface WaveformActiveTileCountOptions {
  renderWidth: number
  visibleStartPx: number
  visibleEndPx: number
  overscanTiles?: number
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

/**
 * Samples live zoom into mounted waveform components at a workload-aware
 * cadence. Every committed value redraws a real sharp canvas; intervening store
 * updates are coalesced, so a slider burst cannot create an unbounded React
 * render queue.
 */
export function useAdaptiveWaveformPixelsPerSecond({
  pixelsPerSecond,
  activeTileCount,
  phaseKey,
  enabled = true,
}: {
  pixelsPerSecond: number
  activeTileCount: number
  phaseKey?: string
  enabled?: boolean
}): number {
  const initialRenderPixelsPerSecond =
    enabled && useZoomStore.getState().isZoomInteracting
      ? useZoomStore.getState().pixelsPerSecond
      : pixelsPerSecond
  const [renderPixelsPerSecond, setRenderPixelsPerSecond] = useState(initialRenderPixelsPerSecond)
  const lastCommitAtRef = useRef(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const redrawIntervalMs = getWaveformZoomRedrawIntervalMs(activeTileCount)
  const phaseDelayMs = getWaveformZoomCommitPhaseMs(activeTileCount, phaseKey)

  useEffect(() => {
    if (!enabled) {
      setRenderPixelsPerSecond(pixelsPerSecond)
      return
    }

    const clearPending = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }

    let cancelled = false
    let microtaskPending = false

    const commit = () => {
      if (cancelled) return
      lastCommitAtRef.current = nowMs()
      setRenderPixelsPerSecond(enabled ? useZoomStore.getState().pixelsPerSecond : pixelsPerSecond)
    }

    const commitAfterLiveLayout = () => {
      if (microtaskPending) return
      microtaskPending = true
      queueMicrotask(() => {
        microtaskPending = false
        commit()
      })
    }

    const schedule = () => {
      const elapsedMs = nowMs() - lastCommitAtRef.current
      if (lastCommitAtRef.current === 0 && phaseDelayMs === 0) {
        commitAfterLiveLayout()
        return
      }
      // Once this canvas has exhausted its redraw budget, commit directly.
      // Forcing every phased waveform through another animation frame leaves
      // the old bounded canvas offscreen for one paint during fast reversals.
      // Bursts inside the budget are still coalesced below.
      if (elapsedMs >= redrawIntervalMs) {
        clearPending()
        commitAfterLiveLayout()
        return
      }
      if (timeoutRef.current) return

      const remainingMs = Math.max(0, redrawIntervalMs - elapsedMs)
      const delayMs = lastCommitAtRef.current === 0 ? phaseDelayMs : remainingMs
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null
        // The timeout already enforces the redraw cadence. Waiting for another
        // animation frame can leave a bounded canvas outside the live clip for
        // one extra paint during a fast zoom reversal.
        commit()
      }, delayMs)
    }

    schedule()
    const unsubscribe = useZoomStore.subscribe((state, previousState) => {
      if (state.pixelsPerSecond !== previousState.pixelsPerSecond) {
        schedule()
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
      clearPending()
    }
  }, [enabled, phaseDelayMs, pixelsPerSecond, redrawIntervalMs])

  // Synchronized zoom commands can update the settled prop without a distinct
  // live-store notification for this mounted component.
  useEffect(() => {
    if (!enabled || !useZoomStore.getState().isZoomInteracting) {
      setRenderPixelsPerSecond(pixelsPerSecond)
    }
  }, [enabled, pixelsPerSecond])

  return renderPixelsPerSecond
}
