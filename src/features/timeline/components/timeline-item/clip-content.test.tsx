import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { Profiler } from 'react'
import { act, render, screen } from '@testing-library/react'
import type { TimelineItem } from '@/types/timeline'
import { useSettingsStore } from '@/features/timeline/deps/settings'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import { useItemsStore } from '../../stores/items-store'
import { useCompositionsStore } from '../../stores/compositions-store'
import { useSequencesStore } from '../../stores/sequences-store'
import { useTimelineStore } from '../../stores/timeline-store'
import { useZoomStore, _resetZoomStoreForTest } from '../../stores/zoom-store'
import { useTimelineViewportStore } from '../../stores/timeline-viewport-store'
import { ClipContent } from './clip-content'

vi.mock('../clip-filmstrip', () => ({
  ClipFilmstrip: ({
    pixelsPerSecond,
    isVisible,
  }: {
    pixelsPerSecond: number
    isVisible: boolean
  }) => (
    <div
      data-testid="clip-filmstrip"
      data-pps={String(pixelsPerSecond)}
      data-visible={String(isVisible)}
    />
  ),
}))

vi.mock('../clip-filmstrip/image-filmstrip', () => ({
  ImageFilmstrip: ({ pixelsPerSecond }: { pixelsPerSecond: number }) => (
    <div data-testid="image-filmstrip" data-pps={String(pixelsPerSecond)} />
  ),
}))

vi.mock('../clip-waveform', () => ({
  ClipWaveform: ({
    pixelsPerSecond,
    liveTimelineZoom,
  }: {
    pixelsPerSecond: number
    liveTimelineZoom?: boolean
  }) => (
    <div
      data-testid="clip-waveform"
      data-pps={String(pixelsPerSecond)}
      data-live-timeline-zoom={String(!!liveTimelineZoom)}
    />
  ),
}))

vi.mock('../clip-waveform/compound-clip-waveform', () => ({
  CompoundClipWaveform: ({ pixelsPerSecond }: { pixelsPerSecond: number }) => (
    <div data-testid="compound-clip-waveform" data-pps={String(pixelsPerSecond)} />
  ),
}))

