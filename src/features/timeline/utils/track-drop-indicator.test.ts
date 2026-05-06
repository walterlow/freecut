import { describe, expect, it } from 'vite-plus/test'
import type { TimelineTrack } from '@/types/timeline'
import { getTrackDropIndicatorTop } from './track-drop-indicator'

function makeTrack(
  overrides: Partial<TimelineTrack> & Pick<TimelineTrack, 'id' | 'name' | 'order'>,
): TimelineTrack {
  return {
    height: 80,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    items: [],
    ...overrides,
  }
}

describe('getTrackDropIndicatorTop', () => {
  const tracks = [
    makeTrack({ id: 'v2', name: 'V2', kind: 'video', order: 0 }),
    makeTrack({ id: 'v1', name: 'V1', kind: 'video', order: 1 }),
    makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 2 }),
  ]

  it('includes the top spacer for the first drop position', () => {
    expect(
      getTrackDropIndicatorTop({
        tracks,
        dropIndex: 0,
        topSectionSpacerHeight: 24,
        hasTrackSections: true,
        videoTrackCount: 2,
        dividerHeight: 8,
      }),
    ).toBe(24)
  })

  it('includes the section divider at the audio boundary', () => {
    expect(
      getTrackDropIndicatorTop({
        tracks,
        dropIndex: 2,
        topSectionSpacerHeight: 24,
        hasTrackSections: true,
        videoTrackCount: 2,
        dividerHeight: 8,
      }),
    ).toBe(192)
  })

  it('places the final drop position after all tracks and the divider', () => {
    expect(
      getTrackDropIndicatorTop({
        tracks,
        dropIndex: 3,
        topSectionSpacerHeight: 24,
        hasTrackSections: true,
        videoTrackCount: 2,
        dividerHeight: 8,
      }),
    ).toBe(272)
  })
})
