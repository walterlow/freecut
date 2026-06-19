import { usePlaybackStore } from '@/shared/state/playback'
import { MINI_TIMELINE_MIN_FRAMES } from './constants'

/**
 * Widest frame the mini timeline must represent: the furthest clip end, the
 * furthest marker, and the in/out points, floored at a sensible minimum so an
 * empty/short timeline still spans a usable width.
 */
export function resolveMiniTimelineMaxFrame(params: {
  items: readonly { from: number; durationInFrames: number }[]
  markers?: readonly { frame: number }[]
  inPoint?: number | null
  outPoint?: number | null
}): number {
  const { items, markers = [], inPoint = null, outPoint = null } = params
  const itemMax = items.reduce((max, item) => Math.max(max, item.from + item.durationInFrames), 0)
  const markerMax = markers.reduce((max, marker) => Math.max(max, marker.frame), 0)
  return Math.max(MINI_TIMELINE_MIN_FRAMES, itemMax, markerMax, inPoint ?? 0, outPoint ?? 0)
}

/** Ruler clock label: HH:MM:SS. */
export function formatMiniTimelineClock(frame: number, fps: number): string {
  const safeFps = fps > 0 ? fps : 30
  const totalSeconds = Math.max(0, Math.floor(frame / safeFps))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
}

/** Film-tile timecode label: HH:MM:SS:FF. */
export function formatMiniTimelineTimecode(frame: number, fps: number): string {
  const safeFps = Math.max(1, Math.round(fps > 0 ? fps : 30))
  const clampedFrame = Math.max(0, Math.round(frame))
  const totalSeconds = Math.floor(clampedFrame / safeFps)
  const frames = clampedFrame % safeFps
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds, frames].map((part) => String(part).padStart(2, '0')).join(':')
}

/**
 * Frame the playhead should sit at right now. Preview wins over committed,
 * unless `suppressPreview` is set (e.g. during an IO drag) — then the playhead
 * stays pinned to the committed frame while the preview canvas keeps updating.
 */
export function getMiniTimelineDisplayFrame(suppressPreview = false): number {
  const playbackState = usePlaybackStore.getState()
  if (suppressPreview) return playbackState.currentFrame
  return playbackState.previewFrame ?? playbackState.currentFrame
}
