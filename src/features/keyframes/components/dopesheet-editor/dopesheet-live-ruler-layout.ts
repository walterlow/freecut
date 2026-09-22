import { getNiceTickStep } from './dopesheet-helpers'

export interface DopesheetRulerTickLayout {
  firstMajorFrame: number
  lastMajorFrame: number
  majorStepFrames: number
  minorStepFrames: number
}

export function getDopesheetRulerTickLayout({
  scrollLeft,
  viewportWidth,
  pixelsPerSecond,
  fps,
}: {
  scrollLeft: number
  viewportWidth: number
  pixelsPerSecond: number
  fps: number
}): DopesheetRulerTickLayout {
  const safePixelsPerSecond = Math.max(pixelsPerSecond, 0.001)
  const safeFps = Math.max(fps, 1)
  const startFrame = (scrollLeft / safePixelsPerSecond) * safeFps
  const endFrame = ((scrollLeft + viewportWidth) / safePixelsPerSecond) * safeFps
  const majorStepFrames = getNiceTickStep(Math.max(1, endFrame - startFrame))

  return {
    firstMajorFrame: Math.floor(startFrame / majorStepFrames) * majorStepFrames,
    lastMajorFrame: Math.ceil(endFrame / majorStepFrames) * majorStepFrames,
    majorStepFrames,
    minorStepFrames: majorStepFrames / 4,
  }
}

/** `m:ss.s` past a minute, otherwise seconds with a stable precision. */
export function formatRulerSeconds(seconds: number): string {
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60)
    const remainder = seconds - minutes * 60
    return `${minutes}:${remainder.toFixed(1).padStart(4, '0')}`
  }
  return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`
}

export function formatDopesheetRulerCanvasLabel(
  frame: number,
  fps: number,
  rulerUnit: 'frames' | 'seconds',
): string {
  if (rulerUnit === 'frames' || fps <= 0) return String(Math.round(frame))

  return formatRulerSeconds(frame / fps)
}
