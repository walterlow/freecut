import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { TimelineTrack, VideoItem } from '@/types/timeline'
import { useTimelineCommandStore } from '@/features/editor/deps/timeline-store'
import { useItemsStore } from '@/features/editor/deps/timeline-store'
import { useTimelineSettingsStore } from '@/features/editor/deps/timeline-store'
import { useSelectionStore } from '@/shared/state/selection'
import { usePlaybackStore } from '@/shared/state/playback'
import { addAdjustmentLayer } from './add-adjustment-layer'

function makeTrack(id: string, order: number, kind: 'video' | 'audio' = 'video'): TimelineTrack {
  return {
    id,
    name: id,
    kind,
    height: 64,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    order,
    items: [],
  }
}

function makeVideoItem(
  id: string,
  trackId: string,
  from: number,
  durationInFrames: number,
): VideoItem {
  return {
    id,
    type: 'video',
    trackId,
    from,
    durationInFrames,
    label: id,
    src: `blob:${id}`,
    mediaId: `media-${id}`,
  }
}

describe('addAdjustmentLayer', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useItemsStore.getState().setItems([])
    useItemsStore.getState().setTracks([])
    useSelectionStore.setState({
      selectedItemIds: [],
      selectedTrackIds: [],
      activeTrackId: null,
      selectedTrackId: null,
    })
    usePlaybackStore.setState({ currentFrame: 10, previewFrame: null })
  })

  it('places the layer on an existing free top video track', () => {
    useItemsStore.getState().setTracks([makeTrack('top', 0), makeTrack('main', 1)])
    useItemsStore.getState().setItems([makeVideoItem('clip', 'main', 0, 90)])
    useSelectionStore.getState().setActiveTrack('main')

    expect(addAdjustmentLayer()).toBe(true)

    const adjustment = useItemsStore.getState().items.find((item) => item.type === 'adjustment')
    expect(adjustment?.trackId).toBe('top')
    expect(adjustment?.from).toBe(10)
    expect(useItemsStore.getState().tracks.map((track) => track.id)).toEqual(['top', 'main'])
  })

  it('creates a new top video track when the current top track is occupied at the playhead', () => {
    useItemsStore.getState().setTracks([makeTrack('top', 0), makeTrack('main', 1)])
    useItemsStore
      .getState()
      .setItems([
        makeVideoItem('top-clip', 'top', 0, 90),
        makeVideoItem('main-clip', 'main', 0, 90),
      ])
    useSelectionStore.getState().setActiveTrack('main')

    expect(addAdjustmentLayer()).toBe(true)

    const state = useItemsStore.getState()
    const adjustment = state.items.find((item) => item.type === 'adjustment')
    const newTopTrack = state.tracks.find((track) => track.id === adjustment?.trackId)

    expect(adjustment?.from).toBe(10)
    expect(newTopTrack).toBeDefined()
    expect(newTopTrack?.order).toBeLessThan(0)
    expect(state.tracks[0]?.id).toBe(newTopTrack?.id)
    expect(state.tracks.map((track) => track.id)).toContain('top')
    expect(state.tracks.map((track) => track.id)).toContain('main')
  })

  it('undoes the layer and any track created for it in one step', () => {
    const originalTracks = [makeTrack('top', 0), makeTrack('main', 1)]
    useItemsStore.getState().setTracks(originalTracks)
    useItemsStore
      .getState()
      .setItems([
        makeVideoItem('top-clip', 'top', 0, 90),
        makeVideoItem('main-clip', 'main', 0, 90),
      ])
    useSelectionStore.getState().setActiveTrack('main')

    expect(addAdjustmentLayer()).toBe(true)
    expect(useItemsStore.getState().tracks).toHaveLength(3)
    expect(useItemsStore.getState().items.some((item) => item.type === 'adjustment')).toBe(true)

    useTimelineCommandStore.getState().undo()

    expect(useItemsStore.getState().tracks.map((track) => track.id)).toEqual(['top', 'main'])
    expect(useItemsStore.getState().items.map((item) => item.id)).toEqual(['top-clip', 'main-clip'])
  })
})
