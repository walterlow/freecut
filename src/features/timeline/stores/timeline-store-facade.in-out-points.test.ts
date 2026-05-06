import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const indexedDbMocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  updateProject: vi.fn(),
  saveThumbnail: vi.fn(),
}))

const playbackMocks = vi.hoisted(() => ({
  currentFrame: 0,
  setCurrentFrame: vi.fn(),
  pause: vi.fn(),
  play: vi.fn(),
  setPreviewFrame: vi.fn(),
}))

const zoomMocks = vi.hoisted(() => ({
  level: 1,
  setZoomLevel: vi.fn(),
}))

const mediaLibraryMocks = vi.hoisted(() => ({
  mediaById: {},
  setOrphanedClips: vi.fn(),
  openOrphanedClipsDialog: vi.fn(),
  closeOrphanedClipsDialog: vi.fn(),
}))

vi.mock('@/infrastructure/storage', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    ...indexedDbMocks,
  }
})

vi.mock('@/shared/state/playback', () => ({
  usePlaybackStore: {
    getState: () => playbackMocks,
  },
}))

vi.mock('./zoom-store', () => ({
  useZoomStore: {
    getState: () => zoomMocks,
  },
}))

vi.mock('@/features/timeline/deps/export-contract', () => ({
  renderSingleFrame: vi.fn(),
  convertTimelineToComposition: vi.fn(),
}))

vi.mock('@/features/timeline/deps/media-library-resolver', () => ({
  resolveMediaUrls: vi.fn(),
}))

vi.mock('@/features/timeline/utils/media-validation', () => ({
  validateProjectMediaReferences: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/features/timeline/deps/media-library-store', () => ({
  useMediaLibraryStore: {
    getState: () => mediaLibraryMocks,
  },
}))

vi.mock('@/core/projects/migrations', () => ({
  migrateProject: vi.fn((project) => ({
    project,
    migrated: false,
    fromVersion: 1,
    toVersion: 1,
    appliedMigrations: [],
  })),
  CURRENT_SCHEMA_VERSION: 1,
}))

import { useItemsStore } from './items-store'
import { useMarkersStore } from './markers-store'
import { useTimelineSettingsStore } from './timeline-settings-store'
import { useTimelineStore } from './timeline-store-facade'

describe('TimelineStoreFacade in/out point clamping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useItemsStore.getState().setItems([])
    useItemsStore.getState().setTracks([])
    useMarkersStore.getState().setMarkers([])
    useMarkersStore.getState().setInPoint(null)
    useMarkersStore.getState().setOutPoint(null)
    useTimelineSettingsStore.getState().setFps(30)
  })

  it('clamps a stale out-point back to the current timeline end', () => {
    useItemsStore.getState().setItems([
      {
        id: 'item-1',
        type: 'video',
        trackId: 'track-1',
        from: 0,
        durationInFrames: 600,
        label: 'clip.mp4',
        src: 'blob:test',
        mediaId: 'media-1',
      },
    ])

    useTimelineStore.setState({
      inPoint: 120,
      outPoint: 5000,
    })

    expect(useMarkersStore.getState().inPoint).toBe(120)
    expect(useMarkersStore.getState().outPoint).toBe(600)
  })

  it('re-clamps existing points when the timeline content shrinks', () => {
    useItemsStore.getState().setItems([
      {
        id: 'item-1',
        type: 'video',
        trackId: 'track-1',
        from: 0,
        durationInFrames: 600,
        label: 'clip.mp4',
        src: 'blob:test',
        mediaId: 'media-1',
      },
    ])
    useMarkersStore.getState().setInPoint(120)
    useMarkersStore.getState().setOutPoint(600)

    useTimelineStore.setState({
      items: [
        {
          id: 'item-1',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 240,
          label: 'shorter.mp4',
          src: 'blob:test',
          mediaId: 'media-1',
        },
      ],
    })

    expect(useMarkersStore.getState().inPoint).toBe(120)
    expect(useMarkersStore.getState().outPoint).toBe(300)
  })

  it('updates stale points when the tail clip is deleted through the item store', () => {
    useItemsStore.getState().setItems([
      {
        id: 'item-1',
        type: 'video',
        trackId: 'track-1',
        from: 0,
        durationInFrames: 600,
        label: 'base.mp4',
        src: 'blob:test',
        mediaId: 'media-1',
      },
      {
        id: 'item-2',
        type: 'video',
        trackId: 'track-1',
        from: 600,
        durationInFrames: 300,
        label: 'tail.mp4',
        src: 'blob:test-2',
        mediaId: 'media-2',
      },
    ])
    useMarkersStore.getState().setInPoint(120)
    useMarkersStore.getState().setOutPoint(900)

    useItemsStore.getState()._removeItems(['item-2'])

    expect(useMarkersStore.getState().inPoint).toBe(120)
    expect(useMarkersStore.getState().outPoint).toBe(600)
  })
})
