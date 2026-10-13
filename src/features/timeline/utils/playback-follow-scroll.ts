const FORWARD_PLAYHEAD_ANCHOR = 0.2
const REVERSE_PLAYHEAD_ANCHOR = 0.8
const EDGE_EPSILON_PX = 1

interface PlaybackFollowScrollInput {
  playheadX: number
  scrollLeft: number
  viewportWidth: number
  maxScrollLeft: number
  playbackDirection: 1 | -1
}

/**
 * Page the timeline only after playback reaches a viewport edge. The playhead
 * lands toward the trailing side of the new page, leaving most of the viewport
 * available in the active playback direction.
 */
export function getPlaybackFollowScrollLeft({
  playheadX,
  scrollLeft,
  viewportWidth,
  maxScrollLeft,
  playbackDirection,
}: PlaybackFollowScrollInput): number | null {
  if (
    !Number.isFinite(playheadX) ||
    !Number.isFinite(scrollLeft) ||
    viewportWidth <= 0 ||
    maxScrollLeft <= 0
  ) {
    return null
  }

  const visibleRight = scrollLeft + viewportWidth
  const beforeViewport = playheadX < scrollLeft
  const atForwardEdge = playbackDirection > 0 && playheadX >= visibleRight - EDGE_EPSILON_PX
  const atReverseEdge = playbackDirection < 0 && playheadX <= scrollLeft + EDGE_EPSILON_PX
  const jumpedPastOppositeEdge =
    (playbackDirection > 0 && beforeViewport) || (playbackDirection < 0 && playheadX > visibleRight)

  if (!atForwardEdge && !atReverseEdge && !jumpedPastOppositeEdge) {
    return null
  }

  const anchor = playbackDirection > 0 ? FORWARD_PLAYHEAD_ANCHOR : REVERSE_PLAYHEAD_ANCHOR
  const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, playheadX - viewportWidth * anchor))

  return Math.abs(nextScrollLeft - scrollLeft) >= 0.5 ? nextScrollLeft : null
}
