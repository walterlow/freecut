import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline'
import {
  buildTransitionTrackOrderById,
  resolveCompositionRenderTracks,
} from './composition-render-inputs'

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'video-track',
    from: 0,
    durationInFrames: 60,
    label: 'clip.mp4',
    src: 'blob:source',
    isReversed: true,
    sourceStart: 60,
    sourceEnd: 180,
    sourceDuration: 300,
    sourceFps: 30,
    speed: 1,
    reverseConformStatus: 'ready',
    reverseConformSrc: 'blob:reverse-export',
    reverseConformPreviewSrc: 'blob:reverse-preview',
    reverseConformPreviewUsesProxy: false,
    ...overrides,
  }
}

function makeTextItem(): TimelineItem {
  return {
    id: 'title-1',
    type: 'text',
    trackId: 'video-track',
    from: 0,
    durationInFrames: 60,
    label: 'Title',
    text: 'Hello',
  } as TimelineItem
}

function makeTrack(items: TimelineItem[], overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id: 'video-track',
    name: 'Video',
    height: 64,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: 1,
    items,
    ...overrides,
  }
}

function resolveTracks(
  tracks: TimelineTrack[],
  overrides: Partial<Parameters<typeof resolveCompositionRenderTracks>[0]> = {},
) {
  return resolveCompositionRenderTracks({
    tracks,
    fps: 30,
    renderText: true,
    isComparisonMode: false,
    renderMode: 'export',
    ...overrides,
  })
}

function onlyTrack(tracks: TimelineTrack[]): TimelineTrack {
  const [track] = tracks
  if (!track) throw new Error('expected exactly one resolved track')
  return track
}

function onlyItem(track: TimelineTrack): TimelineItem {
  const [item] = track.items
  if (!item) throw new Error('expected exactly one resolved item')
  return item
}

describe('resolveCompositionRenderTracks', () => {
  it('drops only text items when renderText is false', () => {
    const video = makeVideoItem({ isReversed: false })
    const text = makeTextItem()
    const resolved = resolveTracks([makeTrack([video, text])], { renderText: false })

    expect(resolved).toHaveLength(1)
    expect(onlyTrack(resolved).items).toEqual([video])
    expect(onlyItem(onlyTrack(resolved))).toBe(video)
  })

  it('keeps text items when renderText is unset, matching the export default', () => {
    const text = makeTextItem()
    const resolved = resolveTracks([makeTrack([text])], { renderText: undefined })

    expect(onlyTrack(resolved).items).toEqual([text])
  })

  it('passes non-video items and track flags through untouched', () => {
    const text = makeTextItem()
    const resolved = resolveTracks([makeTrack([text], { visible: false, order: 7 })])
    const track = onlyTrack(resolved)

    expect(onlyItem(track)).toBe(text)
    expect(track.visible).toBe(false)
    expect(track.order).toBe(7)
  })

  it('conforms a reversed clip to its export conform source in export mode', () => {
    const resolved = resolveTracks([makeTrack([makeVideoItem()])])
    const item = onlyItem(onlyTrack(resolved)) as VideoItem

    expect(item.src).toBe('blob:reverse-export')
    expect(item.isReversed).toBeUndefined()
  })

  it('conforms a reversed clip to its preview conform source in preview and comparison', () => {
    const preview = onlyItem(
      onlyTrack(resolveTracks([makeTrack([makeVideoItem()])], { renderMode: 'preview' })),
    ) as VideoItem
    const comparison = onlyItem(
      onlyTrack(
        resolveTracks([makeTrack([makeVideoItem()])], {
          renderMode: 'export',
          isComparisonMode: true,
        }),
      ),
    ) as VideoItem

    expect(preview.src).toBe('blob:reverse-preview')
    expect(comparison.src).toBe('blob:reverse-preview')
  })

  it('leaves a reversed clip on its original source while the conform is pending', () => {
    const item = makeVideoItem({ reverseConformStatus: 'pending', reverseConformSrc: undefined })
    const resolved = resolveTracks([makeTrack([item])])

    expect(onlyItem(onlyTrack(resolved))).toBe(item)
  })
})

describe('buildTransitionTrackOrderById', () => {
  it('maps each transition to its track order and defaults un-ordered tracks to 0', () => {
    const orderById = buildTransitionTrackOrderById(
      [
        { transition: { id: 'cross-1', trackId: 'track-a' } },
        { transition: { id: 'cross-2', trackId: 'track-unknown' } },
        { transition: { id: 'cross-3', trackId: null } },
      ],
      new Map([['track-a', 4]]),
    )

    expect([...orderById]).toEqual([
      ['cross-1', 4],
      ['cross-2', 0],
      ['cross-3', 0],
    ])
  })
})
