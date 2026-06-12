import type { AudioItem, TimelineTrack, VideoItem } from '@/types/timeline'
import { useItemsStore } from './stores/items-store'
import { useTimelineSettingsStore } from './stores/timeline-settings-store'
import { useTransitionsStore } from './stores/transitions-store'
import { useKeyframesStore } from './stores/keyframes-store'
import { useCompositionsStore } from './stores/compositions-store'

type TimelineTrackOverrides = Partial<TimelineTrack> & Pick<TimelineTrack, 'id' | 'name' | 'order'>

export function makeTimelineTrack(overrides: TimelineTrackOverrides): TimelineTrack {
  return {
    height: 80,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    items: [],
    ...overrides,
  }
}

export function makeTimelineVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'video-1',
    type: 'video',
    trackId: 'track-v1',
    from: 0,
    durationInFrames: 60,
    label: 'clip.mp4',
    src: 'blob:video',
    mediaId: 'media-1',
    sourceStart: 0,
    sourceEnd: 60,
    sourceDuration: 120,
    sourceFps: 30,
    ...overrides,
  }
}

export function makeTimelineAudioItem(overrides: Partial<AudioItem> = {}): AudioItem {
  return {
    id: 'audio-1',
    type: 'audio',
    trackId: 'track-a1',
    from: 0,
    durationInFrames: 60,
    label: 'clip.wav',
    src: 'blob:audio',
    mediaId: 'media-1',
    sourceStart: 0,
    sourceEnd: 60,
    sourceDuration: 120,
    sourceFps: 30,
    ...overrides,
  }
}

export function setDefaultRootTimelineTracks() {
  useItemsStore
    .getState()
    .setTracks([
      makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 }),
      makeTimelineTrack({ id: 'track-a1', name: 'A1', kind: 'audio', order: 1 }),
    ])
}

/**
 * Seeds `useItemsStore` with the standard V1/A1 track pair plus two video
 * items (the second starting at frame 60) and one audio item.
 */
export function seedTimelineWithVideoAndAudioTracks(itemIds: {
  firstVideoId: string
  secondVideoId: string
  audioId: string
}): void {
  setDefaultRootTimelineTracks()
  useItemsStore
    .getState()
    .setItems([
      makeTimelineVideoItem({ id: itemIds.firstVideoId }),
      makeTimelineVideoItem({ id: itemIds.secondVideoId, from: 60 }),
      makeTimelineAudioItem({ id: itemIds.audioId }),
    ])
}

export function makeTwoVideoTwoAudioTimelineTracks(height = 80): TimelineTrack[] {
  return [
    makeTimelineTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0, height }),
    makeTimelineTrack({ id: 'v2', name: 'V2', kind: 'video', order: 1, height }),
    makeTimelineTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 2, height }),
    makeTimelineTrack({ id: 'a2', name: 'A2', kind: 'audio', order: 3, height }),
  ]
}

export function resetTimelineItemsTestState() {
  useTimelineSettingsStore.setState({ fps: 30 })
  useItemsStore.getState().setItems([])
  useItemsStore.getState().setTracks([])
}

export function resetTimelineCompositionTestState() {
  useItemsStore.getState().setTracks([])
  useItemsStore.getState().setItems([])
  useTransitionsStore.getState().setTransitions([])
  useKeyframesStore.getState().setKeyframes([])
  useCompositionsStore.getState().setCompositions([])
}
