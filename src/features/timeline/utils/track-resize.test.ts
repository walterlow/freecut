import { describe, expect, it } from 'vite-plus/test'
import {
  DEFAULT_TRACK_HEIGHT,
  TRACK_SECTION_DIVIDER_HEIGHT,
  MAX_TRACK_HEIGHT,
  MIN_TRACK_HEIGHT,
} from '../constants'
import {
  clampSectionDividerPosition,
  clampTrackHeight,
  getMinimumTrackSectionSpacerHeight,
  getTrackSectionLayout,
  resetAllTrackHeights,
  resizeAllTracksInList,
  resizeTrackInList,
} from './track-resize'

function createTrack(id: string, kind: 'video' | 'audio', height: number) {
  return {
    id,
    name: id.toUpperCase(),
    kind,
    order: 0,
    height,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    items: [],
  }
}

describe('track-resize', () => {
  it('clamps resized track heights into the supported range', () => {
    expect(clampTrackHeight(MIN_TRACK_HEIGHT - 20)).toBe(MIN_TRACK_HEIGHT)
    expect(clampTrackHeight(MAX_TRACK_HEIGHT + 20)).toBe(MAX_TRACK_HEIGHT)
    expect(clampTrackHeight(96.6)).toBe(97)
  })

  it('updates only the requested track and preserves unchanged arrays', () => {
    const tracks = [createTrack('v1', 'video', 72), createTrack('a1', 'audio', 72)]

    const resizedTracks = resizeTrackInList(tracks, 'a1', 118)

    expect(resizedTracks).not.toBe(tracks)
    expect(resizedTracks[0]).toBe(tracks[0])
    expect(resizedTracks[1]).toMatchObject({ id: 'a1', height: 118 })
    expect(resizeTrackInList(tracks, 'missing', 118)).toBe(tracks)
    expect(resizeTrackInList(tracks, 'v1', 72)).toBe(tracks)
  })

  it('can resize every track to a shared height', () => {
    const tracks = [
      createTrack('v1', 'video', 72),
      createTrack('v2', 'video', 96),
      createTrack('a1', 'audio', 120),
    ]

    const resizedTracks = resizeAllTracksInList(tracks, 88)

    expect(resizedTracks).not.toBe(tracks)
    expect(resizedTracks.map((track) => track.height)).toEqual([88, 88, 88])
    expect(resizeAllTracksInList(resizedTracks, 88)).toBe(resizedTracks)
  })

  it('can reset every track back to the default height', () => {
    const tracks = [createTrack('v1', 'video', 72), createTrack('a1', 'audio', 120)]

    const resizedTracks = resetAllTrackHeights(tracks)

    expect(resizedTracks.map((track) => track.height)).toEqual([
      DEFAULT_TRACK_HEIGHT,
      DEFAULT_TRACK_HEIGHT,
    ])
    expect(resetAllTrackHeights(resizedTracks)).toBe(resizedTracks)
  })

  it('keeps the A/V spacer slightly taller than the title bar', () => {
    expect(getMinimumTrackSectionSpacerHeight(24)).toBe(36)
    expect(getMinimumTrackSectionSpacerHeight(26)).toBe(39)
  })

  it('keeps a buffer when manual divider drags reach either edge', () => {
    const viewportHeight = 420
    const trackTitleBarHeight = 24
    const tracks = [createTrack('v1', 'video', 100), createTrack('a1', 'audio', 100)]

    const topCollapsedLayout = getTrackSectionLayout({
      viewportHeight,
      tracks,
      sectionDividerPosition: 0,
      trackTitleBarHeight,
    })
    const bottomCollapsedLayout = getTrackSectionLayout({
      viewportHeight,
      tracks,
      sectionDividerPosition: viewportHeight,
      trackTitleBarHeight,
    })

    expect(topCollapsedLayout.videoPaneHeight).toBe(36)
    expect(topCollapsedLayout.audioPaneHeight).toBe(
      viewportHeight - TRACK_SECTION_DIVIDER_HEIGHT - 36,
    )
    expect(bottomCollapsedLayout.videoPaneHeight).toBe(
      viewportHeight - TRACK_SECTION_DIVIDER_HEIGHT - 36,
    )
    expect(bottomCollapsedLayout.audioPaneHeight).toBe(36)
  })

  it('defaults the split around the section content heights', () => {
    const viewportHeight = 420
    const trackTitleBarHeight = 24
    const tracks = [createTrack('v1', 'video', 120), createTrack('a1', 'audio', 80)]

    const layout = getTrackSectionLayout({
      viewportHeight,
      tracks,
      sectionDividerPosition: null,
      trackTitleBarHeight,
    })

    expect(layout.videoPaneHeight).toBe(229)
    expect(layout.audioPaneHeight).toBe(189)
  })

  it('keeps a manual divider position stable when track heights change', () => {
    const viewportHeight = 420
    const trackTitleBarHeight = 24
    const tracks = [createTrack('v1', 'video', 100), createTrack('a1', 'audio', 100)]
    const resizedTracks = resizeTrackInList(tracks, 'v1', 160)

    const nextLayout = getTrackSectionLayout({
      viewportHeight,
      tracks: resizedTracks,
      sectionDividerPosition: 150,
      trackTitleBarHeight,
    })

    expect(nextLayout.videoPaneHeight).toBe(150)
    expect(nextLayout.audioPaneHeight).toBe(viewportHeight - TRACK_SECTION_DIVIDER_HEIGHT - 150)
  })

  it('clamps divider positions to the available pane height', () => {
    const viewportHeight = 420
    const tracks = [createTrack('v1', 'video', 100), createTrack('a1', 'audio', 100)]

    expect(
      clampSectionDividerPosition({
        viewportHeight,
        tracks,
        requestedDividerPosition: -20,
        trackTitleBarHeight: 24,
      }),
    ).toBe(36)
    expect(
      clampSectionDividerPosition({
        viewportHeight,
        tracks,
        requestedDividerPosition: viewportHeight,
        trackTitleBarHeight: 24,
      }),
    ).toBe(viewportHeight - TRACK_SECTION_DIVIDER_HEIGHT - 36)
  })
})
