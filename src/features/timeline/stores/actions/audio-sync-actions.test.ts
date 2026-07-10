import { beforeEach, describe, expect, it } from 'vite-plus/test'

import type { ImageItem } from '@/types/timeline'
import { useSelectionStore } from '@/shared/state/selection'
import { makeTimelineAudioItem, makeTimelineTrack } from '../../test-helpers'
import { useItemsStore } from '../items-store'
import { useKeyframesStore } from '../keyframes-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { applySelectedAudioDucking, matchSelectedImagesToAudio } from './audio-sync-actions'

function makeImageItem(overrides: Partial<ImageItem> = {}): ImageItem {
  return {
    id: 'image-1',
    type: 'image',
    trackId: 'track-v1',
    from: 0,
    durationInFrames: 60,
    label: 'still.jpg',
    src: 'blob:image',
    mediaId: 'media-image',
    ...overrides,
  }
}

describe('audio sync timeline actions', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useItemsStore
      .getState()
      .setTracks([
        makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 }),
        makeTimelineTrack({ id: 'track-a1', name: 'A1', kind: 'audio', order: 1 }),
        makeTimelineTrack({ id: 'track-a2', name: 'A2', kind: 'audio', order: 2 }),
      ])
    useItemsStore.getState().setItems([])
    useKeyframesStore.getState().setKeyframes([])
    useSelectionStore.getState().clearSelection()
  })

  it('retimes selected still images across the selected audio clip span', () => {
    useItemsStore.getState().setItems([
      makeImageItem({ id: 'image-1', from: 0, durationInFrames: 10 }),
      makeImageItem({ id: 'image-2', from: 20, durationInFrames: 10 }),
      makeImageItem({ id: 'image-3', from: 40, durationInFrames: 10 }),
      makeTimelineAudioItem({
        id: 'music',
        trackId: 'track-a1',
        from: 30,
        durationInFrames: 100,
      }),
    ])

    const result = matchSelectedImagesToAudio(['image-1', 'image-2', 'image-3', 'music'])

    expect(result).toMatchObject({ status: 'matched', imageCount: 3 })
    const byId = useItemsStore.getState().itemById
    expect(byId['image-1']).toMatchObject({ from: 30, durationInFrames: 33 })
    expect(byId['image-2']).toMatchObject({ from: 63, durationInFrames: 39 })
    expect(byId['image-3']).toMatchObject({ from: 102, durationInFrames: 28 })
  })

  it('snaps still-image cuts to narration transcript cue starts when available', () => {
    useItemsStore.getState().setItems([
      makeImageItem({ id: 'image-1', from: 0, durationInFrames: 10 }),
      makeImageItem({ id: 'image-2', from: 20, durationInFrames: 10 }),
      makeImageItem({ id: 'image-3', from: 40, durationInFrames: 10 }),
      makeTimelineAudioItem({
        id: 'narration',
        trackId: 'track-a1',
        from: 0,
        durationInFrames: 300,
        transcriptCaptions: {
          type: 'transcript',
          mediaId: 'narration-media',
          enabled: true,
          updatedAt: 1,
          cues: [
            { id: 'cue-1', startSeconds: 0.1, endSeconds: 1.8, text: 'Opening line' },
            { id: 'cue-2', startSeconds: 3.1, endSeconds: 4.9, text: 'Second beat' },
            { id: 'cue-3', startSeconds: 6.2, endSeconds: 7.8, text: 'Third beat' },
          ],
        },
      }),
    ])

    const result = matchSelectedImagesToAudio(['image-1', 'image-2', 'image-3', 'narration'])

    expect(result).toMatchObject({ status: 'matched', imageCount: 3 })
    const byId = useItemsStore.getState().itemById
    expect(byId['image-1']).toMatchObject({ from: 0, durationInFrames: 93 })
    expect(byId['image-2']).toMatchObject({ from: 93, durationInFrames: 93 })
    expect(byId['image-3']).toMatchObject({ from: 186, durationInFrames: 114 })
  })

  it('prefers dramatic transcript story beats over plain nearby cue starts', () => {
    useItemsStore.getState().setItems([
      makeImageItem({ id: 'image-1', from: 0, durationInFrames: 10 }),
      makeImageItem({ id: 'image-2', from: 20, durationInFrames: 10 }),
      makeImageItem({ id: 'image-3', from: 40, durationInFrames: 10 }),
      makeImageItem({ id: 'image-4', from: 60, durationInFrames: 10 }),
      makeTimelineAudioItem({
        id: 'narration',
        trackId: 'track-a1',
        from: 0,
        durationInFrames: 600,
        transcriptCaptions: {
          type: 'transcript',
          mediaId: 'narration-media',
          enabled: true,
          updatedAt: 1,
          cues: [
            { id: 'cue-1', startSeconds: 0.1, endSeconds: 2, text: 'Opening setup' },
            { id: 'cue-2', startSeconds: 5, endSeconds: 6, text: 'A quiet ordinary line' },
            {
              id: 'cue-3',
              startSeconds: 6.5,
              endSeconds: 8,
              text: 'Only then did the dangerous truth appear',
            },
            { id: 'cue-4', startSeconds: 10, endSeconds: 11, text: 'The room waited' },
            { id: 'cue-5', startSeconds: 15, endSeconds: 16, text: 'A final promise broke' },
          ],
        },
      }),
    ])

    const result = matchSelectedImagesToAudio([
      'image-1',
      'image-2',
      'image-3',
      'image-4',
      'narration',
    ])

    expect(result).toMatchObject({ status: 'matched', imageCount: 4 })
    const byId = useItemsStore.getState().itemById
    expect(byId['image-1']).toMatchObject({ from: 0, durationInFrames: 195 })
    expect(byId['image-2']).toMatchObject({ from: 195, durationInFrames: 105 })
    expect(byId['image-3']).toMatchObject({ from: 300, durationInFrames: 150 })
    expect(byId['image-4']).toMatchObject({ from: 450, durationInFrames: 150 })
  })

  it('reorders selected stills to story segments when image labels match transcript text', () => {
    useItemsStore.getState().setItems([
      makeImageItem({
        id: 'image-truth',
        label: 'hidden truth reveal.png',
        from: 0,
        durationInFrames: 10,
      }),
      makeImageItem({
        id: 'image-moon',
        label: 'silver moon window.png',
        from: 20,
        durationInFrames: 10,
      }),
      makeImageItem({
        id: 'image-opening',
        label: 'opening room.png',
        from: 40,
        durationInFrames: 10,
      }),
      makeTimelineAudioItem({
        id: 'narration',
        trackId: 'track-a1',
        from: 0,
        durationInFrames: 300,
        transcriptCaptions: {
          type: 'transcript',
          mediaId: 'narration-media',
          enabled: true,
          updatedAt: 1,
          cues: [
            { id: 'cue-1', startSeconds: 0.1, endSeconds: 1.8, text: 'Opening in the quiet room' },
            {
              id: 'cue-2',
              startSeconds: 3.1,
              endSeconds: 4.9,
              text: 'A silver moon filled the window',
            },
            {
              id: 'cue-3',
              startSeconds: 6.2,
              endSeconds: 7.8,
              text: 'Only then did the hidden truth reveal itself',
            },
          ],
        },
      }),
    ])

    const result = matchSelectedImagesToAudio([
      'image-truth',
      'image-moon',
      'image-opening',
      'narration',
    ])

    expect(result).toMatchObject({ status: 'matched', imageCount: 3 })
    const byId = useItemsStore.getState().itemById
    expect(byId['image-opening']).toMatchObject({ from: 0, durationInFrames: 93 })
    expect(byId['image-moon']).toMatchObject({ from: 93, durationInFrames: 93 })
    expect(byId['image-truth']).toMatchObject({ from: 186, durationInFrames: 114 })
  })

  it('matches selected stills to the full audio bed when no audio clip is selected', () => {
    useItemsStore.getState().setItems([
      makeImageItem({ id: 'image-1' }),
      makeImageItem({ id: 'image-2', from: 80 }),
      makeTimelineAudioItem({
        id: 'music-1',
        trackId: 'track-a1',
        from: 12,
        durationInFrames: 88,
      }),
      makeTimelineAudioItem({
        id: 'music-2',
        trackId: 'track-a2',
        from: 100,
        durationInFrames: 80,
      }),
    ])

    const result = matchSelectedImagesToAudio(['image-1', 'image-2'])

    expect(result).toMatchObject({ status: 'matched', imageCount: 2 })
    const byId = useItemsStore.getState().itemById
    expect(byId['image-1']).toMatchObject({ from: 12, durationInFrames: 84 })
    expect(byId['image-2']).toMatchObject({ from: 96, durationInFrames: 84 })
  })

  it('uses varied cinematic fallback timing when transcript cues are unavailable', () => {
    useItemsStore.getState().setItems([
      makeImageItem({ id: 'image-1', from: 0, durationInFrames: 90 }),
      makeImageItem({ id: 'image-2', from: 90, durationInFrames: 90 }),
      makeImageItem({ id: 'image-3', from: 180, durationInFrames: 90 }),
      makeImageItem({ id: 'image-4', from: 270, durationInFrames: 90 }),
      makeTimelineAudioItem({
        id: 'narration',
        trackId: 'track-a1',
        from: 0,
        durationInFrames: 1440,
      }),
    ])

    const result = matchSelectedImagesToAudio([
      'image-1',
      'image-2',
      'image-3',
      'image-4',
      'narration',
    ])

    expect(result).toMatchObject({ status: 'matched', imageCount: 4 })
    const byId = useItemsStore.getState().itemById
    const durations = ['image-1', 'image-2', 'image-3', 'image-4'].map(
      (id) => byId[id]!.durationInFrames,
    )

    expect(durations).toEqual([350, 412, 301, 377])
    expect(new Set(durations).size).toBeGreaterThan(1)
    expect(durations.reduce((total, duration) => total + duration, 0)).toBe(1440)
  })

  it('writes editable music ducking volume keyframes under dialogue', () => {
    useItemsStore.getState().setItems([
      makeTimelineAudioItem({
        id: 'music',
        trackId: 'track-a1',
        from: 0,
        durationInFrames: 300,
        volume: -2,
      }),
      makeTimelineAudioItem({
        id: 'dialogue',
        trackId: 'track-a2',
        from: 60,
        durationInFrames: 90,
      }),
    ])

    const result = applySelectedAudioDucking(['music'])

    expect(result).toMatchObject({ status: 'ducked', targetCount: 1, keyframeCount: 4 })
    const volumeKeyframes = useKeyframesStore
      .getState()
      .getAllKeyframesForProperty('music', 'volume')

    expect(volumeKeyframes.map((keyframe) => [keyframe.frame, keyframe.value])).toEqual([
      [55, -2],
      [60, -20],
      [150, -20],
      [161, -2],
    ])
  })

  it('uses transcript cue timing for dialogue ducking when cues are available', () => {
    useItemsStore.getState().setItems([
      makeTimelineAudioItem({
        id: 'music',
        trackId: 'track-a1',
        from: 0,
        durationInFrames: 300,
      }),
      makeTimelineAudioItem({
        id: 'dialogue',
        trackId: 'track-a2',
        from: 0,
        durationInFrames: 240,
        sourceStart: 0,
        sourceFps: 30,
        transcriptCaptions: {
          type: 'transcript',
          mediaId: 'dialogue-media',
          enabled: true,
          updatedAt: 1,
          cues: [{ id: 'cue-1', startSeconds: 2, endSeconds: 3, text: 'Line' }],
        },
      }),
    ])

    applySelectedAudioDucking(['music'])

    const volumeKeyframes = useKeyframesStore
      .getState()
      .getAllKeyframesForProperty('music', 'volume')

    expect(volumeKeyframes.map((keyframe) => [keyframe.frame, keyframe.value])).toEqual([
      [55, 0],
      [60, -18],
      [90, -18],
      [101, 0],
    ])
  })

  it('restores timing changes through undo', () => {
    useItemsStore
      .getState()
      .setItems([
        makeImageItem({ id: 'image-1', from: 10, durationInFrames: 15 }),
        makeTimelineAudioItem({ id: 'music', trackId: 'track-a1', from: 0, durationInFrames: 60 }),
      ])

    matchSelectedImagesToAudio(['image-1', 'music'])
    expect(useItemsStore.getState().itemById['image-1']).toMatchObject({
      from: 0,
      durationInFrames: 60,
    })

    useTimelineCommandStore.getState().undo()
    expect(useItemsStore.getState().itemById['image-1']).toMatchObject({
      from: 10,
      durationInFrames: 15,
    })
  })
})
