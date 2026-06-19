import type { TimelineItem } from '@/types/timeline'

/** Minimal clip shape needed to draw a mini bar on a track lane. */
export interface MiniTimelineClip {
  id: string
  trackId: string
  from: number
  durationInFrames: number
  label: string
}

/**
 * Clip shape needed by the film-tile thumbnail extraction. Source-native frame
 * fields are in source FPS (see CLAUDE.md), converted to seconds with media
 * metadata inside {@link useClipStartFrameUrl}.
 */
export interface MiniFilmTileClip {
  id: string
  type: TimelineItem['type']
  label: string
  trackName: string
  mediaId?: string
  from: number
  durationInFrames: number
  sourceStartFrames: number
  sourceDurationFrames: number
  sourceFps: number
  trimStartFrames: number
  thumbnailUrl?: string
}
