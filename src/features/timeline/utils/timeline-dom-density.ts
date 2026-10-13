/**
 * Dense-track policy is based on the full track size, never the viewport
 * subset. That keeps DOM/detail/culling behavior stable while zoom changes
 * which clips happen to overlap the mounted range.
 */
export const DENSE_TIMELINE_TRACK_ITEM_THRESHOLD = 80
// Once a track is dense enough to use the reduced culling buffer, compact
// clips should also use the lightweight overview surface. Keeping a separate
// emergency-only threshold left hundreds of visually tiny clips mounted as
// full TimelineItem interaction trees in normal projects.
export const DENSE_TIMELINE_OVERVIEW_ITEM_THRESHOLD = DENSE_TIMELINE_TRACK_ITEM_THRESHOLD
export const DENSE_TIMELINE_MAX_OVERVIEW_BUCKETS_PER_TRACK = 1024

export const DEFAULT_TIMELINE_ITEM_CULL_BUFFER_PX = 2000
export const DENSE_TIMELINE_ITEM_CULL_BUFFER_PX = 600
export const COMPACT_TIMELINE_ITEM_MAX_WIDTH_PX = 36
const MIXED_TIMELINE_COMPACT_ZOOM_STEP = 1.12

export interface TimelineItemDurationBounds {
  itemCount: number
  minDurationInFrames: number
  maxDurationInFrames: number
}

/**
 * During zoom-out, use the smaller live scale so retained and newly exposed
 * clips can demote before the settled content channel catches up. Zoom-in keeps
 * the settled scale so detail promotion remains deferred.
 */
export function getDemotionAwarePixelsPerSecond(
  settledPixelsPerSecond: number,
  livePixelsPerSecond: number,
  isZoomInteracting: boolean,
): number {
  if (!isZoomInteracting) return settledPixelsPerSecond
  return Math.min(settledPixelsPerSecond, livePixelsPerSecond)
}

export function getTimelineItemCullBufferPx(trackItemCount: number): number {
  return trackItemCount >= DENSE_TIMELINE_TRACK_ITEM_THRESHOLD
    ? DENSE_TIMELINE_ITEM_CULL_BUFFER_PX
    : DEFAULT_TIMELINE_ITEM_CULL_BUFFER_PX
}

export function isTimelineItemCompactAtZoom(
  durationInFrames: number,
  fps: number,
  pixelsPerSecond: number,
): boolean {
  if (durationInFrames <= 0 || fps <= 0 || pixelsPerSecond <= 0) return false
  const width = Math.round((durationInFrames / fps) * pixelsPerSecond)
  return width <= COMPACT_TIMELINE_ITEM_MAX_WIDTH_PX
}

/**
 * Produces a low-churn primitive for the track selector. Uniform cohorts only
 * publish when they cross the compact boundary; mixed cohorts publish at coarse
 * zoom steps so individual clip widths stay visually current without forcing a
 * list render on every live zoom tick.
 */
export function getTimelineCompactCohortSignal(
  bounds: TimelineItemDurationBounds,
  fps: number,
  pixelsPerSecond: number,
  isZoomInteracting: boolean,
): string {
  const phase = isZoomInteracting ? 'interacting' : 'settled'
  if (bounds.itemCount === 0 || fps <= 0 || pixelsPerSecond <= 0) return `${phase}:none`

  if (
    bounds.minDurationInFrames > 0 &&
    isTimelineItemCompactAtZoom(bounds.maxDurationInFrames, fps, pixelsPerSecond)
  ) {
    return `${phase}:all`
  }
  if (
    bounds.maxDurationInFrames <= 0 ||
    (bounds.minDurationInFrames > 0 &&
      !isTimelineItemCompactAtZoom(bounds.minDurationInFrames, fps, pixelsPerSecond))
  ) {
    return `${phase}:none`
  }

  const zoomBucket = Math.round(
    Math.log(Math.max(pixelsPerSecond, Number.EPSILON)) /
      Math.log(MIXED_TIMELINE_COMPACT_ZOOM_STEP),
  )
  return `${phase}:mixed:${zoomBucket}`
}

/** Count compact clips in O(log n) after callers cache a sorted duration list. */
export function countCompactTimelineItemsAtZoom(
  sortedDurationsInFrames: ReadonlyArray<number>,
  fps: number,
  pixelsPerSecond: number,
): number {
  let low = 0
  let high = sortedDurationsInFrames.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (isTimelineItemCompactAtZoom(sortedDurationsInFrames[middle]!, fps, pixelsPerSecond)) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return low
}