function addUnrelatedComposition(id: string): void {
  useCompositionsStore.getState().addComposition({
    id,
    name: 'Unrelated composition',
    editorKind: 'composite-2d',
    tracks: [],
    items: [],
    transitions: [],
    keyframes: [],
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 90,
  })
}

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
    useTimelineViewportStore.setState({
      scrollLeft: 0,
      scrollTop: 0,
      viewportWidth: 1920,
      viewportHeight: 400,
    })
    useSettingsStore.setState({
      showFilmstrips: false,
      enableFilmstripExtraction: false,
      showWaveforms: false,
    })
    useMediaLibraryStore.setState({
      mediaItems: [],
      mediaById: {},
      brokenMediaIds: [],
      selectedMediaIds: [],
      notification: null,
    })
    useItemsStore.getState().setItems([])
    useCompositionsStore.getState().setCompositions([])
    useSequencesStore.getState().reset()
  })

  it('keeps compact clip content unmounted across live zoom updates', () => {
    useSettingsStore.setState({
      showFilmstrips: true,
      enableFilmstripExtraction: true,
      showWaveforms: true,
    })
    const item = {
      id: 'compact-shell-video',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 30,
      label: 'Compact shell',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem
    const onRender = vi.fn()
    const view = render(
      <Profiler id="compact-clip-content" onRender={onRender}>
        <ClipContent item={item} clipLeftFrames={0} clipWidthFrames={30} fps={30} isCompactWidth />
      </Profiler>,
    )
    const initialCommitCount = onRender.mock.calls.length

    expect(view.container).toBeEmptyDOMElement()

    act(() => {
      useZoomStore.setState({
        level: 0.2,
        pixelsPerSecond: 20,
        isZoomInteracting: true,
      })
    })

    expect(onRender).toHaveBeenCalledTimes(initialCommitCount)
    expect(view.container).toBeEmptyDOMElement()

    view.rerender(
      <Profiler id="compact-clip-content" onRender={onRender}>
        <ClipContent
          item={item}
          clipLeftFrames={0}
          clipWidthFrames={30}
          fps={30}
          isCompactWidth={false}
        />
      </Profiler>,
    )

    expect(screen.getByText('Compact shell')).toBeInTheDocument()
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

  it('removes blank narrow clip content from layout while keeping its DOM stable', () => {
    useZoomStore.setState({
      contentLevel: 0.1,
      contentPixelsPerSecond: 10,
    })
    const item: TimelineItem = {
      id: 'blank-narrow-video',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 30,
      label: 'Hidden until it fits',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem

    const { container } = render(
      <ClipContent item={item} clipLeftFrames={0} clipWidthFrames={30} fps={30} />,
    )
    const content = container.querySelector('[data-media-clip-content]')

    expect(content).toHaveAttribute('hidden')
    expect(content).toHaveStyle({ display: 'none' })

    act(() => {
      useZoomStore.setState({
        contentLevel: 0.28,
        contentPixelsPerSecond: 28,
      })
    })

    expect(content).not.toHaveAttribute('hidden')
    expect(content).not.toHaveStyle({ display: 'none' })
    expect(screen.getByText('Hidden until it fits')).toBeVisible()
  })

  it('retains an offscreen filmstrip shell so zoom entry cannot remount it', async () => {
    useSettingsStore.setState({
      showFilmstrips: true,
      enableFilmstripExtraction: true,
    })
    useTimelineViewportStore.setState({
      scrollLeft: 0,
      viewportWidth: 200,
    })
    const item: TimelineItem = {
      id: 'offscreen-filmstrip',
      type: 'video',
      trackId: 'track-1',
      from: 3000,
      durationInFrames: 60,
      label: 'Offscreen filmstrip',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem

    render(<ClipContent item={item} clipLeftFrames={3000} clipWidthFrames={60} fps={30} />)

    const filmstrip = await screen.findByTestId('clip-filmstrip')
    expect(filmstrip).toHaveAttribute('data-visible', 'false')

    act(() => {
      useTimelineViewportStore.setState({ scrollLeft: 9500 })
    })

    expect(await screen.findByTestId('clip-filmstrip')).toBe(filmstrip)
    expect(filmstrip).toHaveAttribute('data-visible', 'true')
  })

  it('keeps a retained offscreen media shell compact at a rich settled zoom', async () => {
    useSettingsStore.setState({
      showFilmstrips: true,
      enableFilmstripExtraction: true,
    })
    useZoomStore.setState({
      level: 5,
      pixelsPerSecond: 500,
      contentLevel: 5,
      contentPixelsPerSecond: 500,
      isZoomInteracting: false,
    })
    const item: TimelineItem = {
      id: 'retained-offscreen-video',
      type: 'video',
      trackId: 'track-1',
      from: 3000,
      durationInFrames: 60,
      label: 'Retained offscreen video',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem
    const props = {
      item,
      clipLeftFrames: 3000,
      clipWidthFrames: 60,
      fps: 30,
    }
    const view = render(<ClipContent {...props} isDetailEligible={false} />)
    const shell = view.container.querySelector('[data-media-clip-content]')

    expect(shell).toHaveAttribute('hidden')
    expect(screen.queryByTestId('clip-filmstrip')).not.toBeInTheDocument()

    view.rerender(<ClipContent {...props} isDetailEligible={true} />)
    expect(await screen.findByTestId('clip-filmstrip')).toBeInTheDocument()

    view.rerender(<ClipContent {...props} isDetailEligible={false} />)
    expect(view.container.querySelector('[data-media-clip-content]')).toBe(shell)
    expect(shell).toHaveAttribute('hidden')
    expect(screen.queryByTestId('clip-filmstrip')).not.toBeInTheDocument()
  })

  it('demotes linked label content when live width can no longer contain it', () => {
    useZoomStore.setState({
      level: 1,
      pixelsPerSecond: 100,
      contentLevel: 0.47,
      contentPixelsPerSecond: 47,
    })
    const item: TimelineItem = {
      id: 'linked-label-lod',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 30,
      label: 'Width-aware label',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem

    render(
      <ClipContent item={item} clipLeftFrames={0} clipWidthFrames={30} fps={30} isLinked={true} />,
    )

    const linkIcon = screen.getByTitle('Linked audio/video pair')
    const label = screen.getByText('Width-aware label')
    expect(linkIcon).not.toBeVisible()
    expect(label).not.toBeVisible()

    act(() => {
      useZoomStore.setState({
        contentLevel: 0.48,
        contentPixelsPerSecond: 48,
      })
    })

    expect(linkIcon).toBeVisible()
    expect(label).not.toBeVisible()

    act(() => {
      useZoomStore.setState({
        contentLevel: 0.56,
        contentPixelsPerSecond: 56,
      })
    })

    expect(linkIcon).toBeVisible()
    expect(label).toBeVisible()

    act(() => {
      useZoomStore.setState({
        level: 0.1,
        pixelsPerSecond: 10,
        isZoomInteracting: true,
      })
    })

    expect(linkIcon).not.toBeVisible()
    expect(label).not.toBeVisible()
  })

  it('reveals an out-of-sync badge, link icon, and label only when each can fit', () => {
    useZoomStore.setState({
      level: 1,
      pixelsPerSecond: 100,
      contentLevel: 0.65,
      contentPixelsPerSecond: 65,
    })
    const item: TimelineItem = {
      id: 'linked-sync-offset-lod',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 30,
      label: 'Out-of-sync linked clip',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem

    render(
      <ClipContent
        item={item}
        clipLeftFrames={0}
        clipWidthFrames={30}
        fps={30}
        isLinked={true}
        linkedSyncOffsetFrames={-283}
      />,
    )

    const syncOffset = screen.getByTitle('Linked clips out of sync by -09:13')
    const linkIcon = screen.getByTitle('Linked audio/video pair out of sync by -09:13')
    const label = screen.getByText('Out-of-sync linked clip')
    expect(syncOffset).not.toBeVisible()
    expect(linkIcon).not.toBeVisible()
    expect(label).not.toBeVisible()

    act(() => {
      useZoomStore.setState({
        contentLevel: 0.66,
        contentPixelsPerSecond: 66,
      })
    })

    expect(syncOffset).toBeVisible()
    expect(linkIcon).not.toBeVisible()
    expect(label).not.toBeVisible()

    act(() => {
      useZoomStore.setState({
        contentLevel: 0.88,
        contentPixelsPerSecond: 88,
      })
    })

    expect(syncOffset).toBeVisible()
    expect(linkIcon).toBeVisible()
    expect(label).not.toBeVisible()

    act(() => {
      useZoomStore.setState({
        contentLevel: 1.12,
        contentPixelsPerSecond: 112,
      })
    })

    expect(syncOffset).toBeVisible()
    expect(linkIcon).toBeVisible()
    expect(label).toBeVisible()
  })

  it('keeps narrow video on the threshold-only path until settled pixels can show a useful thumbnail', async () => {
    useZoomStore.setState({
      level: 0.9,
      pixelsPerSecond: 90,
      contentLevel: 0.9,
      contentPixelsPerSecond: 90,
      isZoomInteracting: true,
    })
    useSettingsStore.setState({
      showFilmstrips: true,
      enableFilmstripExtraction: true,
      showWaveforms: false,
    })

    const item: TimelineItem = {
      id: 'compact-video',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 1,
      label: 'Compact linked clip',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem
    const onRender = vi.fn()

    render(
      <Profiler id="compact-media" onRender={onRender}>
        <div data-testid="timeline-item-root" data-item-id={item.id}>
          <ClipContent
            item={item}
            clipLeftFrames={0}
            clipWidthFrames={1}
            fps={30}
            isLinked={true}
          />
        </div>
      </Profiler>,
    )

    const timelineItemRoot = screen.getByTestId('timeline-item-root')
    const compactLabel = screen.getByText('Compact linked clip')
    const compactLabelRow = compactLabel.parentElement?.parentElement
    const compactLink = screen.getByTitle('Linked audio/video pair')
    const compactLabelMarkup = compactLabelRow?.outerHTML
    const compactLinkMarkup = compactLink.outerHTML
    const initialCommitCount = onRender.mock.calls.length

    expect(compactLabelRow).toBeInstanceOf(HTMLElement)
    expect(screen.queryByTestId('clip-filmstrip')).not.toBeInTheDocument()
    expect(initialCommitCount).toBe(1)

    for (const pixelsPerSecond of [180, 360, 599]) {
      act(() => {
        useZoomStore.setState({
          level: pixelsPerSecond / 100,
          pixelsPerSecond,
          contentLevel: pixelsPerSecond / 100,
          contentPixelsPerSecond: pixelsPerSecond,
        })
      })
    }
    act(() => {
      useSettingsStore.setState({ showFilmstrips: false })
      useSettingsStore.setState({ showFilmstrips: true })
      useMediaLibraryStore.setState({
        mediaById: {
          'media-1': {
            fps: 60,
            duration: 2,
          } as never,
        },
      })
    })

    expect(onRender).toHaveBeenCalledTimes(initialCommitCount)
    expect(screen.queryByTestId('clip-filmstrip')).not.toBeInTheDocument()
    expect(screen.getByText('Compact linked clip')).toBe(compactLabel)
    expect(screen.getByTestId('timeline-item-root')).toBe(timelineItemRoot)

    act(() => {
      useZoomStore.setState({
        level: 6.01,
        pixelsPerSecond: 601,
        contentLevel: 5.99,
        contentPixelsPerSecond: 599,
      })
    })

    expect(onRender).toHaveBeenCalledTimes(initialCommitCount)
    expect(screen.queryByTestId('clip-filmstrip')).not.toBeInTheDocument()
    expect(screen.getByText('Compact linked clip')).toBe(compactLabel)

    act(() => {
      useZoomStore.setState({
        contentLevel: 6,
        contentPixelsPerSecond: 600,
      })
    })

    expect(await screen.findByTestId('clip-filmstrip')).toHaveAttribute('data-pps', '600')
    expect(onRender.mock.calls.length).toBeGreaterThan(initialCommitCount)
    expect(screen.getByTestId('timeline-item-root')).toBe(timelineItemRoot)
    expect(screen.getByText('Compact linked clip')).toBe(compactLabel)
    expect(screen.getByTitle('Linked audio/video pair')).toBe(compactLink)
    expect(screen.getByText('Compact linked clip').parentElement?.parentElement?.outerHTML).toBe(
      compactLabelMarkup,
    )
    expect(screen.getByTitle('Linked audio/video pair').outerHTML).toBe(compactLinkMarkup)
  })

  it.each([
    {
      kind: 'video',
      detailTestId: 'clip-filmstrip',
      settings: {
        showFilmstrips: true,
        enableFilmstripExtraction: true,
        showWaveforms: false,
      },
    },
    {
      kind: 'audio',
      detailTestId: 'clip-waveform',
      settings: {
        showFilmstrips: false,
        enableFilmstripExtraction: false,
        showWaveforms: true,
      },
    },
    {
      kind: 'image',
      detailTestId: 'image-filmstrip',
      settings: {
        showFilmstrips: true,
        enableFilmstripExtraction: false,
        showWaveforms: false,
      },
    },
  ] as const)(
    'keeps a 36px $kind visual mounted across settled and immediate rendering changes',
    async ({ kind, detailTestId, settings }) => {
      useZoomStore.setState({
        level: 1.08,
        pixelsPerSecond: 108,
        contentLevel: 1.08,
        contentPixelsPerSecond: 108,
        isZoomInteracting: false,
      })
      useSettingsStore.setState(settings)

      const item = {
        id: `dense-${kind}`,
        type: kind,
        trackId: 'track-1',
        from: 0,
        durationInFrames: 10,
        label: `Dense ${kind}`,
        mediaId: 'media-1',
        src: 'blob:test',
      } as TimelineItem
      const props = {
        item,
        clipLeftFrames: 0,
        clipWidthFrames: 10,
        fps: 30,
      }
      const view = render(<ClipContent {...props} />)

      const detailNode = await screen.findByTestId(detailTestId)
      const labelNode = screen.getByText(`Dense ${kind}`)
      expect(detailNode).toHaveAttribute('data-pps', '108')

      view.rerender(<ClipContent {...props} preferImmediateRendering={true} />)

      expect(screen.getByTestId(detailTestId)).toBe(detailNode)
      expect(screen.getByText(`Dense ${kind}`)).toBe(labelNode)

      view.rerender(<ClipContent {...props} preferImmediateRendering={false} />)

      expect(screen.getByTestId(detailTestId)).toBe(detailNode)
      expect(screen.getByText(`Dense ${kind}`)).toBe(labelNode)

      act(() => {
        useZoomStore.setState({
          level: 1.05,
          pixelsPerSecond: 105,
          isZoomInteracting: true,
        })
      })
      expect(screen.getByTestId(detailTestId)).toBe(detailNode)

      act(() => {
        useZoomStore.setState({
          contentLevel: 1.05,
          contentPixelsPerSecond: 105,
          isZoomInteracting: false,
        })
      })
      expect(screen.getByTestId(detailTestId)).toBe(detailNode)
      expect(detailNode).toHaveAttribute('data-pps', '105')
    },
  )

  it.each([
    {
      kind: 'video',
      detailTestId: 'clip-filmstrip',
      belowPixelsPerSecond: 599,
      thresholdPixelsPerSecond: 600,
      settings: {
        showFilmstrips: true,
        enableFilmstripExtraction: true,
        showWaveforms: false,
      },
    },
    {
      kind: 'audio',
      detailTestId: 'clip-waveform',
      belowPixelsPerSecond: 359,
      thresholdPixelsPerSecond: 360,
      settings: {
        showFilmstrips: false,
        enableFilmstripExtraction: false,
        showWaveforms: true,
      },
    },
    {
      kind: 'image',
      detailTestId: 'image-filmstrip',
      belowPixelsPerSecond: 599,
      thresholdPixelsPerSecond: 600,
      settings: {
        showFilmstrips: true,
        enableFilmstripExtraction: false,
        showWaveforms: false,
      },
    },
  ] as const)(
    'promotes $kind content at its real-pixel threshold and follows settled zoom both ways',
    async ({ kind, detailTestId, belowPixelsPerSecond, thresholdPixelsPerSecond, settings }) => {
      useZoomStore.setState({
        level: belowPixelsPerSecond / 100,
        pixelsPerSecond: belowPixelsPerSecond,
        contentLevel: belowPixelsPerSecond / 100,
        contentPixelsPerSecond: belowPixelsPerSecond,
        isZoomInteracting: true,
      })
      useSettingsStore.setState(settings)

      const item = {
        id: `compact-${kind}`,
        type: kind,
        trackId: 'track-1',
        from: 0,
        durationInFrames: 1,
        label: `Compact ${kind}`,
        mediaId: 'media-1',
        src: 'blob:test',
      } as TimelineItem
      render(<ClipContent item={item} clipLeftFrames={0} clipWidthFrames={1} fps={30} />)

      expect(screen.queryByTestId(detailTestId)).not.toBeInTheDocument()
      const labelNode = screen.getByText(`Compact ${kind}`)

      act(() => {
        useZoomStore.setState({
          level: thresholdPixelsPerSecond / 100,
          pixelsPerSecond: thresholdPixelsPerSecond,
          contentLevel: thresholdPixelsPerSecond / 100,
          contentPixelsPerSecond: thresholdPixelsPerSecond,
        })
      })

      const detailNode = await screen.findByTestId(detailTestId)
      expect(detailNode).toHaveAttribute('data-pps', String(thresholdPixelsPerSecond))
      expect(screen.getByText(`Compact ${kind}`)).toBe(labelNode)

      act(() => {
        useZoomStore.setState({
          level: belowPixelsPerSecond / 100,
          pixelsPerSecond: belowPixelsPerSecond,
        })
      })

      expect(screen.queryByTestId(detailTestId)).not.toBeInTheDocument()

      act(() => {
        useZoomStore.setState({
          contentLevel: belowPixelsPerSecond / 100,
          contentPixelsPerSecond: belowPixelsPerSecond,
        })
      })

      expect(screen.queryByTestId(detailTestId)).not.toBeInTheDocument()
      expect(screen.getByText(`Compact ${kind}`)).toBe(labelNode)
    },
  )

  it('mounts newly exposed media at the live zoom-out LOD without a settle teardown', () => {
    useZoomStore.setState({
      level: 50,
      pixelsPerSecond: 5000,
      contentLevel: 50,
      contentPixelsPerSecond: 5000,
      isZoomInteracting: false,
    })
    useSettingsStore.setState({
      showFilmstrips: true,
      enableFilmstripExtraction: true,
      showWaveforms: false,
    })
    useZoomStore.setState({
      level: 0.1,
      pixelsPerSecond: 10,
      isZoomInteracting: true,
    })

    const item = {
      id: 'new-live-zoom-out-video',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 1,
      label: 'New live zoom-out video',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem
    const onRender = vi.fn()

    render(
      <Profiler id="new-live-zoom-out-video" onRender={onRender}>
        <ClipContent item={item} clipLeftFrames={0} clipWidthFrames={1} fps={30} />
      </Profiler>,
    )

    expect(screen.queryByTestId('clip-filmstrip')).not.toBeInTheDocument()
    const initialCommitCount = onRender.mock.calls.length

    act(() => {
      useZoomStore.setState({
        contentLevel: 0.1,
        contentPixelsPerSecond: 10,
        isZoomInteracting: false,
      })
    })

    expect(screen.queryByTestId('clip-filmstrip')).not.toBeInTheDocument()
    expect(onRender).toHaveBeenCalledTimes(initialCommitCount)
  })

  it('demotes a saturated media cohort before settle without a parent rerender', async () => {
    useZoomStore.setState({
      level: 50,
      pixelsPerSecond: 5000,
      contentLevel: 50,
      contentPixelsPerSecond: 5000,
      isZoomInteracting: false,
    })
    useSettingsStore.setState({
      showFilmstrips: true,
      enableFilmstripExtraction: true,
      showWaveforms: false,
    })

    const item = {
      id: 'retained-live-zoom-out-video',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 30,
      label: 'Retained live zoom-out video',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem
    const onRender = vi.fn()
    render(
      <Profiler id="retained-live-zoom-out-video" onRender={onRender}>
        <ClipContent item={item} clipLeftFrames={0} clipWidthFrames={30} fps={30} />
      </Profiler>,
    )

    expect(await screen.findByTestId('clip-filmstrip')).toBeInTheDocument()

    act(() => {
      useZoomStore.setState({
        level: 0.1,
        pixelsPerSecond: 10,
        isZoomInteracting: true,
      })
    })

    expect(screen.queryByTestId('clip-filmstrip')).not.toBeInTheDocument()
    const demotedCommitCount = onRender.mock.calls.length

    act(() => {
      useZoomStore.setState({
        contentLevel: 0.1,
        contentPixelsPerSecond: 10,
        isZoomInteracting: false,
      })
    })

    expect(screen.queryByTestId('clip-filmstrip')).not.toBeInTheDocument()
    expect(onRender).toHaveBeenCalledTimes(demotedCommitCount)
  })

  it('restores live-demoted media after a net-zero zoom reversal', async () => {
    useZoomStore.setState({
      level: 50,
      pixelsPerSecond: 5000,
      contentLevel: 50,
      contentPixelsPerSecond: 5000,
      isZoomInteracting: false,
    })
    useSettingsStore.setState({
      showFilmstrips: true,
      enableFilmstripExtraction: true,
      showWaveforms: false,
    })
    useZoomStore.setState({
      level: 0.1,
      pixelsPerSecond: 10,
      isZoomInteracting: true,
    })

    const item = {
      id: 'net-zero-zoom-video',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 30,
      label: 'Net-zero zoom video',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem

    render(<ClipContent item={item} clipLeftFrames={0} clipWidthFrames={30} fps={30} />)
    expect(screen.queryByTestId('clip-filmstrip')).not.toBeInTheDocument()

    act(() => {
      useZoomStore.setState({
        level: 50,
        pixelsPerSecond: 5000,
        isZoomInteracting: true,
      })
      useZoomStore.setState({
        contentLevel: 50,
        contentPixelsPerSecond: 5000,
        isZoomInteracting: false,
      })
    })

    expect(await screen.findByTestId('clip-filmstrip')).toBeInTheDocument()
  })

  it('isolates detailed video from waveform and composition updates', async () => {
    useSettingsStore.setState({
      showFilmstrips: false,
      enableFilmstripExtraction: true,
      showWaveforms: false,
    })
    const item: TimelineItem = {
      id: 'isolated-video',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Isolated video',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem
    const onRender = vi.fn()

    render(
      <Profiler id="isolated-video" onRender={onRender}>
        <ClipContent item={item} clipLeftFrames={0} clipWidthFrames={96} fps={30} />
      </Profiler>,
    )

    expect(screen.getByText('Isolated video')).toBeInTheDocument()
    const settledCommitCount = onRender.mock.calls.length

    act(() => {
      useSettingsStore.setState({ showWaveforms: true })
    })
    expect(onRender).toHaveBeenCalledTimes(settledCommitCount)

    act(() => {
      addUnrelatedComposition('video-unrelated-composition')
    })
    expect(onRender).toHaveBeenCalledTimes(settledCommitCount)
    expect(screen.queryByTestId('clip-filmstrip')).not.toBeInTheDocument()

    act(() => {
      useSettingsStore.setState({ showFilmstrips: true })
    })
    expect(await screen.findByTestId('clip-filmstrip')).toBeInTheDocument()
    expect(onRender.mock.calls.length).toBeGreaterThan(settledCommitCount)
  })

  it('isolates detailed audio from filmstrip and composition updates', async () => {
    useSettingsStore.setState({
      showFilmstrips: false,
      enableFilmstripExtraction: false,
      showWaveforms: false,
    })
    const item: TimelineItem = {
      id: 'isolated-audio',
      type: 'audio',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Isolated audio',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem
    const onRender = vi.fn()

    render(
      <Profiler id="isolated-audio" onRender={onRender}>
        <ClipContent item={item} clipLeftFrames={0} clipWidthFrames={96} fps={30} />
      </Profiler>,
    )

    expect(screen.getByText('Isolated audio')).toBeInTheDocument()
    const settledCommitCount = onRender.mock.calls.length

    act(() => {
      useSettingsStore.setState({
        showFilmstrips: true,
        enableFilmstripExtraction: true,
      })
    })
    expect(onRender).toHaveBeenCalledTimes(settledCommitCount)

    act(() => {
      addUnrelatedComposition('audio-unrelated-composition')
    })
    expect(onRender).toHaveBeenCalledTimes(settledCommitCount)
    expect(screen.queryByTestId('clip-waveform')).not.toBeInTheDocument()

    act(() => {
      useSettingsStore.setState({ showWaveforms: true })
    })
    expect(await screen.findByTestId('clip-waveform')).toBeInTheDocument()
    expect(onRender.mock.calls.length).toBeGreaterThan(settledCommitCount)
  })

  it('isolates detailed images from waveform and composition updates', async () => {
    useSettingsStore.setState({
      showFilmstrips: false,
      enableFilmstripExtraction: false,
      showWaveforms: false,
    })
    const item: TimelineItem = {
      id: 'isolated-image',
      type: 'image',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Isolated image',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem
    const onRender = vi.fn()

    render(
      <Profiler id="isolated-image" onRender={onRender}>
        <ClipContent item={item} clipLeftFrames={0} clipWidthFrames={96} fps={30} />
      </Profiler>,
    )

    expect(screen.getByText('Isolated image')).toBeInTheDocument()
    const settledCommitCount = onRender.mock.calls.length

    act(() => {
      useSettingsStore.setState({ showWaveforms: true })
    })
    expect(onRender).toHaveBeenCalledTimes(settledCommitCount)

    act(() => {
      addUnrelatedComposition('image-unrelated-composition')
    })
    expect(onRender).toHaveBeenCalledTimes(settledCommitCount)
    expect(screen.queryByTestId('image-filmstrip')).not.toBeInTheDocument()

    act(() => {
      useSettingsStore.setState({ showFilmstrips: true })
    })
    expect(await screen.findByTestId('image-filmstrip')).toBeInTheDocument()
    expect(onRender.mock.calls.length).toBeGreaterThan(settledCommitCount)
  })

  it('keeps detailed static text independent from timeline rendering stores', () => {
    const item: TimelineItem = {
      id: 'isolated-text',
      type: 'text',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Static title clip',
      text: 'Static title body',
      color: '#ffffff',
    } as TimelineItem
    const onRender = vi.fn()
    const view = render(
      <Profiler id="isolated-text" onRender={onRender}>
        <ClipContent item={item} clipLeftFrames={0} clipWidthFrames={96} fps={30} />
      </Profiler>,
    )

    const staticRoot = view.container.firstElementChild
    const staticText = screen.getByText('Static title body')
    const staticMarkup = view.container.innerHTML
    const settledCommitCount = onRender.mock.calls.length

    act(() => {
      useZoomStore.setState({
        level: 2,
        pixelsPerSecond: 200,
        contentLevel: 2,
        contentPixelsPerSecond: 200,
      })
    })
    expect(onRender).toHaveBeenCalledTimes(settledCommitCount)

    act(() => {
      useSettingsStore.setState({
        showFilmstrips: true,
        enableFilmstripExtraction: true,
        showWaveforms: true,
      })
    })
    expect(onRender).toHaveBeenCalledTimes(settledCommitCount)

    act(() => {
      useMediaLibraryStore.setState({
        mediaById: {
          'unrelated-media': {
            fps: 24,
            duration: 10,
          } as never,
        },
      })
    })
    expect(onRender).toHaveBeenCalledTimes(settledCommitCount)

    act(() => {
      addUnrelatedComposition('text-unrelated-composition')
    })
    expect(onRender).toHaveBeenCalledTimes(settledCommitCount)
    expect(view.container.innerHTML).toBe(staticMarkup)
    expect(view.container.firstElementChild).toBe(staticRoot)
    expect(screen.getByText('Static title body')).toBe(staticText)
  })

  it('labels Motion assets as compositions instead of compound clips', () => {
    useCompositionsStore.getState().addComposition({
      id: 'motion-composition',
      name: 'Lower Third',
      editorKind: 'composite-2d',
      tracks: [],
      items: [],
      transitions: [],
      keyframes: [],
      fps: 30,
      width: 1920,
      height: 1080,
      durationInFrames: 90,
    })
    const item: TimelineItem = {
      id: 'motion-wrapper',
      type: 'composition',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 90,
      label: 'Lower Third',
      compositionId: 'motion-composition',
      compositionWidth: 1920,
      compositionHeight: 1080,
      transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
    }

    render(<ClipContent item={item} clipLeftFrames={0} clipWidthFrames={96} fps={30} />)

    expect(screen.getByText('Composition')).toBeInTheDocument()
    expect(screen.queryByText('Compound')).not.toBeInTheDocument()
    expect(screen.getByText('Lower Third')).toBeInTheDocument()
  })

  it('uses settled zoom for filmstrip content by default', async () => {
    // Not interacting: content renders (mid-gesture deferral is covered by its
    // own test below). pixelsPerSecond (180) and contentPixelsPerSecond (100)
    // are set apart purely to verify which one the filmstrip reads.
    useZoomStore.setState({
      level: 1.8,
      pixelsPerSecond: 180,
      contentLevel: 1,
      contentPixelsPerSecond: 100,
      isZoomInteracting: false,
    })
    useSettingsStore.setState({
      showFilmstrips: true,
      enableFilmstripExtraction: true,
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

    // Default (no preferImmediateRendering): filmstrip tracks the SETTLED zoom
    // (contentPixelsPerSecond = 100), not the live in-gesture pps (180). This is
    // what keeps the filmstrip tile grid from re-rendering on every zoom frame.
    expect(await screen.findByTestId('clip-filmstrip')).toHaveAttribute('data-pps', '100')
  })

  it('can opt clip internals into live zoom for immediate edit previews', async () => {
    useZoomStore.setState({
      level: 1.8,
      pixelsPerSecond: 180,
      contentLevel: 1,
      contentPixelsPerSecond: 100,
      isZoomInteracting: false,
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

    expect(await screen.findByTestId('clip-waveform')).toHaveAttribute('data-pps', '180')
  })

  it('mounts the bounded filmstrip for clips that appear during an active zoom gesture', async () => {
    useZoomStore.setState({
      level: 1,
      pixelsPerSecond: 100,
      contentLevel: 1,
      contentPixelsPerSecond: 100,
      isZoomInteracting: true,
    })
    useSettingsStore.setState({
      showFilmstrips: true,
      enableFilmstripExtraction: true,
      showWaveforms: false,
    })

    const item: TimelineItem = {
      id: 'video-defer',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Video clip',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem

    render(<ClipContent item={item} clipLeftFrames={0} clipWidthFrames={96} fps={30} />)

    expect(await screen.findByTestId('clip-filmstrip')).toBeInTheDocument()
    expect(screen.getByText('Video clip')).toBeInTheDocument()
  })

  it('mounts the bounded waveform for clips that appear during an active zoom gesture', async () => {
    useZoomStore.setState({
      level: 1,
      pixelsPerSecond: 100,
      contentLevel: 1,
      contentPixelsPerSecond: 100,
      isZoomInteracting: true,
    })
    useSettingsStore.setState({
      showFilmstrips: false,
      enableFilmstripExtraction: false,
      showWaveforms: true,
    })

    const item: TimelineItem = {
      id: 'audio-during-zoom',
      type: 'audio',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Audio clip',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem

    render(<ClipContent item={item} clipLeftFrames={0} clipWidthFrames={96} fps={30} />)

    expect(await screen.findByTestId('clip-waveform')).toBeInTheDocument()
    expect(screen.getByTestId('clip-waveform')).toHaveAttribute('data-live-timeline-zoom', 'true')
    expect(screen.getByText('Audio clip')).toBeInTheDocument()
  })

  it('keeps narrow detail gated by settled zoom during immediate edit previews', async () => {
    useZoomStore.setState({
      level: 3.6,
      pixelsPerSecond: 360,
      contentLevel: 1,
      contentPixelsPerSecond: 100,
      isZoomInteracting: true,
    })
    useSettingsStore.setState({
      showFilmstrips: false,
      enableFilmstripExtraction: false,
      showWaveforms: true,
    })
    const item: TimelineItem = {
      id: 'short-audio-during-zoom',
      type: 'audio',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 1,
      label: 'Short audio clip',
      mediaId: 'media-1',
      src: 'blob:test',
    } as TimelineItem

    const view = render(<ClipContent item={item} clipLeftFrames={0} clipWidthFrames={1} fps={30} />)

    expect(screen.queryByTestId('clip-waveform')).not.toBeInTheDocument()

    view.rerender(
      <ClipContent
        item={item}
        clipLeftFrames={0}
        clipWidthFrames={1}
        fps={30}
        preferImmediateRendering={true}
      />,
    )

    expect(screen.queryByTestId('clip-waveform')).not.toBeInTheDocument()

    act(() => {
      useZoomStore.setState({
        contentLevel: 3.6,
        contentPixelsPerSecond: 360,
        isZoomInteracting: false,
      })
    })

    expect(await screen.findByTestId('clip-waveform')).toHaveAttribute('data-pps', '360')
  })
})
