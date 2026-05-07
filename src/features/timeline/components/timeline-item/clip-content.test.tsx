import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { render, screen } from '@testing-library/react'
import type { TimelineItem } from '@/types/timeline'
import { useSettingsStore } from '@/features/timeline/deps/settings'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import { useItemsStore } from '../../stores/items-store'
import { useCompositionsStore } from '../../stores/compositions-store'
import { useTimelineSettingsStore } from '../../stores/timeline-settings-store'
import { useTimelineStore } from '../../stores/timeline-store'
import { useZoomStore, _resetZoomStoreForTest } from '../../stores/zoom-store'
import { ClipContent } from './clip-content'

vi.mock('../clip-filmstrip', () => ({
  ClipFilmstrip: ({ pixelsPerSecond }: { pixelsPerSecond: number }) => (
    <div data-testid="clip-filmstrip" data-pps={String(pixelsPerSecond)} />
  ),
}))

vi.mock('../clip-filmstrip/image-filmstrip', () => ({
  ImageFilmstrip: ({ pixelsPerSecond }: { pixelsPerSecond: number }) => (
    <div data-testid="image-filmstrip" data-pps={String(pixelsPerSecond)} />
  ),
}))

vi.mock('../clip-waveform', () => ({
  ClipWaveform: ({ pixelsPerSecond }: { pixelsPerSecond: number }) => (
    <div data-testid="clip-waveform" data-pps={String(pixelsPerSecond)} />
  ),
}))

vi.mock('../clip-waveform/compound-clip-waveform', () => ({
  CompoundClipWaveform: ({ pixelsPerSecond }: { pixelsPerSecond: number }) => (
    <div data-testid="compound-clip-waveform" data-pps={String(pixelsPerSecond)} />
  ),
}))

