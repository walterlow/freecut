import type { TimelineTrack } from '@/types/timeline'
import {
  DEFAULT_TRACK_HEIGHT,
  MAX_TRACK_HEIGHT,
  MIN_TRACK_HEIGHT,
  TRACK_SECTION_DIVIDER_HEIGHT,
} from '../constants'
import { getTrackKind } from './classic-tracks'

interface TrackSectionLayoutParams {
  viewportHeight: number
  tracks: TimelineTrack[]
  sectionDividerPosition: number | null
  trackTitleBarHeight: number
}

interface TrackSectionLayout {
  hasTrackSections: boolean
  availablePaneHeight: number
  minimumSectionDividerPosition: number
  maximumSectionDividerPosition: number
  clampedSectionDividerPosition: number
  videoPaneHeight: number
  audioPaneHeight: number
  videoSectionHeight: number
  audioSectionHeight: number
}

interface SectionDividerPositionParams {
  viewportHeight: number
  tracks: TimelineTrack[]
  requestedDividerPosition: number
  trackTitleBarHeight: number
}

export function clampTrackHeight(height: number): number {
  return Math.max(MIN_TRACK_HEIGHT, Math.min(MAX_TRACK_HEIGHT, Math.round(height)))
}

export function resizeTrackInList(
  tracks: TimelineTrack[],
  trackId: string,
  nextHeight: number,
): TimelineTrack[] {
  const clampedHeight = clampTrackHeight(nextHeight)
  let didChange = false

  const nextTracks = tracks.map((track) => {
    if (track.id !== trackId || track.height === clampedHeight) {
      return track
    }

    didChange = true
    return {
      ...track,
      height: clampedHeight,
    }
  })

  return didChange ? nextTracks : tracks
}

export function resizeAllTracksInList(
  tracks: TimelineTrack[],
  nextHeight: number,
): TimelineTrack[] {
  const clampedHeight = clampTrackHeight(nextHeight)
  let didChange = false

  const nextTracks = tracks.map((track) => {
    if (track.height === clampedHeight) {
      return track
    }

    didChange = true
    return {
      ...track,
      height: clampedHeight,
    }
  })

  return didChange ? nextTracks : tracks
}

export function resizeTracksOfKindByDelta(
  tracks: TimelineTrack[],
  kind: 'video' | 'audio',
  delta: number,
): TimelineTrack[] {
  let didChange = false

  const nextTracks = tracks.map((track) => {
    if (getTrackKind(track) !== kind) return track
    const nextHeight = clampTrackHeight(track.height + delta)
    if (nextHeight === track.height) return track
    didChange = true
    return { ...track, height: nextHeight }
  })

  return didChange ? nextTracks : tracks
}

export function resetAllTrackHeights(tracks: TimelineTrack[]): TimelineTrack[] {
  return resizeAllTracksInList(tracks, DEFAULT_TRACK_HEIGHT)
}

export function getMinimumTrackSectionSpacerHeight(trackTitleBarHeight: number): number {
  return Math.max(0, Math.round(trackTitleBarHeight * 1.5))
}

function getTrackSectionHeights(tracks: TimelineTrack[]) {
  const videoSectionHeight = tracks.reduce(
    (sum, track) => sum + (getTrackKind(track) === 'video' ? track.height : 0),
    0,
  )
  const audioSectionHeight = tracks.reduce(
    (sum, track) => sum + (getTrackKind(track) === 'audio' ? track.height : 0),
    0,
  )

  return {
    videoSectionHeight,
    audioSectionHeight,
    hasTrackSections: videoSectionHeight > 0 && audioSectionHeight > 0,
  }
}

function getSectionDividerBounds(
  viewportHeight: number,
  tracks: TimelineTrack[],
  trackTitleBarHeight: number,
) {
  const { hasTrackSections } = getTrackSectionHeights(tracks)

  if (!hasTrackSections) {
    return {
      hasTrackSections,
      availablePaneHeight: Math.max(0, viewportHeight),
      minimumSectionDividerPosition: 0,
      maximumSectionDividerPosition: 0,
    }
  }

  const availablePaneHeight = Math.max(0, viewportHeight - TRACK_SECTION_DIVIDER_HEIGHT)
  const minimumSpacerHeight = Math.min(
    getMinimumTrackSectionSpacerHeight(trackTitleBarHeight),
    Math.floor(availablePaneHeight / 2),
  )

  return {
    hasTrackSections,
    availablePaneHeight,
    minimumSectionDividerPosition: minimumSpacerHeight,
    maximumSectionDividerPosition: Math.max(
      minimumSpacerHeight,
      availablePaneHeight - minimumSpacerHeight,
    ),
  }
}

export function clampSectionDividerPosition({
  viewportHeight,
  tracks,
  requestedDividerPosition,
  trackTitleBarHeight,
}: SectionDividerPositionParams): number {
  const { hasTrackSections, minimumSectionDividerPosition, maximumSectionDividerPosition } =
    getSectionDividerBounds(viewportHeight, tracks, trackTitleBarHeight)

  if (!hasTrackSections) {
    return 0
  }

  return Math.max(
    minimumSectionDividerPosition,
    Math.min(maximumSectionDividerPosition, requestedDividerPosition),
  )
}

export function getTrackSectionLayout({
  viewportHeight,
  tracks,
  sectionDividerPosition,
  trackTitleBarHeight,
}: TrackSectionLayoutParams): TrackSectionLayout {
  const { videoSectionHeight, audioSectionHeight, hasTrackSections } =
    getTrackSectionHeights(tracks)
  const { availablePaneHeight, minimumSectionDividerPosition, maximumSectionDividerPosition } =
    getSectionDividerBounds(viewportHeight, tracks, trackTitleBarHeight)
  const defaultSectionDividerPosition = hasTrackSections
    ? videoSectionHeight + (availablePaneHeight - videoSectionHeight - audioSectionHeight) / 2
    : videoSectionHeight > 0
      ? availablePaneHeight
      : 0
  const clampedSectionDividerPosition = hasTrackSections
    ? clampSectionDividerPosition({
        viewportHeight,
        tracks,
        requestedDividerPosition: sectionDividerPosition ?? defaultSectionDividerPosition,
        trackTitleBarHeight,
      })
    : 0
  const videoPaneHeight = hasTrackSections
    ? clampedSectionDividerPosition
    : videoSectionHeight > 0
      ? availablePaneHeight
      : 0
  const audioPaneHeight = hasTrackSections
    ? Math.max(0, availablePaneHeight - clampedSectionDividerPosition)
    : audioSectionHeight > 0
      ? availablePaneHeight
      : 0

  return {
    hasTrackSections,
    availablePaneHeight,
    minimumSectionDividerPosition,
    maximumSectionDividerPosition,
    clampedSectionDividerPosition,
    videoPaneHeight: Math.max(0, Math.round(videoPaneHeight)),
    audioPaneHeight: Math.max(0, Math.round(audioPaneHeight)),
    videoSectionHeight,
    audioSectionHeight,
  }
}
