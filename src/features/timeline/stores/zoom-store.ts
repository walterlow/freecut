import { create } from 'zustand'

import { getZoomToFitLevel } from '../utils/timeline-layout'

interface ZoomState {
  // Visual zoom drives cursor anchoring and shell layout during interaction.
  level: number
  pixelsPerSecond: number
  // Content zoom is the settled value used by expensive consumers such as culling.
  contentLevel: number
  contentPixelsPerSecond: number
  isZoomInteracting: boolean
}

interface ZoomActions {
  setZoomLevel: (level: number) => void
  setZoomLevelImmediate: (level: number) => void // Bypasses throttle for smooth momentum zoom
  setZoomLevelSynchronized: (level: number) => void
  zoomIn: () => void
  zoomOut: () => void
  zoomToFit: (containerWidth: number, contentDurationSeconds: number) => void
}

// Throttle visual zoom updates a bit for non-immediate callers like the header
// slider, then let committed content zoom catch up only after interaction settles.
const VISUAL_ZOOM_THROTTLE_MS = 120
const CONTENT_ZOOM_SETTLE_MS = 100
let lastVisualZoomUpdate = 0
let pendingVisualZoomLevel: number | null = null
let pendingContentZoomLevel: number | null = null
let visualZoomThrottleTimeout: ReturnType<typeof setTimeout> | null = null
let contentZoomSettleTimeout: ReturnType<typeof setTimeout> | null = null

function zoomLevelToPixelsPerSecond(level: number): number {
  return level * 100
}

function clearVisualZoomThrottle() {
  if (visualZoomThrottleTimeout) {
    clearTimeout(visualZoomThrottleTimeout)
    visualZoomThrottleTimeout = null
  }
}

function clearContentZoomSettleTimeout() {
  if (contentZoomSettleTimeout) {
    clearTimeout(contentZoomSettleTimeout)
    contentZoomSettleTimeout = null
  }
}

function setVisualZoom(
  set: (partial: Partial<ZoomState>) => void,
  level: number,
  isZoomInteracting: boolean,
) {
  set({
    level,
    pixelsPerSecond: zoomLevelToPixelsPerSecond(level),
    isZoomInteracting,
  })
}

function flushPendingVisualZoom(set: (partial: Partial<ZoomState>) => void) {
  if (pendingVisualZoomLevel === null) return

  clearVisualZoomThrottle()
  lastVisualZoomUpdate = performance.now()
  const nextLevel = pendingVisualZoomLevel
  pendingVisualZoomLevel = null
  setVisualZoom(set, nextLevel, true)
}

function scheduleContentZoomCommit(set: (partial: Partial<ZoomState>) => void) {
  clearContentZoomSettleTimeout()
  contentZoomSettleTimeout = setTimeout(() => {
    contentZoomSettleTimeout = null
    if (pendingContentZoomLevel === null) {
      set({ isZoomInteracting: false })
      return
    }

    const settledLevel = pendingContentZoomLevel
    pendingContentZoomLevel = null
    flushPendingVisualZoom(set)
    set({
      level: settledLevel,
      pixelsPerSecond: zoomLevelToPixelsPerSecond(settledLevel),
      contentLevel: settledLevel,
      contentPixelsPerSecond: zoomLevelToPixelsPerSecond(settledLevel),
      isZoomInteracting: false,
    })
  }, CONTENT_ZOOM_SETTLE_MS)
}

function stageContentZoomCommit(set: (partial: Partial<ZoomState>) => void, level: number) {
  pendingContentZoomLevel = level
  set({ isZoomInteracting: true })
  scheduleContentZoomCommit(set)
}

function applySynchronizedZoom(
  set: (partial: Partial<ZoomState> | ((state: ZoomState) => Partial<ZoomState>)) => void,
  level: number,
) {
  pendingVisualZoomLevel = null
  pendingContentZoomLevel = null
  clearVisualZoomThrottle()
  clearContentZoomSettleTimeout()
  lastVisualZoomUpdate = performance.now()
  const pixelsPerSecond = zoomLevelToPixelsPerSecond(level)
  set({
    level,
    pixelsPerSecond,
    contentLevel: level,
    contentPixelsPerSecond: pixelsPerSecond,
    isZoomInteracting: false,
  })
}

export const useZoomStore = create<ZoomState & ZoomActions>((set, get) => ({
  level: 1,
  pixelsPerSecond: 100,
  contentLevel: 1,
  contentPixelsPerSecond: 100,
  isZoomInteracting: false,

  setZoomLevel: (level) => {
    const now = performance.now()
    pendingVisualZoomLevel = level
    stageContentZoomCommit(set, level)

    // If enough time has passed, update immediately
    if (now - lastVisualZoomUpdate >= VISUAL_ZOOM_THROTTLE_MS) {
      lastVisualZoomUpdate = now
      setVisualZoom(set, level, true)
      pendingVisualZoomLevel = null
      return
    }

    // Otherwise, schedule update for next throttle window
    if (!visualZoomThrottleTimeout) {
      visualZoomThrottleTimeout = setTimeout(
        () => {
          visualZoomThrottleTimeout = null
          if (pendingVisualZoomLevel !== null) {
            const nextLevel = pendingVisualZoomLevel
            pendingVisualZoomLevel = null
            lastVisualZoomUpdate = performance.now()
            setVisualZoom(set, nextLevel, true)
          }
        },
        VISUAL_ZOOM_THROTTLE_MS - (now - lastVisualZoomUpdate),
      )
    }
  },

  // Immediate zoom update - bypasses throttle for synchronized scroll calculations
  setZoomLevelImmediate: (level) => {
    clearVisualZoomThrottle()
    pendingVisualZoomLevel = null
    lastVisualZoomUpdate = performance.now()
    setVisualZoom(set, level, true)
    stageContentZoomCommit(set, level)
  },
  setZoomLevelSynchronized: (level) => {
    applySynchronizedZoom(set, level)
  },
  zoomIn: () => {
    const newLevel = Math.min(get().level * 1.1, 50) // 10% per step for finer control
    applySynchronizedZoom(set, newLevel)
  },
  zoomOut: () => {
    const newLevel = Math.max(get().level / 1.1, 0.01)
    applySynchronizedZoom(set, newLevel)
  },
  zoomToFit: (containerWidth, contentDurationSeconds) => {
    const newLevel = getZoomToFitLevel(containerWidth, contentDurationSeconds)
    applySynchronizedZoom(set, newLevel)
  },
}))

// Non-reactive handler registration — avoids unnecessary subscriber notifications
let _zoomTo100Handler: ((centerFrame: number) => void) | null = null

export function registerZoomTo100(handler: ((centerFrame: number) => void) | null) {
  _zoomTo100Handler = handler
}

export function getZoomTo100Handler() {
  return _zoomTo100Handler
}

export function _resetZoomStoreForTest() {
  clearVisualZoomThrottle()
  clearContentZoomSettleTimeout()
  pendingVisualZoomLevel = null
  pendingContentZoomLevel = null
  lastVisualZoomUpdate = 0
  useZoomStore.setState({
    level: 1,
    pixelsPerSecond: 100,
    contentLevel: 1,
    contentPixelsPerSecond: 100,
    isZoomInteracting: false,
  })
}
