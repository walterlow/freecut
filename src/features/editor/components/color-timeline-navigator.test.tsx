import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { useItemsStore, useTimelineStore } from '@/features/editor/deps/timeline-store'
import { useGizmoStore } from '@/features/editor/deps/preview'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import type { TimelineTrack, VideoItem } from '@/types/timeline'
import { ColorTimelineNavigator } from './color-timeline-navigator'

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

const VIDEO_TRACK_2: TimelineTrack = {
  id: 'v2',
  name: 'V2',
  kind: 'video',
  height: 64,
  locked: false,
  visible: true,
  muted: false,
  solo: false,
  order: 0,
  items: [],
}

const AUDIO_TRACK: TimelineTrack = {
  id: 'a1',
  name: 'A1',
  kind: 'audio',
  height: 64,
  locked: false,
  visible: true,
  muted: false,
  solo: false,
  order: 0,
  items: [],
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

const VIDEO_ITEM_ON_V2: VideoItem = {
  ...VIDEO_ITEM,
  id: 'clip-2',
  trackId: 'v2',
  from: 168,
  label: 'overlay.mp4',
}

describe('ColorTimelineNavigator', () => {
  beforeEach(() => {
    useItemsStore.getState().setTracks([VIDEO_TRACK, AUDIO_TRACK])
    useItemsStore.getState().setItems([VIDEO_ITEM])
    useTimelineStore.setState({
      fps: 24,
      markers: [],
      inPoint: null,
      outPoint: null,
    })
    useSelectionStore.getState().clearSelection()
    usePlaybackStore.setState({
      currentFrame: 0,
      previewFrame: null,
      previewItemId: null,
      frameUpdateEpoch: 0,
      currentFrameEpoch: 0,
      previewFrameEpoch: 0,
    })
    useGizmoStore.getState().clearPreview()
  })

  it('renders a compact timeline strip for color mode', () => {
    render(<ColorTimelineNavigator />)

    expect(screen.getByTestId('color-timeline-navigator')).toBeInTheDocument()
    expect(screen.getAllByText('V1').length).toBeGreaterThan(0)
    expect(screen.getByText('01')).toBeInTheDocument()
    expect(screen.getByText('00:00:02:00')).toBeInTheDocument()
    expect(screen.getByText('shot-01.mp4')).toBeInTheDocument()
    expect(screen.queryByText('MP4')).not.toBeInTheDocument()
    expect(screen.queryByText('A1')).not.toBeInTheDocument()
    expect(screen.getAllByTitle('shot-01.mp4').length).toBeGreaterThan(0)
  })

  it('reserves space for the filmstrip scrollbar below the tiles', () => {
    render(<ColorTimelineNavigator />)

    const filmstripScroll = screen.getByTestId('color-timeline-filmstrip-scroll')
    const tile = screen.getByTestId('color-timeline-film-tile')

    expect(filmstripScroll).toHaveStyle({ height: '92px', paddingBottom: '8px' })
    expect(tile).toHaveStyle({ height: '80px' })
  })

  it('places mini timeline segments on their matching video track rows', () => {
    useItemsStore.getState().setTracks([VIDEO_TRACK_2, VIDEO_TRACK, AUDIO_TRACK])
    useItemsStore.getState().setItems([VIDEO_ITEM, VIDEO_ITEM_ON_V2])

    render(<ColorTimelineNavigator />)

    const v1Segment = screen
      .getAllByTestId('color-timeline-mini-clip')
      .find((element) => element.getAttribute('data-track-id') === 'v1')
    const v2Segment = screen
      .getAllByTestId('color-timeline-mini-clip')
      .find((element) => element.getAttribute('data-track-id') === 'v2')

    expect(v1Segment).toBeDefined()
    expect(v2Segment).toBeDefined()
    expect(v1Segment?.style.top).not.toEqual(v2Segment?.style.top)
    expect(Number.parseFloat(v2Segment?.style.top ?? '0')).toBeLessThan(
      Number.parseFloat(v1Segment?.style.top ?? '0'),
    )
    expect(Number.parseFloat(v1Segment?.style.height ?? '0')).toBeGreaterThanOrEqual(8)
    expect(v1Segment?.style.minWidth).toBe('16px')
  })

  it('selects a clip and seeks to its first frame', async () => {
    usePlaybackStore.getState().setScrubFrame(12, 'stale-scrub')

    render(<ColorTimelineNavigator />)

    fireEvent.pointerDown(screen.getByTestId('color-timeline-film-tile'), {
      button: 0,
      pointerId: 1,
    })

    expect(useSelectionStore.getState().selectedItemIds).toEqual(['clip-1'])
    expect(usePlaybackStore.getState().currentFrame).toBe(48)
    expect(usePlaybackStore.getState().previewFrame).toBeNull()
    expect(usePlaybackStore.getState().previewItemId).toBeNull()
  })

  it('shows the film tile thumbnail with the applied grade treatment', () => {
    useItemsStore.getState().setItems([
      {
        ...VIDEO_ITEM,
        effects: [
          {
            id: 'grade-1',
            enabled: true,
            effect: {
              type: 'gpu-effect',
              gpuEffectType: 'gpu-color-wheels',
              params: {
                exposure: 0.5,
                contrast: 1.25,
                saturation: 45,
                hue: 65,
                temperature: 40,
              },
            },
          },
        ],
      },
    ])

    const { container } = render(<ColorTimelineNavigator />)

    const thumbnail = container.querySelector('[data-graded-thumbnail="true"]')
    expect(thumbnail).not.toBeNull()
    expect(thumbnail?.getAttribute('style')).toContain('filter:')
    expect(screen.getByTestId('color-timeline-grade-overlay')).toBeInTheDocument()
  })

  it('renders timeline markers and the in/out range in the color timeline view', () => {
    useTimelineStore.setState({
      inPoint: 60,
      outPoint: 180,
      markers: [
        { id: 'marker-1', frame: 72, color: '#f97316', label: 'Warm pass' },
        { id: 'marker-2', frame: 144, color: '#22c55e', label: 'Skin check' },
      ],
    })

    render(<ColorTimelineNavigator />)

    expect(screen.getByTestId('color-timeline-io-strip')).toBeInTheDocument()
    expect(screen.getByTestId('color-timeline-in-handle')).toBeInTheDocument()
    expect(screen.getByTestId('color-timeline-out-handle')).toBeInTheDocument()
    expect(screen.getAllByTestId('color-timeline-marker')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Warm pass' })).toBeInTheDocument()
  })

  it('selects a marker and seeks to its frame from the color timeline', () => {
    useTimelineStore.setState({
      markers: [{ id: 'marker-1', frame: 96, color: '#f97316', label: 'Warm pass' }],
    })
    useSelectionStore.getState().selectItems(['clip-1'])
    usePlaybackStore.setState({ currentFrame: 0, previewFrame: 24, previewItemId: 'clip-1' })

    render(<ColorTimelineNavigator />)

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Warm pass' }), {
      button: 0,
      pointerId: 1,
    })

    expect(usePlaybackStore.getState().currentFrame).toBe(96)
    expect(usePlaybackStore.getState().previewFrame).toBeNull()
    expect(useSelectionStore.getState().selectedMarkerId).toBe('marker-1')
    expect(useSelectionStore.getState().selectedItemIds).toEqual([])
  })

  it('selects the pressed film tile immediately even with a stale preview frame', () => {
    useItemsStore.getState().setTracks([VIDEO_TRACK_2, VIDEO_TRACK, AUDIO_TRACK])
    useItemsStore.getState().setItems([VIDEO_ITEM, VIDEO_ITEM_ON_V2])
    usePlaybackStore.getState().setScrubFrame(12, 'stale-scrub')

    render(<ColorTimelineNavigator />)

    const secondTile = screen
      .getAllByTestId('color-timeline-film-tile')
      .find((element) => element.getAttribute('data-clip-id') === 'clip-2')

    expect(secondTile).toBeDefined()
    fireEvent.pointerDown(secondTile!, { button: 0, pointerId: 2 })

    expect(useSelectionStore.getState().selectedItemIds).toEqual(['clip-2'])
    expect(usePlaybackStore.getState().currentFrame).toBe(168)
    expect(usePlaybackStore.getState().previewFrame).toBeNull()
    expect(usePlaybackStore.getState().previewItemId).toBeNull()
  })

  it('scrubs the compact strip while dragging and clears the preview on release', async () => {
    usePlaybackStore.setState({ isPlaying: true })
    render(<ColorTimelineNavigator />)

    const scrubSurface = screen.getByTestId('color-timeline-scrub-surface')
    scrubSurface.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 96,
      width: 600,
      height: 96,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(scrubSurface, { button: 0, clientX: 146, pointerId: 1 })
    expect(usePlaybackStore.getState().isPlaying).toBe(false)
    expect(usePlaybackStore.getState().currentFrame).toBe(0)
    expect(usePlaybackStore.getState().previewFrame).toBe(60)

    // Move commits are rAF-batched — wait for the scheduled frame to land.
    fireEvent.pointerMove(scrubSurface, { clientX: 316, pointerId: 1 })
    await waitFor(() => {
      expect(usePlaybackStore.getState().previewFrame).toBe(150)
    })
    expect(usePlaybackStore.getState().currentFrame).toBe(0)

    fireEvent.pointerUp(scrubSurface, { clientX: 316, pointerId: 1 })
    expect(usePlaybackStore.getState().currentFrame).toBe(150)
    expect(usePlaybackStore.getState().previewFrame).toBeNull()
  })
})
