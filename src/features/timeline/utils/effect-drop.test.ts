import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import {
  canApplyDroppedEffectsToItem,
  isDragPointInsideElement,
  resolveEffectDropTargetIds,
} from './effect-drop'

function makeItem(id: string, type: TimelineItem['type']): TimelineItem {
  switch (type) {
    case 'audio':
      return {
        id,
        type,
        trackId: 'track-1',
        from: 0,
        durationInFrames: 30,
        label: id,
        src: 'blob:audio',
      }
    case 'video':
      return {
        id,
        type,
        trackId: 'track-1',
        from: 0,
        durationInFrames: 30,
        label: id,
        src: 'blob:video',
      }
    case 'image':
      return {
        id,
        type,
        trackId: 'track-1',
        from: 0,
        durationInFrames: 30,
        label: id,
        src: 'blob:image',
      }
    case 'text':
      return {
        id,
        type,
        trackId: 'track-1',
        from: 0,
        durationInFrames: 30,
        label: id,
        text: id,
        color: '#fff',
      }
    case 'shape':
      return {
        id,
        type,
        trackId: 'track-1',
        from: 0,
        durationInFrames: 30,
        label: id,
        shapeType: 'rectangle',
        fillColor: '#fff',
      }
    case 'adjustment':
      return { id, type, trackId: 'track-1', from: 0, durationInFrames: 30, label: id }
    case 'composition':
      return {
        id,
        type,
        trackId: 'track-1',
        from: 0,
        durationInFrames: 30,
        label: id,
        compositionId: 'comp-1',
        compositionWidth: 1920,
        compositionHeight: 1080,
      }
    case 'subtitle':
      return {
        id,
        type,
        trackId: 'track-1',
        from: 0,
        durationInFrames: 30,
        label: id,
        source: { type: 'subtitle-import', fileName: id, format: 'srt', importedAt: 0 },
        cues: [],
        color: '#fff',
      }
  }
}

describe('canApplyDroppedEffectsToItem', () => {
  it('rejects audio items only', () => {
    expect(canApplyDroppedEffectsToItem(makeItem('audio-1', 'audio'))).toBe(false)
    expect(canApplyDroppedEffectsToItem(makeItem('video-1', 'video'))).toBe(true)
    expect(canApplyDroppedEffectsToItem(makeItem('adj-1', 'adjustment'))).toBe(true)
  })
})

describe('resolveEffectDropTargetIds', () => {
  it('applies to hovered item when it is not part of a multi-selection', () => {
    const items = [makeItem('video-1', 'video'), makeItem('video-2', 'video')]

    expect(
      resolveEffectDropTargetIds({
        hoveredItemId: 'video-1',
        items,
        selectedItemIds: ['video-2'],
      }),
    ).toEqual(['video-1'])
  })

  it('applies to all compatible selected items when hovered item is selected', () => {
    const items = [
      makeItem('video-1', 'video'),
      makeItem('audio-1', 'audio'),
      makeItem('text-1', 'text'),
    ]

    expect(
      resolveEffectDropTargetIds({
        hoveredItemId: 'video-1',
        items,
        selectedItemIds: ['video-1', 'audio-1', 'text-1'],
      }),
    ).toEqual(['video-1', 'text-1'])
  })
})

describe('isDragPointInsideElement', () => {
  it('detects whether the drag point is still inside the element bounds', () => {
    const element = {
      getBoundingClientRect: () => ({ left: 10, right: 110, top: 20, bottom: 120 }),
    } as HTMLElement

    expect(isDragPointInsideElement({ clientX: 50, clientY: 50 }, element)).toBe(true)
    expect(isDragPointInsideElement({ clientX: 5, clientY: 50 }, element)).toBe(false)
  })
})
