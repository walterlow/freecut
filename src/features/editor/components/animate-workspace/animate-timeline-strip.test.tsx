import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { useItemsStore, useTimelineStore } from '@/features/editor/deps/timeline-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import type { AudioItem, TimelineTrack, VideoItem } from '@/types/timeline'
import { AnimateTimelineStrip } from './animate-timeline-strip'

const VIDEO_TRACK: TimelineTrack = {
  id: 'v1',
  name: 'V1',
  kind: 'video',
  height: 64,
  locked: false,
  visible: true,
  muted: false,
  solo: false,
  order: 1,
  items: [],
}

const AUDIO_TRACK: TimelineTrack = {
  ...VIDEO_TRACK,
  id: 'a1',
  name: 'A1',
  kind: 'audio',
  order: 2,
}

const VIDEO_ITEM: VideoItem = {
  id: 'clip-1',
  type: 'video',
  trackId: 'v1',
  from: 48,
  durationInFrames: 120,
  label: 'shot-01.mp4',
  src: 'blob:shot',
  thumbnailUrl: 'blob:thumb',
}

const VIDEO_ITEM_2: VideoItem = {
  ...VIDEO_ITEM,
  id: 'clip-2',
  from: 200,
  label: 'overlay.mp4',
}

describe('AnimateTimelineStrip', () => {
  beforeEach(() => {
    useItemsStore.getState().setTracks([VIDEO_TRACK])
    useItemsStore.getState().setItems([VIDEO_ITEM, VIDEO_ITEM_2])
    useTimelineStore.setState({ fps: 24, markers: [], inPoint: null, outPoint: null })
    useSelectionStore.getState().clearSelection()
    usePlaybackStore.setState({
      currentFrame: 0,
      previewFrame: null,
      previewItemId: null,
      frameUpdateEpoch: 0,
      currentFrameEpoch: 0,
      previewFrameEpoch: 0,
    })
  })

  it('renders the shared mini-timeline parts (film tiles, scrub surface, playhead)', () => {
    render(<AnimateTimelineStrip />)

    expect(screen.getByTestId('animate-timeline-strip')).toBeInTheDocument()
    expect(screen.getByTestId('animate-timeline-scrub-surface')).toBeInTheDocument()
    expect(screen.getByTestId('animate-timeline-playhead')).toBeInTheDocument()
    expect(screen.getAllByTestId('animate-timeline-film-tile').length).toBe(2)
    expect(screen.getAllByTestId('animate-timeline-clip').length).toBe(2)
    expect(screen.getAllByText('V1').length).toBeGreaterThan(0)
  })

  it('renders the in/out bar when in/out points are set', () => {
    useTimelineStore.setState({ inPoint: 60, outPoint: 180 })

    render(<AnimateTimelineStrip />)

    expect(screen.getByTestId('animate-timeline-io-strip')).toBeInTheDocument()
    expect(screen.getByTestId('animate-timeline-in-handle')).toBeInTheDocument()
    expect(screen.getByTestId('animate-timeline-out-handle')).toBeInTheDocument()
  })

  it('auto-selects the earliest clip on the default track for the keyframe editor', () => {
    render(<AnimateTimelineStrip />)

    // clip-1 (from 48) precedes clip-2 (from 200) on V1.
    expect(useSelectionStore.getState().selectedItemIds).toEqual(['clip-1'])
  })

  describe('linked audio companion (A1 paired with V1)', () => {
    const LINKED_VIDEO: VideoItem = {
      ...VIDEO_ITEM,
      id: 'linked-video',
      from: 48,
      label: 'interview.mp4',
      linkedGroupId: 'pair-1',
    }
    const LINKED_AUDIO: AudioItem = {
      id: 'linked-audio',
      type: 'audio',
      trackId: 'a1',
      from: 48,
      durationInFrames: 120,
      label: 'interview.mp4 audio',
      src: 'blob:audio',
      linkedGroupId: 'pair-1',
    }

    beforeEach(() => {
      useItemsStore.getState().setTracks([VIDEO_TRACK, AUDIO_TRACK])
      useItemsStore.getState().setItems([LINKED_VIDEO, LINKED_AUDIO])
    })

    it('omits the audio companion from the film-tile row', () => {
      render(<AnimateTimelineStrip />)

      const tiles = screen.getAllByTestId('animate-timeline-film-tile')
      expect(tiles.map((tile) => tile.getAttribute('data-clip-id'))).toEqual(['linked-video'])
    })

    it('keeps the audio companion as a dimmed, non-target lane bar', () => {
      render(<AnimateTimelineStrip />)

      const clips = screen.getAllByTestId('animate-timeline-clip')
      const audioBar = clips.find((bar) => bar.getAttribute('data-track-id') === 'a1')
      expect(audioBar).toBeDefined()
      expect(audioBar!.getAttribute('data-muted')).toBe('1')
    })

    it('forwards selection from the audio bar to its visual partner', () => {
      render(<AnimateTimelineStrip />)

      const audioBar = screen
        .getAllByTestId('animate-timeline-clip')
        .find((bar) => bar.getAttribute('data-track-id') === 'a1')
      fireEvent.click(audioBar!)

      expect(useSelectionStore.getState().selectedItemIds).toEqual(['linked-video'])
      expect(usePlaybackStore.getState().currentFrame).toBe(48)
    })

    it('auto-selects the visual partner, never the audio companion', () => {
      render(<AnimateTimelineStrip />)

      expect(useSelectionStore.getState().selectedItemIds).toEqual(['linked-video'])
    })
  })

  it('selects + seeks to a clip when its film tile is pressed', () => {
    render(<AnimateTimelineStrip />)

    const secondTile = screen
      .getAllByTestId('animate-timeline-film-tile')
      .find((element) => element.getAttribute('data-clip-id') === 'clip-2')
    expect(secondTile).toBeDefined()

    fireEvent.pointerDown(secondTile!, { button: 0, pointerId: 1 })

    expect(useSelectionStore.getState().selectedItemIds).toEqual(['clip-2'])
    expect(usePlaybackStore.getState().currentFrame).toBe(200)
  })
})
