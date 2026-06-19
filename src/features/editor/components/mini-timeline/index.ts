/**
 * Mini timeline — the compact ruler + track-lane strip shared by the Color and
 * Animate workspaces. Compose the pieces you need: every consumer drives the
 * scrub surface with {@link useMiniTimelineScrub} and renders a
 * {@link MiniTimelinePlayhead}; the Color/Animate parity layout adds the
 * film-tile row, {@link MiniTimelineIoLane}, {@link MiniTimelineAnnotations},
 * {@link MiniTimelineRuler} and {@link MiniTimelineTrackLanes} on top.
 */
export * from './constants'
export * from './types'
export { resolveMiniTimelineMaxFrame, formatMiniTimelineTimecode } from './utils'
export { useMiniTimelineScrub } from './use-mini-timeline-scrub'
export { MiniTimelinePlayhead } from './mini-timeline-playhead'
export { MiniTimelineRuler } from './mini-timeline-ruler'
export { MiniTimelineTrackLanes } from './mini-timeline-track-lanes'
export { MiniTimelineIoLane } from './mini-timeline-io-lane'
export { MiniTimelineAnnotations } from './mini-timeline-annotations'
export { MiniFilmTile } from './mini-film-tile'
export { useMediaPosterUrls, useClipStartFrameUrl } from './use-clip-thumbnails'
