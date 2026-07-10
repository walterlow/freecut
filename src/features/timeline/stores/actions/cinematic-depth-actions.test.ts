import { beforeEach, describe, expect, it } from 'vite-plus/test'

import type { ImageItem } from '@/types/timeline'
import { useSelectionStore } from '@/shared/state/selection'
import { makeTimelineTrack } from '../../test-helpers'
import { useItemsStore } from '../items-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { useTransitionsStore } from '../transitions-store'
import { insertCinematicDepthLayers } from './cinematic-depth-actions'

function makeImageItem(overrides: Partial<ImageItem> = {}): ImageItem {
  return {
    id: 'image-1',
    type: 'image',
    trackId: 'track-v1',
    from: 24,
    durationInFrames: 96,
    label: 'bellmere.png',
    src: 'blob:image',
    mediaId: 'media-image',
    sourceWidth: 3840,
    sourceHeight: 2160,
    transform: { x: 10, y: -20, width: 3840, height: 2160 },
    ...overrides,
  }
}

describe('cinematic depth timeline actions', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useItemsStore
      .getState()
      .setTracks([
        makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 }),
        makeTimelineTrack({ id: 'track-a1', name: 'A1', kind: 'audio', order: 1 }),
      ])
    useItemsStore.getState().setItems([])
    useTransitionsStore.getState().setTransitions([])
    useSelectionStore.getState().clearSelection()
  })

  it('turns a still into background, subject, and hidden depth-map layers', () => {
    useItemsStore.getState().setItems([makeImageItem()])

    const result = insertCinematicDepthLayers([
      {
        sourceItemId: 'image-1',
        depthSourceId: 'scene-bellmere',
        depthQuality: 0.91,
        backgroundAsset: {
          mediaId: 'media-background',
          src: 'blob:background',
          label: 'bellmere background plate',
          sourceWidth: 3840,
          sourceHeight: 2160,
        },
        subjectAsset: {
          mediaId: 'media-subject',
          src: 'blob:subject',
          label: 'bellmere subject',
          sourceWidth: 3840,
          sourceHeight: 2160,
        },
        depthMapAsset: {
          mediaId: 'media-depth',
          src: 'blob:depth',
          label: 'bellmere depth map',
          sourceWidth: 3840,
          sourceHeight: 2160,
        },
      },
    ])

    expect(result.status).toBe('inserted')
    expect(result.sourceImageCount).toBe(1)
    expect(result.layerCount).toBe(3)
    expect(result.trackCount).toBe(2)

    const state = useItemsStore.getState()
    const original = state.itemById['image-1'] as ImageItem
    const subject = state.items.find((item): item is ImageItem => item.mediaId === 'media-subject')
    const depth = state.items.find((item): item is ImageItem => item.mediaId === 'media-depth')

    expect(original).toMatchObject({
      label: 'bellmere background plate',
      mediaId: 'media-background',
      src: 'blob:background',
      cinematicDepthRole: 'background',
      cinematicDepthSourceId: 'scene-bellmere',
      cinematicDepthQuality: 0.91,
    })
    expect(subject).toMatchObject({
      type: 'image',
      cinematicDepthRole: 'subject',
      cinematicDepthSourceId: 'scene-bellmere',
      from: 24,
      durationInFrames: 96,
      transform: expect.objectContaining({ x: 10, y: -20, opacity: 1 }),
    })
    expect(depth).toMatchObject({
      type: 'image',
      cinematicDepthRole: 'depth-map',
      cinematicDepthSourceId: 'scene-bellmere',
      transform: expect.objectContaining({ opacity: 0 }),
    })
    expect(state.tracks.map((track) => track.name)).toEqual(
      expect.arrayContaining(['Cinematic Subjects', 'Cinematic Depth Maps']),
    )
    expect(useSelectionStore.getState().selectedItemIds).toEqual(result.visibleItemIds)
  })
})
