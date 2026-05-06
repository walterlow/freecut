import { describe, expect, it } from 'vite-plus/test'
import type { SubtitleSegmentItem, TimelineTrack, VideoItem } from '@/types/timeline'
import { convertTimelineToComposition } from './timeline-to-composition'

describe('convertTimelineToComposition IO marker conversion', () => {
  it('converts IO trims from timeline frames to source frames using source FPS', () => {
    const fps = 30
    const sourceFps = 24
    const inPoint = 100
    const outPoint = 200

    const track: TimelineTrack = {
      id: 'track-1',
      name: 'Track 1',
      height: 72,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 0,
      items: [],
    }

    const item: VideoItem = {
      id: 'item-1',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 300,
      label: 'Video',
      src: 'blob:test',
      trimStart: 10,
      trimEnd: 5,
      sourceStart: 1000,
      sourceFps,
      speed: 1,
    }

    const composition = convertTimelineToComposition(
      [track],
      [item],
      [],
      fps,
      1920,
      1080,
      inPoint,
      outPoint,
    )

    const exportedItem = composition.tracks[0]!.items[0] as VideoItem

    // 100 timeline frames at 30fps = 3.333s => 80 source frames at 24fps
    expect(exportedItem.sourceStart).toBe(1080)
    expect(exportedItem.trimStart).toBe(90)
    expect(exportedItem.trimEnd).toBe(85)
    expect(exportedItem.offset).toBe(90)
    expect(exportedItem.durationInFrames).toBe(100)
    expect(composition.durationInFrames).toBe(100)
  })

  it('moves sourceEnd backward when IO range trims the start of a reversed video', () => {
    const fps = 30
    const inPoint = 30
    const outPoint = 90

    const track: TimelineTrack = {
      id: 'track-1',
      name: 'Track 1',
      height: 72,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 0,
      items: [],
    }

    const item: VideoItem = {
      id: 'item-1',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 120,
      label: 'Video',
      src: 'blob:test',
      sourceStart: 100,
      sourceEnd: 220,
      sourceFps: 30,
      speed: 1,
      isReversed: true,
    }

    const composition = convertTimelineToComposition(
      [track],
      [item],
      [],
      fps,
      1920,
      1080,
      inPoint,
      outPoint,
    )

    const exportedItem = composition.tracks[0]!.items[0] as VideoItem

    expect(exportedItem.from).toBe(0)
    expect(exportedItem.durationInFrames).toBe(60)
    expect(exportedItem.isReversed).toBe(true)
    expect(exportedItem.sourceStart).toBe(130)
    expect(exportedItem.sourceEnd).toBe(190)
  })

  it('shifts and clips subtitle segment cues when IO range trims the segment', () => {
    const fps = 30
    const inPoint = 45
    const outPoint = 120

    const track: TimelineTrack = {
      id: 'track-subtitles',
      name: 'Subtitles',
      height: 72,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 0,
      items: [],
    }

    const item: SubtitleSegmentItem = {
      id: 'subtitle-1',
      type: 'subtitle',
      trackId: 'track-subtitles',
      from: 30,
      durationInFrames: 120,
      label: 'Transcript',
      mediaId: 'media-1',
      source: {
        type: 'transcript',
        mediaId: 'media-1',
        clipId: 'clip-1',
      },
      cues: [
        { id: 'cue-before', startSeconds: 0, endSeconds: 0.25, text: 'Before range' },
        { id: 'cue-overlap-start', startSeconds: 0.25, endSeconds: 1, text: 'Starts before' },
        { id: 'cue-inside', startSeconds: 1.5, endSeconds: 2, text: 'Inside' },
        { id: 'cue-overlap-end', startSeconds: 2.75, endSeconds: 4, text: 'Ends after' },
      ],
      color: '#ffffff',
    }

    const composition = convertTimelineToComposition(
      [track],
      [item],
      [],
      fps,
      1920,
      1080,
      inPoint,
      outPoint,
    )

    const exportedItem = composition.tracks[0]!.items[0] as SubtitleSegmentItem

    expect(exportedItem.from).toBe(0)
    expect(exportedItem.durationInFrames).toBe(75)
    expect(exportedItem.cues).toEqual([
      { id: 'cue-overlap-start', startSeconds: 0, endSeconds: 0.5, text: 'Starts before' },
      { id: 'cue-inside', startSeconds: 1, endSeconds: 1.5, text: 'Inside' },
      { id: 'cue-overlap-end', startSeconds: 2.25, endSeconds: 2.5, text: 'Ends after' },
    ])
  })
})
