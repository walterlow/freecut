import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { AudioItem, VideoItem } from '@/types/timeline'
import { useItemsStore } from '../items-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { useEditorStore } from '@/app/state/editor'
import { trackPushItems } from './item-actions'

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'video-1',
    type: 'video',
    trackId: 'video-track',
    from: 0,
    durationInFrames: 60,
    label: 'clip.mp4',
    src: 'blob:video',
    mediaId: 'media-1',
    ...overrides,
  }
}

function makeAudioItem(overrides: Partial<AudioItem> = {}): AudioItem {
  return {
    id: 'audio-1',
    type: 'audio',
    trackId: 'audio-track',
    from: 0,
    durationInFrames: 60,
    label: 'clip.mp4',
    src: 'blob:audio',
    mediaId: 'media-1',
    ...overrides,
  }
}

describe('trackPushItems', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useEditorStore.setState({ linkedSelectionEnabled: true })
    useItemsStore.getState().setItems([])
    useItemsStore.getState().setTracks([])
  })

  it('shifts all items at or after anchor position across all tracks', () => {
    useItemsStore
      .getState()
      .setItems([
        makeVideoItem({ id: 'v1', from: 0, durationInFrames: 50 }),
        makeVideoItem({ id: 'v2', from: 100, durationInFrames: 50 }),
        makeAudioItem({ id: 'a1', from: 0, durationInFrames: 50 }),
        makeAudioItem({ id: 'a2', from: 80, durationInFrames: 50 }),
      ])

    // Push from v2's position (frame 100), shift right by 20
    trackPushItems('v2', 20)

    const items = useItemsStore.getState().items
    expect(items.find((i) => i.id === 'v1')).toMatchObject({ from: 0 }) // before anchor, unchanged
    expect(items.find((i) => i.id === 'v2')).toMatchObject({ from: 120 }) // shifted right
    expect(items.find((i) => i.id === 'a1')).toMatchObject({ from: 0 }) // before anchor, unchanged
    expect(items.find((i) => i.id === 'a2')).toMatchObject({ from: 80 }) // from < anchor (100), unchanged
  })

  it('shifts items left (closing gap) and clamps at frame 0', () => {
    useItemsStore
      .getState()
      .setItems([
        makeVideoItem({ id: 'v1', from: 30, durationInFrames: 50 }),
        makeAudioItem({ id: 'a1', from: 30, durationInFrames: 50 }),
      ])

    trackPushItems('v1', -20)

    const items = useItemsStore.getState().items
    expect(items.find((i) => i.id === 'v1')).toMatchObject({ from: 10 })
    expect(items.find((i) => i.id === 'a1')).toMatchObject({ from: 10 })
  })

  it('does nothing when delta is 0', () => {
    useItemsStore.getState().setItems([makeVideoItem({ id: 'v1', from: 50, durationInFrames: 50 })])

    trackPushItems('v1', 0)

    expect(useItemsStore.getState().items.find((i) => i.id === 'v1')).toMatchObject({ from: 50 })
  })

  it('commits as a single undo entry', () => {
    useItemsStore
      .getState()
      .setItems([
        makeVideoItem({ id: 'v1', from: 50, durationInFrames: 50 }),
        makeVideoItem({ id: 'v2', from: 100, durationInFrames: 50 }),
        makeAudioItem({ id: 'a1', from: 50, durationInFrames: 50 }),
      ])

    trackPushItems('v1', 30)

    const items = useItemsStore.getState().items
    expect(items.find((i) => i.id === 'v1')).toMatchObject({ from: 80 })
    expect(items.find((i) => i.id === 'v2')).toMatchObject({ from: 130 })
    expect(items.find((i) => i.id === 'a1')).toMatchObject({ from: 80 })

    // Undo should revert everything in one step
    useTimelineCommandStore.getState().undo()

    const reverted = useItemsStore.getState().items
    expect(reverted.find((i) => i.id === 'v1')).toMatchObject({ from: 50 })
    expect(reverted.find((i) => i.id === 'v2')).toMatchObject({ from: 100 })
    expect(reverted.find((i) => i.id === 'a1')).toMatchObject({ from: 50 })
  })
})
