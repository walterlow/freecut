import { describe, expect, it } from 'vite-plus/test'
import type { TimelineTrack } from '@/types/timeline'
import {
  createClassicTrack,
  findNearestTrackByKind,
  getAdjacentTrackOrder,
  getNextClassicTrackName,
  isTrackDisabled,
  getTrackKind,
  normalizeClassicTrackNames,
  renameTrackForKind,
} from './classic-tracks'

function makeTrack(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id: 'track-1',
    name: 'Track 1',
    height: 64,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    order: 0,
    items: [],
    ...overrides,
  }
}

describe('classic tracks', () => {
  it('infers track kind from explicit kind or classic names', () => {
    expect(getTrackKind(makeTrack({ kind: 'audio' }))).toBe('audio')
    expect(getTrackKind(makeTrack({ name: 'V2' }))).toBe('video')
    expect(getTrackKind(makeTrack({ name: 'A4' }))).toBe('audio')
    expect(getTrackKind(makeTrack({ name: 'Track 1' }))).toBeNull()
  })

  it('derives disabled state from stored visibility or mute flags', () => {
    expect(isTrackDisabled(makeTrack({ kind: 'video', visible: false }))).toBe(true)
    expect(isTrackDisabled(makeTrack({ kind: 'audio', muted: true }))).toBe(true)
    expect(isTrackDisabled(makeTrack({ name: 'V2', kind: undefined, visible: false }))).toBe(true)
    expect(isTrackDisabled(makeTrack({ name: 'A4', kind: undefined, muted: true }))).toBe(true)
    expect(isTrackDisabled(makeTrack({ name: 'Track 1', visible: true, muted: false }))).toBe(false)
  })

  it('renames generic tracks into classic names when assigning a kind', () => {
    const tracks = [
      makeTrack({ id: 'track-1', name: 'Track 1' }),
      makeTrack({ id: 'track-2', name: 'V1', kind: 'video', order: 1 }),
    ]
    expect(renameTrackForKind(tracks[0]!, tracks, 'audio')).toMatchObject({
      kind: 'audio',
      name: 'A1',
    })
  })

  it('finds or creates adjacent classic track positions', () => {
    const tracks = [
      makeTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
      makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 1 }),
      makeTrack({ id: 'v2', name: 'V2', kind: 'video', order: 2 }),
    ]

    expect(
      findNearestTrackByKind({ tracks, targetTrack: tracks[0]!, kind: 'audio', direction: 'below' })
        ?.id,
    ).toBe('a1')
    expect(getAdjacentTrackOrder(tracks, tracks[1]!, 'above')).toBe(0.5)
    expect(getNextClassicTrackName(tracks, 'audio')).toBe('A2')
    expect(createClassicTrack({ tracks, kind: 'audio', order: 3 })).toMatchObject({
      name: 'A2',
      kind: 'audio',
    })
  })

  describe('normalizeClassicTrackNames', () => {
    it('renumbers scrambled video names by stack position (bottom-most is V1)', () => {
      // Reproduces the reported state: orders -2,-1,0.5,1 named V4,V3,V5,V1.
      const tracks = [
        makeTrack({ id: 'a', name: 'V4', kind: 'video', order: -2 }),
        makeTrack({ id: 'b', name: 'V3', kind: 'video', order: -1 }),
        makeTrack({ id: 'c', name: 'V5', kind: 'video', order: 0.5 }),
        makeTrack({ id: 'd', name: 'V1', kind: 'video', order: 1 }),
      ]

      const result = normalizeClassicTrackNames(tracks)
      const nameByOrder = Object.fromEntries(result.map((t) => [t.order, t.name]))
      expect(nameByOrder).toEqual({ '1': 'V1', '0.5': 'V2', '-1': 'V3', '-2': 'V4' })
    })

    it('numbers audio from the top down (top-most is A1)', () => {
      const tracks = [
        makeTrack({ id: 'a', name: 'A2', kind: 'audio', order: 2 }),
        makeTrack({ id: 'b', name: 'A5', kind: 'audio', order: 3 }),
      ]

      const result = normalizeClassicTrackNames(tracks)
      const nameByOrder = Object.fromEntries(result.map((t) => [t.order, t.name]))
      expect(nameByOrder).toEqual({ '2': 'A1', '3': 'A2' })
    })

    it('preserves custom names, group headers, and array identity when already correct', () => {
      const tracks = [
        makeTrack({ id: 'v2', name: 'V2', kind: 'video', order: 0 }),
        makeTrack({ id: 'grp', name: 'Group A', kind: 'video', order: 0.5, isGroup: true }),
        makeTrack({ id: 'music', name: 'Music', kind: 'video', order: 0.8 }),
        makeTrack({ id: 'v1', name: 'V1', kind: 'video', order: 1 }),
        makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 2 }),
      ]

      const result = normalizeClassicTrackNames(tracks)
      // V1 (bottom) and V2 (above the custom/group lanes) are already in order, so
      // nothing changes and the original array reference is returned.
      expect(result).toBe(tracks)
      expect(result.map((t) => t.name)).toEqual(['V2', 'Group A', 'Music', 'V1', 'A1'])
    })
  })
})
