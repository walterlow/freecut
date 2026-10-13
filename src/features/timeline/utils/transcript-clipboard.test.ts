// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem, VideoItem } from '@/types/timeline'
import type { TranscriptToken } from './transcript-edit-model'
import { buildTranscriptClipboardItems } from './transcript-clipboard'

function videoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'item-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 300,
    label: 'Clip',
    src: 'blob:x',
    mediaId: 'media-1',
    sourceStart: 0,
    sourceEnd: 300,
    sourceDuration: 300,
    sourceFps: 30, // explicit → no media-store lookup needed
    speed: 1,
    ...overrides,
  } as VideoItem
}

function token(overrides: Partial<TranscriptToken>): TranscriptToken {
  return {
    key: 'item-1:0',
    itemId: 'item-1',
    mediaId: 'media-1',
    text: 'word',
    sourceStart: 0,
    sourceEnd: 1,
    startFrame: 0,
    endFrame: 30,
    ...overrides,
  }
}

describe('buildTranscriptClipboardItems', () => {
  const itemById: Record<string, TimelineItem | undefined> = { 'item-1': videoItem() }

  it('clones a single run trimmed to the words source range', () => {
    const slice = [
      token({ sourceStart: 1, sourceEnd: 2, startFrame: 30, endFrame: 60 }),
      token({ key: 'item-1:1', sourceStart: 2, sourceEnd: 3, startFrame: 60, endFrame: 90 }),
    ]
    const clones = buildTranscriptClipboardItems(slice, itemById, 30)

    expect(clones).toHaveLength(1)
    const clone = clones[0]!
    expect(clone.type).toBe('video')
    // 1s..3s at 30fps source → frames 30..90
    expect(clone.sourceStart).toBe(30)
    expect(clone.sourceEnd).toBe(90)
    // timeline span = last.endFrame - first.startFrame
    expect(clone.durationInFrames).toBe(60)
    expect(clone.from).toBe(30)
    expect(clone.id).not.toBe('item-1')
    expect(clone.linkedGroupId).toBeUndefined()
  })

  it('splits a selection spanning two clips into one clone each', () => {
    const twoClips: Record<string, TimelineItem | undefined> = {
      'item-1': videoItem(),
      'item-2': videoItem({ id: 'item-2', from: 300 }),
    }
    const slice = [
      token({ itemId: 'item-1', sourceStart: 0, sourceEnd: 1, startFrame: 0, endFrame: 30 }),
      token({
        key: 'item-2:0',
        itemId: 'item-2',
        sourceStart: 0,
        sourceEnd: 1,
        startFrame: 300,
        endFrame: 330,
      }),
    ]
    const clones = buildTranscriptClipboardItems(slice, twoClips, 30)
    expect(clones).toHaveLength(2)
    expect(clones.map((clone) => clone.from)).toEqual([0, 300])
  })

  it('honors source fps when converting seconds to source frames', () => {
    const items: Record<string, TimelineItem | undefined> = {
      'item-1': videoItem({ sourceFps: 60 }),
    }
    const slice = [token({ sourceStart: 1, sourceEnd: 2, startFrame: 30, endFrame: 60 })]
    const clone = buildTranscriptClipboardItems(slice, items, 30)[0]!
    // 1s..2s at 60fps source → 60..120
    expect(clone.sourceStart).toBe(60)
    expect(clone.sourceEnd).toBe(120)
  })

  it('clones the linked audio companion so A/V pairs paste together', () => {
    const audioCompanion = {
      id: 'aud-1',
      type: 'audio',
      trackId: 'A1',
      from: 0,
      durationInFrames: 300,
      label: 'Audio',
      src: 'blob:a',
      mediaId: 'media-1',
      sourceStart: 0,
      sourceEnd: 300,
      sourceDuration: 300,
      sourceFps: 48,
      speed: 1,
      linkedGroupId: 'pair-1',
    } as unknown as TimelineItem
    const linked: Record<string, TimelineItem | undefined> = {
      'vid-1': videoItem({ id: 'vid-1', trackId: 'V1', linkedGroupId: 'pair-1', sourceFps: 30 }),
      'aud-1': audioCompanion,
    }
    // The transcript only surfaces the video token stream (audio is deduped).
    const slice = [
      token({ itemId: 'vid-1', sourceStart: 1, sourceEnd: 2, startFrame: 30, endFrame: 60 }),
    ]
    const clones = buildTranscriptClipboardItems(slice, linked, 30)

    expect(clones).toHaveLength(2)
    const [video, audio] = clones
    expect(video!.type).toBe('video')
    expect(audio!.type).toBe('audio')
    // Both kept on their own tracks, same timeline placement.
    expect(video!.trackId).toBe('V1')
    expect(audio!.trackId).toBe('A1')
    expect(video!.from).toBe(audio!.from)
    expect(video!.durationInFrames).toBe(audio!.durationInFrames)
    // Re-linked under one fresh group id so paste keeps them paired.
    expect(video!.linkedGroupId).toBeDefined()
    expect(video!.linkedGroupId).toBe(audio!.linkedGroupId)
    expect(video!.linkedGroupId).not.toBe('pair-1')
    // Each converts seconds with its own source fps.
    expect(video!.sourceStart).toBe(30) // 1s * 30fps
    expect(audio!.sourceStart).toBe(48) // 1s * 48fps
  })

  it('skips non-media items', () => {
    const items: Record<string, TimelineItem | undefined> = { 'item-1': undefined }
    const slice = [token({})]
    expect(buildTranscriptClipboardItems(slice, items, 30)).toHaveLength(0)
  })
})