describe('ClipContent', () => {
  beforeEach(() => {
    useTimelineStore.setState({ fps: 30 })
    _resetZoomStoreForTest()
    useZoomStore.setState({
      level: 1,
      pixelsPerSecond: 100,
      contentLevel: 1,
      contentPixelsPerSecond: 100,
      isZoomInteracting: false,
    })
    useSettingsStore.setState({
      showFilmstrips: false,
      showWaveforms: false,
    })
    useTimelineSettingsStore.setState({
      isTimelineLoading: false,
      loadingProjectId: null,
      loadedProjectId: 'project-1',
    })
    useMediaLibraryStore.setState({
      currentProjectId: 'project-1',
      mediaItems: [],
      mediaById: {},
      isLoading: false,
      brokenMediaIds: [],
      selectedMediaIds: [],
      notification: null,
    })
    useItemsStore.getState().setItems([])
  })

  it('renders the linked delta badge before the clip title text', () => {
    const item: TimelineItem = {
      id: 'video-1',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Clip title',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem

    render(
      <ClipContent
        item={item}
        clipLeftFrames={0}
        clipWidthFrames={96}
        fps={30}
        isLinked={true}
        linkedSyncOffsetFrames={-283}
      />,
    )

    expect(screen.getByText('-09:13')).toBeInTheDocument()
    expect(screen.getByTitle('Linked audio/video pair out of sync by -09:13')).toBeInTheDocument()
    expect(screen.getByText('Clip title')).toBeInTheDocument()
  })

  it('renders the linked icon before the title when clips are still in sync', () => {
    const item: TimelineItem = {
      id: 'video-1',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Linked clip',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem

    render(
      <ClipContent item={item} clipLeftFrames={0} clipWidthFrames={96} fps={30} isLinked={true} />,
    )

    expect(screen.getByTitle('Linked audio/video pair')).toBeInTheDocument()
    expect(screen.getByText('Linked clip')).toBeInTheDocument()
  })

  it('uses settled zoom for filmstrip content by default', () => {
    useZoomStore.setState({
      level: 1.8,
      pixelsPerSecond: 180,
      contentLevel: 1,
      contentPixelsPerSecond: 100,
      isZoomInteracting: true,
    })
    useSettingsStore.setState({
      showFilmstrips: true,
      showWaveforms: false,
    })

    const item: TimelineItem = {
      id: 'video-1',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Video clip',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem

    render(<ClipContent item={item} clipLeftFrames={0} clipWidthFrames={96} fps={30} />)

    expect(screen.getByTestId('clip-filmstrip')).toHaveAttribute('data-pps', '180')
  })

  it('can opt clip internals into live zoom for immediate edit previews', () => {
    useZoomStore.setState({
      level: 1.8,
      pixelsPerSecond: 180,
      contentLevel: 1,
      contentPixelsPerSecond: 100,
      isZoomInteracting: true,
    })
    useSettingsStore.setState({
      showFilmstrips: false,
      showWaveforms: true,
    })

    const item: TimelineItem = {
      id: 'audio-1',
      type: 'audio',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Audio clip',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem

    render(
      <ClipContent
        item={item}
        clipLeftFrames={0}
        clipWidthFrames={96}
        fps={30}
        preferImmediateRendering={true}
      />,
    )

    expect(screen.getByTestId('clip-waveform')).toHaveAttribute('data-pps', '180')
  })

  it('defers heavy video visuals while the timeline is hydrating', () => {
    useSettingsStore.setState({
      showFilmstrips: true,
      showWaveforms: true,
    })
    useTimelineSettingsStore.setState({
      isTimelineLoading: true,
      loadingProjectId: 'project-1',
      loadedProjectId: null,
    })

    const item: TimelineItem = {
      id: 'video-1',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Hydrating video clip',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem

    render(<ClipContent item={item} clipLeftFrames={0} clipWidthFrames={96} fps={30} />)

    expect(screen.getByText('Hydrating video clip')).toBeInTheDocument()
    expect(screen.queryByTestId('clip-filmstrip')).not.toBeInTheDocument()
  })

  it('defers heavy audio visuals while media metadata is still loading for the current project', () => {
    useSettingsStore.setState({
      showFilmstrips: true,
      showWaveforms: true,
    })
    useMediaLibraryStore.setState({
      currentProjectId: 'project-1',
      isLoading: true,
    })

    const item: TimelineItem = {
      id: 'audio-1',
      type: 'audio',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Loading audio clip',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem

    render(<ClipContent item={item} clipLeftFrames={0} clipWidthFrames={96} fps={30} />)

    expect(screen.getByText('Loading audio clip')).toBeInTheDocument()
    expect(screen.queryByTestId('clip-waveform')).not.toBeInTheDocument()
  })

  it('defers compound clip visual segment filmstrips while media metadata is loading', () => {
    useSettingsStore.setState({
      showFilmstrips: true,
      showWaveforms: true,
    })
    useMediaLibraryStore.setState({
      currentProjectId: 'project-1',
      isLoading: true,
    })
    useCompositionsStore.getState().setCompositions([
      {
        id: 'composition-1',
        name: 'Compound',
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 60,
        transitions: [],
        keyframes: [],
        tracks: [
          {
            id: 'sub-track-1',
            name: 'Video',
            kind: 'video',
            order: 0,
            height: 60,
            locked: false,
            visible: true,
            muted: false,
            solo: false,
            items: [],
          },
        ],
        items: [
          {
            id: 'sub-video-1',
            type: 'video',
            trackId: 'sub-track-1',
            from: 0,
            durationInFrames: 60,
            label: 'Nested video',
            mediaId: 'media-1',
            src: 'blob:test',
            sourceStart: 0,
            sourceDuration: 60,
          } as TimelineItem,
        ],
      },
    ])

    const item: TimelineItem = {
      id: 'composition-item-1',
      type: 'composition',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Compound shell',
      compositionId: 'composition-1',
    } as TimelineItem

    render(<ClipContent item={item} clipLeftFrames={0} clipWidthFrames={96} fps={30} />)

    expect(screen.getByText('Compound shell')).toBeInTheDocument()
    expect(screen.queryByTestId('clip-filmstrip')).not.toBeInTheDocument()
  })

  it('mounts heavy visuals after timeline hydration and media loading have settled', () => {
    useSettingsStore.setState({
      showFilmstrips: true,
      showWaveforms: true,
    })

    const item: TimelineItem = {
      id: 'video-1',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Settled video clip',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem

    render(<ClipContent item={item} clipLeftFrames={0} clipWidthFrames={96} fps={30} />)

    expect(screen.getByText('Settled video clip')).toBeInTheDocument()
    expect(screen.getByTestId('clip-filmstrip')).toBeInTheDocument()
  })
})
